# Debugger Report — Run 7 Cycle 3

**HEAD:** c6eff919  
**Date:** 2026-06-19  
**Scope:** Independent re-verification of the prior run's iloc `indexSize` candidate + fresh sweep of icc-extractor mluc bounds, clip-embeddings decode round-trip, blur-data-url validation, WI-15 temp-file cleanup, and use-display-capability snapshot memoization.

---

## 1. Prior Candidate — DISPROVED (confirmed)

### Candidate: `gps-exif-strip.ts:466` — `indexSize` not validated against {0,4,8}

**Independent read:** Lines 455–526 confirmed.

`indexSize` is derived from `sizesByte2 & 0xf` (range 0–15) only when `ilocVersion >= 1` (line 466). It is NOT passed to `readSized`. The only two uses are:

- **Line 513:** `extentEntrySize = indexSize + offsetSize + lengthSize` — used only as an addend in the size-sum for the bounds check.
- **Line 514:** `if (pos + extentEntrySize > ilocBox.dataEnd) return null` — bounds check fires BEFORE any read; a large `indexSize` (e.g. 15) simply makes the sum bigger, making the bounds check MORE likely to reject → `null` (safe).
- **Line 515:** `pos += indexSize` — advances `pos` past the unread index field. The value at `pos` is never read; `pos` is advanced, then `readSized` is called at the new `pos` for `offsetSize` and `lengthSize` — both of which ARE validated at lines 476–478 and will return `null` for any size ∉ {0,4,8}.

**Conclusion:** A malformed `indexSize` (e.g. 7, 11) either trips the bounds check (line 514 → null) or misaligns `pos` so subsequent `readSized` calls return null (since `offsetSize`/`lengthSize` were pre-validated as 0/4/8, there is no off-by-one on those reads — only `pos` is shifted). No out-of-bounds read, no GPS-leak path. This is a defense-in-depth symmetry nit only. Adding `indexSize` to the line 476–478 loop would be consistent but has zero behavioral effect.

**Disposition: DISPROVED.** Already tracked as RES-R7C2-01 residual. Do not re-file.

---

## 2. Fresh Sweep — Results

### 2a. `icc-extractor.ts` — mluc UTF-16BE parsing bounds

**Read:** Lines 83–118.

All paths are safe:

- `numRecords` is clamped to 100 (line 86).
- `recordSize` is validated `>= 12` before the loop (line 88).
- `recOffset + 12 > iccLen` AND `recOffset + 12 > dataOffset + dataSize` are both checked before any field read (line 93).
- `recLen = Math.min(icc.readUInt32BE(recOffset + 4), 1024)` — capped at 1024 bytes (line 99).
- `recTextOffset = icc.readUInt32BE(recOffset + 8)` — untrusted 32-bit value, but immediately consumed in:
  - `strStart = dataOffset + recTextOffset`
  - `strEnd = strStart + recLen`
  - Guard at line 103: `strEnd > iccLen || strEnd > dataOffset + dataSize || strStart >= strEnd` — the `strStart >= strEnd` arm catches `recLen == 0` (confirmed: `strStart + 0 >= strStart` is true → `continue`). The `strEnd > iccLen` arm catches integer overflow if `recTextOffset` is near `UINT32_MAX`: `dataOffset + recTextOffset` can wrap in JS... but `dataOffset` is a tag offset validated by `dataOffset + 12 > iccLen` (line 70), so `dataOffset < iccLen <= Buffer.MAX_LENGTH (< 2^31)`. `recTextOffset` is an untrusted UInt32 up to `~4 GB`. The sum `dataOffset + recTextOffset` could exceed `Number.MAX_SAFE_INTEGER`? No — JS numbers are IEEE-754 doubles; `dataOffset < 2^31` and `recTextOffset < 2^32` so their sum is at most `~2^32 + 2^31 ≈ 6e9`, well within `Number.MAX_SAFE_INTEGER (2^53 - 1)`. And `strEnd > iccLen` where `iccLen` is a real JS Buffer length (always < 2 GB) catches any overshoot.

**Disposition: No bug.**

### 2b. `clip-embeddings.ts` — 2048-byte embedding decode round-trip

**Read:** Full file (lines 1–182).

The write path (`embeddingToBuffer`, line 62) writes 512 × 4 = 2048 bytes little-endian. The read path (`decodeEmbeddingColumn`, line 108) checks `value.length === EMBEDDING_BYTES` (2048) before direct decode, or base64-decodes legacy buffers and checks again. `bufferToEmbedding` reads `readFloatLE(i * 4)` for `i` in 0..511 — correct, no off-by-one (last byte accessed: `511 * 4 + 3 = 2047`, the last byte of a 2048-byte buffer). The legacy path (`Buffer.from(value.toString('latin1'), 'base64')`) is sound: `latin1` is a lossless encoding for arbitrary bytes, and base64 decoding it yields the original bytes.

**Disposition: No bug.**

### 2c. `blur-data-url.ts` — validation

**Read:** Full file (lines 1–121).

`isSafeBlurDataUrl` checks: typeof string, length 1–4096, starts with one of three known prefixes. `assertBlurDataUrl` throttles rejection logging via a bounded 256-entry LRU. The throttle correctly handles the first-sighting emit and every-1000th hit (`count === 0 || count % 1000 === 0`). No path allows an unsafe value through to the CSS `url()` call.

**Disposition: No bug.**

### 2d. `process-image.ts:1312–1317` — WI-15 temp-file `finally` cleanup

**Read:** Lines 1290–1319.

The `finally` block (lines 1312–1317) runs unconditionally — including on throw from the `catch` block (the `catch` at line 1295 re-throws after cleanup). The condition `processingInputPath !== inputPath` correctly identifies whether a downscaled intermediate was written. `fs.unlink(...).catch(() => {})` suppresses ENOENT or any unlink error. The intermediate is always cleaned regardless of whether the main encode succeeded or failed.

**Disposition: No bug.**

### 2e. `use-display-capability.ts` — snapshot memoization (React #185)

**Read:** Full file (lines 1–141).

The module-level `_cachedSnapshot` variable (line 47) is compared by value fields at lines 76–82 before returning a new object. If `colorGamut` and `isHdr` are unchanged, the same object reference is returned. `useSyncExternalStore` uses `Object.is` between successive `getSnapshot()` return values; returning the same reference prevents the infinite-loop React #185 scenario. The `SERVER_DEFAULT` constant (line 39) is a stable module-level object — `getServerSnapshot` always returns the same reference, which is also correct.

One edge case: the module-level `_cachedSnapshot` is a singleton shared across all component instances. If two components call `useDisplayCapability` simultaneously during SSR hydration, there is no race (JS is single-threaded). On the client, `detect()` is called synchronously, so no issue.

**Disposition: No bug.**

---

## 3. Summary

| Area | File | Disposition |
|---|---|---|
| `indexSize` not in validation loop | `gps-exif-strip.ts:466` | DISPROVED — bounds check + readSized make it safe |
| mluc UTF-16BE bounds | `icc-extractor.ts:83-118` | No bug |
| Embedding decode round-trip | `clip-embeddings.ts:108-126` | No bug |
| Blur-data-url validation | `blur-data-url.ts:47-120` | No bug |
| WI-15 temp-file finally | `process-image.ts:1312-1317` | No bug |
| Snapshot memoization React #185 | `use-display-capability.ts:47-84` | No bug |

---

**NEW confirmed findings: 0**  
**Disproved candidates: 1** (the `indexSize` iloc candidate from the prior run)  
**Verdict: CLEAN PASS — no new latent bugs found in any swept area.**
