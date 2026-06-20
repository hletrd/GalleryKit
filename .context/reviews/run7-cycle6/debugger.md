# Debugger Review — Run-7 Cycle-6

**Scope:** Fresh skeptical defect-hunt on GalleryKit commit e855e6ee (byte-identical to cycle-5 HEAD).
**Expected outcome:** ZERO new actionable findings — a truthful zero is the goal.
**Result: 0 new actionable findings.**

---

## Verified Clean

### (1) Binary Parsers

#### `lib/color-detection.ts` — ISOBMFF walker + NCLX colr box
- `parseCicpFromHeif`: MAX_SCAN_BYTES=1 MB, MAX_DEPTH=5. Box-size-0 handled (`size = buffer.length - pos`). Box-size-1 (64-bit extended) checked with `pos + 16 > buffer.length` guard before `readBigUInt64BE`. Invalid/truncated sizes → `break`. Loop advances `pos = boxEnd` unconditionally after each box — no possibility of infinite loop on size-0 (size is set to remaining bytes, so `pos` advances by a positive amount).
- NCLX dataSize >= 11 guard before all field reads.
- `detectColorSignals` wraps `fileHandle.close()` in `try/finally` — handle is always closed.
- Per-field NCLX mapping (AGG-R8-06): code-2 "Unspecified" is never written over ICC-derived values.
- **CLEAN** — no overflow, divide-by-zero, OOB, or infinite-loop paths found.

#### `lib/icc-extractor.ts` — desc/mluc UTF-16BE parsing
- `extractIccProfileName`: tagCount capped at 100. Every (offset, size) pair bounds-checked before read. `mluc` numRecords capped at 100, recordSize >= 12 enforced. Per-record `recOffset + 12 > iccLen` guard. Record text length clamped: `recLen = Math.min(icc.readUInt32BE(recOffset + 4), 1024)`. `strStart = dataOffset + recTextOffset` — offset is relative to the tag data block (not file start); `strEnd > dataOffset + dataSize` guard prevents OOB within the tag region.
- `clampUtf8Bytes`: uses `for...of` string iteration — surrogate-pair safe (iterates by code point, not UTF-16 code unit).
- **CLEAN** — no OOB, no surrogate-pair split, no unbounded allocation.

#### `lib/icc-chromaticity.ts` — XYZ tag parsing + matrix inversion
- `detectGamutFromIccChromaticity`: tagCount capped at MAX_TAG_COUNT=100. Tag table walk bounded by `tagTableEnd = Math.min(132 + tagCount * 12, 132 + MAX_TAG_TABLE_BYTES, icc.length)`. Per-tag `offset + size > icc.length || size > MAX_TAG_TABLE_BYTES` skip.
- `readXyzTag`: size >= 20, signature 'XYZ ' checked. All `readS15Fixed16` calls check `offset + 4 > buf.length` → NaN → `!Number.isFinite` rejection.
- `xyzToXy`: `Math.abs(sum) < 1e-9` divide-by-zero guard before dividing.
- `invert3x3`: `Math.abs(det) < 1e-12` guard before dividing by determinant.
- Chad inversion: `chadInv` null-check before applying.
- **CLEAN** — all arithmetic guards present.

#### `lib/gain-map-detection.ts` — iinf/infe/iref
- Entire `walk()` wrapped in `try/catch` → returns false on any exception.
- `walk()`: MAX_DEPTH=5, MAX_SCAN_BYTES=1 MB. Box-size-0: `size = buffer.length - pos`, then `size < headerSize` check prevents infinite loop (headerSize=8, so remaining bytes must be ≥ 8). Box-size-1: `pos + 16 > buffer.length` guard.
- `parseIinf`: entryCount capped at 1024, inner `parsed < 1024` guard.
- `parseIref`: outer `parsed < 1024`, `refCount` capped at 1024 per entry, `i < 1024` inner cap.
- `readNullTerminatedAscii`: bounded by `Math.min(end, buffer.length)`.
- **CLEAN** — no unbounded recursion, no OOB.

#### `lib/gps-exif-strip.ts` — EXIF IFD walker (REJ-R7C3-01 confirmed disproved)
- IFD chain bounded by MAX_IFD_CHAIN=8 + `visited` Set (cycle detection returns null). Entry count bounded by MAX_IFD_ENTRIES=1024.
- `typeSize * valueCount` arithmetic: JS arithmetic is IEEE-754 double; large products are representable. The `inBounds(valueAbs, valueSize)` check catches OOB before any fill.
- IFD0 offset <= tiffStart+7 → returns null.
- `stripGpsFromJpegBuffer`: segLength < 2 check; post-EOI trailer detection.
- `stripGpsFromIsobmffBuffer`: `readSized` only handles {0,4,8} byte widths → else null. All {offsetSize,lengthSize,baseOffsetSize} validated. itemCount ≤ 4096, extentCount ≤ 64. Extent start/length bounds-checked before fill.
- `stripGpsFromWebpBuffer`: `paddedSize` overflow guard: `if (next <= offset) return null`.
- REJ-R7C3-01 confirmed disproved: `indexSize` advances `pos` only; every actual read goes through `readSized`, which rejects widths not in {0,4,8} → safe null reject.
- **CLEAN**.

### (2) React Hazards

#### `lib/use-display-capability.ts` — useSyncExternalStore getSnapshot stability (React #185)
- Module-level `_cachedSnapshot: DisplayCapability | null = null`. `detect()` returns `_cachedSnapshot` (same reference) when `colorGamut` and `isHdr` values are unchanged — prevents React #185 infinite-loop from `useSyncExternalStore`.
- `getServerSnapshot()` returns module-level `SERVER_DEFAULT` constant — always the same reference.
- `subscribe()` correctly attaches listeners to all three MQs + `visibilitychange` + `focus`, and returns a cleanup function that calls `removeEventListener` for each.
- **CLEAN** — getSnapshot is referentially stable; server snapshot is a constant.

### (3) Concurrency / finally — Advisory Lock Release

#### `lib/admin-backfill-runner.ts` — backfill + per-image processing claim
- `acquireBackfillLock` / `releaseBackfillLock`: `releaseBackfillLock` calls `RELEASE_LOCK` in a `try` block and `lockConn.release()` in `finally` — connection always returned to pool even if RELEASE_LOCK fails (connection close releases the advisory lock anyway).
- `acquireImageProcessingClaim` / `releaseImageProcessingClaim`: symmetric pattern — `RELEASE_LOCK` in `try`, `lockConn.release()` in `finally`.
- The backfill run's outer `try/finally` calls `releaseBackfillLock(lockConn)` unconditionally. Per-image claim is released in each worker's `finally` at line 610.
- **CLEAN** — all lock acquire/release pairs are in try/finally.

#### `lib/image-queue.ts` — image processing claim
- `acquireImageProcessingClaim` / `releaseImageProcessingClaim`: `RELEASE_LOCK` in `try`, `lockConnection.release()` in `finally` (line 219). The queue worker's outer `finally` (line 544) calls `releaseImageProcessingClaim(job.id, lockConnection)` unconditionally.
- **CLEAN**.

#### `apps/web/src/app/[locale]/admin/db-actions.ts` — DB restore advisory lock
- Three RELEASE_LOCK call sites: (1) early-return when upload-contract lock fails (line 304), (2) early-return when `beginRestoreMaintenance()` fails (line 323), (3) the inner `finally` block (line 349) that runs on all paths through the restore.
- Outer `finally` (line 355) releases the pool connection (`conn.release()`) — connection is always returned to pool.
- Both `LOCK_DB_RESTORE` and `LOCK_UPLOAD_PROCESSING_CONTRACT` are released on every exit path.
- **CLEAN** — no lock-leak paths found.

### (4) Number / String Edges

#### `lib/base56.ts` — modulo bias
- Rejection sampling rejects values >= 224. The threshold 224 = 4 × 56 exactly. Values 0–223 (224 values) map uniformly: `224 % 56 = 0` — no remainder, so every character has exactly 4 representatives in [0, 224). The bias concern (256 % 56 = 32, meaning chars 0–31 would get 5 representatives vs 4 for chars 32–55 without rejection) is fully eliminated by the rejection threshold of 224.
- Pool refill on exhaustion; 1000-attempt guard against RNG failure.
- **CLEAN** — no modulo bias.

#### `lib/blur-data-url.ts` — blur-data-url cap
- `MAX_BLUR_DATA_URL_LENGTH = 4096`. `isSafeBlurDataUrl` checks `value.length > MAX_BLUR_DATA_URL_LENGTH` (rejects oversized). Prefix allowlist enforced. `assertBlurDataUrl` throttles rejection warnings via bounded LRU (256-entry cap with oldest-entry eviction, Map insertion-order guaranteed in modern JS engines).
- **CLEAN** — cap enforced at both read and write sides.

#### `lib/audit.ts` — surrogate-pair-safe truncation
- `serializedMetadata.length > 4096` check (string `.length` measures UTF-16 code units). Truncation uses `[...serializedMetadata]` (spread iterates by Unicode code point) then `.slice(0, 4000)` on the resulting array — cannot bisect a surrogate pair. The resulting fragments are re-wrapped in `JSON.stringify({ truncated: true, preview: ... })`. The comment at line 25–34 explicitly documents that `preview` may be an invalid JSON fragment — intentional, for forensic debugging only.
- **CLEAN** — surrogate-pair safe.

#### `lib/settings-hash.ts` — settings-hash stability
- `buildHash`: uses `COLOR_IMPACTING_KEYS.map(...)` (deterministic iteration order — `const` array), joined with `|`, hashed with SHA-256, sliced to 8 chars. Order is fixed at module definition time. Compile-time guard `_ColorKeysAreSettingKeys` catches typos/removed keys at `tsc`.
- Module-level `cache` + `inflight` pattern: a concurrent call during an in-flight fetch returns the same Promise (coalesces). `inflight` is set to null in `.finally()` — no promise leak.
- `buildHashFromConfig` (R8-H1): pure computation from validated GalleryConfig values — no DB read, no caching needed. Produces identical output for identical settings regardless of raw DB string format.
- **CLEAN** — hash is stable and deterministic.

#### `lib/clip-embeddings.ts` — decodeEmbeddingColumn exact-byte guard
- EMBEDDING_BYTES = 512 × 4 = 2048. `decodeEmbeddingColumn` checks exact byte count at every branch: Case 1 (raw Buffer): `value.length === EMBEDDING_BYTES`; Case 2 (legacy base64 Buffer): decoded length check; Case 3 (string): decoded length check. Any non-exact length returns null.
- `bufferToEmbedding` enforces `buf.length !== EMBEDDING_BYTES` with a throw — secondary defense.
- **CLEAN** — exact-byte guard present on all decode paths.

---

## Summary

**0 new actionable findings.**

All 6 binary parsers are well-defended (bounds, caps, divide-by-zero guards, infinite-loop prevention). The React useSyncExternalStore hook correctly memoizes its snapshot. All advisory lock acquire/release pairs are in try/finally on every exit path. All number/string edges are correctly handled (base56 bias eliminated by threshold 224 = 4×56; blur-data-url cap enforced symmetrically; surrogate-pair-safe truncation via code-point spread; settings hash deterministic with compile-time guard; CLIP embedding exact-byte guard on all decode paths).

The previously-rejected finding REJ-R7C3-01 remains correctly disproved.
