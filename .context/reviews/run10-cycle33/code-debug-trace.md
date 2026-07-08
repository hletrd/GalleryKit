# Run-10 Cycle 33 Code / Debug / Trace Review

HEAD eligibility: current `HEAD` is `959e45afdfcf901f9f88e3eb8e675a12545ced8c`, matching the requested minimum.

Relevant inventory inspected:

- Review/control-surface: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/run10-cycle32/{plan,deferred}.md`, `.context/reviews/run10-cycle32/_aggregate.md`, root/app `package.json`, `.github/workflows/quality.yml`, `apps/web/src/__tests__/cycle12-ops-contracts.test.ts`.
- Source flows traced: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/pending-file-deletions.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/data-timeline.ts`, and related source-contract/behavior tests.

## Finding 1 - Bulk delete cleans pending-file rows for images it did not actually delete

- Severity: High
- Confidence: High
- File/line: `apps/web/src/app/actions/images.ts:814`
- Failure scenario: `deleteImages()` fetches `imageRecords`, then inside the transaction inserts a `pending_file_deletions` row for every fetched image before running one batch `DELETE ... WHERE id IN (...)` at `apps/web/src/app/actions/images.ts:833`. If a concurrent delete or restore interleaving removes one of those rows after the initial fetch but before this transaction's delete, `deleteResult.affectedRows` can be lower than `pendingDeletions.length` (`staleCount` is calculated at `apps/web/src/app/actions/images.ts:838`). However the cleanup loop still iterates every `pendingDeletion` at `apps/web/src/app/actions/images.ts:865`, including stale rows this call did not delete. Because restores are SQL-only and do not roll back host files, a stale pending row can name files that now belong to a live restored image with the same filename/id lineage. This action can then unlink originals/derivatives for a row it did not delete, leaving the restored live DB row pointing at missing files. The single-image path avoids the same class by deleting its pending row and returning when `deletedRows === 0` (`apps/web/src/app/actions/images.ts:703`).
- Concrete fix: Make `pendingDeletions` contain only rows whose image delete was proven by this transaction. The least ambiguous fix is to perform the row fetch and delete mapping inside the same transaction with row locks, or delete per image inside the transaction and push the `PendingFileDeletionRecord` only when that image's `DELETE` returns `affectedRows === 1`; if an inserted pending row's delete returns `0`, remove that pending row before commit and do not run `cleanupPendingFileDeletion` for it. Add a regression test simulating `imageRecords.length > deletedRows` and asserting stale pending rows are not cleaned.

No other new confirmed source findings from this lane. The December archive boundary, production audit gate wiring, pending cleanup retry semantics, restore post-drain hook, and action-guard surfaces matched current tests and documentation during this pass.
