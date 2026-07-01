# Latest Aggregate Review

Current aggregate: `cycle-61-2026-07-01/_aggregate.md`

Cycle 61 produced seven deduplicated findings:

- `C61-01` - OG routes bypass restore-maintenance and can do DB/image work during restore.
- `C61-02` - Lightroom upload can query topic DB after restore starts but before acquiring the upload contract lock.
- `C61-03` - Migration journal tests do not catch orphan SQL files missing from `_journal.json`.
- `C61-04` - Cycle 60 terminal evidence is stale after signed/pushed/deployed commit `7e85644e`.
- `C61-05` - Local ignored `apps/web/.env.local` mode is group/world-readable.
- `C61-06` - Shared-group view-count flush race logic lacks behavioral coverage.
- `C61-07` - Lightroom upload route remains mostly source-contract covered.

Cycle 61 schedules `C61-01` through `C61-05` and defers only the broad test-coverage gaps `C61-06` and `C61-07` with explicit exit criteria. `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08` remain carried forward.
