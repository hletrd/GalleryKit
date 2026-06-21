# Debugger Review — Run-9 Cycle-2

**Scope:** Full repo deep debugging / edge-case review.  
**Baseline:** run-8 convergence commit f63af3b9. Since that commit, ONLY two new test files were added; zero production logic changed.  
**Instruction:** Hold a HIGH bar. Do NOT manufacture findings. Do NOT re-file adjudicated BENIGN/REFUTED items.

---

## Files Reviewed

| File | Area |
|------|------|
| `apps/web/src/lib/color-detection.ts` | NCLX ISOBMFF walker, per-field guard |
| `apps/web/src/lib/icc-extractor.ts` | `desc`/`mluc` ICC descriptor parser |
| `apps/web/src/lib/icc-chromaticity.ts` | XYZ tag bounds checks, chad inversion guard |
| `apps/web/src/lib/gain-map-detection.ts` | hasGainMap ISOBMFF walker |
| `apps/web/src/lib/gps-exif-strip.ts` | TIFF IFD walker, JPEG APP1/XMP segment parser |
| `apps/web/src/lib/bounded-map.ts` | BoundedMap prune / eviction |
| `apps/web/src/lib/rate-limit.ts` | In-memory rate limits, rollback helpers |
| `apps/web/src/lib/auth-rate-limit.ts` | Account-scoped login + password-change rate limits |
| `apps/web/src/lib/view-retention.ts` | Chunked DELETE, retention guard |
| `apps/web/src/lib/upload-tracker.ts` | Claim/settle reconciliation |
| `apps/web/src/lib/sw-cache.ts` | LRU eviction, insertion-order recency |
| `apps/web/src/lib/use-display-capability.ts` | Snapshot-memoized `useSyncExternalStore` |
| `apps/web/src/lib/csv-escape.ts` | Formula injection guard, C0 strip, unicode strip |
| `apps/web/src/lib/validation.ts` | UNICODE_FORMAT_CHARS regex, `safeInsertId` |
| `apps/web/src/lib/image-queue.ts` | Queue bootstrap, retry map eviction |

---

## BENIGN / REFUTED Verdicts (Prior Cycles — Not Re-Filed)

| Item | Verdict | Rationale |
|------|---------|-----------|
| `parseCicpFromHeif`/`hasGainMap` depth×1 MB scan DoS | REFUTED | Buffer pre-capped to 1 MB before `walk()`; MAX_DEPTH=5 enforced per recursion level |
| `gps-exif-strip.ts` value-size integer overflow | BENIGN | `typeSize * valueCount` is u32×u32 but total capped by `inBounds()` which checks `abs + size <= tiffEnd`; no allocation on that value |
| `gps-exif-strip.ts` XMP cross-chunk reconstruction | BENIGN | Module explicitly rejects files with non-trivial post-EOI trailers (returns null → re-encode fallback); ExtendedXMP chunks are token-tested per-chunk AND as offset-ordered reconstruction |
| `icc-extractor.ts` mluc offset arithmetic | BENIGN | `strStart = dataOffset + recTextOffset`; bounds check `strEnd > iccLen || strEnd > dataOffset + dataSize || strStart >= strEnd` at line 103 covers all overflow cases |
| Restore flag / lock / temp lifecycle | BENIGN | Advisory lock released on connection close; flag cleared in finally; temp file renamed atomically |
| Global-regex `lastIndex` statefulness | BENIGN | `UNICODE_FORMAT_CHARS` (no `/g`) used only with `.test()`; the `/g` twin `UNICODE_FORMAT_CHARS_G` is a separate non-shared instance used only with `.replace()` |
| Smart-collections SQL injection | BENIGN | All dynamic SQL uses Drizzle parameterization; no raw interpolation of untrusted input |
| `blur-data-url` contract | BENIGN | Producer-side `assertBlurDataUrl` + consumer-side `isSafeBlurDataUrl` enforce the `data:image/{jpeg,png,webp};base64,…` contract and 4096-char cap |
| View-count atomic Map swap | BENIGN | `atomicFlushBuffer` snapshot-swaps the Map reference; flush operates on the snapshot, not the live Map |
| Settings-hash no-arg vs config-arg divergence | BENIGN-BY-DESIGN | `computeSettingsHash()` (no-arg) is used for ETag emission; `computeSettingsHash(config)` exists for testing. Both read from the same 9 `COLOR_IMPACTING_KEYS` |

---

## New Findings

**None.**

All examined modules are correctly bounded, guard against overflow and structural anomalies, and do not exhibit regex catastrophic backtracking, lastIndex statefulness, race conditions, error-swallowing corruption, off-by-one errors in chunked operations, or Map/Set eviction logic bugs.

Specific checks confirmed clean this cycle:

- `gps-exif-strip.ts`: `ifdAbs <= tiffStart + 7` structural anomaly guard (AGG-L2) is in place; cycle-detection via `visited` Set; `MAX_IFD_CHAIN=8` and `MAX_IFD_ENTRIES=1024` caps enforced; inline-value (≤4 bytes at `entry+8`) vs offset-value (>4 bytes, `tiffStart + r.u32(entry+8)`) branch is correct for both GPS IFD entries and the XMP TIFF tag.
- `use-display-capability.ts`: `_cachedSnapshot` value-equality check (`colorGamut === gamut && isHdr === isHdr`) returns the same object reference when unchanged — no infinite loop via React error #185.
- `csv-escape.ts`: imports `UNICODE_FORMAT_CHARS_G` (new RegExp with `/g`) from a local non-shared instance; C0 strip preserves CR/LF for the subsequent `[\r\n]+→space` collapse; formula-injection `^\s*[=+\-@]` guard accounts for post-collapse whitespace; `\t` (0x09) correctly pre-stripped by the C0 pass before the formula guard runs.
- `validation.ts`: `UNICODE_FORMAT_CHARS` (no `/g`) used only with `.test()` and `.replace()` via the `UNICODE_FORMAT_CHARS_GLOBAL` twin — no `lastIndex` hazard. `safeInsertId` guards both BigInt overflow and `Number.isFinite`/negative for the number path.
- `auth-rate-limit.ts`: rollback helpers use count-decrement-not-delete pattern (count > 1 → decrement, else → delete) matching the IP-scoped login rollback; `pruneAccountLoginRateLimit` delegates to `BoundedMap.prune()`.
- `image-queue.ts` retry map eviction: collect-then-delete FIFO pattern; `MAX_RETRY_MAP_SIZE=10000` and `MAX_PERMANENTLY_FAILED_IDS=1000` caps prevent unbounded growth.

---

## Determination

**0 new bugs — convergence confirmed.**
