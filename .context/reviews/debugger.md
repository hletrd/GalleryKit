# Cycle 17 Debugger Review — debugger

Date: 2026-05-06
Scope: Full repository, post-cycle-16 state
Focus: Latent bug surface, failure modes, regressions

## Findings

### MEDIUM SEVERITY

**C17-DEBUG-01: Fresh uploads silently produce wrong AVIF colorspace**
- **File:** `apps/web/src/app/actions/images.ts` (lines 407-421)
- **Confidence:** High
- **Failure scenario:**
  1. Admin uploads a photo taken with an iPhone (Display P3 ICC profile).
  2. `saveOriginalAndGetMetadata` correctly detects `iccProfileName = 'Display P3'`.
  3. `uploadImages` does NOT pass this to `enqueueImageProcessing`.
  4. Queue calls `processImageFormats` with `iccProfileName = undefined`.
  5. `resolveAvifIccProfile(undefined)` returns `'srgb'`.
  6. AVIF derivative is encoded as 8-bit sRGB instead of 10-bit P3.
  7. Result: colors are gamut-clipped and appear washed out on P3 displays.
  8. The bug is silent — no error is logged, and the image appears "processed" in the admin dashboard.
- **Detection:** Only visible on wide-gamut displays (modern Macs, iPhones) when comparing original vs derivative side-by-side. Most users might not notice.

**C17-DEBUG-02: Caption generation hints missing for fresh uploads**
- **File:** `apps/web/src/app/actions/images.ts` (lines 407-421)
- **Confidence:** High
- **Failure scenario:**
  1. Admin uploads a photo with EXIF containing camera_model = "Canon EOS R5" and capture_date = "2024-06-15".
  2. `extractExifForDb` extracts these values.
  3. `uploadImages` inserts them into DB but does NOT pass them to `enqueueImageProcessing`.
  4. `generateCaption` receives `{ camera_model: undefined, capture_date: undefined }`.
  5. Caption quality degrades because the generator lacks EXIF context.
  6. Result: generic captions like "A photo of a landscape" instead of "Sunset landscape taken with Canon EOS R5 in June 2024".

### LOW SEVERITY

**C17-DEBUG-03: Service Worker stale HTML on corrupted cache**
- **File:** `apps/web/public/sw.js` (lines 162-169)
- **Confidence:** Low
- **Failure scenario:**
  1. A cache entry's `sw-cached-at` header is corrupted (e.g., by a browser extension, manual Cache API manipulation, or a storage bug).
  2. `Number(dateHeader)` returns `NaN`.
  3. `age > HTML_MAX_AGE_MS` evaluates to `false` (NaN comparison).
  4. Stale HTML is served indefinitely, potentially showing outdated gallery content.
  5. The only recovery is manual cache clearing or waiting for a new SW version to purge old caches.

**C17-DEBUG-04: checkout idempotency key collision under TRUST_PROXY=false**
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts` (line 147)
- **Confidence:** Low
- **Failure scenario:**
  1. Deployment does not set TRUST_PROXY=true.
  2. Two different visitors click "Buy" on the same image within the same minute.
  3. Both requests get IP = 'unknown'.
  4. Both generate identical idempotency key: `checkout-<imageId>-unknown-<minute>`.
  5. Stripe deduplicates and returns the same Checkout session URL to both visitors.
  6. One visitor completes payment; the other's session is tied to the first visitor's Stripe customer.
  7. Result: confusion, potential double-charge or misattributed sale.

## Verdict

The most insidious bugs are C17-DEBUG-01 and C17-DEBUG-02 because they are silent correctness failures — no errors are thrown, and the system appears to work normally while producing degraded output. These are exactly the types of issues that integration tests with mocked dependencies should catch.
