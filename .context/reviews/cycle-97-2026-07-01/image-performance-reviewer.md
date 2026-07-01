# Cycle 97 Image / Performance / Concurrency Review

Scope: deployed `master` at `061c1c81af234469641f75a53e5bbc61fa63114a`.

## Findings

### C97-03 - Startup cleanup can delete active sidecar derivative temp files and misses stale backups

- Severity/confidence: Medium / High.
- Evidence: `apps/web/src/lib/image-queue.ts:33`-`49` deleted every derivative `*.tmp` during queue bootstrap with no age check; `apps/web/src/lib/image-queue.ts:1001` invokes it at bootstrap; `apps/web/src/lib/process-image.ts:1171` creates `.bak` files for in-place rewrites and `:1191` creates `.tmp` files for atomic writes; `apps/web/scripts/backfill-color-pipeline.ts:236` uses the same derivative directories from a sidecar.
- Failure scenario: a normal deploy/restart overlaps a documented sidecar backfill, the restarted web process unlinks the sidecar's fresh temp file, and the sidecar fails the row's atomic write. If the process crashes after backup creation, `.bak` files are left forever because cleanup only sees `.tmp`.
- Suggested fix: age-gate derivative cleanup and include stale `.bak` leftovers, with a unit test that preserves fresh active temps and removes stale temp/backup files.

## Residual Risks

No other confirmed queue/image/color/CLIP performance issues in this cycle. Load/EXPLAIN-only risks remain manual validation items in earlier deferred files.
