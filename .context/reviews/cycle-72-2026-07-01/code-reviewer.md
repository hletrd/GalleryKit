# Cycle 72 Code Reviewer / Architect Review

HEAD reviewed: `363dc1c9` (`fix(cycle-71): guard sidecars during restore maintenance`).
Scope: read-only review; no files edited.

## Inventory

- Restore-maintenance lifecycle and durable marker helper.
- Cycle 71 sidecar restore-maintenance guards in the color and CLIP backfills.
- Image derivative write path in `process-image.ts`.
- Restore DB action marker behavior, privacy selectors, public API guard surfaces, and recent deferred ledgers.

Validation evidence from the lane:

- `npm test --workspace=apps/web -- --run src/__tests__/restore-maintenance.test.ts src/__tests__/cycle-71-source-contracts.test.ts src/__tests__/image-queue-settings-wiring.test.ts src/__tests__/image-queue-embed-wiring.test.ts` passed: 4 files, 24 tests.
- `npm run typecheck --workspace=apps/web` passed.

## Findings

### C72-01 - Durable restore-maintenance marker can fail open on unreadable paths

- Severity/confidence: Medium / High.
- File/line: `apps/web/src/lib/restore-maintenance-durable.ts:36-43`.
- Evidence: `readDurableRestoreMaintenance()` uses `fs.existsSync(markerPath)` and only fails closed if that call throws. Node can return `false` for marker paths it cannot stat through an inaccessible parent, so the sidecar guard can treat an unreadable marker path as inactive.
- Failure scenario: a restore leaves durable maintenance active, but a sidecar process has a bad `RESTORE_MAINTENANCE_DIR` or permission view. The sidecar proceeds into writes during a protected restore/recovery window.
- Suggested fix: use `fs.statSync(markerPath)` or equivalent, return `false` only for `ENOENT`, and fail closed for all other read errors. Add a regression test for a non-`ENOENT` read failure.

### C72-02 - Color sidecar can rewrite derivative files after restore maintenance starts mid-row

- Severity/confidence: Medium / Medium.
- File/line: `apps/web/scripts/backfill-color-pipeline.ts:515`, `apps/web/scripts/backfill-color-pipeline.ts:227`, `apps/web/src/lib/process-image.ts:1182`, `CLAUDE.md:217`.
- Evidence: the color sidecar checks durable maintenance before `reprocessRow()`, but `reprocessRow()` calls `processImageFormats()`, whose atomic final-path rename writes derivative files before the later DB-flush guard. The SQL restore contract explicitly does not roll back files under `public/uploads`.
- Failure scenario: restore maintenance starts after a row begins re-encoding. The sidecar can rewrite derivative bytes, then later avoid the DB update, leaving filesystem bytes changed during restore and out of sync with the restored DB.
- Suggested fix: add a sidecar-only write guard at the derivative final-write boundary and ensure `processImageFormats()` rolls back already-swapped files if the guard trips.

## Final Sweep

Known carry-forward items were not re-raised without new evidence. The current gaps are specific to the fail-closed and write-boundary behavior introduced around the Cycle 71 sidecar guard work.
