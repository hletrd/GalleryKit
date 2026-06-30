# Cycle 46 Backfill / Storage Review

## Finding: C46-F1

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/lib/process-image.ts:1199`, `apps/web/src/lib/process-image.ts:1463`, `apps/web/src/lib/admin-backfill-runner.ts:533`, `apps/web/scripts/backfill-color-pipeline.ts:232`, `apps/web/src/app/actions/images.ts:722`

`processImageFormats()` restores backed-up final derivative files on encode failure. During a color backfill, `deleteImage()` can remove the DB row and unlink variants while the backfill still holds the per-image processing lock. If encode/verification then throws, rollback restores `.bak` derivatives and both backfill paths classify the row as encode failure before checking whether the row still exists.

Fix: on encode failure in both backfill entry points, query row existence; if absent, run existing full-directory variant cleanup and count `deleted-mid-reencode`.
