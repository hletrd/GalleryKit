# Debugger Review — Cycle 5 Manual Fallback

_Manual fallback after child-agent timeout._

## Confirmed latent bug

### G5-01 — `uploadImages()` can still cross the restore boundary after its initial guard
- **Severity:** HIGH
- **Confidence:** High
- **Citations:** `apps/web/src/app/actions/images.ts:81-88,180-227`, `apps/web/src/app/[locale]/admin/db-actions.ts:256-269`
- **Failure scenario:** an upload request passes the top-of-function `isRestoreMaintenanceActive()` check, then a restore starts while the upload is inside `saveOriginalAndGetMetadata()`. The upload proceeds to DB insert because there is no second guard near the write boundary.
- **Suggested fix:** re-check the maintenance state after file preprocessing and before DB insert/queue enqueue, cleaning up any saved originals if the restore window opened in the meantime.
