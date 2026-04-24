# Code Reviewer Cycle 1 — review-plan-fix specialist review

## Scope

Comprehensive read-only review of the repository at `HEAD 0000000979` with full inventory coverage of review-relevant files. I excluded generated/build/artifact directories (`node_modules`, `.next`, `test-results`, `.omx`, `.omc`, `.context`, `plan`) and binary/static upload assets because they are not review-relevant source. All remaining code/docs/config/test files were inventoried and mechanically swept; the highest-risk logic paths were additionally read in full.

- Review-relevant files inventoried: **256**
- `app`: 55 files
- `components`: 44 files
- `lib`: 44 files
- `db`: 3 files
- `tests`: 56 files
- `scripts`: 14 files
- `messages`: 2 files
- `migrations`: 6 files
- `web-config`: 21 files
- `root`: 11 files

## Verification and sweep performed

- `npm --workspace=apps/web run test` → **50 passed / 298 passed**
- `npm --workspace=apps/web run lint` → **passed**
- `npm --workspace=apps/web run build` → **passed**
- `./apps/web/node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit --pretty false` → **fails** on `src/__tests__/privacy-fields.test.ts:56`
- repo-wide pattern sweeps run for `console.log`, empty `catch`, TODO/FIXME/HACK, same-origin/rate-limit/restore surfaces
- code-intel MCP diagnostics were attempted but the transport was unavailable, so I used CLI-backed verification (`tsc`, `eslint`, `vitest`, targeted `rg`, targeted file reads) instead

## Findings

### 1) Confirmed — retry path is bypassed when derivative verification fails
- **Severity:** MEDIUM
- **Confidence:** High
- **Region:** `apps/web/src/lib/image-queue.ts:246-259` and `apps/web/src/lib/image-queue.ts:282-294`
- **Why this is a problem:** the queue verifies the three output files after `processImageFormats()`, but on any verification failure it only logs and `return`s. That early return skips the `catch` block that contains the retry logic. The comment at line 258 says “retry will handle it”, but the retry path is only entered on `throw`/rejection.
- **Concrete failure scenario:** if Sharp finishes with one zero-byte or missing derivative (temporary disk pressure, interrupted rename, partial filesystem failure), the row remains `processed = false`, no in-process retry happens, and the image stays unavailable until a later bootstrap/restart re-enqueues it. This is user-visible on a long-lived server.
- **Suggested fix:** after verification failure, either (a) throw an error so the existing retry loop runs, or (b) explicitly clean up partial derivatives and re-enqueue from the failure branch. Add a unit/integration test that stubs `processImageFormats` to leave one derivative missing/zero-byte and asserts the retry counter increments.

### 2) Confirmed — the repository’s TypeScript typecheck is currently red even though tests/build are green
- **Severity:** MEDIUM
- **Confidence:** High
- **Region:** `apps/web/src/__tests__/privacy-fields.test.ts:54-56` with cross-file impact from `apps/web/tsconfig.json:31-38`
- **Why this is a problem:** `adminSelectFieldKeys` is a wider union than `publicSelectFieldKeys`, so `publicSelectFieldKeys.includes(key)` is not type-safe for the compiler. `tsc -p apps/web/tsconfig.json --noEmit` fails with `TS2345`, but `vitest` and `next build` both stay green, so the repository can look healthy while its declared TypeScript program is broken.
- **Concrete failure scenario:** anyone adding a dedicated CI `tsc` step, editor “problems” gate, or release-time typecheck will get a hard failure from this test file. Because build/test do not surface it, the breakage is easy to miss until the workflow is tightened.
- **Evidence:** `apps/web/src/__tests__/privacy-fields.test.ts(56,62): error TS2345 ... Type "filename_original" is not assignable ...` from `./apps/web/node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit --pretty false`.
- **Suggested fix:** compare via a widened container (`new Set<string>(publicSelectFieldKeys)`), or cast the arrays to `readonly string[]` before `.includes()`. Also add a first-class `typecheck` script so the repo’s intended TypeScript program is exercised alongside lint/test.

### 3) Confirmed likely risk — restore SQL scanner still allows `DO ...`, so crafted dumps can hang the restore session
- **Severity:** LOW
- **Confidence:** Medium
- **Classification:** Likely risk (scanner gap confirmed; exploit requires an authenticated admin restore action)
- **Region:** `apps/web/src/lib/sql-restore-scan.ts:1-48` and missing coverage in `apps/web/src/__tests__/sql-restore-scan.test.ts:22-69`
- **Why this is a problem:** the dangerous-statement blocklist covers `GRANT`, `REVOKE`, `CALL`, `LOAD DATA`, `CREATE USER`, etc., but it does not block `DO`. A statement like `DO SLEEP(86400);` is not emitted by `mysqldump`, yet it will execute under `mysql` restore and can hold the restore window/advisory lock for a long time.
- **Concrete failure scenario:** an authenticated admin uploads a crafted dump containing `DO SLEEP(...)`; the scanner accepts it, `mysql` executes it, and the restore session stays occupied while maintenance mode and the restore advisory lock remain held.
- **Evidence:** a direct evaluator run against the current pattern list returned `DO SLEEP(5); => false` while `CREATE USER x; => true`.
- **Suggested fix:** add a `DO` pattern (for example `/\bDO\s+/i`) and a regression test beside the existing `CALL` / `REVOKE` / `RENAME USER` cases.

### 4) Confirmed likely risk — experimental storage backend accepts empty/dot keys as the upload root itself
- **Severity:** LOW
- **Confidence:** Medium
- **Classification:** Likely risk (current abstraction is exported but not yet wired into the live pipeline)
- **Region:** `apps/web/src/lib/storage/local.ts:25-31`
- **Why this is a problem:** `resolve()` explicitly allows `resolved === path.resolve(UPLOAD_ROOT)`, so `""` and `"."` both pass the guard and resolve to the root directory. Downstream calls then fail later with directory-oriented errors (`EISDIR`, “not a regular file”) instead of rejecting the key up front.
- **Concrete failure scenario:** when this abstraction gets integrated or reused by another caller, a malformed or empty key can produce inconsistent runtime behavior depending on which method is called (`stat`, `readBuffer`, `createReadStream`, `copy`), making error handling harder and potentially bypassing assumptions that keys always name files.
- **Evidence:** direct evaluation of the current logic resolves both `""` and `"."` to the upload root and marks them as passing the guard.
- **Suggested fix:** reject empty, dot, and dot-segment keys before `path.resolve()`, and add a small unit test covering `""`, `"."`, and `".."` inputs.

## Missed-issues sweep / cross-file notes

- I re-swept the largest and most coupled files (`src/lib/data.ts`, `src/app/actions/images.ts`, `src/lib/process-image.ts`, `src/lib/image-queue.ts`, `src/app/[locale]/admin/db-actions.ts`, `src/app/actions/{auth,sharing,tags,topics}.ts`, `src/components/{photo-viewer,image-manager,upload-dropzone,lightbox}.tsx`) after the first pass.
- Search/lint/test/build surfaces are otherwise in good shape: no failing Vitest tests, no ESLint failures, and no build breakages were reproduced.
- The remaining issues are mostly “verification gap / edge-path” problems rather than broad architectural defects: one real typecheck break, one real queue retry bug, and two low-severity hardening gaps.

## Inventory appendix

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

### components (44)
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

### lib (44)
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/action-result.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/audit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/backup-filename.ts`
- `apps/web/src/lib/base56.ts`
- `apps/web/src/lib/clipboard.ts`
- `apps/web/src/lib/constants.ts`
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
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/utils.ts`
- `apps/web/src/lib/validation.ts`

### messages (2)
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

### migrations (6)
- `apps/web/drizzle/0000_nappy_madelyne_pryor.sql`
- `apps/web/drizzle/0001_sync_current_schema.sql`
- `apps/web/drizzle/0002_fix_processed_default.sql`
- `apps/web/drizzle/meta/0000_snapshot.json`
- `apps/web/drizzle/meta/0001_snapshot.json`
- `apps/web/drizzle/meta/_journal.json`

### root (11)
- `.agent/rules/commit-and-push.md`
- `.vscode/extensions.json`
- `.vscode/launch.json`
- `.vscode/settings.json`
- `.vscode/tasks.json`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `package-lock.json`
- `package.json`
- `scripts/deploy-remote.sh`

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

### tests (56)
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/helpers.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/e2e/origin-guard.spec.ts`
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`
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
- `apps/web/src/__tests__/clipboard.test.ts`
- `apps/web/src/__tests__/csv-escape.test.ts`
- `apps/web/src/__tests__/data-pagination.test.ts`
- `apps/web/src/__tests__/db-pool-connection-handler.test.ts`
- `apps/web/src/__tests__/db-restore.test.ts`
- `apps/web/src/__tests__/error-shell.test.ts`
- `apps/web/src/__tests__/exif-datetime.test.ts`
- `apps/web/src/__tests__/gallery-config-shared.test.ts`
- `apps/web/src/__tests__/health-route.test.ts`
- `apps/web/src/__tests__/histogram.test.ts`
- `apps/web/src/__tests__/image-url.test.ts`
- `apps/web/src/__tests__/images-actions.test.ts`
- `apps/web/src/__tests__/lightbox.test.ts`
- `apps/web/src/__tests__/live-route.test.ts`
- `apps/web/src/__tests__/locale-path.test.ts`
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
- `apps/web/src/__tests__/shared-page-title.test.ts`
- `apps/web/src/__tests__/sql-restore-scan.test.ts`
- `apps/web/src/__tests__/tag-input.test.ts`
- `apps/web/src/__tests__/tag-records.test.ts`
- `apps/web/src/__tests__/tag-slugs.test.ts`
- `apps/web/src/__tests__/tags-actions.test.ts`
- `apps/web/src/__tests__/topics-actions.test.ts`
- `apps/web/src/__tests__/upload-dropzone.test.ts`
- `apps/web/src/__tests__/upload-tracker.test.ts`
- `apps/web/src/__tests__/validation.test.ts`

### web-config (21)
- `apps/web/README.md`
- `apps/web/components.json`
- `apps/web/deploy.sh`
- `apps/web/drizzle.config.ts`
- `apps/web/eslint.config.mjs`
- `apps/web/next-env.d.ts`
- `apps/web/next.config.ts`
- `apps/web/nginx/default.conf`
- `apps/web/package.json`
- `apps/web/playwright.config.ts`
- `apps/web/postcss.config.mjs`
- `apps/web/public/histogram-worker.js`
- `apps/web/src/i18n/request.ts`
- `apps/web/src/instrumentation.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/site-config.example.json`
- `apps/web/src/site-config.json`
- `apps/web/tailwind.config.ts`
- `apps/web/tsconfig.json`
- `apps/web/tsconfig.scripts.json`
- `apps/web/vitest.config.ts`
