# Code Review Summary — PROMPT 1 / cycle 4

**Scope:** Full-repo review of review-relevant code/config/runtime files, excluding `node_modules`, `.next`, `.git`, `test-results`, generated artifacts, and binary assets.

**Files Reviewed:** 192 review-relevant files
- `src/app`: 55
- `src/components`: 44
- `src/lib`: 46
- `src/db`: 3
- `src/other`: 5
- `apps/web/scripts`: 14
- `apps/web` config/root files: 21
- root config/scripts: 4

**Validation performed**
- Read/inventoried all review-relevant files via repo-wide scan
- `npm --prefix apps/web run typecheck` ✅
- `npm --prefix apps/web run lint` ✅
- `npm --prefix apps/web run lint:api-auth` ✅
- `npm --prefix apps/web run lint:action-origin` ✅
- Repo-wide pattern scans for `console.log`, empty catches, hardcoded secrets ✅

## By Severity
- **CRITICAL:** 0
- **HIGH:** 1
- **MEDIUM:** 2
- **LOW:** 1

## Issues

### CR-C4-01 — Backup generation and restore scanning are misaligned; the app can likely reject its own backups
- **Severity:** HIGH
- **Confidence:** Medium
- **Status:** Likely
- **File / region:** `apps/web/src/app/[locale]/admin/db-actions.ts:136-143`, `apps/web/src/app/[locale]/admin/db-actions.ts:367-381`, `apps/web/src/lib/sql-restore-scan.ts:17-19`
- **Issue:** `dumpDatabase()` invokes `mysqldump` with only `--single-transaction` and `--quick`, while `restoreDatabase()` rejects dumps containing `DROP TABLE` / `DELETE FROM`.
- **Failure scenario:** An admin creates a backup from the UI, later uploads that same `.sql` file into restore, and receives the localized `disallowedSql`/restore failure because the scanner blocks statements emitted by the dump command.
- **Suggested fix:** Make dump and restore deterministic: add dump flags matching the scanner, relax the scanner for the exact app-generated dump statement set, and add a golden-path round-trip test.

### CR-C4-02 — Uploads can silently lose requested tags while still reporting success
- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** Confirmed
- **File / region:** `apps/web/src/app/actions/images.ts:252-287`, `apps/web/src/app/actions/images.ts:305-343`
- **Issue:** In `uploadImages()`, tag creation/linking errors are caught, logged, and ignored. The upload still counts as successful.
- **Failure scenario:** An admin uploads photos with tags during a transient DB issue. The UI shows upload success, but search/filter pages cannot find those photos by the requested tags.
- **Suggested fix:** Treat tag persistence as part of the upload contract: use a transaction or return per-file warnings/errors so the client can surface partial success and retry.

### CR-C4-03 — The storage-backend abstraction is exposed as switchable, but the live pipeline bypasses it entirely
- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** Confirmed
- **File / region:** `apps/web/src/lib/storage/index.ts:52-143`, `apps/web/src/lib/process-image.ts:242-253`, `apps/web/src/lib/process-image.ts:362-444`, `apps/web/src/lib/serve-upload.ts:63-103`, `apps/web/src/lib/upload-paths.ts:12-46`
- **Issue:** `storage/index.ts` exposes a backend singleton and backend-switching API, but upload processing, file writes, file serving, and path resolution still talk directly to the local filesystem.
- **Failure scenario:** A maintainer calls `switchStorageBackend(...)` expecting uploads/reads to move off local disk; new code using `getStorage()` behaves one way while real upload/serve paths continue writing and serving local paths.
- **Suggested fix:** Remove the unfinished abstraction until backend switching is real, or route all save/read/delete/serve paths through `StorageBackend`.

### CR-C4-04 — Generated OG images ignore runtime SEO branding and can drift from the rest of the site
- **Severity:** LOW
- **Confidence:** High
- **Status:** Confirmed
- **File / region:** `apps/web/src/app/api/og/route.tsx:4-5`, `apps/web/src/app/api/og/route.tsx:29-30`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:55-67`
- **Issue:** `/api/og` reads branding from static `site-config.json`, while page metadata elsewhere uses runtime/admin-managed `getSeoSettings()`.
- **Failure scenario:** An admin updates SEO branding. Page metadata updates, but generated topic OG images still render the old build-time site title.
- **Suggested fix:** Use the same metadata source for OG generation as the rest of the app, or pass already-resolved title/brand through a shared helper.

## Final sweep
Re-checked auth/origin enforcement, upload/process/serve, backup/restore, SEO/OG, storage abstraction vs runtime path, and repo-wide diagnostics. No additional CRITICAL/HIGH issues beyond CR-C4-01 were found.

## Skipped files/categories
Unit/e2e tests, `.context/**`, `.omx/**`, `.omc/**`, `plan/**`, binary/static assets, `node_modules`, `.next`, `.git`, and `test-results` were skipped as non-authoritative for this review lane.

## Recommendation
REQUEST CHANGES
