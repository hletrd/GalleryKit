# Cycle 17 Test Engineering Review — test-engineer

Date: 2026-05-06
Scope: Full repository, post-cycle-16 state
Focus: Test coverage gaps, fixture contracts, flaky tests, TDD opportunities

## Findings

### MEDIUM SEVERITY

**C17-TEST-01: No test verifies enqueueImageProcessing receives correct EXIF/ICC fields from uploadImages**
- **File:** `apps/web/src/app/actions/images.ts` (lines 407-421)
- **Confidence:** High
- **Problem:** There is no unit or integration test that asserts the `enqueueImageProcessing` call in `uploadImages` passes `camera_model`, `capture_date`, and `iccProfileName`. The bootstrap query tests (added in cycle 16) verify the DB-to-queue path, but the upload-to-queue path is untested. The `ImageProcessingJob` type includes these fields, yet the call site silently omits them.
- **Fix:** Add a test that mocks `enqueueImageProcessing` and asserts the job object includes `camera_model`, `capture_date`, and `iccProfileName` when the source image/metadata provides them.

**C17-TEST-02: No test for iccProfileName propagation through the upload pipeline**
- **File:** `apps/web/src/lib/process-image.ts` / `apps/web/src/app/actions/images.ts`
- **Confidence:** High
- **Problem:** The `saveOriginalAndGetMetadata` function extracts `iccProfileName` from Sharp metadata, but there is no end-to-end test verifying that this value flows through to `processImageFormats` and influences the AVIF colorspace decision.
- **Fix:** Add an integration test with a P3-tagged test image that verifies the queue processes it with `iccProfileName` set correctly.

### LOW SEVERITY

**C17-TEST-03: SW networkFirstHtml NaN age path is untested**
- **File:** `apps/web/public/sw.js` (lines 162-169)
- **Confidence:** Medium
- **Problem:** The stale-HTML eviction logic has no test for malformed `sw-cached-at` headers. A corrupted cache entry would produce `NaN` age, bypassing eviction.
- **Fix:** Add a SW test that injects a corrupted cache entry and asserts it is evicted.

**C17-TEST-04: checkout route idempotency key collision is untested**
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts` (line 147)
- **Confidence:** Medium
- **Problem:** The idempotency key uses `ip` which becomes `'unknown'` when TRUST_PROXY is unset. There is no test verifying behavior when multiple requests for the same image arrive with `'unknown'` IP.
- **Fix:** Add a test that simulates concurrent checkout requests without TRUST_PROXY and asserts they receive distinct session URLs.

## Previously Deferred Test Items

- None specific from prior cycles.

## Verdict

The most critical gap is the upload-to-queue field propagation (C17-TEST-01 and C17-TEST-02). These are exactly the kinds of integration gaps that regression tests should catch — the type system allows optional fields, and the call site compiles fine while silently dropping data.
