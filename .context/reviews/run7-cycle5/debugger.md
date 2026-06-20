# Debugger Report — run-7 cycle-5

**Agent:** debugger (failure-mode / edge-case sweep)
**HEAD:** code HEAD unchanged since cycle-4 (`f5d7aaf7`); only review docs and SW-version stamp since then
**Date:** 2026-06-20
**Mode:** Full sweep of designated high-risk surfaces

---

## Scope

Assigned targets for this sweep:

1. Binary parsers: `color-detection.ts`, `icc-extractor.ts`, `icc-chromaticity.ts`, `gain-map-detection.ts`, `gps-exif-strip.ts`
2. React hazards: `use-display-capability.ts` (useSyncExternalStore snapshot memoization / React #185)
3. Concurrency/finally: advisory-lock release in both backfill paths; per-image processing claim
4. Number/string edge cases: `blur-data-url.ts` cap wiring, `audit.ts` surrogate-pair truncation, `base56.ts` rejection sampling
5. Embedding decode: `clip-embeddings.ts` `decodeEmbeddingColumn` exact-byte-length guard

---

## Findings

### Binary Parsers

**color-detection.ts — ISOBMFF NCLX walker**
- Box-size=1 (64-bit extended) path: guarded with `if (pos + 16 > buffer.length) return null` before `readBigUInt64BE`. Safe.
- Box-size=0 (to-EOF) path: `size = buffer.length - pos` is non-negative by construction (walk loop already verifies `pos + 8 <= limit`). Safe.
- Depth cap at 5 and scan cap at 1 MB are both enforced before recursion. Safe.
- Per-field NCLX override: code-2 "Unspecified" is intentionally absent from `NCLX_*_MAP`; ICC-derived values are preserved when NCLX leaves a field unspecified. No off-by-one or map-miss hazard.

**icc-extractor.ts — desc v2 / mluc v4**
- Tag count capped at 100 before the loop. String lengths capped at 1024 bytes. Safe.
- `clampUtf8Bytes()` iterates code points via spread (`[...str]`), not UTF-16 code units. Surrogate-pair safe. Safe.
- `mluc` record: `recTextOffset` is relative to `dataOffset` (not to the record entry itself); bounds check `strEnd > iccLen || strEnd > dataOffset + dataSize || strStart >= strEnd` is correct and covers the aliased-offset case. Safe.

**icc-chromaticity.ts — XYZ→xy divide-by-zero**
- `xyzToXy()`: guarded with `if (!Number.isFinite(sum) || Math.abs(sum) < 1e-9) return null`. Divide-by-zero impossible. Safe.
- `readS15Fixed16()`: returns NaN on out-of-bounds (`if (offset + 4 > buf.length) return NaN`). Callers propagate NaN through arithmetic; `xyzToXy()` rejects NaN via `Number.isFinite`. Safe.
- `invert3x3()`: guarded with `if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null`. Safe.
- Tag size guard: `if (offset + size > icc.length || size > MAX_TAG_TABLE_BYTES) continue`. Safe.

**gain-map-detection.ts — iinf/infe/iref walk**
- Box header reads: 8-byte pre-check before `readUInt32BE`; extended-size path pre-checks 16 bytes. Safe.
- `parseIinf()`: entry loop bounded at `parsed < 1024`. Safe.
- `parseIref()`: inner reference count bounded at `i < 1024`. Safe.
- Version-dependent item-ID widths (v0: 2-byte, v1+: 4-byte) are correctly selected for both `iinf` (entry_count field) and `iref` (item ID fields). Safe.
- Entire `walk()` wrapped in try/catch; malformed input returns false, never throws. Safe.

**gps-exif-strip.ts — iloc/iinf walker, readSized, offset-sum bounds**
- `readSized()` (lines 467-475): handles sizes {0, 4, 8} only; returns null for anything else. Safe.
- Validation loop (lines 476-478): validates `offsetSize`, `lengthSize`, `baseOffsetSize` through `readSized`; returns null if any returns null.
- `indexSize`: NOT passed to `readSized`. Used only as `pos += indexSize` with a subsequent `if (pos + extentEntrySize > ilocBox.dataEnd) return null` bounds check. REJ-R7C3-01 re-confirmed DISPROVED — same conclusion as cycles 2, 3, 4.
- IFD chain walk: bounded by `MAX_IFD_CHAIN = 8` and a visited-offset Set. No unbounded recursion. Safe.
- ilocVersion guard: ≤ 2 only; item count cap 4096; extent count cap 64. Safe.

### React Hazards

**use-display-capability.ts — useSyncExternalStore snapshot memoization**
- Module-level `_cachedSnapshot` is checked by value (`colorGamut === gamut && isHdr === isHdr`) before constructing a new object. When unchanged, the existing reference is returned. React's `Object.is` comparison between consecutive `getSnapshot()` calls therefore returns true → no spurious re-render → React #185 infinite loop cannot occur. Safe.
- `getServerSnapshot()` returns the module-level `SERVER_DEFAULT` constant — a stable reference. Safe.
- `subscribe()` cleanup: `removeEventListener` calls for MQ changes, `visibilitychange`, and `focus` are all registered. All unsubscription paths are covered. Safe.

### Concurrency / Finally

**admin-backfill-runner.ts — in-app runner**
- `runBackfill()`: advisory lock connection (`lockConn`) is released in the `finally` block of `runBackfill` via `releaseBackfillLock(lockConn).catch(() => undefined)`. The `finally` runs unconditionally — on success, abort, or any thrown error. Safe.
- `reprocessOne()`: per-image processing claim (`claimConn`) is released in the `finally` block at lines 610-613, after the DB UPDATE. The `finally` executes regardless of whether the UPDATE succeeded, detection failed, or any other throw inside the `try`. `releaseImageProcessingClaim` is wrapped in `.catch(() => undefined)` so a release failure is non-fatal. Safe.
- `triggerAdminBackfill()`: lock is acquired on `lockConn`; if `candidateCount === 0` the lock is released via `releaseBackfillLock(lockConn)` before the early return. If the runner is started, `lockConn` is set to null and `lockConnHandoff` is passed to `runBackfill`, which owns its lifetime. The caller's `catch` block releases only if `lockConn !== null` (i.e. handoff did not occur). No double-release and no leak. Safe.

**scripts/backfill-color-pipeline.ts — sidecar script**
- Advisory lock is acquired on a dedicated `lockConn`. The release path is unconditional: the lock-release `try/catch` block and `lockConn.release()` appear at the end of `main()`, after `queue.onIdle()` and `flushBatch()`. The script then calls `process.exit()`.
- The sidecar script does NOT use a `try/finally` around the queue processing: if `queue.onIdle()` or `flushBatch()` throw unexpectedly, `lockConn.release()` could be skipped. However, this is the sidecar script pattern — MySQL advisory locks are connection-scoped and are automatically released when the connection closes or the process exits. A process crash or uncaught throw will terminate the script, which releases the MySQL connection and therefore the lock. No effective leak hazard.
- Per-image processing claim: `acquireImageProcessingClaim` + `releaseImageProcessingClaim` follow the same pattern as the in-app runner (non-blocking GET_LOCK, release in finally). Safe.

### Number / String Edge Cases

**blur-data-url.ts — MAX_BLUR_DATA_URL_LENGTH cap**
- `isSafeBlurDataUrl()` at line 49: `if (value.length === 0 || value.length > MAX_BLUR_DATA_URL_LENGTH) return false`. Length is checked before the prefix test. The cap (4096) is correctly enforced. Safe.
- `assertBlurDataUrl()` delegates to `isSafeBlurDataUrl` and uses the rejection-log throttle. Rejection-log eviction: `Map.keys().next().value` yields the oldest insertion-order key; `delete` then removes it before `size` would overflow `REJECTION_LOG_CAP = 256`. Correct LRU eviction. Safe.

**audit.ts — surrogate-pair-safe truncation**
- Lines 35-38: `[...serializedMetadata]` spreads by Unicode code point, not UTF-16 code unit. `.slice(0, 4000)` on the resulting array cannot bisect a surrogate pair. The resulting string is then passed to `JSON.stringify`, which handles arbitrary Unicode. Safe.
- `purgeOldAuditLog()`: negative / non-finite retention guard at lines 69-74 prevents a future-timestamp cutoff. Identical guard pattern to the view-retention R4C6 COR-R4C6-10 fix. Safe.

**base56.ts — rejection sampling**
- Threshold: `randomValue >= 224` rejects values in [224, 255] (32 out of 256 = 12.5%). This makes the acceptance range [0, 223] which is 224 values. `224 % 56 = 0` — exactly divisible, so no modulo bias in the accepted range. Correct.
- Attempts cap at 1000: with 87.5% acceptance probability, the expected attempts per character is 1.14. P(>1000 rejections in a row) is astronomically small. The cap is a safety valve against a broken RNG, not an expected-path ceiling. Safe.
- Pool refill: when `poolIdx >= pool.length`, a new buffer is allocated. This prevents indefinite stalling when `length * 2` bytes are exhausted by rejections (pathological case). Safe.

**clip-embeddings.ts — decodeEmbeddingColumn exact-byte-length**
- `EMBEDDING_BYTES = 512 * 4 = 2048`. All three decode paths (raw Buffer, base64 Buffer, base64 string) gate on `decoded.length === EMBEDDING_BYTES`. A wrong-length result returns null; callers must handle null. `bufferToEmbedding()` also independently checks `buf.length !== EMBEDDING_BYTES` and throws. Doubly guarded. Safe.
- Legacy base64 path (`Case 2`): `value.toString('latin1')` then `Buffer.from(..., 'base64')`. `latin1` is the correct encoding for raw binary data stored as MySQL BLOB-derived Buffers. The resulting decoded length is checked against `EMBEDDING_BYTES`. Safe.

---

## Previously Disproved Finding

**REJ-R7C3-01** (`indexSize` not validated `{0,4,8}` in `gps-exif-strip.ts:466`) — re-confirmed DISPROVED for the 4th consecutive cycle. `indexSize` is never passed to `readSized`; its sole use is `pos += indexSize` followed by a `pos + extentEntrySize > ilocBox.dataEnd` bounds check. Malformed input → safe null reject.

---

## Summary

All designated high-risk surfaces examined. Every bounds check, divide-by-zero guard, surrogate-pair truncation, advisory-lock release path, rejection-sampling threshold, and React snapshot memoization pattern is correctly implemented. No off-by-one, no integer overflow hazard, no unbounded recursion, no null deref, no lock leak, no error-swallowing that masks corruption.

**NEW actionable findings: 0**
