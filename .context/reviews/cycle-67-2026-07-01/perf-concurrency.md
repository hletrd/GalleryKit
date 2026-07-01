# Cycle 67 Performance / Concurrency / Deploy Operability Review

Current HEAD: `3e8ab924b5ed714f8a0f1dbfe1f9739d6fe25886`.

## Inventory

- Reviewed image queue/bootstrap, admin and sidecar backfills, CLIP semantic search and embedding backfill, similar search, histogram worker/component, service worker cache behavior, deploy scripts, Docker runtime, and migration/reconcile behavior.
- No files edited in this review lane.

## Findings

### C67-02 - CLIP embedding sidecar can stop at a custom scan limit without the rerun notice

- Severity/confidence: Medium / High.
- File/line: `apps/web/scripts/backfill-clip-embeddings.ts:144`, `apps/web/scripts/backfill-clip-embeddings.ts:174`, `apps/web/scripts/backfill-clip-embeddings.ts:223`, `CLAUDE.md:545`.
- Evidence: the script logs `Reached SEMANTIC_SCAN_LIMIT (...)` only at the top of the next loop when `remainingScanBudget === 0`. A non-`BATCH_SIZE`-aligned cap makes the final limited query return fewer than `BATCH_SIZE` rows, so line 223 breaks before the notice.
- Failure scenario: an operator sets `SEMANTIC_SCAN_LIMIT=75`, processes 50 then 25 rows, sees only `Done... processed=75 failed=0`, and does not repeat the command even though more images may remain.
- Fix direction: emit the same scan-limit rerun notice immediately after a batch exhausts the scan budget, before the short-page break.

## Final Sweep

No new finding was confirmed in image queue claims, color backfill locking, service worker cache bounds, histogram lifecycle, deploy prune sequencing, or migration hash postconditions.
