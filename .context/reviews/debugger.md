# Debugger Review - Cycle 10

Scope: latent bug surface, failure modes, async failures, race symptoms, data corruption/loss, and regressions in current `HEAD` of `/Users/hletrd/flash-shared/gallery`.

Constraints honored:
- Read and followed `AGENTS.md` plus `CLAUDE.md`.
- Review-only lane: no source edits.
- Wrote only this report artifact.
- Did not run deploy.
- Existing dirty sibling review artifacts were left untouched.

## Inventory Summary

Built the inventory before findings. The broad review set contained `2223` files across `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, `.context`, root docs, and package manifests.

Primary runtime surfaces reviewed:
- Upload and import: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`.
- Processing and cleanup: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/lib/queue-shutdown.ts`, `apps/web/src/lib/restore-maintenance.ts`.
- Data, schema, migration, restore: `apps/web/src/lib/data.ts`, `apps/web/src/db/schema.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`.
- Public/admin actions and APIs: `apps/web/src/app/actions/auth.ts`, `settings.ts`, `topics.ts`, `public.ts`, `sharing.ts`, `admin-users.ts`, `embeddings.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/smart-collections.ts`, `apps/web/src/lib/serve-upload.ts`.
- Final sweeps: cleanup/unlink swallowing, queue/delete race cleanup, restore maintenance gates, migration journal cursor behavior, public route mutation/rate-limit surfaces, and source-grep tests around cleanup contracts.

## Confirmed Findings

### DBG10-01 - Image delete cleanup reports success even when filesystem unlinks fail

Severity: High
Confidence: High
Status: Confirmed issue

Code regions:
- `apps/web/src/app/actions/images.ts:56-86` defines `collectImageCleanupFailures`, but it only records a cleanup failure when the supplied operation rejects.
- `apps/web/src/app/actions/images.ts:681-699` uses that helper for single-image delete and returns `cleanupFailureCount: cleanupFailures.length`.
- `apps/web/src/app/actions/images.ts:816-859` uses the same helper for bulk delete and returns the same count.
- `apps/web/src/lib/upload-paths.ts:75-79` makes `deleteOriginalUploadFile` resolve after swallowing both private and legacy original `fs.unlink` failures with `.catch(() => {})`.
- `apps/web/src/lib/process-image.ts:90-101` makes `safeUnlink` swallow all non-`ENOENT` unlink failures after a debug log.
- `apps/web/src/lib/process-image.ts:573-620` makes `deleteImageVariants` call `safeUnlink` for every derivative, so derivative unlink failures also resolve.
- Related paths with the same cleanup primitive: `apps/web/src/lib/admin-backfill-runner.ts:430-439` and `apps/web/scripts/backfill-color-pipeline.ts:127-136`.

Concrete failure scenario:
An admin deletes an image while the upload directory has a permission drift, transient `EIO`, `EBUSY`, `EMFILE`, readonly mount, or other non-`ENOENT` unlink failure. The database row is deleted first. The original cleanup operation then resolves because `deleteOriginalUploadFile` swallows unlink errors, and every derivative cleanup operation resolves because `safeUnlink` swallows unlink errors. `collectImageCleanupFailures` sees four successful promises, so the action returns `{ success: true, cleanupFailureCount: 0 }`. Public derivative files under `public/uploads` can remain directly reachable by old URLs even though the image was deleted from the DB; private originals can also remain on disk. The UI warning path in `apps/web/src/components/image-manager.tsx:145-178` is therefore never reached for the most important cleanup failures.

Why this is confirmed:
The delete actions depend on promise rejection to observe cleanup failure, but the cleanup functions intentionally convert non-`ENOENT` unlink failures into fulfilled promises. No race timing is required; any actual unlink rejection is masked deterministically.

Concrete fix:
Separate tolerant temporary-file cleanup from deletion guarantees. For image deletion and deleted-mid-reencode cleanup, use a strict cleanup helper that treats `ENOENT` as success but returns or throws structured failures for `EACCES`, `EPERM`, `EIO`, `EBUSY`, `EMFILE`, and scan failures. Make `deleteOriginalUploadFile` and `deleteImageVariants` either return `ImageCleanupFailure[]` or expose strict variants such as `deleteOriginalUploadFileStrict` / `deleteImageVariantsStrict`. Then have `collectImageCleanupFailures` retry strict operations and report nonzero `cleanupFailureCount` to the UI/logs. Add a regression test that mocks `fs.unlink` to reject with `EACCES` and asserts delete returns a cleanup warning instead of `cleanupFailureCount: 0`.

## Reviewed Non-Findings

- Migration journal ordering is non-monotonic in `apps/web/drizzle/meta/_journal.json:47-130`, and the sweep confirmed entries `0007` through `0017` have `when` values below earlier entries. This is already accounted for in `apps/web/scripts/migrate.js:686-762` via reconcile plus per-entry baselining, and `apps/web/scripts/migrate.js:764-785` fails loudly if any committed migration hash is missing after Drizzle runs. I did not classify this as a new runtime finding.
- The sidecar deleted-mid-reencode cleanup no longer matches the older fatal-cleanup risk. `apps/web/scripts/backfill-color-pipeline.ts:127-136` now uses `Promise.allSettled` and logs individual cleanup failures, while `apps/web/src/lib/admin-backfill-runner.ts:430-439` catches best-effort cleanup failures. The remaining problem is that the underlying unlink helper can still mask failures, covered by `DBG10-01`.
- Restore/upload maintenance gates were traced through `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/queue-shutdown.ts`, `apps/web/src/app/actions/images.ts`, and the Lightroom upload route. I did not confirm a new restore-vs-upload race in this pass.
- Queue bootstrap, retry, permanent-failure, and deleted-mid-update cleanup paths in `apps/web/src/lib/image-queue.ts` were reviewed. I did not confirm a new stuck-job or duplicate-processing regression beyond the cleanup observability issue above.

## Verification Evidence

Read-only commands and checks performed:
- `git status --short --branch` to identify pre-existing dirty artifacts before writing this report.
- Inventory via `rg --files` across app source, scripts, migrations, tests, configs, and committed context.
- Targeted sweeps for cleanup/unlink swallowing, `deleteImageVariants`, `deleteOriginalUploadFile`, `safeUnlink`, `cleanupFailureCount`, queue/delete race cleanup, migration journal cursor behavior, and public/admin async surfaces.
- Migration journal monotonicity check with a Node script; result confirmed non-monotonic historical entries but no new finding because the migration script now handles that condition.
- Line-numbered inspection of all code regions cited above.

Tests not run:
- Full lint/typecheck/build/test gates were not run because this prompt requested a review report only and no source changes. The finding should be locked with a focused failing regression test during the fix prompt.

No additional confirmed Critical or High findings were found after the final missed-issues sweep.
