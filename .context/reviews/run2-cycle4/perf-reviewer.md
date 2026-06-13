# Performance + Concurrency/Race Review — Run-2 Cycle 4 (HEAD 2508f132)

Date: 2026-05-30
Method: direct orchestrator review (Task fan-out unavailable in nested context).

## Verdict: ZERO net-new findings (CRIT 0 / HIGH 0 / MED 0 / LOW 0)

## Concurrency / lock-lifecycle surfaces verified clean

| Surface | File(s) | Evidence |
|---|---|---|
| Backfill advisory lock (in-app) | `lib/admin-backfill-runner.ts` | `acquireBackfillLock` non-blocking `GET_LOCK(name,0)`; lock connection handed off to `runBackfill` which releases in a single `finally` (R29-CRIT-1). Every state mutation + `getGalleryConfig()` is INSIDE the try block, so a thrown config read can't strand `state.running=true` or leak the lock. Fire-and-forget `.catch()` swallows synchronous rejections (no unhandledRejection process kill). Zero-candidate fast path releases the lock before returning. |
| Backfill advisory lock (sidecar) | `scripts/backfill-color-pipeline.ts` | `GET_LOCK(name,10)`, explicit RELEASE_LOCK + connection close on every exit path (0 candidates, success, error). `--force-reencode` bypasses version gate intentionally. |
| Backfill ⇄ queue isolation | runner + `image-queue.ts:368` | Runner only touches `processed=TRUE` rows; queue only claims `processed=false`. No overlap. UPDATE column sets are equivalent: queue sets `{processed, pipeline_version, was_downscaled, avif_10bit, processing_error, failed_at}`; backfill success path mirrors color + derivative cols; detection-failure path persists ONLY `was_downscaled`+`avif_10bit` WITHOUT bumping `pipeline_version` (preserves AGG-01 resume invariant — row re-picked on later run). Runner and script match exactly (AGG2-01). |
| Backfill ⇄ restore isolation | runner | `isRestoreMaintenanceActive()` checked at trigger time AND per-queued-task, so a restore taking over the DB aborts in-flight re-encode tasks gracefully. |
| Snapshot stability | `lib/use-display-capability.ts:73-81` | `detect()` returns cached reference when `colorGamut`+`isHdr` unchanged → `useSyncExternalStore` `Object.is` stable → no React #185 loop. `getServerSnapshot` returns module constant. |
| serve-upload ETag/cache | `lib/serve-upload.ts` | ETag embeds pipeline version + mtime + size + settings-hash; backfill re-encode bumps mtime so cached clients revalidate. (Re-confirmed clean per cycle 3.) |

## Perf notes (no action)
- `fetchCandidates()` loads all candidate rows at once (DEF-02 carryover, LOW) —
  exit criterion (OOM / >~50k un-migrated rows) NOT reached at current scale.
- Per-row UPDATE in runner vs batched in script (DEF-03 carryover, LOW) — not a
  correctness issue; pool not exhausted in practice. Severity preserved.

## Note on honesty
Independent re-verification of every lock acquire/release pairing across all
throw paths found no leak, deadlock, or unhandled rejection. No findings.
