# Cycle-7 Debugger Review

**HEAD:** `d0920957` (clean tree). Re-trace pass focused on the byte-walkers after the WebP RIFF field-order fix (`b6c4f915`, prior cycle DBG-C6-01) landed.

**NEW findings: 0 confirmed latent bugs.** The codebase is converged on the failure-mode / boundary-arithmetic surface I own. The prior cycle's single real walker bug is fixed and verified correct, with no adjacent regression. One previously-recorded dead-code note persists (no functional impact). Below is the full VERIFIED-BOUNDS-CORRECT evidence for every walker and lifecycle flow re-traced.

---

## WebP RIFF fix (b6c4f915) — VERIFIED CORRECT + COMPLETE

`apps/web/src/lib/gps-exif-strip.ts:554-595` (`stripGpsFromWebpBuffer`). The fix swapped the field reads to the correct RIFF sub-chunk order and corrected the JUNK write offset. Re-traced against every edge case the cycle-7 prompt called out:

| Concern | Line(s) | Verdict |
|---|---|---|
| Field order `[FourCC tag:0-3][size:4-7 LE]` | 566-567 | CORRECT — `chunkTag` at `offset..offset+4`, `chunkSize` at `offset+4` |
| First chunk is VP8X (FourCC misread-as-size bug) | 566-570 | FIXED — tag read first; VP8X no longer trips `dataEnd > buf.length` |
| JUNK retag offset | 584 | CORRECT — writes to `offset` (ChunkTag field), not `offset+4` (was the bug) |
| Odd-size chunk padding → even | 589 | CORRECT — `paddedSize = chunkSize + (chunkSize % 2)`; payload reads use unpadded `dataEnd` |
| Last odd chunk with omitted trailing pad byte | 563, 590 | SAFE — `next` may overshoot, but loop guard `offset + 8 <= buf.length` exits cleanly; current chunk already processed |
| Chunk size overflows buffer | 570 | FAILS CLOSED — `dataEnd > buf.length → return null` → Tier-2 re-encode |
| EXIF-only / XMP-only / both | 571-588 | CORRECT — each chunk processed independently; `stripped` accumulates |
| VP8 vs VP8L vs VP8X frame chunks | 571, 579 | CORRECT — non-EXIF/XMP tags are skipped, loop advances past them |
| FourCC with embedded null (malformed) | 566 | SAFE — `=== 'EXIF'`/`=== 'XMP '` simply fail; chunk skipped |
| Infinite-loop guard | 591 | SAFE — `next >= offset + 8 > offset` always; belt-and-braces null on regression |
| RIFF container declared-size lie (larger/smaller than buffer) | 563 | SAFE — walker iterates by sub-chunk to `buf.length`, ignores the RIFF-level size; over-declared → stops at buffer end, under-declared → harmlessly scans trailing chunks |

**Caller wiring** (`apps/web/src/lib/process-image.ts:1536-1537`): `.webp` correctly dispatches to `stripGpsFromWebpBuffer`, and a `null` return falls through to the Tier-2 Sharp re-encode at 1564-1567 (fails CLOSED — GPS still removed). No adjacent dispatch case was disturbed by the fix. Confirmed.

---

## VERIFIED-BOUNDS-CORRECT walkers (re-traced this cycle)

### `gps-exif-strip.ts` — all four scrubbers + shared TIFF core
- **`stripGpsFromTiffRegion` (103-189)** — shared core for JPEG/WebP/ISOBMFF EXIF.
  - `tiffEnd > buf.length || tiffEnd - tiffStart < 8 → null` (104) also catches `tiffStart > tiffEnd` (negative diff < 8).
  - `inBounds(abs,size) = abs >= tiffStart && abs+size <= tiffEnd` (112).
  - `valueSize = typeSize * valueCount` (129): `valueCount` u32 × `typeSize` ≤ 8 → max ~3.4e10, exact in JS Number (< 2^53); `inBounds` (132) catches it. No 32-bit wrap.
  - IFD entry/value/next-pointer all `inBounds`-guarded (122, 132, 140).
  - IFD chain bounded `MAX_IFD_CHAIN=8` + `visited` Set cycle-break (149-151); entry count capped `MAX_IFD_ENTRIES=1024` (119, 154).
  - Inline-value path `valueAbs = entry+8` for `valueSize <= 4` is within the 12-byte entry (174-175). Correct.
- **`stripGpsFromJpegBuffer` (212-350)** — APP1 segment walk bounded, `segLength < 2 || markerPos+2+segLength > buf.length → null` (251). Post-EOI trailer detection (274-279) fails CLOSED on MPF/Motion-Photo trailers. ExtendedXMP reconstruction (302-320) bounds-checked. XMP drop-and-rebuild (332-349) cursor math correct.
- **`stripGpsFromIsobmffBuffer` (369-545)** — `walkChildren` depth cap 5; size=1 BigUInt64 with `> MAX_SAFE_INTEGER → return` (385); `size < headerSize || pos+size > end → return` (391). iinf version-gated entry offset (414); infe v2/v3 id width + `typeOffset+4 > infe.dataEnd` guard (425). iloc offset/length/baseOffset sizes validated to {0,4,8} (466-468); `readSized` 8-byte path MAX_SAFE_INTEGER-guarded (462); itemCount cap 4096 (480), extentCount cap 64 (501); every `pos+N > ilocBox.dataEnd` checked before read (485,490,494,504). Final extent `start<0 || length<0 || start+length > buf.length → null` (521). Fails CLOSED throughout.

### `color-detection.ts` — NCLX `parseCicpFromHeif` (217-283)
- Depth cap 5, scan cap 1 MB (`limit = min(end, offset+MAX_SCAN_BYTES, buffer.length)`, 225).
- size=1 BigUInt64 has NO explicit MAX_SAFE_INTEGER guard (236) — but `size < headerSize || pos+size > buffer.length → break` (243) catches any value ≥ ~1 MB (i.e. all imprecise ones). Fails CLOSED. Identical reasoning to prior cycles — harmless.
- `colr` nclx reads gated on `dataSize >= 11` before the 4 field reads at `dataStart+4/+6/+8/+10` (251-260). `meta` FullBox +4 skip gated on `dataSize >= 4` (269). Correct.
- Per-field NCLX-vs-ICC precedence (381-387) applies only `!== undefined` mapped values — code-2 "Unspecified" cannot clobber ICC-derived data. Verified against the documented AGG-R8-06 / CRT-1 contract.

### `icc-extractor.ts` — `extractIccProfileName` (45-127)
- `icc.length <= 132 → null` (49); tagCount capped 100 (61); `tagOffset+12 > iccLen → break` (64).
- `desc`: `dataOffset+12 > iccLen || dataSize < 12 || dataOffset+dataSize > iccLen → break` (70); `strEnd > iccLen || strStart >= strEnd → break` (79).
- `mluc`: numRecords capped 100 (86), `recordSize < 12 → break` (88), per-record `recOffset+12 > iccLen || recOffset+12 > dataOffset+dataSize → break` (93), `strEnd` double-bound (103). Locale match + first-non-empty fallback both terminate. No infinite loop in `clampUtf8Bytes`. Wrapped in try/catch.

### `icc-chromaticity.ts` — `detectGamutFromIccChromaticity` (220-322)
- **Division-by-zero / NaN escapes all guarded:**
  - `readS15Fixed16`: `offset+4 > buf.length → NaN` (107).
  - `xyzToXy`: `!Number.isFinite(sum) || Math.abs(sum) < 1e-9 → null` (172) — guards both div-by-zero and NaN. All four results null-checked at 295 before use.
  - `invert3x3`: `!Number.isFinite(det) || Math.abs(det) < 1e-12 → null` (152).
- Tag table loop bounded by `tagTableEnd = min(132+tagCount*12, 132+MAX_TAG_TABLE_BYTES, icc.length)` (234); `offset+size > icc.length || size > MAX_TAG_TABLE_BYTES → continue` (247). `offset`+`size` (each u32) sum ≤ ~8.6e9, exact in JS Number.
- `readXyzTag`/`readChadMatrix` length + finite guards (192-199, 130-139). chad-inverse path null-safe (278-289).

### `gain-map-detection.ts` — `hasGainMap` (57-291)
- `readBoxHeader` size=1 BigUInt64 (72) — no MAX_SAFE_INTEGER guard, but `size < headerSize || pos+size > buffer.length → null` (79) catches oversized. Fails CLOSED.
- `parseInfe` every read bounds-checked vs `dataEnd` (103,108,119,122); item_name scan bounded by `dataEnd` (127).
- `parseIinf` entry loop `parsed < entryCount && parsed < 1024` (165); `parseIref` outer `parsed < 1024` (191), inner `i < refCount && i < 1024` with `inner+idSize > innerEnd → break` (206-207).
- `walk` depth 5 + 1 MB cap (219-221). Whole thing in try/catch → false on any throw (242-248). Fails CLOSED.
- **Dead-code note DBG-C6-NC-01 persists** (line 87 `if (p > limit) return ''` in `readNullTerminatedAscii` — unreachable since the `while (p < limit ...)` guarantees `p <= limit` on exit). Record-only, no functional impact. Not re-counting as a finding.

---

## VERIFIED-CLEAN lifecycle / concurrency flows (re-traced this cycle)

### View-count flush state machine — `lib/data.ts:12-202`
The most state-machine-heavy surface; re-traced the full timer FSM for strand/stuck/leak:
- **`flushGroupViewCounts` (63-189):** nulls `viewCountFlushTimer` on entry FIRST (75, the COR-R4C11-01 fix), so the variable stays an accurate "drain pending" signal. `isFlushing` re-entrancy guard re-arms a fresh timer if buffered work remains and returns (76-88).
- **`isFlushing` cannot get stuck `true`:** set at 89, reset in `finally` (136). Every DB op in the `try` is wrapped in `.catch()` that swallows, so `Promise.all` of non-rejecting promises cannot throw before `finally`. Always resets.
- **Buffer cannot be stranded:** timer re-armed in both the re-entrancy path (84) and the `finally` (159-162) whenever `viewCountBuffer.size > 0`. The only strand requires a non-null timer with no pending callback — impossible because entry nulls it and every re-arm assigns a fresh `setTimeout`.
- Bounded maps: `viewCountBuffer` cap 1000 with drop-on-full + post-flush FIFO eviction (143-150); `viewCountRetryCount` cap 500 FIFO (169-187) + clear-when-buffer-empty (167); retry cap `VIEW_COUNT_MAX_RETRIES=3` drops poison increments (117-120). Exponential backoff on consecutive failures (37-41).
- `.unref?.()` optional-call (55,85,161) — safe where the timer is a number. `flushBufferedSharedGroupViewCounts` (191-202) clears + force-flushes safely. Restore-maintenance gate (44) suppresses buffering during DB restore. No leak, no unhandled rejection.

### Histogram worker + AbortController — `components/histogram.tsx`
- **`requestHistogramFromWorker` (129-167):** per-request `requestId` discriminates responses (143); `cleanup()` removes BOTH message and abort listeners (137-140); pre-aborted signal short-circuits before post (158-161); `{ once: true }` on abort listener (162). Stale post-abort worker messages are ignored (listener already removed). No listener accumulation across photo changes.
- **Worker lifecycle effect (526-532):** create on mount, `terminate()` + null on unmount; StrictMode double-invoke re-creates after cleanup; `img.onload` null-guards `workerRef.current` (544).
- **Image-load effect (534-577):** `aborted` flag + `AbortController`; cleanup sets aborted, aborts controller, nulls handlers, clears `img.src` to cancel in-flight fetch (570-576); all `.then`/`.catch` guard on `aborted` (550,556). No leak, no unhandled rejection.

### Masonry resize rAF + scroll handlers — `components/home-client.tsx`
- **Resize effect (28-60):** `handleResize` cancels pending rAF before scheduling (debounce, 48-49); cleanup removes listener + cancels rAF (56-59).
- **Scroll-restore effect (138-163):** two rAFs + setTimeout, all cancelled in cleanup; `cancelled` flag guards restore (157-162).
- **Back-to-top effect (178-185):** passive listener removed in cleanup.

### `use-display-capability.ts` — React #185 memoization
- `detect()` value-memoizes via `_cachedSnapshot` comparing `colorGamut` + `isHdr` (73-81); returns the SAME reference when unchanged → no `useSyncExternalStore` infinite loop.
- `getServerSnapshot` returns the stable module constant `SERVER_DEFAULT` (115-117).
- `subscribe` cleanup removes all MQ listeners + visibility + focus (112). Confirmed stable-reference contract.

### `blur-data-url.ts` — validation (producer + write + read)
- `isSafeBlurDataUrl` rejects length 0 and `> MAX_BLUR_DATA_URL_LENGTH=4096`, enforces the 3-prefix allowlist (47-51).
- `assertBlurDataUrl` null-passthrough + throttled warn (104-120). `rejectionLog` LRU capped 256 with oldest-eviction (80-83) — bounded, no leak. Redacted preview (first 8 chars only) — no token leak.

### `stripGpsFromOriginal` dispatch + fail-closed chain — `process-image.ts:1522-1596`
- All four extensions dispatch to the right scrubber (1530-1537); `.gif`/`.bmp` early-return (no EXIF carriage); `scrubbed === null` → Tier-2 re-encode (1552+) — **fails CLOSED for every format**.
- Tier-2 uses `.keepIccProfile()` only (NOT `withMetadata()`), so GPS is dropped (1558) — matches the documented COR-R4C8-01 contract.
- Atomic temp-file + rename (1547-1548, 1585-1586); whole body in try/catch logging non-fatally (1587-1595).
- One documented gap (not a regression): structurally-anomalous HEIC has no HEVC re-encoder → original retains GPS, logged at `error` level loud (1579). Known/intentional.
- Minor quality-only note (NOT a bug): `input.includes(Buffer.from('VP8L'))` at 1566 is a naive whole-buffer scan; a lossy VP8 file whose EXIF/XMP/ICC payload coincidentally contains the bytes `VP8L` would be re-encoded as lossless on the rare Tier-2 fallback. No correctness/privacy impact (GPS still stripped; the only effect is a larger lossless re-encode of an already-lossy source). Below the reporting bar — recorded for completeness only.

---

## References (re-traced, all correct)
- `apps/web/src/lib/gps-exif-strip.ts:554-595` — WebP RIFF scrub, fix verified correct + complete
- `apps/web/src/lib/gps-exif-strip.ts:103-189` — shared TIFF region scrubber, bounds-correct
- `apps/web/src/lib/gps-exif-strip.ts:212-350` — JPEG scrubber + post-EOI-trailer fail-closed
- `apps/web/src/lib/gps-exif-strip.ts:369-545` — ISOBMFF/HEIF/AVIF scrubber, bounds-correct
- `apps/web/src/lib/color-detection.ts:217-283` — NCLX walker, fails closed on oversized box
- `apps/web/src/lib/icc-extractor.ts:45-127` — ICC name parser, bounds-correct
- `apps/web/src/lib/icc-chromaticity.ts:147-322` — chromaticity, div-by-zero + NaN guarded
- `apps/web/src/lib/gain-map-detection.ts:57-291` — gain-map walker, fails closed; line 87 dead-code note persists
- `apps/web/src/lib/data.ts:63-202` — view-count flush FSM, no strand/stuck/leak
- `apps/web/src/components/histogram.tsx:129-167, 526-577` — worker/abort lifecycle, no leak
- `apps/web/src/components/home-client.tsx:28-60, 138-185` — masonry rAF + scroll, no leak
- `apps/web/src/lib/use-display-capability.ts:49-124` — snapshot memoization, no React #185
- `apps/web/src/lib/blur-data-url.ts:47-120` — validation + bounded rejection LRU
- `apps/web/src/lib/process-image.ts:1522-1596` — GPS-strip dispatch, fails closed
