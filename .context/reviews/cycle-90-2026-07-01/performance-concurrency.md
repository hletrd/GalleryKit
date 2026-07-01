# Cycle 90 Performance / Concurrency Review

Start HEAD: `baefb4277e67bf387c350b56b61b56d40451c933`.

## Scope

Reviewed the Cycle 89 backfill pixel-cap change, in-app/sidecar backfill detection paths, semantic scan caps, public rate-limit bounded maps, and known carry-forward concurrency deferrals.

## Findings

No new performance or concurrency finding was confirmed beyond the release-ledger item captured as `C90-01` in the merged aggregate.

## Evidence

- Cycle 89 replaced duplicated post-reencode detection pixel caps with `MAX_INPUT_PIXELS` in both paths (`apps/web/scripts/backfill-color-pipeline.ts:275`-`277`, `apps/web/src/lib/admin-backfill-runner.ts:591`-`593`).
- `apps/web/src/__tests__/cycle-89-source-contracts.test.ts` source-locks both detection constructors against reverting to the hard-coded `256 * 1024 * 1024` cap.
- Semantic scan/top-K caps remain env-guarded and upper-clamped in `apps/web/src/lib/clip-embeddings.ts:36`-`44`.
- Public search/load-more/view-record buckets remain bounded and pre-incremented in `apps/web/src/app/actions/public.ts`.

## Carry-Forward

`C88-03`, `C80-06`, `C77-ARCH-01`, `C76-04`, `C76-05`, and `C75-08` remain governed by prior deferred artifacts and were not duplicated here.
