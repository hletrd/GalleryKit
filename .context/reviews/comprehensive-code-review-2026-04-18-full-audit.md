# Comprehensive Code Review — 2026-04-18 (full audit)

**Verdict:** REQUEST CHANGES

## Scope and inventory

I started by building a repository inventory from `git ls-files`, then reviewed every **review-relevant, human-authored source-of-truth file** affecting runtime behavior, build/deploy behavior, tests, or project documentation.

### Included and examined
- Root docs/config: `README.md`, `CLAUDE.md`, `package.json`, `.dockerignore`, `.gitignore`, `.nvmrc`, `.github/dependabot.yml`, `.vscode/*`, `.agent/rules/commit-and-push.md`, `AGENTS.md`
- App config/deploy: `apps/web/{package.json,README.md,.env.local.example,Dockerfile,docker-compose.yml,deploy.sh,drizzle.config.ts,eslint.config.mjs,next.config.ts,nginx/default.conf,playwright*.ts,postcss.config.mjs,tailwind.config.ts,tsconfig*.json,vitest.config.ts,components.json}`
- Database layer: `apps/web/src/db/*`
- Migrations and migration metadata: `apps/web/drizzle/*`
- Runtime/backend logic: `apps/web/src/lib/*`, `apps/web/src/instrumentation.ts`, `apps/web/src/proxy.ts`, `apps/web/src/i18n/request.ts`
- App routes/pages/server actions: all tracked files under `apps/web/src/app/**`
- UI/components: all tracked files under `apps/web/src/components/**`
- Tests: all tracked files under `apps/web/src/__tests__/*` and `apps/web/e2e/*`
- Scripts: all tracked files under `apps/web/scripts/*`
- I18n/runtime assets: `apps/web/messages/{en,ko}.json`, `apps/web/public/histogram-worker.js`, `apps/web/src/site-config.example.json`
- Context docs relevant to current repo state: `.context/plans/*`

### Explicitly excluded as non-source-of-truth / non-reviewable artifacts
- Generated/runtime state: `.next/`, `node_modules/`, `.omx/`, `.omc/`, uploaded media under `public/uploads/`
- Binary/artifact payloads: screenshot PNGs under `.context/reviews/ui-ux-artifacts-2026-04-18/`, the bundled font binary, and the logo asset
- Prior review documents under `.context/reviews/` were not treated as source-of-truth for this audit (I used them only as historical context after doing my own pass)

### Inventory coverage summary
I examined the full relevant repository surface across these categories:
- App routes/actions: 48 files
- Components: 24 files
- UI primitives: 19 files
- Library modules: 23 files
- DB layer: 3 files
- Scripts: 11 files
- Migrations/meta: 6 files
- Unit + E2E tests: 12 files
- App config/deploy/i18n/runtime assets/docs: remaining tracked review-relevant files

## Verification executed

- `npm run lint --workspace=apps/web` ✅ passed
- `npm test --workspace=apps/web` ✅ passed (`51` tests across `7` files)
- `npm run build --workspace=apps/web` ✅ passed
  - Important build evidence: the route manifest showed `/icon` and `/apple-icon`, **not** `/icon.png` / `/apple-icon.png`
- Translation key parity check (`apps/web/messages/en.json` vs `ko.json`) ✅ no missing keys

---

## Confirmed issues

### 1) Locale URL generation is internally inconsistent with `localePrefix: 'as-needed'`, causing duplicate/default-locale URLs in metadata, sitemap, and navigation
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Files / regions:**
  - `apps/web/src/proxy.ts:5-9`
  - `apps/web/src/app/[locale]/layout.tsx:22-26`
  - `apps/web/src/app/sitemap.ts:24-45`
  - `apps/web/src/components/nav-client.tsx:41-45`
  - `apps/web/src/app/[locale]/(public)/page.tsx:31-48`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:102-108`
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:52-60`
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:24-38`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:24-40`
- **Why this is a problem:** The middleware explicitly configures `localePrefix: 'as-needed'`, which makes the default locale canonical URL unprefixed. But the app still emits `/en/...` URLs in alternates, sitemap entries, page-level canonical/OG URLs, and even the nav logo home link. At the same time, some structured data paths omit the locale entirely (for example the topic gallery JSON-LD `url` field).
- **Concrete failure scenario:** Crawlers and users can see multiple URL shapes for the same English content (`/topic`, `/en/topic`, and locale-less structured data URLs). Korean topic pages also emit JSON-LD URLs pointing to `/${topic}` instead of `/ko/${topic}`.
- **Suggested fix:** Centralize public URL generation with a locale-aware helper that respects `localePrefix: 'as-needed'`, and use it everywhere: alternates, sitemap, canonical URLs, structured data, nav links, and redirects.

### 2) Upload replacement is keyed only by `user_filename`, so unrelated photos can be silently overwritten across the whole gallery
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Files / regions:**
  - `apps/web/src/app/actions/images.ts:72-88`
- **Why this is a problem:** The upload path treats any existing row with the same `user_filename` as a replacement target. Camera/export filenames like `IMG_0001.JPG`, `DSC0001.ARW`, or `PXL_0001.jpg` are commonly reused across folders, dates, and topics.
- **Concrete failure scenario:** An admin uploads `IMG_0001.JPG` into a new topic months later, and the app updates the most recent existing `IMG_0001.JPG` row instead of creating a new image. The old image’s metadata, originals, and variants are mutated even though the files are unrelated.
- **Suggested fix:** Do not infer replacement from a bare filename. Require an explicit replace target, or match on a stronger identity such as content hash plus explicit user confirmation (or at minimum scope replacement to a safer invariant than global `user_filename`).

### 3) A failed replacement upload deletes the previous original file before the new upload is validated, leaving the database and disk out of sync
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Files / regions:**
  - `apps/web/src/app/actions/images.ts:105-115`
  - `apps/web/src/lib/process-image.ts:222-250`
- **Why this is a problem:** `saveOriginalAndGetMetadata(..., {id})` calls `deleteByPrefix()` immediately when replacing an existing image. If the new file later fails to save or fails Sharp metadata parsing, the old original is already gone and the DB row has not yet been updated.
- **Concrete failure scenario:** An admin replaces an existing RAW file with a corrupt HEIC upload. The function deletes the old original, then throws during metadata parsing. The row still points to the old image record, the processed variants remain from the previous version, but the original file is gone forever.
- **Suggested fix:** Stage the new original under a temporary name first, validate it fully, then atomically swap/update the DB and only afterwards delete the old original.

### 4) Share links can be created for unprocessed images from the admin dashboard, producing dead or partial public shares
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Files / regions:**
  - `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:13-17`
  - `apps/web/src/components/image-manager.tsx:134-152`
  - `apps/web/src/app/actions/sharing.ts:13-104`
  - `apps/web/src/lib/data.ts:347-364`
  - `apps/web/src/lib/data.ts:413-423`
- **Why this is a problem:** The admin dashboard intentionally includes unprocessed images, and the bulk-share flow exposes them. But the public share readers only return `processed = true` images.
- **Concrete failure scenario:** An admin uploads a batch and immediately clicks “Share”. The copied photo-share URL 404s until processing finishes; a group-share link can open with missing images or even an empty group if all selected items are still unprocessed.
- **Suggested fix:** Gate share creation on `processed = true`, or surface a processing-state wait/disable in the admin UI before generating and copying public links.

### 5) The SQL restore scanner can reject legitimate backups because it searches inside quoted data strings, not just SQL syntax
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Files / regions:**
  - `apps/web/src/app/[locale]/admin/db-actions.ts:212-264`
- **Why this is a problem:** The restore validator strips comments, but it does **not** strip SQL string literals before applying patterns like `/\bGRANT\s/i`, `/\bPREPARE\b/i`, `/\bEXECUTE\b/i`, etc. Those regexes will match ordinary user content embedded in `INSERT` statements.
- **Concrete failure scenario:** A backup containing a photo title/description such as `Grant Morrison`, `Execute`, or `Prepare for Landing` can be rejected as “SQL file contains disallowed statements” even though the dump is harmless.
- **Suggested fix:** Parse/scan only statement keywords outside quoted literals, or tokenize SQL before applying the dangerous statement denylist.

### 6) The categories screen does not refresh its list after successful create, update, or delete operations
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Files / regions:**
  - `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:41-69`
  - Contrast: `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:43-60`
- **Why this is a problem:** `TopicManager` calls server actions and shows success toasts, but it neither updates `initialTopics` locally nor calls `router.refresh()` after success. The tags screen *does* refresh, which highlights the inconsistency.
- **Concrete failure scenario:** An admin creates or renames a category, gets a success toast, and still sees the old table state until manually reloading or navigating away.
- **Suggested fix:** After successful category mutations, either update local state optimistically or call `router.refresh()` consistently.

### 7) The admin users screen has the same stale-state bug: successful create/delete actions do not refresh the list
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Files / regions:**
  - `apps/web/src/components/admin-user-manager.tsx:30-50`
  - `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx:1-20`
- **Why this is a problem:** `AdminUserManager` shows success toasts but does not update its `users` prop-derived list or refresh the route.
- **Concrete failure scenario:** An admin creates a second user, sees a success toast, and the table still shows the old user list. They may retry and accidentally create duplicate operations or think the action failed.
- **Suggested fix:** Refresh the route or update the local user list after success.

### 8) Shared-group viewer navigation changes local state without updating `?photoId=`, so the URL, refresh state, and shareable deep-link drift apart
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Files / regions:**
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:58-107`
  - `apps/web/src/components/photo-viewer.tsx:66-83`
- **Why this is a problem:** The shared-group route uses `?photoId=` to select the initial image, but once inside `PhotoViewer`, arrow navigation only mutates `currentImageId` in local state.
- **Concrete failure scenario:** A recipient opens `/ko/g/abc?photoId=10`, navigates to image `12` with arrows, then refreshes or copies the URL. The page reopens on `10`, not `12`, and any deep-link/bookmark no longer matches what the user was viewing.
- **Suggested fix:** In shared-group mode, update the query string with `router.replace()` whenever the current image changes.

### 9) The layout hierarchy creates nested `<main>` landmarks and breaks the global skip link on admin pages
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Files / regions:**
  - `apps/web/src/app/[locale]/layout.tsx:77-89`
  - `apps/web/src/app/[locale]/(public)/layout.tsx:7-10`
  - `apps/web/src/app/[locale]/admin/layout.tsx:13-18`
- **Why this is a problem:** The root locale layout already renders a `<main>`, and both the public and admin child layouts render their own `<main>`. On top of that, the root skip link always targets `#main-content`, which does not exist on admin pages (`#admin-content` is used there instead).
- **Concrete failure scenario:** Screen-reader users get duplicate main landmarks, and keyboard users on admin pages trigger a skip link whose target ID is missing.
- **Suggested fix:** Let child layouts own the single `<main>` landmark and move the shared wrapper in the root layout to a non-landmark container. Normalize skip-link target IDs across public and admin shells.

### 10) Search results can race out of order and show stale data from an older query
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Files / regions:**
  - `apps/web/src/components/search.tsx:31-55`
- **Why this is a problem:** `performSearch()` awaits the server action and unconditionally writes `setResults(data)` when it resolves. There is no request token, abort, or stale-response guard.
- **Concrete failure scenario:** A user types `land`, then quickly `landscape`. If the `land` request returns after the `landscape` request, the UI can briefly show results for the older query even though the input holds the newer text.
- **Suggested fix:** Track a monotonically increasing request ID (or use an abortable fetch path) and ignore responses that are not from the latest query.

### 11) The web manifest points to `/icon.png` and `/apple-icon.png`, but the build only exposes `/icon` and `/apple-icon`
- **Severity:** Medium
- **Confidence:** Medium
- **Status:** Likely issue, strongly supported by build output
- **Files / regions:**
  - `apps/web/src/app/manifest.ts:13-23`
  - Build evidence from `npm run build --workspace=apps/web`: route list included `/icon` and `/apple-icon`, not `.png` variants
- **Why this is a problem:** The manifest hardcodes icon asset paths that do not correspond to any route shown by the production build.
- **Concrete failure scenario:** Installed PWA/app-icon fetches can 404, leaving browsers without the intended manifest icons.
- **Suggested fix:** Point the manifest at the actual metadata-route URLs or add matching static files at the exact `.png` paths you declare.

### 12) Tag-filter clicks do extra work because they trigger both a navigation and a forced refresh
- **Severity:** Low
- **Confidence:** High
- **Status:** Confirmed
- **Files / regions:**
  - `apps/web/src/components/tag-filter.tsx:18-40`
- **Why this is a problem:** `router.push(...)` already triggers a route transition. Calling `router.refresh()` immediately afterward forces a second fetch/render cycle for the same state.
- **Concrete failure scenario:** Every tag click does duplicate server work (more DB queries, more rerenders), which is especially noticeable on slower devices or larger galleries.
- **Suggested fix:** Remove the explicit `router.refresh()` unless you can point to a concrete stale-cache scenario that `push()` alone does not handle.

### 13) Topic pages still render the generic “Latest Uploads” heading instead of the current topic label
- **Severity:** Low
- **Confidence:** High
- **Status:** Confirmed
- **Files / regions:**
  - `apps/web/src/components/home-client.tsx:187-199`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:116-127`
- **Why this is a problem:** The topic route uses the generic home gallery component without passing any heading override, so the page title in content does not match the route context.
- **Concrete failure scenario:** A user browsing `/ko/travel` sees page metadata for the Travel topic, but the visible H1 still says “Latest Uploads”.
- **Suggested fix:** Pass the topic label into `HomeClient` (or split a topic-specific header component) so the on-page heading matches the route.

### 14) The documented Docker deployment path is not actually “single-command Docker ready” across common environments
- **Severity:** Low
- **Confidence:** High
- **Status:** Confirmed
- **Files / regions:**
  - `README.md:39,133-140`
  - `apps/web/docker-compose.yml:10-19`
  - `apps/web/deploy.sh:11-25`
- **Why this is a problem:** The README markets the project as “Docker Ready — standalone output, single-command deployment”, but the compose file requires `network_mode: host` and a host-side `src/site-config.json` bind mount. `deploy.sh` also tells users to provide `DATABASE_URL`, even though the app uses `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`.
- **Concrete failure scenario:** A macOS/Windows Docker Desktop user follows the README and either cannot use host networking as intended or cannot satisfy the undocumented host bind-mount / env expectations.
- **Suggested fix:** Either provide a portable compose setup (named network + DB service/host alias + documented config file workflow) or document the Linux-host-only requirements explicitly and fix the deploy script messaging.

### 15) `CLAUDE.md` claims there is “No formal test suite”, which is now false and will mislead maintainers
- **Severity:** Low
- **Confidence:** High
- **Status:** Confirmed
- **Files / regions:**
  - `CLAUDE.md:207-209`
  - Counter-evidence: tracked tests under `apps/web/src/__tests__/*` and `apps/web/e2e/*`
- **Why this is a problem:** Documentation is part of the repository contract. This file now instructs maintainers to behave as if the repo has no test suite, even though it has both unit and Playwright coverage.
- **Concrete failure scenario:** A future maintainer or AI tool skips running existing tests because the repo guidance says they do not exist.
- **Suggested fix:** Update `CLAUDE.md` to reflect the actual unit/E2E test surface and the relevant commands.

---

## Likely issues / risks needing manual validation

### A) `getClientIp()` walks `X-Forwarded-For` from the right, which is wrong for multi-proxy/CDN chains
- **Severity:** Medium
- **Confidence:** Medium
- **Status:** Likely issue
- **Files / regions:**
  - `apps/web/src/lib/rate-limit.ts:43-61`
- **Why it may be a problem:** With `TRUST_PROXY=true`, the code returns the **right-most** valid IP in the `X-Forwarded-For` chain. In multi-proxy deployments, the original client is usually the **left-most** IP.
- **Concrete failure scenario:** Behind a CDN + nginx, many different end users could collapse onto the CDN/proxy address for login/search quotas, weakening or distorting per-user throttling.
- **Suggested fix:** If the deployment trusts the full XFF chain, use the left-most client IP (or explicitly configure trusted proxy depth).

### B) `/api/og` has no app-level rate limiting and relies entirely on cache/proxy/platform controls
- **Severity:** Medium
- **Confidence:** Medium
- **Status:** Risk needing manual validation
- **Files / regions:**
  - `apps/web/src/app/api/og/route.tsx:1-134`
- **Why it may be a problem:** The endpoint is public, dynamically renders images, and accepts unbounded topic/tag combinations within the current validation rules. There is no app-level throttle.
- **Concrete failure scenario:** A bot can vary `topic`/`tags` inputs to generate many cache misses and repeatedly force expensive image generation work.
- **Suggested fix:** Either document that upstream/CDN rate limiting is required, or add an explicit app-level throttle for this route.

### C) Shared-group view counts can undercount around process shutdown because increments are buffered in memory with no shutdown flush
- **Severity:** Low
- **Confidence:** Medium
- **Status:** Risk needing manual validation
- **Files / regions:**
  - `apps/web/src/lib/data.ts:7-26`
  - No corresponding flush hook in `apps/web/src/instrumentation.ts`
- **Why it may be a problem:** Group view counts are batched on a 5-second timer. If the process exits before the timer fires, recent views are lost.
- **Concrete failure scenario:** A rollout/restart right after traffic spikes loses the last few seconds of share-view increments.
- **Suggested fix:** Flush buffered group counts during shutdown, or record counts synchronously if the metric matters.

---

## Test gaps highlighted by this review

The current automated coverage does **not** lock in several behaviors that are currently at risk:
- No test covers accidental filename-based overwrite behavior in `uploadImages()`.
- No test covers replacement-failure safety around `saveOriginalAndGetMetadata(..., {id})`.
- No test covers the restore scanner’s false-positive behavior on quoted SQL string content.
- No test covers admin users/categories list refresh after successful mutations.
- No test covers shared-link generation on unprocessed images.
- No test covers shared-group navigation preserving `photoId` in the URL.
- No test covers locale/canonical/sitemap URL consistency under `localePrefix: 'as-needed'`.
- No test covers manifest icon URL correctness.

---

## Final missed-issues sweep

I did a final targeted sweep for commonly missed classes of problems after the main review:
- **Locale/canonical drift:** searched metadata, sitemap, canonical, and explicit `/${locale}` link construction
- **Landmark/accessibility issues:** searched all `<main>` landmarks and skip-link IDs
- **State-refresh issues after mutations:** compared admin screens for `router.refresh()` / local optimistic updates
- **Restore/backup hazards:** rechecked DB dump/restore and path/regex logic
- **Upload replacement hazards:** rechecked replace paths, original-file lifecycle, and queue interactions
- **Share-link state consistency:** traced admin share creation through public data readers
- **Manifest/runtime asset mismatches:** cross-checked manifest declarations against build routes
- **Docs/code drift:** rechecked README/CLAUDE/deploy script against the current code paths

I did **not** find evidence that relevant human-authored runtime/build/test/docs files were skipped. The remaining blind spots are environment-dependent deployment behaviors that need live validation (for example multi-proxy IP chains and live DB restore on a populated database).
