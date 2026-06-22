# Debugger Review — run-9 cycle-8

**Repo:** `/Users/hletrd/flash-shared/gallery`
**HEAD:** `4e132b03`
**Scope:** Latent bugs missed by static review — binary/EXIF/ICC/NCLX parsers, async/concurrency hazards, error-handling, numeric coercion, Sharp pipeline.

---

## Binary/EXIF/ICC/NCLX Parser Bounds Checks

**No read without a preceding bounds check was found in any binary parser.**

Every flagged path in prior passes had checks; this pass confirms the same.

Specifically verified:

- `color-detection.ts` `parseCicpFromHeif`: ISOBMFF walker checks `size < headerSize`, `pos + size > buffer.length`, extended-size (`size === 1`) branch reads `readBigUInt64BE` only after confirming 16-byte minimum, `size === 0` treated as `buffer.length - pos` (remaining), depth capped at `MAX_DEPTH = 5`, scan capped at `MAX_SCAN_BYTES = 1 MB`. CLEAN.

- `process-image.ts` `verifyAvifNclxInBuffer`: outer guard `buffer.length < 16` before entering loop `i < buffer.length - 12`; per-NCLX inner guard `if (i + 12 > buffer.length)`. CLEAN.

- `process-image.ts` `verifyWebpIccInBuffer`: WebP RIFF chunk walker; `paddedSize = chunkSize + (chunkSize % 2)` — JavaScript float64 handles UInt32 max without wrap; `nextOffset > buffer.length` guard catches oversized values; `nextOffset <= offset` guard prevents zero-progress infinite loops. CLEAN.

- `icc-extractor.ts` `extractIccProfileName`: tag count bounded to 100, `tagOffset + 12 > iccLen` break, `dataOffset + dataSize > iccLen` break, string lengths bounded by `Math.min(..., 1024)`. CLEAN.

---

## Sharp Pipeline — rgb16 / Bradford / 10-bit Fallback / Clone Paths

**All Sharp pipeline paths are sound.**

**WI-14 fresh-instance-per-format:** `generateForFormat` creates a fresh `sharp(processingInputPath, ...)` per format and per size (unless the same resize width produces an identical output, in which case `fs.link`/`fs.copyFile` deduplication is used — no Sharp instance reuse across formats). No cross-format contamination risk. CLEAN.

**rgb16 pipeline:** `needsRgb16 = isWideGamutSource && !isDciP3`. When true, `.pipelineColorspace('rgb16')` is called before `.resize()`. DCI-P3 explicitly skips rgb16 to preserve source ICC for Bradford D63→D65 adaptation. CLEAN.

**10-bit AVIF probe singleton:** `_highBitdepthAvifProbePromise` is a module-level Promise set once. `canUseHighBitdepthAvif()` awaits it. Effectively a permanent one-time probe per process lifetime — intended behavior. CLEAN.

**10-bit fallback `base.clone()` (process-image.ts ~line 1176):** When `await base.toColorspace(...).avif({bitdepth:10}).toFile(outputPath)` throws with a bitdepth error, `base.clone()` is called. `base` is the Sharp source instance with `pipelineColorspace('rgb16').resize()` transforms registered but not yet executed — the terminal chain was chained FROM `base` but not stored back to `base`. When the terminal chain throws, `base` itself remains unconsumed and `clone()` on it produces a valid copy of the pre-terminal transform pipeline. The clone retries with explicit `bitdepth: 8`. This is valid Sharp API usage. CLEAN.

**50 MP downscale guard (WI-15):** `basePixels` computed with `autoOrient: true` metadata (COR-R4C8-07). Intermediate TIFF uses `keepIccProfile()` to preserve source white-point. Cleanup is in a `finally` block that runs on both success and failure. CLEAN.

---

## Async / Concurrency Hazards

**Fire-and-forget caption generation** (`image-queue.ts`): `.then(...).catch(...)` pattern prevents unhandled rejections. CLEAN.

**Fire-and-forget CLIP embedding** (`image-queue.ts`): `void (async () => { try { ... } catch (err) { ... } })()` — top-level try/catch prevents unhandled rejections. CLEAN.

**`claimRetryScheduled` re-enqueue path:** `state.enqueued.delete(job.id)` IS called in the finally block before the `setTimeout` fires. No double-delete or missed-cleanup risk. CLEAN.

**`admin-backfill-runner.ts` lock release:** `runBackfill` wraps everything in `try/catch/finally` with `releaseBackfillLock` in the `finally`. `triggerAdminBackfill` passes the lock connection via handoff (sets `lockConn = null` after handoff) so the caller's catch does not double-release. CLEAN.

**`fetchCandidateBatch` keyset pagination:** `cursor` advances to `batch[batch.length - 1]!.id`; the non-null assertion is safe because the loop only continues when `batch.length > 0`. CLEAN.

---

## Error Handling / Partial-Write Safety

**`stripGpsFromOriginal`:** Writes to UUID-suffixed `tmpPath` then atomically renames over the original. On any throw, the `catch` block unlinks `tmpPath` (with `.catch(() => {})` to suppress ENOENT). `chmod` on `tmpPath` is best-effort. CLEAN.

**`processImageFormats` failure cleanup:** `catch` block deletes all paths in `writtenSizedPaths` (per-format Sets). `finally` block deletes the WI-15 intermediate. Correctly handles mid-size failures within a format and mid-format failures in `Promise.all`. CLEAN.

**`isLosslessWebpByChunk`:** Chunk walker has zero-progress guard (`next <= offset`). Returns `false` (safe lossy choice) on any malformation. CLEAN.

---

## Numeric / Type Coercion

**`decimalToRational`:** All call sites pre-check `Number.isFinite(val) && val > 0`. `1 / val` for small positives yields large but finite float64. `denominator > 0` guard handles edge cases. CLEAN.

**`convertDMSToDD` GPS parsing:** Validates array length, degree/minute/second ranges, and applies a final `Math.abs(dd) > maxDegrees` bound check. CLEAN.

**`cleanNumber`:** Returns `null` on non-finite values explicitly. CLEAN.

---

## Files Examined

- `apps/web/src/lib/process-image.ts` (complete, 1650 lines)
- `apps/web/src/lib/image-queue.ts` (complete, 806 lines)
- `apps/web/src/lib/color-detection.ts` (complete, 424 lines)
- `apps/web/src/lib/icc-extractor.ts` (complete, 127 lines)
- `apps/web/src/lib/admin-backfill-runner.ts` (complete, 871 lines)

---

## DISPOSITION: 0 DEFECTS, 0 POLISH
