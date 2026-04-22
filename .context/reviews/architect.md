# Cycle 11 Architect Notes

Finding count: 4

### A11-01 — Restore maintenance is still process-local
- **Severity:** HIGH
- **Confidence:** HIGH
- **Citations:** `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/image-queue.ts`
- Shared DB restore coordination still fans out into process-local mutation guards.

### A11-02 — Backup/restore only snapshots MySQL, not the filesystem-backed image corpus
- **Severity:** HIGH
- **Confidence:** HIGH
- **Citations:** `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/image-queue.ts`, `README.md`
- DB-only restore can leave missing/orphaned files and stuck image rows.

### A11-03 — Public search still scales via repeated wildcard scans
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Citations:** `apps/web/src/lib/data.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/app/actions/public.ts`
- Search fan-out still depends on repeated `%term%` scans without a dedicated searchable projection.

### A11-04 — Several correctness-sensitive counters remain process-local
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Citations:** `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/upload-tracker.ts`
- View-count buffering and cumulative upload windows still assume a single Node process.
