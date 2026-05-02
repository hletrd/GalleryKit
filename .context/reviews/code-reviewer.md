# Code Review Report — Cycle 1

Repository: `/Users/hletrd/flash-shared/gallery`  
Role: code-reviewer  
Scope: comprehensive review of tracked source, tests, scripts, configs, and docs. Application code was not edited.

## Inventory and coverage

Inventory source: `git ls-files`, then filtered only for review-relevant text/code. I included `apps/web/public/histogram-worker.js` as source. I excluded binary/static assets and generated or runtime artifacts (`.context/`, `plan/`, `test-results/`, images/fonts/icons, `.gitkeep`) from logic/code review.

- Tracked files: **1475**
- Review-relevant files examined: **311**
- Excluded generated/binary/non-code artifacts: **1164**

### Complete reviewed inventory

- **root docs/config** (10 files)
  - `.dockerignore`
  - `.env.deploy.example`
  - `.gitignore`
  - `.nvmrc`
  - `AGENTS.md`
  - `CLAUDE.md`
  - `LICENSE`
  - `README.md`
  - `package-lock.json`
  - `package.json`
- **.github workflow/config** (2 files)
  - `.github/dependabot.yml`
  - `.github/workflows/quality.yml`
- **workflow docs** (1 files)
  - `.omc/plans/plan-cycle12-fixes.md`
- **root scripts** (1 files)
  - `scripts/deploy-remote.sh`
- **app docs/config/messages** (22 files)
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
  - `apps/web/messages/en.json`
  - `apps/web/messages/ko.json`
  - `apps/web/next.config.ts`
  - `apps/web/nginx/default.conf`
  - `apps/web/package.json`
  - `apps/web/playwright.config.ts`
  - `apps/web/postcss.config.mjs`
  - `apps/web/tailwind.config.ts`
  - `apps/web/tsconfig.json`
  - `apps/web/tsconfig.scripts.json`
  - `apps/web/tsconfig.typecheck.json`
  - `apps/web/vitest.config.ts`
- **drizzle migrations/meta** (7 files)
  - `apps/web/drizzle/0000_nappy_madelyne_pryor.sql`
  - `apps/web/drizzle/0001_sync_current_schema.sql`
  - `apps/web/drizzle/0002_fix_processed_default.sql`
  - `apps/web/drizzle/0003_audit_created_at_index.sql`
  - `apps/web/drizzle/meta/0000_snapshot.json`
  - `apps/web/drizzle/meta/0001_snapshot.json`
  - `apps/web/drizzle/meta/_journal.json`
- **app scripts** (17 files)
  - `apps/web/scripts/check-action-origin.ts`
  - `apps/web/scripts/check-api-auth.ts`
  - `apps/web/scripts/check-js-scripts.mjs`
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
  - `apps/web/scripts/prepare-next-typegen.mjs`
  - `apps/web/scripts/run-e2e-server.mjs`
  - `apps/web/scripts/seed-admin.ts`
  - `apps/web/scripts/seed-e2e.ts`
- **public source** (1 files)
  - `apps/web/public/histogram-worker.js`
- **application source** (160 files)
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/layout.tsx`
  - `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx`
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
  - `apps/web/src/app/actions.ts`
  - `apps/web/src/app/actions/admin-users.ts`
  - `apps/web/src/app/actions/auth.ts`
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/app/actions/public.ts`
  - `apps/web/src/app/actions/seo.ts`
  - `apps/web/src/app/actions/settings.ts`
  - `apps/web/src/app/actions/sharing.ts`
  - `apps/web/src/app/actions/tags.ts`
  - `apps/web/src/app/actions/topics.ts`
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
  - `apps/web/src/db/index.ts`
  - `apps/web/src/db/schema.ts`
  - `apps/web/src/db/seed.ts`
  - `apps/web/src/i18n/request.ts`
  - `apps/web/src/instrumentation.ts`
  - `apps/web/src/lib/action-guards.ts`
  - `apps/web/src/lib/action-result.ts`
  - `apps/web/src/lib/advisory-locks.ts`
  - `apps/web/src/lib/api-auth.ts`
  - `apps/web/src/lib/audit.ts`
  - `apps/web/src/lib/auth-rate-limit.ts`
  - `apps/web/src/lib/backup-filename.ts`
  - `apps/web/src/lib/base56.ts`
  - `apps/web/src/lib/blur-data-url.ts`
  - `apps/web/src/lib/bounded-map.ts`
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
  - `apps/web/src/lib/upload-processing-contract-lock.ts`
  - `apps/web/src/lib/upload-tracker-state.ts`
  - `apps/web/src/lib/upload-tracker.ts`
  - `apps/web/src/lib/utils.ts`
  - `apps/web/src/lib/validation.ts`
  - `apps/web/src/proxy.ts`
  - `apps/web/src/site-config.example.json`
- **unit/contract tests** (84 files)
  - `apps/web/src/__tests__/action-guards.test.ts`
  - `apps/web/src/__tests__/admin-user-create-ordering.test.ts`
  - `apps/web/src/__tests__/admin-users.test.ts`
  - `apps/web/src/__tests__/auth-no-rollback-on-infrastructure-error.test.ts`
  - `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts`
  - `apps/web/src/__tests__/auth-rate-limit.test.ts`
  - `apps/web/src/__tests__/auth-rethrow.test.ts`
  - `apps/web/src/__tests__/backup-download-route.test.ts`
  - `apps/web/src/__tests__/backup-filename.test.ts`
  - `apps/web/src/__tests__/base56.test.ts`
  - `apps/web/src/__tests__/blur-data-url.test.ts`
  - `apps/web/src/__tests__/check-action-origin.test.ts`
  - `apps/web/src/__tests__/check-api-auth.test.ts`
  - `apps/web/src/__tests__/client-source-contracts.test.ts`
  - `apps/web/src/__tests__/clipboard.test.ts`
  - `apps/web/src/__tests__/code-point-length.test.ts`
  - `apps/web/src/__tests__/content-security-policy.test.ts`
  - `apps/web/src/__tests__/csv-escape.test.ts`
  - `apps/web/src/__tests__/data-adjacency-source.test.ts`
  - `apps/web/src/__tests__/data-pagination.test.ts`
  - `apps/web/src/__tests__/data-tag-names-sql.test.ts`
  - `apps/web/src/__tests__/data-view-count-flush.test.ts`
  - `apps/web/src/__tests__/db-pool-connection-handler.test.ts`
  - `apps/web/src/__tests__/db-restore.test.ts`
  - `apps/web/src/__tests__/error-shell.test.ts`
  - `apps/web/src/__tests__/exif-datetime.test.ts`
  - `apps/web/src/__tests__/gallery-config-shared.test.ts`
  - `apps/web/src/__tests__/health-route.test.ts`
  - `apps/web/src/__tests__/histogram.test.ts`
  - `apps/web/src/__tests__/image-queue-bootstrap.test.ts`
  - `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts`
  - `apps/web/src/__tests__/image-queue.test.ts`
  - `apps/web/src/__tests__/image-url.test.ts`
  - `apps/web/src/__tests__/images-action-blur-wiring.test.ts`
  - `apps/web/src/__tests__/images-actions.test.ts`
  - `apps/web/src/__tests__/images-delete-revalidation.test.ts`
  - `apps/web/src/__tests__/lightbox.test.ts`
  - `apps/web/src/__tests__/live-route.test.ts`
  - `apps/web/src/__tests__/load-more-rate-limit.test.ts`
  - `apps/web/src/__tests__/locale-path.test.ts`
  - `apps/web/src/__tests__/mysql-cli-ssl.test.ts`
  - `apps/web/src/__tests__/next-config.test.ts`
  - `apps/web/src/__tests__/nginx-config.test.ts`
  - `apps/web/src/__tests__/og-rate-limit.test.ts`
  - `apps/web/src/__tests__/photo-title.test.ts`
  - `apps/web/src/__tests__/privacy-fields.test.ts`
  - `apps/web/src/__tests__/process-image-blur-wiring.test.ts`
  - `apps/web/src/__tests__/process-image-dimensions.test.ts`
  - `apps/web/src/__tests__/process-image-metadata.test.ts`
  - `apps/web/src/__tests__/process-image-variant-scan.test.ts`
  - `apps/web/src/__tests__/public-actions.test.ts`
  - `apps/web/src/__tests__/queue-shutdown.test.ts`
  - `apps/web/src/__tests__/rate-limit.test.ts`
  - `apps/web/src/__tests__/request-origin.test.ts`
  - `apps/web/src/__tests__/resolved-stream-source.test.ts`
  - `apps/web/src/__tests__/restore-maintenance.test.ts`
  - `apps/web/src/__tests__/restore-upload-lock.test.ts`
  - `apps/web/src/__tests__/revalidation.test.ts`
  - `apps/web/src/__tests__/safe-json-ld.test.ts`
  - `apps/web/src/__tests__/sanitize-admin-string.test.ts`
  - `apps/web/src/__tests__/sanitize-normalize-string-record.test.ts`
  - `apps/web/src/__tests__/sanitize-stderr.test.ts`
  - `apps/web/src/__tests__/sanitize.test.ts`
  - `apps/web/src/__tests__/seo-actions.test.ts`
  - `apps/web/src/__tests__/serve-upload.test.ts`
  - `apps/web/src/__tests__/session.test.ts`
  - `apps/web/src/__tests__/settings-image-sizes-lock.test.ts`
  - `apps/web/src/__tests__/share-key-length.test.ts`
  - `apps/web/src/__tests__/shared-page-title.test.ts`
  - `apps/web/src/__tests__/shared-route-rate-limit-source.test.ts`
  - `apps/web/src/__tests__/sharing-source-contracts.test.ts`
  - `apps/web/src/__tests__/sql-restore-scan.test.ts`
  - `apps/web/src/__tests__/storage-local.test.ts`
  - `apps/web/src/__tests__/tag-input.test.ts`
  - `apps/web/src/__tests__/tag-label-consolidation.test.ts`
  - `apps/web/src/__tests__/tag-records.test.ts`
  - `apps/web/src/__tests__/tag-slugs.test.ts`
  - `apps/web/src/__tests__/tags-actions.test.ts`
  - `apps/web/src/__tests__/topics-actions.test.ts`
  - `apps/web/src/__tests__/touch-target-audit.test.ts`
  - `apps/web/src/__tests__/upload-dropzone.test.ts`
  - `apps/web/src/__tests__/upload-limits.test.ts`
  - `apps/web/src/__tests__/upload-tracker.test.ts`
  - `apps/web/src/__tests__/validation.test.ts`
- **e2e tests** (6 files)
  - `apps/web/e2e/admin.spec.ts`
  - `apps/web/e2e/helpers.ts`
  - `apps/web/e2e/nav-visual-check.spec.ts`
  - `apps/web/e2e/origin-guard.spec.ts`
  - `apps/web/e2e/public.spec.ts`
  - `apps/web/e2e/test-fixes.spec.ts`

## Verification performed

- `npm run lint && npm run typecheck && npm test` — passed during review (Vitest: 84 files / 586 tests).
- `npm run lint:api-auth && npm run lint:action-origin` — passed during review.
- Final full-text sweep over all review-relevant files for risky patterns (`TODO/FIXME`, guard/lint suppressions, raw SQL, shell/file operations, random/key generation, DOM injection APIs, advisory locks, destructive SQL) — reviewed; findings below are the actionable items retained.
- One-off scanner probe confirmed the action-origin lint accepts a mutation-before-guard fixture:
  `deleteFoo(){ await db.delete(...); const originError = await requireSameOriginAdmin(); if (originError) return ... }` reports `OK`.

## Findings

### HIGH-01 — Admin-user deletion lock is scoped by target user, so two concurrent deletions can remove every admin

- **Severity:** High
- **Label:** confirmed
- **Confidence:** High
- **Locations:**
  - `apps/web/src/app/actions/admin-users.ts:198-215` says the deletion path is serialized to prevent concurrent requests from both observing “more than one admin,” but then chooses `getAdminDeleteLockName(id)`.
  - `apps/web/src/app/actions/admin-users.ts:218-245` acquires that lock, counts all admins, and deletes the target in the same transaction.
  - `apps/web/src/lib/advisory-locks.ts:26-32` builds `gallerykit_admin_delete:${userId}`, i.e. a different lock for each target admin.
- **Failure scenario:** With exactly two admins A and B, A deletes B while B deletes A. The requests acquire different advisory locks (`...:B` and `...:A`), both run `SELECT COUNT(*) AS count FROM admin_users` before either commit, both see `2`, and both delete their target. The app can end with zero admin users and lock out administration.
- **Suggested fix:** Use a single global admin-delete lock for all admin deletions, or lock the admin-user set/rows before the count+delete invariant check (for example, transactional `SELECT ... FOR UPDATE` over the relevant rows or equivalent serializable strategy). Add a concurrency regression test that attempts to delete two different admins at the same time and asserts at least one admin remains.

### MEDIUM-01 — Existing photo share keys roll back rate-limit counters before any pre-increment happened

- **Severity:** Medium
- **Label:** confirmed
- **Confidence:** High
- **Locations:**
  - `apps/web/src/app/actions/sharing.ts:87-105` computes the bucket, loads the image, and if `image.share_key` already exists calls `rollbackShareRateLimitFull(ip, 'share_photo', shareBucketStart)` before returning.
  - `apps/web/src/app/actions/sharing.ts:108-115` shows the in-memory and DB pre-increments occur only after the existing-key branch.
  - `apps/web/src/app/actions/sharing.ts:55-75` rolls back both in-memory and DB counters.
  - `apps/web/src/lib/rate-limit.ts:336-363` decrements/deletes the DB bucket row.
  - Test gap: `apps/web/src/__tests__/sharing-source-contracts.test.ts:8-16` asserts rollback only for the concurrent-winner branch, not for the initial existing-key branch.
- **Failure scenario:** An admin who repeatedly requests a share link for an already-shared image decrements the current `share_photo` bucket even though that request never incremented it. This can erase real prior counts for the same IP/window, undermining share-write throttling and desynchronizing the in-memory and DB counters.
- **Suggested fix:** Remove the rollback from the first `if (image.share_key)` branch. Keep rollback only in branches reached after `checkShareRateLimit`/`incrementRateLimit` actually pre-incremented (for example the concurrent-refetch branch later in the retry loop). Add a unit/contract test that the already-shared early return does not call `rollbackShareRateLimitFull`/`decrementRateLimit`.

### MEDIUM-02 — Same-origin action lint accepts guards that run after mutations

- **Severity:** Medium
- **Label:** risk (confirmed scanner false-negative pattern; current action files were inspected and did not show this ordering bug)
- **Confidence:** High
- **Locations:**
  - `apps/web/scripts/check-action-origin.ts:174-199` scans top-level statements for a `requireSameOriginAdmin()` variable and then searches only following statements for a return-on-guard; it never rejects side effects that appear before the guard.
  - `apps/web/src/__tests__/check-action-origin.test.ts:32-43` and `apps/web/src/__tests__/check-action-origin.test.ts:112-123` test valid declaration/arrow guard shapes, but there is no negative fixture for `db`/`fs`/other mutation before the guard.
- **Failure scenario:** A future server action can mutate state first and then run the guard:
  `await db.delete(...); const originError = await requireSameOriginAdmin(); if (originError) return ...;`. The lint reports OK, so CI would not catch a cross-origin mutation path.
- **Suggested fix:** Make the scanner enforce guard-before-effect ordering. For example, require the guard/return pair to appear before any statement containing known mutating operations (`db.insert/update/delete`, `connection.query`, filesystem writes/removes, `revalidate*`, audit writes, process spawning), or require it in the initial allowed prefix after auth/maintenance/i18n setup. Add a fixture test where mutation-before-guard fails.

### MEDIUM-03 — Remote deploy README instructs users to create a root `.env.deploy`, but the script does not load it by default

- **Severity:** Medium
- **Label:** confirmed
- **Confidence:** High
- **Locations:**
  - `README.md:103-113` tells users to copy `.env.deploy.example` to root `.env.deploy` and run `npm run deploy`.
  - `.env.deploy.example:1-4` says the default location is `~/.gallerykit-secrets/gallery-deploy.env` unless `DEPLOY_ENV_FILE` is set.
  - `scripts/deploy-remote.sh:4-6` sets `ENV_FILE` to `${DEPLOY_ENV_FILE:-$HOME/.gallerykit-secrets/gallery-deploy.env}`.
  - `scripts/deploy-remote.sh:47-50` fails if that home secrets file does not exist.
- **Failure scenario:** A user follows the README exactly (`cp .env.deploy.example .env.deploy; npm run deploy`) and the deploy helper exits with “Missing deploy env file: ~/.gallerykit-secrets/gallery-deploy.env”. The documented happy path is broken.
- **Suggested fix:** Align docs and script. Either update the README to copy the example to `~/.gallerykit-secrets/gallery-deploy.env`, or make `scripts/deploy-remote.sh` fall back to root `.env.deploy` when present and `DEPLOY_ENV_FILE` is unset.

### LOW-01 — Settings UI lets admins toggle `strip_gps_on_upload` after uploads even though the server rejects the change

- **Severity:** Low
- **Label:** confirmed
- **Confidence:** Medium
- **Locations:**
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:142-155` disables `image_sizes` when `hasExistingImages` is true.
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:170-180` renders the `strip_gps_on_upload` switch without `disabled={hasExistingImages}`.
  - `apps/web/src/app/actions/settings.ts:115-132` rejects a `strip_gps_on_upload` change once any image exists, returning `uploadSettingsLocked`.
- **Failure scenario:** After the first upload, the UI warns that upload-processing settings are locked but still allows the privacy switch to be toggled. Saving then fails server-side. This is not data corruption, but it is a confusing and avoidable regression in admin UX.
- **Suggested fix:** Disable the `strip_gps_on_upload` switch when `hasExistingImages` is true (matching `image_sizes`), or make the warning and control state explicit so admins cannot stage an impossible save.

### LOW-02 — Data-layer tag filtering does not deduplicate slugs before comparing against `COUNT(DISTINCT ...)`

- **Severity:** Low
- **Label:** risk
- **Confidence:** Medium
- **Locations:**
  - `apps/web/src/lib/data.ts:423-436` trims/validates `tagSlugs` but does not deduplicate before building `or(...tagConditions)` and `HAVING COUNT(DISTINCT tags.slug) = ${validTagSlugs.length}`.
  - Public entry points currently mitigate this: `apps/web/src/lib/tag-slugs.ts:18-35` canonicalizes/deduplicates requested slugs, and `apps/web/src/app/actions/public.ts:89-91` canonicalizes load-more tags.
- **Failure scenario:** Any current or future internal caller that passes `['portrait', 'portrait']` to `getImages*`/`countImages` receives no matches for images that have `portrait`, because the subquery can only count one distinct slug while the required count is two.
- **Suggested fix:** Deduplicate inside `buildTagFilterCondition` (`const validTagSlugs = [...new Set(...)]`) so the data layer is correct regardless of caller hygiene. Add a data-layer test for duplicate tag input.

## Accepted/non-findings checked to avoid false positives

- No finding for the Dockerfile omitting package-lock usage; repo comments/docs explicitly accept the platform optional-dependency tradeoff.
- No finding for the backup download route’s strict same-origin behavior; fail-closed direct GET behavior is intentional for the route’s security posture.
- No finding for public static assets or binary/gallery seed media; they were out of scope for code/logic review.
- Current mutating server actions were manually checked for same-origin guards before mutations; the action-origin finding is about the scanner’s future-regression gap, not a currently observed unguarded action.
- Current public tag-filter callers deduplicate user-supplied tags; the duplicate-slug finding is deliberately scoped to data-layer robustness.

## Final missed-issues sweep

I performed a final sweep across the complete reviewed inventory for risky constructs and cross-file interactions (auth/origin gates, rate-limit rollback symmetry, advisory locks, destructive DB operations, file/path handling, worker code, deploy scripts, Next.js config, tests, and docs). No additional actionable issues were retained after excluding accepted repo rules and non-code assets.

Relevant files skipped: **none**. Exclusions were limited to generated/runtime artifacts and binary/static assets listed in the inventory policy above.

## Severity count

- Critical: 0
- High: 1
- Medium: 3
- Low: 2
- **Total findings: 6**

Recommendation: **REQUEST CHANGES** because one High-severity correctness issue remains.
