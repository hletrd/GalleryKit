# Debugger Review — Cycle 18

**Date:** 2026-06-27
**HEAD:** bcd67b12 (checked against installed code)
**Baseline:** Cycle-17 aggregate (`_aggregate.md`) — DBG-17-1 the headline; all cycle-16 fixes verified correct

---

## Scope

Latent bug surface only. Does NOT re-report cycle-17 or earlier items.
Focus areas per task brief: error-handling holes (claim leaks, awaits without try/catch),
null/undefined deref, off-by-one, unhandled promise rejection, async ordering bugs,
numeric edge cases, resource leaks (DB connections, file handles, Sharp instances),
race conditions, boundary conditions in ISOBMFF/ICC/EXIF parsers.

---

## Surfaces Investigated

| File | Lines reviewed | Method |
|------|---------------|--------|
| `apps/web/src/app/actions/images.ts` | 175-570 (full upload flow) | Read + settle-path trace |
| `apps/web/src/lib/image-queue.ts` | 113-175 (types), 380-430 (config gate), 474-570 (fire-and-forget IILEs) | Read + grep |
| `apps/web/src/lib/process-image.ts` | 832-981 (`saveOriginalAndGetMetadata`), 1275-1365 (atomic rename + cleanup), 1629-1706 (`stripGpsFromOriginal`) | Read |
| `apps/web/src/lib/admin-backfill-runner.ts` | 296-370 (advisory lock helpers), 478-620 (`reprocessOne`), 700-775 (batch loop), 800-870 (`triggerAdminBackfill`) | Read |
| `apps/web/src/lib/gain-map-detection.ts` | Full | Read |
| `apps/web/src/lib/icc-extractor.ts` | Full | Read |
| `apps/web/src/lib/icc-chromaticity.ts` | Full | Read |
| `apps/web/src/lib/color-detection.ts` | Full | Read |
| `apps/web/src/app/api/search/similar/[id]/route.ts` | Full | Read + grep |
| `apps/web/src/app/api/search/semantic/route.ts` | 60-200 | Read |
| `apps/web/src/app/actions/settings.ts` | Lock release pattern | Grep |
| `apps/web/src/app/actions/sharing.ts` | Rollback pattern | Grep |

---

## Confirmed Fixes from Cycle-17

### DBG-17-1 — Upload-tracker claim leak on topic-exists SELECT throw
**Status: CONFIRMED FIXED** at `apps/web/src/app/actions/images.ts:267-275`.

The topic-exists SELECT is now wrapped in try/catch that calls
`settleUploadTrackerClaim(..., files.length, totalSize, 0, 0)` before re-throwing.
The disk pre-check sibling (lines 233-251) has the same pattern. Both sibling
awaits between the synchronous claim (lines 226-228) and the queue-drain settle
(lines 533, 555) are now guarded. No missed sibling exists between claim and the
two mutually exclusive final settle paths.

### PERF-17-04 — Per-image redundant `getGalleryConfig()` on normal upload jobs
**Status: CONFIRMED FIXED.**

`ImageProcessingJob.semanticSearchMode` field added at `image-queue.ts:141`.
Enqueue site (`images.ts:497`) passes `uploadConfig.semanticSearchMode`.
Embedding IIFE (`image-queue.ts:521-523`) uses
`resolvedSemanticMode ?? job.semanticSearchMode ?? 'disabled'`,
falling through to a live `getGalleryConfig()` SELECT only for legacy snapshot-less
jobs (the `resolvedSemanticMode === null && job.semanticSearchMode === undefined`
guard at line 523). Normal upload jobs and bootstrap jobs both avoid the per-image
DB round-trip.

---

## New Bugs Found in Cycle-18

### NONE — Zero confirmed bugs.

All surfaces investigated are clean. No new HIGH, MEDIUM, or CRITICAL findings.

---

## Per-Surface Verification Notes

### `images.ts` — Upload flow settle coverage
- Synchronous claim at lines 226-228 — before all awaits, correct.
- Disk pre-check `await getDiskSpace()` (lines 233-251): try/catch+settle — correct.
- Topic-exists `await db.select(...)` (lines 267-275): try/catch+settle — correct (DBG-17-1 fix).
- If `topicRow` is undefined, settle+return at lines 279-282 — correct.
- File loop: each file's processing can fail independently; two final settle paths at lines 533
  (all-failed) and 555 (success/partial) are mutually exclusive and exhaustive.
- No double-settle or missed-settle path found.

### `image-queue.ts` — Lock and resource lifecycle
- Advisory lock connection for processing claims released at lines 633-636 in `finally`:
  `await releaseImageProcessingClaim(job.id, lockConnection).catch(...)` — correct.
- Fire-and-forget caption IIFE (lines 474-488): fully wrapped in try/catch — no unhandled rejection.
- Fire-and-forget embedding IIFE (lines 512-567): fully wrapped in try/catch — no unhandled rejection.
- PERF-17-04 fix wired correctly at lines 519-530 (see above).

### `process-image.ts` — File handle and temp file cleanup
- `saveOriginalAndGetMetadata`: stream pipeline uses `Readable.fromWeb + pipeline()`;
  Node's `pipeline()` destroys both streams on failure — no file handle leak.
  Post-write metadata extraction wrapped in try/catch that calls `safeUnlink(originalPath)`
  then rethrows — correct.
- Atomic rename (base filename creation, lines 1275-1303): `tmpPath` cleaned in `finally`
  using `safeUnlink(tmpPath)` which silently ignores ENOENT — safe for both success
  (tmpPath renamed away) and failure (partial tmpPath) paths.
- `processImageFormats` cleanup on failure (lines 1341-1363): `writtenSizedPaths` cleaned
  in catch; intermediate downscaled `processingInputPath` cleaned in `finally` — correct.
- `stripGpsFromOriginal` (lines 1629-1706): `tmpPath` written only in Tier 2 Sharp re-encode
  path. On success, `fs.rename(tmpPath, filePath)` moves it and the catch never runs.
  On any failure, `safeUnlink(tmpPath)` runs in catch. Early-return paths for HEIC/unknown
  extension return before writing `tmpPath`, so there is nothing to clean up — correct.
- Numeric guards: `Number.parseInt` results always checked with `Number.isFinite()` before
  use (lines 45-46, 330-331, 339-340); GPS clamped ±90/±180; `Infinity`/`NaN`→`null`
  before all DB writes.

### `admin-backfill-runner.ts` — Advisory lock lifecycle
- `acquireBackfillLock` (lines 303-322): returns connection (holding lock) or releases
  connection and returns null. No leak on failure.
- `releaseBackfillLock` (lines 324-333): null-guarded (`if (!lockConn) return`);
  `RELEASE_LOCK` query in try; `lockConn.release()` in `finally` — connection always
  returned to pool regardless of query success.
- `acquireImageProcessingClaim` (lines 343-358): throws after release on query error;
  returns connection or falls through to `lockConn.release()` when not acquired — correct.
- `releaseImageProcessingClaim` (lines 361-368): `lockConn.release()` in `finally` — correct.
- `reprocessOne` (lines 478-618): outer `finally` at lines 613-617 always calls
  `releaseImageProcessingClaim(...).catch(() => undefined)`, even when encode or detection
  throws before reaching it — correct.
- Batch loop (lines 700-775): per-row catch at line 732; tally increments are always
  reached; no abort on single failure.
- `triggerAdminBackfill` (lines 819-869): lock acquired at line 831; set to null at
  line 849 (handoff to `runBackfill`); outer catch at line 862 checks `if (lockConn)`
  before releasing — no double-release on the normal success path. Zero-candidates
  path (line 840) calls `releaseBackfillLock(lockConn)` then returns; if that call
  itself throws, the outer catch calls `releaseBackfillLock(lockConn).catch(...)` a
  second time — harmless because `releaseBackfillLock` catches its own query error and
  `lockConn.release()` is idempotent in mysql2.

### ISOBMFF / ICC parsers
- `gain-map-detection.ts`: MAX_DEPTH=5, MAX_SCAN_BYTES=1MB; all box reads bounds-checked;
  outer `try { walk(...) } catch { return false }` prevents any parser exception reaching
  the caller — correct.
- `icc-extractor.ts`: tagCount capped at 100; strLen capped at 1024; `clampUtf8Bytes` at
  255; outer try/catch returns null on any parse error — correct.
- `icc-chromaticity.ts`: `Math.abs(det) < 1e-12` guard before matrix inversion;
  `Math.abs(sum) < 1e-9` guard in `xyzToXy`; all XYZ reads guarded with
  `!Number.isFinite(x)` — correct.
- `color-detection.ts`: per-field guards on every NCLX-mapped value; ICC chromaticity
  upgrades primaries only at HIGH or MEDIUM confidence — correct.

### API search routes
- `apps/web/src/app/api/search/similar/[id]/route.ts`: `parseInt(idStr, 10)` followed
  by `!Number.isFinite(id) || id <= 0` at lines 77-80; rate limit pre-incremented at
  line 86; `rollbackSemanticAttempt` called on every early-return path before the
  expensive scan (lines 105, 125, 132, 137, 152); catch at line 234 is post-scan
  enrichment fallback (not a failed-request abort — correct to not refund the rate
  limit there since the scan succeeded).
- `apps/web/src/app/api/search/semantic/route.ts`: `Number.isFinite()` validation on
  `topKRaw` and `contentLength`; `SEMANTIC_SCAN_LIMIT` applied as `.limit()` in the
  DB query — correct.

### Sharing / settings
- `apps/web/src/app/actions/settings.ts`: `uploadContractLock` released in `finally` — correct.
- `apps/web/src/app/actions/sharing.ts`: `rollbackShareRateLimitFull` called on every
  error path; `decrementRateLimit` wrapped with `.catch()` to avoid masking original
  errors — correct.

---

## Summary

**Cycle-18 new confirmed bugs: 0.**

The codebase is clean on all investigated surfaces. The cycle-17 headline bug
(DBG-17-1) and the cycle-17 perf finding (PERF-17-04) are both correctly fixed
and properly wired end-to-end. All advisory lock connections are released in
`finally` blocks. All temp file cleanup paths are ENOENT-safe. All numeric guards
use `Number.isFinite()` before DB writes. All rate limit rollback patterns in the
semantic search routes are comprehensive. The ISOBMFF/ICC parsers are bounded and
exception-safe.

No new items are proposed for the cycle-18 plan.
