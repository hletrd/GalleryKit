# Latent Bug Surface Review — R5C1

**Reviewer:** Debugger agent  
**Date:** 2026-06-11  
**Scope:** Latent failure modes not yet fired — unhandled promise rejections, inconsistent state on error paths, boundary errors, TZ/datetime hazards, encoding issues, null/undefined flows TypeScript can't see, process lifecycle bugs, regressions from recent commits.

---

## Summary

| Severity | Count |
|----------|-------|
| HIGH     | 2     |
| MED      | 3     |
| LOW      | 3     |
| TOTAL    | 8     |

---

## Findings

---

### BUG-R5C1-01 — HIGH / confirmed

**File:** `apps/web/src/lib/process-image.ts:1128`  
**Classification:** Undefined behavior on consumed Sharp pipeline (AVIF 10-bit fallback)

**The bug:**  
Inside `generateForFormat`, the AVIF encode at line 1106–1114 calls `base.toFile(outputPath)`. `toFile()` on a Sharp instance terminates the pipeline — it begins consuming the input stream to completion. The `catch` block at line 1118–1136 fires when `wantHighBitdepth` is true and the encode fails with a `bitdepth`-related error. It then calls `base.clone()` at line 1128 to retry at 8-bit.

However, `base` was already consumed by the `.toFile()` call on line 1114. Cloning a Sharp instance AFTER it has been consumed produces a clone of an already-drained stream. The comment at line 1122–1127 even documents that `clone()` copies the "options snapshot" — but it does not reconstitute the source pixel stream after the stream has been consumed. The retry will either produce a zero-byte file, throw internally, or produce corrupt output depending on the Sharp/libvips version.

**Trigger scenario:**  
Any wide-gamut photo upload where `canUseHighBitdepthAvif()` resolves true (the probe singleton says yes) but the specific image fails 10-bit encode. In practice this occurs when libvips was probed against a simple test image that encoded fine at 10-bit, but the actual source image has properties (e.g. unusual HEIF container metadata, specific dimensions, unusual ICC data) that cause the libheif 10-bit path to reject it.

**Evidence:**  
`base` is the Sharp instance that enters `generateForFormat` as a parameter (sourced from `pipelineSharp` at the call site). It is NOT re-instantiated before the fallback clone. The `.toFile()` call at line 1114 consumes it.

**Suggested fix:**  
Re-instantiate `base` from `inputPath` (the original or TIFF intermediate) before the fallback encode, following the same pattern used for per-format fresh instances further in the function (lines around `sharp(inputPath, ...)`). Alternatively, call `.clone()` BEFORE the first `.toFile()` attempt and keep the clone as the fallback source.

**Impact:** Wide-gamut image encodes silently produce corrupt or empty AVIF derivatives on affected images. The image is marked as processed with `avif_10bit = false`, but the actual AVIF file at every size is wrong.

---

### BUG-R5C1-02 — HIGH / confirmed

**File:** `apps/web/src/lib/process-image.ts:867` + `apps/web/src/app/actions/images.ts:279`  
**Classification:** Original file leak on `detectColorSignals` exception

**The bug:**  
In `saveOriginalAndGetMetadata` (process-image.ts), the original file is written to `originalPath` at lines 783–790. The function then calls `detectColorSignals(originalPath, image, metadata)` at line 867.

If `detectColorSignals` throws (ISOBMFF parser crash, unexpected HEIF structure, out-of-memory on ICC parse, etc.), the exception propagates up out of `saveOriginalAndGetMetadata` with no cleanup — `originalPath` is never unlinked.

In `uploadImages` (images.ts), `savedOriginalFilename` is only assigned AFTER `saveOriginalAndGetMetadata` returns successfully (line 279). The top-level catch block at line 458 checks `if (savedOriginalFilename)` before attempting cleanup. When `detectColorSignals` throws inside `saveOriginalAndGetMetadata`, that guard is null and the uploaded original is permanently leaked on disk.

**Trigger scenario:**  
Upload a HEIF/AVIF/WebP file that:
- Has valid enough metadata to pass Sharp `image.metadata()` 
- Passes width/height checks
- Causes `detectColorSignals` to throw (malformed NCLX `colr` box with unusual box lengths, truncated ISOBMFF structure that passes Sharp but fails the custom ISOBMFF walker, or an ICC profile that triggers an exception in `extractIccProfileName` / `detectColorSignals`)

Every such upload leaks a file under `data/uploads/original/`.

**Evidence:**  
Lines 783–790 write the original. Line 867 calls `detectColorSignals` with no surrounding try/catch that unlinks `originalPath` on failure. `saveOriginalAndGetMetadata` has no `finally` that cleans up the file on throw.

**Suggested fix:**  
Wrap the block from line 862 onwards (after the file is written) in a try/catch that unlinks `originalPath` on any exception before re-throwing. OR: set `savedOriginalFilename = filenameOriginal` inside `saveOriginalAndGetMetadata` and pass it out so the caller's cleanup can see it, or return partial data from the catch path.

**Impact:** Disk space leak on every failed upload of a structurally anomalous image. Accumulates silently — no logging or cleanup job covers originals with no corresponding DB row.

---

### BUG-R5C1-03 — MED / confirmed

**File:** `apps/web/src/lib/process-image.ts` — `verifyWebpIccInBuffer`  
**Classification:** Incomplete WebP ICC verification (only first 1 KB scanned)

**The bug:**  
`verifyWebpIccInBuffer` reads only `buffer.subarray(0, 1024)` to check for the ICCP chunk. WebP is a RIFF container; the ICCP chunk appears AFTER VP8/VP8L/ANIM/ANIM frame chunks. For animated WebP or large VP8/VP8L bitstreams (e.g. high-resolution images where the VP8 frame data starts immediately), the ICCP chunk offset exceeds 1024 bytes. The function returns false ("no ICCP chunk") for these files even though the ICC profile is correctly embedded.

**Trigger scenario:**  
Upload a wide-gamut WebP image where the VP8 frame data block is > ~1000 bytes before the ICCP chunk. Any high-resolution wide-gamut WebP (>1 MP) is likely to exhibit this. The function is currently used for audit logging/warning only (not blocking), so the direct user-visible impact is misleading "no ICCP" warnings in server logs for valid wide-gamut WebP images, and potential incorrect color pipeline decisions on the verification path.

**Suggested fix:**  
Scan the full buffer (or at least the first 64 KB) for the ICCP FourCC, not just the first 1024 bytes. The RIFF chunk structure scan should be sequential.

---

### BUG-R5C1-04 — MED / likely

**File:** `apps/web/src/lib/mysql-datetime.ts:19`  
**Classification:** TZ-sensitive DATETIME serialization — silent sort corruption on TZ change

**The bug:**  
`toMySqlDateTime` uses `getFullYear`, `getMonth`, `getDate`, `getHours`, `getMinutes`, `getSeconds` — all server-local time getters. This is documented as intentional to match the mysql2 driver's own Date serialization.

However, this creates a latent hazard: if the Docker container timezone changes between deployments (e.g., `TZ=Asia/Seoul` → `TZ=UTC`), DATETIME values written before and after the change represent different absolute times but compare as if they are in the same zone. For columns like `failed_at` (written by error handling paths) and `sessions.expires_at`, a TZ change causes silent sort/comparison corruption. For example, records written at UTC+9 and records written at UTC will sort as if Seoul-time 13:00 and UTC 04:00 are "at the same time" from MySQL's perspective, since MySQL DATETIME has no TZ.

**Trigger scenario:**  
Container is redeployed with a different `TZ` env variable. Or: server is migrated from a Korean server (KST) to a UTC server without a DB migration to convert stored values.

**Suggested fix:**  
Document the TZ dependency prominently in docker-compose.yml as a required-stable env var. Consider adding a startup assertion that compares `TZ` against a value stored in `admin_settings` at first boot, failing loudly if it changed.

---

### BUG-R5C1-05 — MED / confirmed

**File:** `apps/web/src/lib/process-image.ts` — `decimalToRational` (approx. line 1319)  
**Classification:** Exposure times >= 1 second stored as decimal string, not rational

**The bug:**  
`decimalToRational` has an early-return branch for values >= 1: it returns the decimal string directly (e.g. `"1.5"`, `"2"`, `"3.5"`) rather than a rational fraction (`"3/2"`, `"2/1"`, `"7/2"`). EXIF exposure time is conventionally expressed as a rational (numerator/denominator pair), and EXIF viewers/tools expect the rational form. A value like `"1.5"` will display correctly in some viewers (numeric fallback) but break others that strictly parse rational EXIF format.

Additionally, for sub-second values where floating-point rounding produces a denominator that doesn't cleanly represent the original (e.g. `0.003333...` → denominator 300, roundtrip check `|1/300 - 0.003333| < 0.001` passes, but the canonical shutter speed is `1/300` not `1/299.9997`), the denominator may differ from the camera's original value.

**Trigger scenario:**  
Long-exposure photograph (exposure time >= 1 second). EXIF `ExposureTime` tag is stored as `"1.5"` or `"4"` instead of `"3/2"` or `"4/1"`.

**Suggested fix:**  
For values >= 1, return `"${Math.round(value)}/1"` for integers, or find the nearest simple rational for non-integers (e.g. round to nearest 1/4 stop and express as a fraction).

---

### BUG-R5C1-06 — LOW / confirmed

**File:** `apps/web/src/lib/image-queue.ts` — `bootstrapImageProcessingQueue`, permanent-failure path  
**Classification:** Permanent failure resets bootstrap cursor to null, causing full re-scan

**The bug:**  
When a job is added to `permanentlyFailedIds` (max 1000 IDs, FIFO eviction), the code sets `state.bootstrapCursorId = null` (approximately line 498). This resets the bootstrap cursor to the beginning so the next bootstrap pass restarts from `id = null` (all images) instead of continuing from where it left off.

For a large gallery with many images near the end of the ID sequence and a few permanently-failed images near the beginning, every bootstrap pass re-scans from id=0 and issues N/500 paginated queries to reach the resumption point. With 1000 permanent failures tracked, any process restart triggers a full gallery scan.

**Trigger scenario:**  
Gallery with >10,000 images where early uploads permanently failed. Process restarts (deploy, crash) trigger quadratic bootstrap behavior proportional to gallery size × permanent failure count.

**Suggested fix:**  
Do not reset `bootstrapCursorId` on permanent failure. The cursor should only advance forward or reset on a clean bootstrap completion. Permanent failures should be excluded from the query via the `notInArray` clause (already done) without resetting position.

---

### BUG-R5C1-07 — LOW / needs-manual-validation

**File:** `apps/web/src/lib/process-image.ts` — `verifyAvifNclxInBuffer`  
**Classification:** NCLX verification only scans first 4096 bytes — may miss colr box on exotic AVIF

**The bug:**  
`verifyAvifNclxInBuffer` scans only the first 4096 bytes of the AVIF output file for the `colr` box. For AVIF files where metadata items (Exif, XMP) or `iinf`/`iloc` boxes appear before the `colr` box in the `moov`/`meta` structure, the NCLX colr box may be beyond offset 4096. The ISO base media file format allows `colr` to appear anywhere in the `moov` box hierarchy.

In practice, Sharp writes `colr` early (in the `ftyp`+`moov` preamble), so this is unlikely to fire with Sharp-generated AVIF. But for pass-through or externally-generated AVIF, the verification would log a false "no NCLX colr box found" warning.

**Impact:** Non-blocking audit log false positives only. Does not affect encoding correctness.

**Suggested fix:**  
Increase scan window to 65536 bytes, or perform a proper ISOBMFF box walk (which already exists in `color-detection.ts`'s NCLX walker) on the output.

---

### BUG-R5C1-08 — LOW / confirmed

**File:** `apps/web/src/lib/image-queue.ts` — `bootstrapImageProcessingQueue`  
**Classification:** `notInArray(images.id, [...state.permanentlyFailedIds])` spreads 1000-item Set on every bootstrap batch

**The bug:**  
The `[...state.permanentlyFailedIds]` spread converts the entire permanently-failed ID Set (up to 1000 items) into an array on every batch query during bootstrap. This produces an IN clause with up to 1000 literal values per paginated query. With 500-per-page pagination and a large gallery, a bootstrap pass issues N/500 queries, each with a 1000-item IN clause.

While 1000 items is within MySQL's `max_allowed_packet` limits, it is unnecessary overhead for the normal case (zero or few permanent failures). Additionally, the spread is recreated on every loop iteration rather than computed once before the loop.

**Trigger scenario:**  
Process restart after reaching MAX_PERMANENTLY_FAILED_IDS (1000). Bootstrap takes noticeably longer than expected on large galleries.

**Suggested fix:**  
Compute the array once before the bootstrap loop: `const excludedIds = [...state.permanentlyFailedIds]` and reuse it across iterations. Also consider whether the IN clause is needed at all during bootstrap vs. letting the `WHERE processed = false` + per-job advisory lock handle exclusion.

---

## Files Examined

- `apps/web/src/lib/process-image.ts` (full, 1561 lines)
- `apps/web/src/lib/image-queue.ts` (full)
- `apps/web/src/lib/queue-shutdown.ts` (full)
- `apps/web/src/lib/gps-exif-strip.ts` (full)
- `apps/web/src/lib/mysql-datetime.ts` (full)
- `apps/web/src/lib/auth-rate-limit.ts` (full)
- `apps/web/src/lib/rate-limit.ts` (full)
- `apps/web/src/lib/gallery-config.ts` (full)
- `apps/web/src/lib/data.ts` (lines 1–500)
- `apps/web/src/lib/validation.ts` (full)
- `apps/web/src/lib/seo-og-url.ts` (full)
- `apps/web/src/app/actions/images.ts` (full, 1112 lines)
- `apps/web/src/app/actions/auth.ts` (full)
- `apps/web/src/app/actions/topics.ts` (lines 1–150)
- `apps/web/src/app/[locale]/admin/db-actions.ts` (full)
- `CLAUDE.md` (full)

## Ruled Out / Confirmed Clean

- **`queue-shutdown.ts`:** `state.enqueued.clear()` during shutdown before in-flight jobs call `state.enqueued.delete()` is a no-op, not a race. In-flight jobs completing after the clear simply find the ID absent — safe.
- **`auth.ts` rate limiting:** Pre-increment before Argon2 verify is correct (no rollback on infra error — by design). `updatePassword` validates fields before rate-limit increment — correct order.
- **`db-actions.ts` advisory lock double-finally:** Correctly structured. Lock is released in finally even if `runRestore` throws.
- **`topicRouteSegmentExists`:** The `result[0]` unwrap from Drizzle `db.execute` tuple is correct (COR-R4C19-01 is already fixed).
- **`seo-og-url.ts`:** Backslash gate (SEC-R4C20-01) is correct and complete.
- **`gps-exif-strip.ts`:** The null-return fallback to re-encode on structural anomalies is the correct defensive posture.
- **`toMySqlDateTime` vs. ISO-Z strings:** The local-getter approach is intentional and documented. The hazard (BUG-R5C1-04) is structural but requires a deployment operation to trigger.

---

*End of R5C1 Debugger Review*
