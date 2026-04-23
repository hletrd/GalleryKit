# Test & Quality Review

## Review Scope

### Inventory reviewed
- Governance/docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`
- Manifests/config: root `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `.github/*`
- Automated tests: all 37 Vitest files under `apps/web/src/__tests__/`, all Playwright specs/helpers under `apps/web/e2e/`
- Application code: all review-relevant `apps/web/src/**` modules, with special attention to server actions, API routes, data layer, queue/restore paths, metadata routes, and client flows that are only covered end-to-end

### Verification run
- `npm test --workspace=apps/web` → **37 passed / 203 passed**
- `npm run test:e2e --workspace=apps/web -- --grep "homepage|search|photo page|shared-group|mobile nav|desktop nav|photo info|desktop photo navigation"` → **12 passed**

---

## Findings

### 1) Server-side admin creation ignores password confirmation entirely
- **File / region:** `apps/web/src/components/admin-user-manager.tsx:35-43`, `apps/web/src/app/actions/admin-users.ts:68-159`
- **Problem:** The only password-confirmation check lives in the client component. The server action never reads or validates `confirmPassword`, so a direct server-action submission can create an account with mismatched credentials.
- **Concrete failure scenario:** A browser extension, crafted request, or future UI refactor submits `password=correct horse battery staple` and `confirmPassword=correct horse battery staplex`. The action still creates the admin user, leaving an account whose intended password was never actually confirmed.
- **Suggested fix:** Validate `confirmPassword` in `createAdminUser()` and reject mismatches server-side; add a unit test that posts mismatched passwords straight to the action.
- **Severity:** High
- **Confidence:** High
- **Status:** **Confirmed**

### 2) “Visual check” Playwright specs are not asserting anything visual
- **File / region:** `apps/web/e2e/nav-visual-check.spec.ts:5-29`
- **Problem:** These specs only write screenshots to disk with `page.screenshot(...)`; they never compare against a baseline with `expect(...).toHaveScreenshot()` or any diffing assertion.
- **Concrete failure scenario:** The mobile nav regresses so controls overlap or disappear, but the spec still passes because saving a PNG is not a verification step.
- **Suggested fix:** Convert these to snapshot assertions (`toHaveScreenshot`) or wire them to a visual-diff workflow with committed baselines and CI artifacts.
- **Severity:** Medium
- **Confidence:** High
- **Status:** **Confirmed**

### 3) Default E2E runs skip the admin surface entirely
- **File / region:** `apps/web/e2e/admin.spec.ts:4-7`, `apps/web/e2e/helpers.ts:15`, `apps/web/playwright.config.ts:13-16`, `apps/web/package.json:14`
- **Problem:** The whole admin suite is opt-in via `E2E_ADMIN_ENABLED`. The default `npm run test:e2e` path therefore does not cover login, protected-route redirects, admin navigation, uploads, password change, or DB UI.
- **Concrete failure scenario:** A regression breaks `/admin` login or dashboard uploads, but the standard Playwright run stays green because the broken flows never execute.
- **Suggested fix:** Split admin coverage into a seeded, non-destructive smoke lane that runs by default in CI/local verification, and keep destructive/remote cases behind an explicit flag.
- **Severity:** High
- **Confidence:** High
- **Status:** **Confirmed**

### 4) Critical auth flows have no direct action-level regression protection
- **File / region:** `apps/web/src/app/actions/auth.ts:70-389`, `apps/web/src/lib/session.ts:16-145`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/auth-rate-limit.ts:10-107`
- **Problem:** The repository tests session helpers and some rate-limit utilities, but not the actual login/logout/password-change actions that compose same-origin checks, cookie issuance, DB-backed rollback logic, and session invalidation.
- **Concrete failure scenario:** A small change to `login()` or `updatePassword()` breaks same-origin enforcement, stops clearing success buckets, or leaves stale sessions alive after password change. The current suite would likely miss it until manual admin testing.
- **Suggested fix:** Add action-level tests with mocked `headers()`, `cookies()`, translations, DB calls, and redirect handling for: invalid origin, invalid credentials, successful login, rollback on session insert failure, password change success, and session invalidation.
- **Severity:** Critical
- **Confidence:** High
- **Status:** **Likely risk**

### 5) Backup/restore code is high-risk and largely untested
- **File / region:** `apps/web/src/app/[locale]/admin/db-actions.ts:107-436`
- **Problem:** The code shells out to `mysqldump`/`mysql`, manages advisory locks, scans uploaded SQL for dangerous statements, pauses/resumes queue processing, and cleans temp files. Only the authenticated download route and a couple of helper utilities are covered today.
- **Concrete failure scenario:** A restore failure on `stdin`, a partial pipeline write, or a scan rejection could leave temp files behind, mis-report success/failure, or return the app from maintenance with the queue in the wrong state.
- **Suggested fix:** Extract child-process orchestration behind injectable helpers and add focused tests for dump spawn failure, write-stream flush failure, SQL-scan rejection, restore stdin errors, maintenance begin/end symmetry, and lock release.
- **Severity:** Critical
- **Confidence:** High
- **Status:** **Likely risk**

### 6) Share-link creation/revocation paths have no dedicated tests despite concurrency-sensitive logic
- **File / region:** `apps/web/src/app/actions/sharing.ts:78-344`, cross-file with `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:27-188` and `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:32-129`
- **Problem:** The share actions implement rate limiting, collision retries, conditional revoke updates, and transactional group creation, but none of these branches are covered by unit tests or generated through E2E from the admin UI.
- **Concrete failure scenario:** A regression in the conditional revoke path returns `success` while leaving the old share key live, or a transaction partial-failure produces a group row without the expected image links. Public share pages then 404 or expose stale links.
- **Suggested fix:** Add unit tests for photo share create/reuse/retry/revoke, group create with missing images, duplicate-key retry, and group deletion; add an E2E smoke test that generates a share link and opens it.
- **Severity:** High
- **Confidence:** Medium
- **Status:** **Likely risk**

### 7) Image queue/bootstrap/retry behavior has almost no regression coverage
- **File / region:** `apps/web/src/lib/image-queue.ts:136-373`, `apps/web/src/lib/process-topic-image.ts:42-106`, `apps/web/src/lib/upload-paths.ts:48-93`
- **Problem:** The processing queue contains the highest-complexity async logic in the repo: advisory claims, retry scheduling, cleanup of orphan temp files, restore-time quiescing, and bootstrap recovery. None of that behavior is directly tested.
- **Concrete failure scenario:** A worker repeatedly fails to acquire a claim and eventually drops a still-pending image after 10 retries, or queue resume after restore misses pending items because bootstrap state was not reset as expected.
- **Suggested fix:** Add queue-state unit tests using fake queue/DB/fs layers for claim contention, retry exhaustion, delete-during-processing cleanup, startup orphan cleanup, quiesce/resume, and bootstrap-on-import behavior.
- **Severity:** High
- **Confidence:** Medium
- **Status:** **Likely risk**

### 8) Settings/SEO persistence and metadata coupling are under-tested
- **File / region:** `apps/web/src/app/actions/settings.ts:36-129`, `apps/web/src/app/actions/seo.ts:50-156`, `apps/web/src/lib/gallery-config.ts:33-88`, `apps/web/src/lib/data.ts:870-894`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:22-177`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:29-171`
- **Problem:** These modules drive public metadata, image-size derivation, privacy defaults, and admin configuration writes, yet there are no direct tests for the server actions or their downstream metadata effects.
- **Concrete failure scenario:** A change to sanitization or `seo_og_image_url` validation silently stores a bad value, causing broken OG tags, stale metadata, or invalid image-size configuration that only shows up after deployment.
- **Suggested fix:** Add unit tests for allowed/disallowed setting keys, image-size lock behavior when processed images exist, same-origin/relative OG URL validation, and metadata generation after config changes.
- **Severity:** High
- **Confidence:** Medium
- **Status:** **Likely risk**

### 9) Metadata/OG/public-route generators are mostly untested despite substantial branching
- **File / region:** `apps/web/src/app/[locale]/(public)/page.tsx:18-162`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:18-162`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:24-243`, `apps/web/src/app/api/og/route.tsx:27-157`
- **Problem:** The app has many SSR branches for canonical URLs, OG images, filtered tag metadata, invalid IDs, topic alias redirects, and custom OG overrides, but only a narrow shared-page-title slice is unit-tested.
- **Concrete failure scenario:** Changing `image_sizes` or title fallback logic produces OG URLs that 404, wrong canonical paths, or bad not-found metadata; public page tests still pass because current Playwright checks focus on navigation behavior, not metadata correctness.
- **Suggested fix:** Add lightweight metadata tests that call `generateMetadata()` and the OG route with mocked `getSeoSettings()/getGalleryConfig()` values, especially around invalid IDs, alias redirects, and custom OG URLs.
- **Severity:** Medium
- **Confidence:** Medium
- **Status:** **Likely risk**

### 10) There is no repository-level CI workflow enforcing the declared test surface
- **File / region:** repository `.github/` (no workflow file present), with expected commands declared in `apps/web/package.json:8-15` and docs in `README.md`, `CLAUDE.md`
- **Problem:** The repo documents `vitest`, Playwright, and lint commands, but there is no GitHub Actions workflow (or equivalent checked-in automation) to run them on every change.
- **Concrete failure scenario:** Any of the gaps above can ship on a green branch because nothing in-repo automatically runs unit tests, E2E, lint, or build checks before merge.
- **Suggested fix:** Add a CI workflow that at minimum runs install, lint, unit tests, build, and the default Playwright smoke lane; optionally add a seeded admin E2E job.
- **Severity:** High
- **Confidence:** High
- **Status:** **Confirmed**

---

## Flaky / brittle test notes
- `apps/web/e2e/public.spec.ts` and `apps/web/e2e/test-fixes.spec.ts` rely on `.first()` selectors and locale-button text matching; they are currently passing, but they are coupled to nav structure and could become brittle if hidden/duplicated controls change.
- `apps/web/e2e/admin.spec.ts` uses real upload timing and full app build/startup, so once enabled in CI it should be kept in a seeded smoke lane to avoid environment-driven flakes.

---

## Highest-value TDD opportunities
1. **`createAdminUser()` mismatch rejection** — write the failing test first; it should prove the action rejects mismatched `confirmPassword` even without client-side JS.
2. **`login()`/`updatePassword()` action tests** — cover same-origin rejection, successful session creation, rollback on infrastructure failure, and session invalidation.
3. **`db-actions.ts` process orchestration** — isolate dump/restore helpers and drive failure-path tests with stubbed child-process events.
4. **`sharing.ts` transaction/retry tests** — assert duplicate-key retry, missing-image failure, and revoke conditional-update behavior.
5. **`image-queue.ts` retry/claim tests** — prove images are not silently dropped during claim contention or restore transitions.

---

## Missed-issues sweep
A final sweep across the repo did not reveal additional confirmed defects beyond the findings above, but the dominant repository risk remains the same: the most security- and data-sensitive paths (auth, restore, sharing, admin management, queue recovery, config/SEO persistence) are under-protected compared with the well-covered helper layer.
