# Comprehensive Code Review — 2026-04-18 (deep pass)

**Verdict:** REQUEST CHANGES

## Scope and inventory

I built an explicit inventory first, then reviewed every tracked, human-authored repository file that affects runtime behavior, build/deploy behavior, tests, or documentation. I excluded generated artifacts and binary payloads (`node_modules`, `.next`, uploaded media, screenshots, font binaries, logo SVG, prior review artifacts).

- Reviewed tracked human-authored files: **180**
- **Root docs and config (33)**
  - `.agent/rules/commit-and-push.md`
  - `.dockerignore`
  - `.github/dependabot.yml`
  - `.gitignore`
  - `.nvmrc`
  - `.vscode/extensions.json`
  - `.vscode/launch.json`
  - `.vscode/settings.json`
  - `.vscode/tasks.json`
  - `AGENTS.md`
  - `CLAUDE.md`
  - `README.md`
  - `apps/web/.dockerignore`
  - `apps/web/.env.local.example`
  - `apps/web/.gitignore`
  - `apps/web/Dockerfile`
  - `apps/web/README.md`
  - `apps/web/components.json`
  - `apps/web/deploy.sh`
  - `apps/web/docker-compose.yml`
  - `apps/web/drizzle.config.ts`
  - `apps/web/eslint.config.mjs`
  - `apps/web/next.config.ts`
  - `apps/web/nginx/default.conf`
  - `apps/web/package.json`
  - `apps/web/playwright-test.config.ts`
  - `apps/web/playwright.config.ts`
  - `apps/web/postcss.config.mjs`
  - `apps/web/tailwind.config.ts`
  - `apps/web/tsconfig.json`
  - `apps/web/vitest.config.ts`
  - `package-lock.json`
  - `package.json`
- **App routes, pages, and server actions (46)**
  - `apps/web/src/app/[locale]/[topic]/page.tsx`
  - `apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx`
  - `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
  - `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
  - `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
  - `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`
  - `apps/web/src/app/[locale]/admin/(protected)/error.tsx`
  - `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
  - `apps/web/src/app/[locale]/admin/(protected)/loading.tsx`
  - `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx`
  - `apps/web/src/app/[locale]/admin/(protected)/password/password-client.tsx`
  - `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`
  - `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx`
  - `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`
  - `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx`
  - `apps/web/src/app/[locale]/admin/db-actions.ts`
  - `apps/web/src/app/[locale]/admin/login-form.tsx`
  - `apps/web/src/app/[locale]/admin/page.tsx`
  - `apps/web/src/app/[locale]/error.tsx`
  - `apps/web/src/app/[locale]/g/[key]/page.tsx`
  - `apps/web/src/app/[locale]/globals.css`
  - `apps/web/src/app/[locale]/layout.tsx`
  - `apps/web/src/app/[locale]/loading.tsx`
  - `apps/web/src/app/[locale]/not-found.tsx`
  - `apps/web/src/app/[locale]/p/[id]/page.tsx`
  - `apps/web/src/app/[locale]/page.tsx`
  - `apps/web/src/app/[locale]/s/[key]/page.tsx`
  - `apps/web/src/app/[locale]/uploads/[...path]/route.ts`
  - `apps/web/src/app/actions.ts`
  - `apps/web/src/app/actions/admin-users.ts`
  - `apps/web/src/app/actions/auth.ts`
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/app/actions/public.ts`
  - `apps/web/src/app/actions/sharing.ts`
  - `apps/web/src/app/actions/tags.ts`
  - `apps/web/src/app/actions/topics.ts`
  - `apps/web/src/app/api/admin/db/download/route.ts`
  - `apps/web/src/app/api/health/route.ts`
  - `apps/web/src/app/api/og/route.tsx`
  - `apps/web/src/app/apple-icon.tsx`
  - `apps/web/src/app/global-error.tsx`
  - `apps/web/src/app/icon.tsx`
  - `apps/web/src/app/manifest.ts`
  - `apps/web/src/app/robots.ts`
  - `apps/web/src/app/sitemap.ts`
  - `apps/web/src/app/uploads/[...path]/route.ts`
- **Components (23)**
  - `apps/web/src/components/admin-header.tsx`
  - `apps/web/src/components/admin-nav.tsx`
  - `apps/web/src/components/admin-user-manager.tsx`
  - `apps/web/src/components/footer.tsx`
  - `apps/web/src/components/histogram.tsx`
  - `apps/web/src/components/home-client.tsx`
  - `apps/web/src/components/i18n-provider.tsx`
  - `apps/web/src/components/image-manager.tsx`
  - `apps/web/src/components/image-zoom.tsx`
  - `apps/web/src/components/info-bottom-sheet.tsx`
  - `apps/web/src/components/lightbox.tsx`
  - `apps/web/src/components/load-more.tsx`
  - `apps/web/src/components/nav-client.tsx`
  - `apps/web/src/components/nav.tsx`
  - `apps/web/src/components/optimistic-image.tsx`
  - `apps/web/src/components/photo-navigation.tsx`
  - `apps/web/src/components/photo-viewer.tsx`
  - `apps/web/src/components/search.tsx`
  - `apps/web/src/components/tag-filter.tsx`
  - `apps/web/src/components/tag-input.tsx`
  - `apps/web/src/components/theme-provider.tsx`
  - `apps/web/src/components/topic-empty-state.tsx`
  - `apps/web/src/components/upload-dropzone.tsx`
- **UI primitives (19)**
  - `apps/web/src/components/ui/alert-dialog.tsx`
  - `apps/web/src/components/ui/alert.tsx`
  - `apps/web/src/components/ui/aspect-ratio.tsx`
  - `apps/web/src/components/ui/badge.tsx`
  - `apps/web/src/components/ui/button.tsx`
  - `apps/web/src/components/ui/card.tsx`
  - `apps/web/src/components/ui/dialog.tsx`
  - `apps/web/src/components/ui/dropdown-menu.tsx`
  - `apps/web/src/components/ui/input.tsx`
  - `apps/web/src/components/ui/label.tsx`
  - `apps/web/src/components/ui/progress.tsx`
  - `apps/web/src/components/ui/scroll-area.tsx`
  - `apps/web/src/components/ui/select.tsx`
  - `apps/web/src/components/ui/separator.tsx`
  - `apps/web/src/components/ui/sheet.tsx`
  - `apps/web/src/components/ui/skeleton.tsx`
  - `apps/web/src/components/ui/sonner.tsx`
  - `apps/web/src/components/ui/table.tsx`
  - `apps/web/src/components/ui/textarea.tsx`
- **Library modules (22)**
  - `apps/web/src/lib/action-result.ts`
  - `apps/web/src/lib/api-auth.ts`
  - `apps/web/src/lib/audit.ts`
  - `apps/web/src/lib/base56.ts`
  - `apps/web/src/lib/clipboard.ts`
  - `apps/web/src/lib/constants.ts`
  - `apps/web/src/lib/data.ts`
  - `apps/web/src/lib/image-queue.ts`
  - `apps/web/src/lib/image-types.ts`
  - `apps/web/src/lib/image-url.ts`
  - `apps/web/src/lib/locale-path.ts`
  - `apps/web/src/lib/process-image.ts`
  - `apps/web/src/lib/process-topic-image.ts`
  - `apps/web/src/lib/queue-shutdown.ts`
  - `apps/web/src/lib/rate-limit.ts`
  - `apps/web/src/lib/revalidation.ts`
  - `apps/web/src/lib/safe-json-ld.ts`
  - `apps/web/src/lib/serve-upload.ts`
  - `apps/web/src/lib/session.ts`
  - `apps/web/src/lib/upload-limits.ts`
  - `apps/web/src/lib/utils.ts`
  - `apps/web/src/lib/validation.ts`
- **Database layer (3)**
  - `apps/web/src/db/index.ts`
  - `apps/web/src/db/schema.ts`
  - `apps/web/src/db/seed.ts`
- **Other app source (4)**
  - `apps/web/src/i18n/request.ts`
  - `apps/web/src/instrumentation.ts`
  - `apps/web/src/proxy.ts`
  - `apps/web/src/site-config.example.json`
- **Scripts (11)**
  - `apps/web/scripts/check-api-auth.ts`
  - `apps/web/scripts/entrypoint.sh`
  - `apps/web/scripts/init-db.ts`
  - `apps/web/scripts/migrate-admin-auth.ts`
  - `apps/web/scripts/migrate-aliases.ts`
  - `apps/web/scripts/migrate-capture-date.js`
  - `apps/web/scripts/migrate-titles.ts`
  - `apps/web/scripts/migrate.js`
  - `apps/web/scripts/migration-add-column.ts`
  - `apps/web/scripts/seed-admin.ts`
  - `apps/web/scripts/seed-e2e.ts`
- **Migrations and schema snapshots (5)**
  - `apps/web/drizzle/0000_nappy_madelyne_pryor.sql`
  - `apps/web/drizzle/0001_sync_current_schema.sql`
  - `apps/web/drizzle/meta/0000_snapshot.json`
  - `apps/web/drizzle/meta/0001_snapshot.json`
  - `apps/web/drizzle/meta/_journal.json`
- **Unit tests (6)**
  - `apps/web/src/__tests__/base56.test.ts`
  - `apps/web/src/__tests__/queue-shutdown.test.ts`
  - `apps/web/src/__tests__/rate-limit.test.ts`
  - `apps/web/src/__tests__/revalidation.test.ts`
  - `apps/web/src/__tests__/session.test.ts`
  - `apps/web/src/__tests__/validation.test.ts`
- **E2E tests (5)**
  - `apps/web/e2e/admin.spec.ts`
  - `apps/web/e2e/helpers.ts`
  - `apps/web/e2e/nav-visual-check.spec.ts`
  - `apps/web/e2e/public.spec.ts`
  - `apps/web/e2e/test-fixes.spec.ts`
- **Translations (2)**
  - `apps/web/messages/en.json`
  - `apps/web/messages/ko.json`
- **Public runtime assets (1)**
  - `apps/web/public/histogram-worker.js`

## Evidence gathered

- `npm test --workspace=apps/web` ✅ — 6/6 files, 46/46 tests passed
- `npm run lint --workspace=apps/web` ❌ — fails, including a real `photo-viewer.tsx` hooks violation
- `npm run build --workspace=apps/web` ❌ — production build fails on `/api/og`
- `npm run lint:api-auth --workspace=apps/web` ✅
- Docker compose path sanity check ❌ — `apps/web/docker-compose.yml` resolves `./apps/web/src/site-config.json` to a non-existent host path (`apps/web/apps/web/src/site-config.json`)

---

## Confirmed issues

### 1. Production build is currently broken by an Edge route importing Node-only code
- **Severity:** HIGH
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `apps/web/src/app/api/og/route.tsx:4-6`, `apps/web/src/lib/rate-limit.ts:1-3`
- **Why this is a problem:** `/api/og` is explicitly `runtime = 'edge'`, but it imports `@/lib/rate-limit`, which imports Node’s `net` module and database code. The build already fails with `The edge runtime does not support Node.js 'stream' module` / `net` import traces when collecting `/api/og`.
- **Concrete failure scenario:** A normal `npm run build --workspace=apps/web` fails, so CI/CD or Docker image builds cannot produce a releasable artifact.
- **Suggested fix:** Split the OG route onto an Edge-safe helper with no Node/database imports, or move `/api/og` back to the Node runtime and use a Node-safe rate limiter there.

### 2. `/api/og` rate limiting is effectively disabled even aside from the build break
- **Severity:** HIGH
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `apps/web/src/app/api/og/route.tsx:8-16`
- **Why this is a problem:** The route checks `searchRateLimit.get(ip)`, but never writes to that map and never calls `checkRateLimit`. It only fire-and-forget increments the DB bucket. The limiter therefore never blocks repeated calls inside this route.
- **Concrete failure scenario:** After the Edge import bug is fixed, a bot can hammer `/api/og?topic=...` and keep forcing expensive image generation work without ever hitting the intended 429 path.
- **Suggested fix:** Use the same full check/update flow as `searchImagesAction`: `checkRateLimit(...)`, update the in-memory entry (or remove the map entirely), then increment atomically.

### 3. The documented reverse-proxy deployment collapses all app-level rate limits into one shared `unknown` bucket unless `TRUST_PROXY=true` is set, but that requirement is undocumented
- **Severity:** HIGH
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/rate-limit.ts:43-64`, `apps/web/nginx/default.conf:46-52`, `apps/web/.env.local.example:1-27`
- **Why this is a problem:** The nginx config forwards `X-Real-IP` and `X-Forwarded-For`, but `getClientIp()` ignores both unless `TRUST_PROXY === 'true'`. The example env file does not mention `TRUST_PROXY`. In that default deployment, every request is keyed as `unknown`.
- **Concrete failure scenario:** Five bad admin logins from any source can lock out every admin user for 15 minutes. Search/OG quotas also become effectively global across all visitors.
- **Suggested fix:** Document and set `TRUST_PROXY=true` in the standard reverse-proxy deployment path, or derive trust more safely from a deployment mode instead of silently falling back to a shared `unknown` key.

### 4. Topic aliases can be created with CJK/emoji characters, but those aliases can never resolve at runtime
- **Severity:** HIGH
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/validation.ts:38-46`, `apps/web/src/app/actions/topics.ts:214-249`, `apps/web/src/lib/data.ts:434-462`
- **Why this is a problem:** `createTopicAlias()` accepts any alias matching `isValidTopicAlias()` (including non-ASCII aliases), but `getTopicBySlug()` immediately returns `null` unless the route segment matches `/^[a-z0-9_-]+$/i/` before it even checks `topic_aliases`.
- **Concrete failure scenario:** An admin successfully adds alias `서울` or `✈️`, the UI stores it, but visiting `/<locale>/서울` or `/<locale>/✈️` always 404s.
- **Suggested fix:** Only apply slug-format validation to direct topic slugs. Always allow the alias lookup path to query `topic_aliases` using the raw decoded route segment.

### 5. Shared album order is lost because new `shared_group_images` rows never receive a `position`
- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `apps/web/src/app/actions/sharing.ts:84-99`, `apps/web/src/lib/data.ts:413-426`
- **Why this is a problem:** `getSharedGroup()` sorts by `(position, imageId)`, but `createGroupShareLink()` inserts rows with only `groupId` and `imageId`. Every row gets the default `position = 0`, so ordering falls back to image ID, not share selection order.
- **Concrete failure scenario:** An admin selects images in a deliberate order for a share set, but viewers receive them re-sorted by image ID instead.
- **Suggested fix:** Write `position` during insertion, e.g. `uniqueImageIds.map((imageId, position) => ({ groupId, imageId, position }))`.

### 6. Deleted photos can remain publicly accessible/stale because delete actions do not revalidate photo pages or affected topic pages
- **Severity:** HIGH
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `apps/web/src/app/actions/images.ts:257-315`, `apps/web/src/app/actions/images.ts:317-399`, `apps/web/src/app/[locale]/p/[id]/page.tsx:16-17`, `apps/web/src/app/[locale]/[topic]/page.tsx:10`
- **Why this is a problem:** Public photo pages are cached for **1 week** and topic pages for **1 hour**, but `deleteImage()` / `deleteImages()` only revalidate `'/'` and `'/admin/dashboard'`. They do not invalidate `'/p/:id'` or the affected topic listings.
- **Concrete failure scenario:** A photo is deleted from the admin, but `/<locale>/p/123` can keep serving cached HTML for days, and the topic grid can keep showing the deleted image until the ISR window expires.
- **Suggested fix:** Before deleting, capture the affected `id` and `topic`, then revalidate `'/p/:id'`, `'/<topic>'`, and any share routes that depended on that image, in addition to home/admin pages.

### 7. Tag and topic mutations leave cached public pages stale because revalidation only covers admin pages (and sometimes the individual photo page)
- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `apps/web/src/app/actions/tags.ts:88-149`, `apps/web/src/app/actions/topics.ts:135-173`, `apps/web/src/app/actions/topics.ts:179-274`, `apps/web/src/app/[locale]/page.tsx:11`, `apps/web/src/app/[locale]/[topic]/page.tsx:10`
- **Why this is a problem:** Home/topic pages are ISR-cached, but:
  - tag add/remove only revalidate `'/p/:id'` and `'/admin/dashboard'`;
  - topic update/delete/alias actions only revalidate admin categories and `'/'`;
  - old/new topic or alias paths are never invalidated.
- **Concrete failure scenario:** A topic slug rename or alias change leaves old topic URLs and old nav/topic labels stale for up to an hour; adding/removing tags leaves tag-derived gallery cards and filters stale on public pages.
- **Suggested fix:** Revalidate both old and new topic/alias paths, plus affected home/topic pages for tag mutations.

### 8. `docker-compose.yml` mounts the wrong host path for `site-config.json`
- **Severity:** HIGH
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `apps/web/docker-compose.yml:16-19`
- **Why this is a problem:** Because the compose file lives in `apps/web/`, the source `./apps/web/src/site-config.json` resolves to `apps/web/apps/web/src/site-config.json`, which does not exist.
- **Concrete failure scenario:** `docker compose -f apps/web/docker-compose.yml up` either fails to start cleanly or mounts the wrong thing, so the container does not get the intended site configuration file.
- **Suggested fix:** Change the source to `./src/site-config.json` (or another path resolved relative to the compose file directory).

### 9. CSV export corrupts timezone-less `capture_date` values by converting them through `Date` and `toISOString()`
- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `apps/web/src/app/[locale]/admin/db-actions.ts:51-60`
- **Why this is a problem:** `capture_date` is stored as a MySQL `DATETIME` without timezone specifically to preserve the original EXIF local timestamp. Exporting it via `new Date(row.captureDate).toISOString()` reinterprets it and adds timezone conversion.
- **Concrete failure scenario:** A photo stored as `2025-01-01 08:00:00` exports as `2024-12-31T23:00:00.000Z` on a UTC+9 server, silently shifting the timestamp.
- **Suggested fix:** Export the raw `DATETIME` string (or a deliberately timezone-free formatted string) instead of round-tripping through `Date`.

### 10. Migration state disagrees with runtime schema about the default value of `images.processed`
- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `apps/web/src/db/schema.ts:60`, `apps/web/drizzle/0000_nappy_madelyne_pryor.sql:37-40`, `apps/web/scripts/migrate.js:239-243`
- **Why this is a problem:** The TypeScript schema says `processed` defaults to `false`, but both the committed SQL migration and the legacy-schema reconciler create `processed DEFAULT true`. Fresh or repaired databases therefore do not match the application schema contract.
- **Concrete failure scenario:** Any insert path that omits `processed` (future script, manual import, or raw SQL tool) will create a row marked processed before variants exist, producing broken public image URLs and queue bootstrap gaps.
- **Suggested fix:** Ship a corrective migration that changes the DB default to `false`, and update `scripts/migrate.js` so legacy reconciliation matches the runtime schema.

### 11. `drizzle.config.ts` builds a raw MySQL URL without encoding credentials
- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `apps/web/drizzle.config.ts:6-11`
- **Why this is a problem:** Username/password are interpolated directly into a URI. Reserved URL characters such as `@`, `:`, `/`, or `#` break the connection string. The app runtime does not have this problem because it passes fields separately to `mysql2`.
- **Concrete failure scenario:** A perfectly valid password like `abc@123` makes `drizzle-kit push` fail even though the application itself can connect.
- **Suggested fix:** Use separate `host`/`port`/`user`/`password` fields if supported, or wrap credentials with `encodeURIComponent`.

### 12. Two E2E suites ignore the configured Playwright base URL and hardcode `http://localhost:3000`
- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `apps/web/playwright.config.ts:7-20`, `apps/web/e2e/nav-visual-check.spec.ts:1-5`, `apps/web/e2e/test-fixes.spec.ts:1-6`
- **Why this is a problem:** The main Playwright config runs the app on `127.0.0.1:${E2E_PORT || 3100}`, but these specs bypass `baseURL` and always hit `localhost:3000`.
- **Concrete failure scenario:** Running the documented/default E2E config on port 3100 causes these tests to hit the wrong server or fail outright.
- **Suggested fix:** Replace hardcoded `BASE` constants with relative URLs (`/en`) or derive from `test.info().project.use.baseURL`.

### 13. `photo-viewer.tsx` currently violates the hooks rules and ships incorrect memo dependencies
- **Severity:** HIGH
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `apps/web/src/components/photo-viewer.tsx:128-176`
- **Why this is a problem:** `useMemo` is called after `if (!image) return ...`, so the component changes hook order across renders. The dependency list also omits values used inside the memo (`t`, `image.height`, `image.filename_jpeg`, and the full `image` object shape). ESLint already fails on this file.
- **Concrete failure scenario:** Current linting is red, and under state changes where `image` becomes temporarily unavailable/available the component can hit undefined behavior or stale alt/src calculations.
- **Suggested fix:** Move the memo above the early return (or eliminate the memo), and include the actual dependencies or derive a plain render helper instead.

---

## Likely issues

### 14. Responsive `srcSet` descriptors overstate actual pixel widths for small source images
- **Severity:** MEDIUM
- **Confidence:** Medium
- **Status:** Likely issue
- **Files:** `apps/web/src/lib/process-image.ts:366-399`, `apps/web/src/components/photo-viewer.tsx:153-163`, `apps/web/src/components/lightbox.tsx:140-158`
- **Why this is probably a problem:** When the original image is smaller than 1536/2048/4096px, `processImageFormats()` reuses the same smaller render but still writes files named `_1536`, `_2048`, `_4096`. The viewer and lightbox then advertise those files with matching width descriptors, even though the pixels are not actually that wide.
- **Concrete failure scenario:** A 900px-wide source can still advertise a `4096w` candidate. The browser may choose what it believes is a high-resolution asset on a high-DPI display, but it only receives a 900px image, causing softer rendering than expected.
- **Suggested fix:** Only emit descriptors up to the real output width, or generate metadata describing the actual width of each emitted file and build the `srcSet` from that.

### 15. Infinite-scroll results can append stale data after a topic/tag change because in-flight requests are not invalidated
- **Severity:** MEDIUM
- **Confidence:** Medium
- **Status:** Likely issue
- **Files:** `apps/web/src/components/load-more.tsx:28-61`, `apps/web/src/components/home-client.tsx:148-156`
- **Why this is probably a problem:** `LoadMore` resets state when `queryKey` changes, but an already-started `loadMoreImages(...)` promise is not cancelled or version-checked. When it resolves, `HomeClient` blindly appends the returned images.
- **Concrete failure scenario:** A user changes tags while a background load-more request for the old filter is still in flight; the old result arrives late and appends unrelated images into the new filtered gallery.
- **Suggested fix:** Track a request token/query version and ignore late responses that no longer match the current filter/topic key.

---

## Risks needing manual validation

### 16. Admin dashboard bulk-selection state may survive pagination changes and act on hidden rows
- **Severity:** MEDIUM
- **Confidence:** Medium
- **Status:** Risk needing manual validation
- **Files:** `apps/web/src/components/image-manager.tsx:55-72`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:37-66`
- **Why this might be a problem:** `ImageManager` resets `images` when `initialImages` changes, but it does **not** reset `selectedIds`. If App Router preserves the client component instance across `?page=` navigation, selections from page 1 can carry into page 2.
- **Concrete failure scenario:** An admin selects images on page 1, navigates to page 2, then bulk-deletes or shares while the hidden page-1 IDs are still selected.
- **Suggested fix:** Clear selection whenever `initialImages` or the current page changes, or key the component by page so it remounts.

---

## Test and coverage gaps exposed by the review

These issues were not protected by the current automated suite:

- No test covers non-ASCII topic aliases end-to-end.
- No test checks shared-group ordering / `position`.
- No test verifies ISR revalidation after deletes, tag edits, or topic slug/alias changes.
- No test validates Docker compose host-path correctness.
- No test covers `/api/og` in a production build.
- No test checks CSV capture-date exports for timezone drift.
- No test ensures E2E specs use Playwright’s configured base URL/port.

---

## Final missed-issues sweep

I did a separate final sweep specifically for commonly missed areas:

- **Build/runtime mismatches:** checked `next build`, edge-runtime usage, Node-only imports, middleware/runtime boundaries.
- **Cache invalidation:** cross-checked every `revalidateLocalizedPaths(...)` call against pages that declare `revalidate`.
- **Deployment/config:** reviewed Dockerfile, docker-compose, nginx, env example, deploy script, drizzle config.
- **Cross-file data flow:** traced uploads → DB → queue → public rendering; sharing creation → shared page ordering; topic aliases create → route resolution.
- **Tests/docs:** reviewed unit tests, E2E tests, README/app README/CLAUDE, and looked for code-doc mismatches.

**Conclusion of final sweep:** no additional human-authored tracked file outside the inventory above was intentionally skipped. The main unresolved concerns after the sweep are the 13 confirmed issues, 2 likely issues, and 1 manual-validation risk listed above.
