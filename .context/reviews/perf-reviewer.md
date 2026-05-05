# Cycle 17 Performance Review — perf-reviewer

Date: 2026-05-06
Scope: Full repository, post-cycle-16 state
Focus: CPU/memory, concurrency, UI responsiveness, database query efficiency

## Findings

### MEDIUM SEVERITY

**C17-PERF-01: uploadImages loses ICC profile info, causing incorrect color-space decisions in queue**
- **File:** `apps/web/src/app/actions/images.ts` (lines 407-421)
- **Confidence:** High
- **Problem:** Missing `iccProfileName` in `enqueueImageProcessing` means `processImageFormats` defaults to sRGB for all queue-processed fresh uploads. For P3 sources, this skips the `pipelineColorspace('rgb16')` path and 10-bit AVIF encoding (process-image.ts lines 656-692). The result is smaller files (8-bit sRGB) but the visual quality loss is the actual bug. From a perf perspective, the wider-gamut path (16-bit pipeline + 10-bit AVIF) is MORE expensive, so omitting it actually saves CPU. However, this is a correctness bug masquerading as a performance difference.
- **Fix:** Pass `iccProfileName` so the correct (more expensive but higher-quality) path is taken when appropriate.

### LOW SEVERITY

**C17-PERF-02: getImagesLitePage uses COUNT(*) OVER() which may be expensive on large tables**
- **File:** `apps/web/src/lib/data.ts` (lines 694)
- **Confidence:** Medium
- **Problem:** The window function `COUNT(*) OVER()` computes the total count for every row returned. On a 100-row page, this repeats the total count 100 times. For a table with tens of thousands of images, this adds overhead compared to a separate `SELECT COUNT(*)` query.
- **Fix:** Consider separate count query if table grows beyond ~50k rows.

**C17-PERF-03: searchImages runs up to 3 queries in parallel with potential over-fetch**
- **File:** `apps/web/src/lib/data.ts` (lines 1235-1255)
- **Confidence:** Low
- **Problem:** When the main query doesn't fill the limit, tag and alias queries run in parallel. Each can fetch up to `remainingLimit` rows. Worst-case total rows fetched: `effectiveLimit + 2 * remainingLimit`. For a limit of 20, this is at most 60 rows — negligible at personal-gallery scale.
- **Fix:** No action needed at current scale.

## Previously Deferred Performance Items

- C16-LOW-03 (rate-limit sub-second truncation): Still deferred, latent only.

## Verdict

No new performance regressions. The missing `iccProfileName` propagation actually reduces CPU per image (by skipping 16-bit pipeline + 10-bit AVIF) but degrades output quality — fix it for correctness, not performance.
