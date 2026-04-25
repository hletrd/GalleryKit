# Code Review Summary — Cycle 8 Prompt 1

Date: 2026-04-25
Reviewer: code-reviewer
Repository: `/Users/hletrd/flash-shared/gallery`

## Scope and inventory

I reviewed the full review-relevant repository surface and did not sample within that scope.

Excluded as non-review surface: generated/runtime/vendor/binary artifacts such as `node_modules/`, `.next/`, `test-results/`, uploaded image binaries, and historical `.context/` planning/review artifacts.

### Inventory summary

- Root/docs/config/workflows: 30 files
- Messages: 2 files
- Public JS assets: 1 file
- Scripts: 14 files
- E2E specs/helpers: 6 files
- App router/actions/API/CSS: 55 files
- Components: 45 files
- DB layer: 3 files
- i18n: 1 file
- Library modules: 48 files
- Other source/config JSON: 4 files
- Unit tests: 59 files

**Total review-relevant files examined:** 268

## Verification performed

Grounding steps completed:

- `npm run lint` ✅
- `npm run typecheck` ✅
- `npm test` ✅ (59 files / 370 tests passed)
- `npm run lint:api-auth` ✅
- `npm run lint:action-origin` ✅
- repo-wide pattern sweeps for auth/origin/rate-limit/child-process/dangerous HTML/storage usage ✅
- final missed-issues sweep across source/tests/scripts/docs ✅

## Findings

### Confirmed issues

#### 1) [MEDIUM] Rate-limit rollbacks can decrement the wrong time window and leave stale counters behind
- **Confidence:** High
- **Locations:**
  - `apps/web/src/lib/rate-limit.ts:254-281`
  - `apps/web/src/lib/auth-rate-limit.ts:40-48`
  - `apps/web/src/lib/auth-rate-limit.ts:76-84`
  - `apps/web/src/app/actions/auth.ts:138-141`
  - `apps/web/src/app/actions/auth.ts:238-240`
  - `apps/web/src/app/actions/admin-users.ts:62-66`
  - `apps/web/src/app/actions/sharing.ts:85-89`
  - Contrast with the correct pinned-window pattern in `apps/web/src/app/actions/public.ts:23-32,126-160`
- **Why this is a problem:** `decrementRateLimit()` defaults `bucketStart` to `Date.now()` at rollback time. Several rollback paths call it without passing the original bucket/window that was incremented. That means a request that starts near a window boundary can increment bucket A and later roll back bucket B.
- **Concrete failure scenario:** A login/share/user-create request is pre-incremented at `12:59:59.900`, then fails or is rolled back at `13:00:00.100`. The rollback decrements the new bucket instead of the original one, so the old bucket remains inflated. Repeating this edge case can create false `tooManyAttempts` responses and make operators chase a “phantom” limiter.
- **Suggested fix:** Capture `bucketStart` once at the start of every pre-increment/check/rollback flow and thread it through increment/check/decrement consistently. Reuse the same pinned-window pattern already used by `searchImagesAction()`.

#### 2) [LOW] Uploads persist `user_filename` without normalization or length guarding
- **Confidence:** Medium
- **Locations:**
  - `apps/web/src/app/actions/images.ts:200-241`
  - `apps/web/src/db/schema.ts:28`
- **Why this is a problem:** The stored metadata field `user_filename` is taken from `path.basename(file.name).trim()` and written directly into `varchar(255)` without `stripControlChars()` or an explicit length bound. The repo is otherwise careful to sanitize user-controlled strings before persistence.
- **Concrete failure scenario:** A client uploads a file whose basename is longer than 255 characters, or contains embedded control characters/newlines. The server does the disk write and EXIF work first, then the DB insert can fail late on the metadata field. If the DB accepts the value, those control characters can still leak into admin tooltips, logs, or exports.
- **Suggested fix:** Sanitize and bound `user_filename` before persistence (for example: strip control characters, trim, enforce a safe maximum, and return a clear validation error before any expensive file I/O).

### Likely issues

#### 3) [MEDIUM] Core server behavior is concentrated in a few god modules, which is now a maintainability/SOLID liability
- **Confidence:** Medium
- **Locations:**
  - `apps/web/src/lib/data.ts:1-894`
  - `apps/web/src/app/actions/images.ts:82-646`
  - `apps/web/src/lib/image-queue.ts:24-489`
- **Why this is a problem:** These files mix unrelated concerns:
  - `data.ts` combines public query shape/privacy policy, shared-group view buffering, pagination, topic/tag/image lookup, and SEO settings fallback.
  - `images.ts` combines upload validation, quota tracking, EXIF persistence, tag creation, queueing, file cleanup, delete flows, batch delete, and metadata editing.
  - `image-queue.ts` combines queue state, claim locking, retry policy, orphan cleanup, bootstrap/gc, restore coordination, and shutdown.

  This breaks single-responsibility boundaries and makes cross-file reasoning harder than it needs to be.
- **Concrete failure scenario:** A future “small” change to public-image selection or upload policy can accidentally regress unrelated runtime behavior because the same module also owns mutable timers, global process state, cleanup loops, and revalidation behavior. That risk is already visible in the amount of defensive comments and contract tests needed to keep these files stable.
- **Suggested fix:** Split by responsibility rather than by call site. Examples:
  - `data.ts` → `public-image-queries.ts`, `shared-group-views.ts`, `seo-settings.ts`
  - `images.ts` → `image-upload.ts`, `image-delete.ts`, `image-metadata.ts`
  - `image-queue.ts` → `queue-bootstrap.ts`, `queue-runtime.ts`, `queue-cleanup.ts`

### Manual-validation risks

#### 4) [MEDIUM] Horizontal scaling is still unsafe because several correctness guards are process-local only
- **Confidence:** High
- **Locations:**
  - `README.md:143-146`
  - `apps/web/src/lib/restore-maintenance.ts:1-56`
  - `apps/web/src/lib/upload-tracker-state.ts:7-61`
  - `apps/web/src/lib/data.ts:11-109`
  - `apps/web/src/lib/image-queue.ts:113-132,382-489`
- **Why this is a risk:** The docs explicitly say the shipped deployment is single-instance/single-writer, and the code matches that assumption: restore maintenance, upload quota claims, buffered shared-group view counts, and queue state all live in process memory.
- **Concrete failure scenario:** During a blue/green rollout or accidental horizontal scaling, one instance can enter restore maintenance while another continues accepting uploads/searches and buffering view counts. The system will look healthy per-instance, but global behavior becomes inconsistent.
- **Suggested fix:** If multi-instance deployment is ever needed, move these coordination states into shared storage/locking (DB/Redis/etc.) and add an explicit deployment-mode guard so unsupported topologies fail loudly instead of drifting silently.

## Final missed-issues sweep

I did a final repo-wide pass over:
- auth/origin enforcement
- rate-limit flows
- storage/path traversal boundaries
- backup/restore flows
- public privacy boundaries
- tests/docs/workflow alignment

No additional confirmed HIGH/CRITICAL issues surfaced beyond the items above.

## Recommendation

**REQUEST CHANGES**

Reason: the rate-limit rollback window drift is a real correctness bug that can produce false throttling under edge timing, and the upload metadata path still lacks the input normalization discipline used elsewhere.

---

## Appendix A — grouped inventory

### root_docs (30)
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `.agent/rules/commit-and-push.md`
- `.github/workflows/quality.yml`
- `.github/dependabot.yml`
- `package.json`
- `package-lock.json`
- `apps/web/README.md`
- `apps/web/package.json`
- `apps/web/next.config.ts`
- `apps/web/playwright.config.ts`
- `apps/web/eslint.config.mjs`
- `apps/web/drizzle.config.ts`
- `apps/web/docker-compose.yml`
- `apps/web/Dockerfile`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `apps/web/postcss.config.mjs`
- `apps/web/tailwind.config.ts`
- `apps/web/tsconfig.json`
- `apps/web/tsconfig.scripts.json`
- `apps/web/tsconfig.typecheck.json`
- `apps/web/vitest.config.ts`
- `apps/web/components.json`
- `apps/web/next-env.d.ts`
- `apps/web/nginx/default.conf`
- `apps/web/.env.local.example`
- `.env.deploy.example`
- `.nvmrc`

### messages (2)
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

### public_assets (1)
- `apps/web/public/histogram-worker.js`

### scripts (14)
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/ensure-site-config.mjs`
- `apps/web/scripts/entrypoint.sh`
- `apps/web/scripts/init-db.ts`
- `apps/web/scripts/migrate-admin-auth.ts`
- `apps/web/scripts/migrate-aliases.ts`
- `apps/web/scripts/migrate-capture-date.js`
- `apps/web/scripts/migrate-titles.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/migration-add-column.ts`
- `apps/web/scripts/mysql-connection-options.js`
- `apps/web/scripts/seed-admin.ts`
- `apps/web/scripts/seed-e2e.ts`

### e2e (6)
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/helpers.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/e2e/origin-guard.spec.ts`
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`

### app (55)
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
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
- `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/app/[locale]/error.tsx`
- `apps/web/src/app/[locale]/globals.css`
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/loading.tsx`
- `apps/web/src/app/[locale]/not-found.tsx`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/apple-icon.tsx`
- `apps/web/src/app/global-error.tsx`
- `apps/web/src/app/icon.tsx`
- `apps/web/src/app/manifest.ts`
- `apps/web/src/app/robots.ts`
- `apps/web/src/app/sitemap.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`

### components (45)
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
- `apps/web/src/components/lazy-focus-trap.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/optimistic-image.tsx`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/components/photo-viewer-loading.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/components/tag-input.tsx`
- `apps/web/src/components/theme-provider.tsx`
- `apps/web/src/components/topic-empty-state.tsx`
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
- `apps/web/src/components/ui/switch.tsx`
- `apps/web/src/components/ui/table.tsx`
- `apps/web/src/components/ui/textarea.tsx`
- `apps/web/src/components/upload-dropzone.tsx`

### db (3)
- `apps/web/src/db/index.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/db/seed.ts`

### i18n (1)
- `apps/web/src/i18n/request.ts`

### lib (48)
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/action-result.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/audit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/backup-filename.ts`
- `apps/web/src/lib/base56.ts`
- `apps/web/src/lib/clipboard.ts`
- `apps/web/src/lib/constants.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/src/lib/csp-nonce.ts`
- `apps/web/src/lib/csv-escape.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/error-shell.ts`
- `apps/web/src/lib/exif-datetime.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/image-types.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/lib/locale-path.ts`
- `apps/web/src/lib/mysql-cli-ssl.ts`
- `apps/web/src/lib/photo-title.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/queue-shutdown.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/sanitize.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/storage/types.ts`
- `apps/web/src/lib/tag-records.ts`
- `apps/web/src/lib/tag-slugs.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/utils.ts`
- `apps/web/src/lib/validation.ts`

### other_src (4)
- `apps/web/src/instrumentation.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/site-config.example.json`
- `apps/web/src/site-config.json`

### tests (59)
- `apps/web/src/__tests__/action-guards.test.ts`
- `apps/web/src/__tests__/admin-user-create-ordering.test.ts`
- `apps/web/src/__tests__/admin-users.test.ts`
- `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts`
- `apps/web/src/__tests__/auth-rate-limit.test.ts`
- `apps/web/src/__tests__/auth-rethrow.test.ts`
- `apps/web/src/__tests__/backup-download-route.test.ts`
- `apps/web/src/__tests__/backup-filename.test.ts`
- `apps/web/src/__tests__/base56.test.ts`
- `apps/web/src/__tests__/check-action-origin.test.ts`
- `apps/web/src/__tests__/check-api-auth.test.ts`
- `apps/web/src/__tests__/client-source-contracts.test.ts`
- `apps/web/src/__tests__/clipboard.test.ts`
- `apps/web/src/__tests__/content-security-policy.test.ts`
- `apps/web/src/__tests__/csv-escape.test.ts`
- `apps/web/src/__tests__/data-pagination.test.ts`
- `apps/web/src/__tests__/db-pool-connection-handler.test.ts`
- `apps/web/src/__tests__/db-restore.test.ts`
- `apps/web/src/__tests__/error-shell.test.ts`
- `apps/web/src/__tests__/exif-datetime.test.ts`
- `apps/web/src/__tests__/gallery-config-shared.test.ts`
- `apps/web/src/__tests__/health-route.test.ts`
- `apps/web/src/__tests__/histogram.test.ts`
- `apps/web/src/__tests__/image-queue-bootstrap.test.ts`
- `apps/web/src/__tests__/image-queue.test.ts`
- `apps/web/src/__tests__/image-url.test.ts`
- `apps/web/src/__tests__/images-actions.test.ts`
- `apps/web/src/__tests__/images-delete-revalidation.test.ts`
- `apps/web/src/__tests__/lightbox.test.ts`
- `apps/web/src/__tests__/live-route.test.ts`
- `apps/web/src/__tests__/locale-path.test.ts`
- `apps/web/src/__tests__/mysql-cli-ssl.test.ts`
- `apps/web/src/__tests__/next-config.test.ts`
- `apps/web/src/__tests__/photo-title.test.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/public-actions.test.ts`
- `apps/web/src/__tests__/queue-shutdown.test.ts`
- `apps/web/src/__tests__/rate-limit.test.ts`
- `apps/web/src/__tests__/request-origin.test.ts`
- `apps/web/src/__tests__/restore-maintenance.test.ts`
- `apps/web/src/__tests__/revalidation.test.ts`
- `apps/web/src/__tests__/safe-json-ld.test.ts`
- `apps/web/src/__tests__/sanitize.test.ts`
- `apps/web/src/__tests__/seo-actions.test.ts`
- `apps/web/src/__tests__/serve-upload.test.ts`
- `apps/web/src/__tests__/session.test.ts`
- `apps/web/src/__tests__/settings-image-sizes-lock.test.ts`
- `apps/web/src/__tests__/shared-page-title.test.ts`
- `apps/web/src/__tests__/sql-restore-scan.test.ts`
- `apps/web/src/__tests__/storage-local.test.ts`
- `apps/web/src/__tests__/tag-input.test.ts`
- `apps/web/src/__tests__/tag-records.test.ts`
- `apps/web/src/__tests__/tag-slugs.test.ts`
- `apps/web/src/__tests__/tags-actions.test.ts`
- `apps/web/src/__tests__/topics-actions.test.ts`
- `apps/web/src/__tests__/upload-dropzone.test.ts`
- `apps/web/src/__tests__/upload-limits.test.ts`
- `apps/web/src/__tests__/upload-tracker.test.ts`
- `apps/web/src/__tests__/validation.test.ts`
