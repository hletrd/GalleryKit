# Debugger Audit — Run-9 Cycle-6

**Scope:** Latent-bug / boundary / parsing lens review of binary parsers,
boundary-heavy logic modules, and sanity-check of CR-R9C6-01.

**HEAD at audit time:** ba3277da  
**Date:** 2026-06-21

---

## DO-NOT-RE-FILE LIST (previously confirmed benign, excluded from scope)

The following items were explicitly excluded per task brief and are not
re-examined here:

- icc-extractor mluc/desc offsets
- gain-map dead-branch (`if (p > limit) return ''`)
- sw-cache eviction-by-design
- view-retention parseInt-truncate
- icc-chromaticity invert3x3 1e-12
- auth-rate-limit in-place reset (single-threaded)
- mluc recordSize×index overflow
- gps-exif ILOC walker bounds
- color-detection NCLX colr bounds
- REJ-R7C3-01 (gps-exif indexSize) — DISPROVED

---

## Binary Parser Modules

### `lib/color-detection.ts` — BENIGN

`parseCicpFromHeif()` ISOBMFF walker:
- MAX_SCAN_BYTES=1 MB, MAX_DEPTH=5 hard caps enforced at walk entry.
- Extended-size box (size==1): `pos + 16 > buffer.length` guard before
  `readBigUInt64BE`, then `Number()` cast — result is float64, but
  1 MB cap means the actual walk range is bounded before the size is used.
- Per-box: `size < headerSize || pos + size > buffer.length` → break.
- colr payload: `dataSize >= 11` check before any NCLX field reads.
- NCLX code 2 (Unspecified) is absent from NCLX_TRANSFER_MAP /
  NCLX_PRIMARIES_MAP, so ICC-derived values remain intact — no override
  hazard.

No unguarded reads, no integer overflow paths, no off-by-one found.

### `lib/gps-exif-strip.ts` — BENIGN

- TIFF walker: MAX_IFD_CHAIN=8, MAX_IFD_ENTRIES=1024, cycle detection via
  visited Set. `valueSize = typeSize * valueCount` is float64 × float64 —
  at overflow scale, `inBounds` check fails before any fill is attempted.
- JPEG: post-EOI detection with JPEG_TRAILER_TOLERANCE_BYTES=2 tolerance.
  ExtendedXMP chunk reconstruction bounds-checked.
- ISOBMFF iloc walker: version 0/1/2, itemCount>4096 cap,
  extentCount>64 cap. `readSized` uses bigint for 64-bit item offsets with
  explicit overflow guard.
- WebP: RIFF chunk walk has `next <= offset` anti-infinite-loop guard.
- `ifdAbs <= tiffStart + 7` null-IFD guard present.

No unguarded reads, no off-by-one found.

### `lib/icc-extractor.ts` — BENIGN

- `tagCount = Math.min(icc.readUInt32BE(128), 100)` — hard cap.
- Per-tag: `tagOffset + 12 > iccLen` → break.
- desc branch: `strLen = Math.min(declaredLength, dataSize - 12, 1024)`,
  `strEnd > iccLen || strStart >= strEnd` → break.
- mluc branch: `numRecords = Math.min(..., 100)`, `recordSize >= 12` check,
  per-record `recOffset + 12 > iccLen` continue, `recLen = Math.min(..., 1024)`,
  `strEnd > iccLen || strEnd > dataOffset + dataSize || strStart >= strEnd`
  continue.

All multi-byte reads guarded by bounds before access. No unguarded reads.

### `lib/icc-chromaticity.ts` — BENIGN

- `tagCount <= 0` and `> MAX_TAG_COUNT` guards.
- `tagTableEnd = Math.min(...)` cap applied before scan.
- `readXyzTag`: `offset + 20 > buf.length` guard, `sig !== 'XYZ '` check.
- `readChadMatrix`: `size < 44 || offset + 44 > buf.length` guard;
  9 × s15Fixed16 reads all within confirmed range; `Number.isFinite` check
  on each parsed value.
- `invert3x3`: `Math.abs(det) < 1e-12` singular-matrix guard.
- `xyzToXy`: `Math.abs(sum) < 1e-9` zero-denominator guard.

No unguarded reads, no division-by-zero, no integer overflow.

### `lib/gain-map-detection.ts` — BENIGN

- `readBoxHeader`: `pos + 8 > buffer.length`, `pos + 16 > buffer.length`
  (extended size), `size < headerSize || pos + size > buffer.length` guards.
- `parseIinf`: `parsed < entryCount && parsed < 1024` dual cap.
- `parseIref`: outer `parsed < 1024` cap; inner per-reference
  `i < refCount && i < 1024` cap; `inner + idSize > innerEnd` break.
- `readNullTerminatedAscii`: `p <= limit` loop invariant; `if (p > limit)`
  branch is structurally unreachable (confirmed harmless dead code, already
  on DO-NOT-RE-FILE list).
- Entire `walk()` wrapped in try/catch → returns false on any exception.

No unguarded reads, no integer overflow.

---

## Boundary / Non-Parser Logic Modules

### `lib/view-retention.ts` — BENIGN

- `resolveRetentionMs`: `Number.isFinite(maxAgeMs) && maxAgeMs > 0` guard
  prevents negative/non-finite retention from putting cutoff in the future.
- `parseInt(..., 10)` with explicit radix; followed by same
  `isFinite && > 0` guard for env-var path.
- `MAX_BATCHES_PER_TABLE=200`, `VIEW_PURGE_BATCH=5000` — bounded iteration.
- `affected < VIEW_PURGE_BATCH` drain-detection correctly breaks the inner
  loop when a table is drained.

### `lib/auth-rate-limit.ts` — BENIGN

- Both `accountLoginRateLimit` and `passwordChangeRateLimit` use
  `createWindowBoundedMap`.
- Rollback functions check `entry.count > 1` before decrement (no underflow
  below 0). Correct — reviewed and confirmed in prior cycle.

### `lib/bounded-map.ts` — BENIGN

- `createResetAtBoundedMap`: expiry via `entry.resetAt <= now`.
- `createWindowBoundedMap`: expiry via `now - entry.lastAttempt > windowMs`.
- `prune()` uses collect-then-delete pattern (safe over Map iteration).
- Hard cap eviction by insertion order (FIFO oldest-first).

### `lib/rate-limit.ts` — BENIGN

- `preIncrementOgAttempt` / `preIncrementShareAttempt` /
  `preIncrementSemanticAttempt`: standard resetAt pattern, count starts at 1
  on first entry, increments on existing. No underflow possible on rollback
  (`count > 1` check before decrement, `delete` instead when count is 1).
- `getRateLimitBucketStart`: `Math.floor(nowMs / 1000)` then integer modulo —
  all integer arithmetic on second-precision values well within safe integer
  range.
- `decrementRateLimit`: uses `GREATEST(count - 1, 0)` in MySQL so DB counter
  cannot go negative even under concurrent decrements. Followed by DELETE of
  zero-count rows in the same transaction. Correct.
- `purgeOldBuckets`: `Math.floor((Date.now() - maxAgeMs) / 1000)` is
  well-defined; the default 24-hour window produces a safe positive cutoff.

### `lib/sw-cache.ts` — BENIGN

- `recordAndEvict`: delete-then-set pattern for recency tracking (Map
  insertion-order LRU). Total is O(n) sum; eviction is head-walk.
- Guard in eviction loop: only adjusts `evicted` / `total` when
  `cache.delete()` returns true (handles browser-side quota eviction that
  may have already removed the entry). No double-counting.
- `isAdminRoute` / `isImageDerivative`: both wrapped in try/catch over
  `new URL()` — malformed URLs return false, never throw.

### `lib/settings-hash.ts` — BENIGN

- `COLOR_IMPACTING_KEYS` is a 9-element const tuple with compile-time guard
  (`_ColorKeysAreSettingKeys`) that catches a typo or removed key at `tsc`.
  Cannot catch a forgotten new byte-impacting key — this is a known gap
  documented in CLAUDE.md as an author responsibility, not a code defect.
- `buildHash`: deterministic ordered string over all 9 keys, SHA-256 →
  first 8 hex chars. Stable — same inputs always produce the same output.
- `buildHashFromConfig`: uses resolved GalleryConfig values, not raw DB
  strings, preventing ETag misalignment when DB stores an invalid value
  (e.g. quality=150) and the encoder falls back to a default.
- `FALLBACK_HASH` built from empty map — stable constant.
- Inflight deduplication via module-scoped `inflight` Promise prevents
  parallel DB fetches. Cache TTL is 5 s.

### `lib/validation.ts` — BENIGN

- `UNICODE_FORMAT_CHARS` regex uses `\uXXXX` escapes (not literal chars)
  making it ASCII-safe and editor-portable (C18-LOW-01).
- `UNICODE_FORMAT_CHARS_GLOBAL` is a separate derived instance to avoid
  shared `/g` lastIndex state between `test()` calls (correct).
- `stripUnicodeFormatting`: uses the global-flag twin for replace-all;
  null/undefined input returns null.
- `isValidTopicAlias`: `UNICODE_FORMAT_CHARS.test()` runs before
  `countCodePoints` max-length check — correct short-circuit ordering.
- `isValidTagName`: trims before test — consistent.
- `isValidTagSlug`: uses `countCodePoints` for max-length (not `.length`)
  to handle supplementary Unicode correctly (C22-AGG-01).
- `isValidSlug`: `.length` is correct here because the regex restricts to
  ASCII, where `.length` and `countCodePoints` agree (AGG10-02 note).

### `lib/blur-data-url.ts` — BENIGN

- `isSafeBlurDataUrl`: type check → length bounds → ALLOWED_PREFIXES prefix
  check. Correct layering.
- `MAX_BLUR_DATA_URL_LENGTH=4096`: adequate ceiling for 16px JPEG blur.
- Rejection log throttle: keyed by `(typeof, length, head-8-chars)` tuple.
  `count % 1000 === 0` condition also fires at count=0 (first sighting).
  Bounded at 256 entries with FIFO eviction. No log-flood vector.
- `assertBlurDataUrl` redacts rejected value to `typeof + length + head-8`
  in the warn line — no token/URL leakage risk.

### `lib/exif-datetime.ts` — BENIGN

- `EXIF_DATETIME_PATTERN`: anchored regex `/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/` —
  only exact-length digit groups accepted, no partial match possible.
- `isValidExifDateTimeParts`: calendar range checks (year 1900–2100, month
  1–12, day 1–31, hour 0–23, minute/second 0–59) then round-trip validation
  via `Date.UTC` + UTC field accessors. Catches invalid calendar dates like
  Feb 30.
- `parseStoredExifDateTime`: feeds `Number(match[n])` — regex guarantees
  only decimal digits, so `Number()` never produces NaN here.

---

## CR-R9C6-01 Sanity-Check: Upload Path and the `if (!quality && !imageSizes)` Gate

**Candidate claim:** The upload path skips 6 processing settings
(`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`,
`sdrJpegChroma`, `wideGamutMaxSourcePixels`, and `autoAltTextEnabled`) via
the `if (!quality && !imageSizes)` gate at `image-queue.ts:318`.

**Data flow traced:**

1. `apps/web/src/app/actions/images.ts:176` — upload action resolves
   `uploadConfig: GalleryConfig = await getGalleryConfig()` at the start of
   the upload batch.

2. `images.ts:440–458` — `enqueueImageProcessing({...})` call passes:
   ```
   quality: {
     webp: uploadConfig.imageQualityWebp,
     avif: uploadConfig.imageQualityAvif,
     jpeg: uploadConfig.imageQualityJpeg,
   },
   imageSizes: uploadConfig.imageSizes.length > 0 ? uploadConfig.imageSizes : undefined,
   ```
   Only `quality` and `imageSizes` are forwarded in the job struct. The
   remaining 6 settings (`forceSrgbDerivatives`, `wideGamutJpegChroma`,
   `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`,
   `autoAltTextEnabled`) are NOT present in the `ImageProcessingJob` struct
   (confirmed by `image-queue.ts:121–130`) and are therefore not carried on
   the job.

3. `image-queue.ts:306–336` — processing worker initializes:
   ```typescript
   let quality: ImageQualitySettings | undefined = job.quality;       // set from job
   let imageSizes: number[] | undefined = job.imageSizes;             // set from job
   let autoAltTextEnabled = false;                                     // default
   let forceSrgbDerivatives = false;                                   // default
   let wideGamutJpegChroma: JpegChromaSubsampling | undefined;        // default
   let avifEffort: number | undefined;                                 // default
   let sdrJpegChroma: JpegChromaSubsampling | undefined;              // default
   let wideGamutMaxSourcePixels: number | undefined;                  // default
   if (!quality && !imageSizes) {
       // reads ALL 8 settings from DB config
   }
   ```

**Verdict on CR-R9C6-01:** CONFIRMED AS DESCRIBED. The upload path sets
`job.quality` and `job.imageSizes` from the upload-time config snapshot,
so the `if (!quality && !imageSizes)` gate at line 318 evaluates to
`false` — the config block is skipped. The 6 other settings that live
inside that block (`forceSrgbDerivatives`, `wideGamutJpegChroma`,
`avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`,
`autoAltTextEnabled`) are never set from the upload-time snapshot and stay
at their zero/undefined defaults for every upload-path job.

**Impact assessment:** The `ImageProcessingJob` struct has no fields for
these 6 settings. The upload action does not pass them. The gate that
would read them from the DB is bypassed because `quality` is always set by
the upload caller. This means:
- `forceSrgbDerivatives` is always `false` for upload-time processing
  regardless of the admin setting.
- `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`,
  `wideGamutMaxSourcePixels` are always their Sharp defaults
  (`undefined` → process-image defaults).
- `autoAltTextEnabled` is always `false`.

The quality+size snapshot-at-upload-time approach is intentional per the
comment at `image-queue.ts:304–305` ("Prefer upload-time snapshots so one
accepted upload action cannot straddle later admin config changes while it
waits in the queue"). However, only quality and size were snapshotted; the
6 color/chroma/effort/HDR settings were not included in the job struct,
creating an asymmetric snapshot — quality/size are frozen to upload time,
but color pipeline settings are expected to come from the config block
that is then bypassed.

This is a genuine defect in the snapshotting strategy:
- **ID:** CR-R9C6-01
- **Severity:** MEDIUM (photo derivatives may be encoded with wrong chroma
  subsampling / effort / force-srgb state if admin changes those settings
  after upload is accepted but before the queue processes the job; more
  critically, all upload-path jobs ALWAYS use Sharp defaults for these 6
  settings regardless of admin config, never the configured values)
- **Fix direction:** Either (a) add the 6 missing fields to
  `ImageProcessingJob` and populate them at `images.ts:440` from
  `uploadConfig`, or (b) remove `quality`/`imageSizes` from the job struct
  and always read all settings from the DB inside the processing worker
  (option b loses the snapshot-at-upload semantic for quality/size too).
  Option (a) is minimal and matches the existing pattern.

---

## Summary

| Module | Verdict |
|--------|---------|
| `lib/color-detection.ts` | BENIGN |
| `lib/gps-exif-strip.ts` | BENIGN |
| `lib/icc-extractor.ts` | BENIGN |
| `lib/icc-chromaticity.ts` | BENIGN |
| `lib/gain-map-detection.ts` | BENIGN |
| `lib/view-retention.ts` | BENIGN |
| `lib/auth-rate-limit.ts` | BENIGN |
| `lib/bounded-map.ts` | BENIGN |
| `lib/rate-limit.ts` | BENIGN |
| `lib/sw-cache.ts` | BENIGN |
| `lib/settings-hash.ts` | BENIGN |
| `lib/validation.ts` | BENIGN |
| `lib/blur-data-url.ts` | BENIGN |
| `lib/exif-datetime.ts` | BENIGN |
| `image-queue.ts:318` (CR-R9C6-01) | CONFIRMED DEFECT |

---

**1 DEFECT found: CR-R9C6-01 (CONFIRMED). Upload-path jobs always use Sharp defaults for `forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, and `autoAltTextEnabled` because these 6 settings are not carried in `ImageProcessingJob` and the config-read gate at `image-queue.ts:318` is bypassed whenever `quality` is set by the upload caller.**
