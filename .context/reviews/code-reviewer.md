# Cycle 17 Code Review — code-reviewer

Date: 2026-05-06
Scope: Full repository, post-cycle-16 state
Focus: Code quality, logic correctness, edge cases, maintainability

## Findings

### MEDIUM SEVERITY

**C17-MED-01: uploadImages omits EXIF caption hints from enqueueImageProcessing**
- **File:** `apps/web/src/app/actions/images.ts` (lines 407-421)
- **Confidence:** High
- **Problem:** `uploadImages` calls `enqueueImageProcessing` with `id`, `filenameOriginal`, `filenameWebp`, `filenameAvif`, `filenameJpeg`, `width`, `topic`, `quality`, and `imageSizes` — but NOT `camera_model` or `capture_date`. These fields are available in `exifDb` (line 286) and are passed by the bootstrap query (`apps/web/src/lib/image-queue.ts` lines 549-560). The result is that freshly uploaded images lose EXIF hints for the `generateCaption` fire-and-forget hook, degrading caption quality for all uploads processed within a single process lifetime.
- **Fix:** Pass `camera_model: exifDb.camera_model` and `capture_date: exifDb.capture_date` to `enqueueImageProcessing`.

**C17-MED-02: uploadImages omits iccProfileName from enqueueImageProcessing, breaking P3 AVIF tagging for fresh uploads**
- **File:** `apps/web/src/app/actions/images.ts` (lines 407-421)
- **Confidence:** High
- **Problem:** `saveOriginalAndGetMetadata` returns `iccProfileName` (line 579 in process-image.ts), which determines whether `processImageFormats` tags AVIF derivatives as P3 or sRGB. `uploadImages` does NOT pass this value to `enqueueImageProcessing`. The queue handler passes `job.iccProfileName` to `processImageFormats` (image-queue.ts line 317), which defaults to `undefined` → `'srgb'`. Therefore, ALL freshly uploaded wide-gamut images processed by the queue get sRGB-tagged AVIF derivatives instead of P3, causing visible color degradation.
- **Fix:** Pass `iccProfileName: data.iccProfileName` to `enqueueImageProcessing`.

### LOW SEVERITY

**C17-LOW-01: Service Worker networkFirstHtml timestamp validation gap**
- **File:** `apps/web/public/sw.js` (lines 162-169)
- **Confidence:** Medium
- **Problem:** `const age = Date.now() - Number(dateHeader);` If `dateHeader` is malformed (e.g., manually corrupted in Cache API), `Number(dateHeader)` returns `NaN`, and `NaN > HTML_MAX_AGE_MS` is always `false`. Stale HTML would be served indefinitely until the cache entry is manually cleared.
- **Fix:** Validate `!Number.isNaN(age) && age > HTML_MAX_AGE_MS`.

**C17-LOW-02: process-image.ts decimalToRational rounds values >= 1 to 2 decimal places**
- **File:** `apps/web/src/lib/process-image.ts` (lines 832-839)
- **Confidence:** Low
- **Problem:** Exposure times >= 1 second are rounded to 2 decimal places (e.g., 1.333s → "1.33"). This loses precision for display metadata. Impact is cosmetic only.
- **Fix:** Use a higher-precision rounding or rational approximation for values >= 1.

## Previously Deferred Items (Status Check)

- C16-HIGH-01 (SW metadata race): Still present, deferred.
- C16-LOW-03 (rate-limit sub-second truncation): Still present, deferred.
- C16-LOW-04 (SW caches non-image responses): Still present, deferred.
- C16-LOW-05 (analytics entity validation): Still present, deferred.

## Cross-File Interaction Notes

The `enqueueImageProcessing` call site in `uploadImages` (images.ts) and the bootstrap query in `image-queue.ts` are the two producers of `ImageProcessingJob`. They have diverged: bootstrap passes `camera_model`/`capture_date` (fixed in cycle 16) but upload does not. Upload also fails to pass `iccProfileName`, which bootstrap cannot pass because the DB schema lacks an `icc_profile_name` column. Both call sites should be kept in sync with the `ImageProcessingJob` type definition.
