# Cycle 17 Critic Review — critic

Date: 2026-05-06
Scope: Full repository, post-cycle-16 state
Focus: Multi-perspective critique of the whole change surface

## Findings

### MEDIUM SEVERITY

**C17-CRIT-01: Two producer sites for ImageProcessingJob have diverged again**
- **Files:** `apps/web/src/app/actions/images.ts` (upload path), `apps/web/src/lib/image-queue.ts` (bootstrap path)
- **Confidence:** High
- **Problem:** Cycle 16 fixed the bootstrap query to include `camera_model` and `capture_date`. However, the upload path (`uploadImages`) was NOT updated to match. This is a classic multi-site maintenance failure: fixing one call site while leaving another silently broken. The EXIF hints now work for server-restarted images but not for freshly uploaded ones. Worse, `iccProfileName` is missing from BOTH paths (not in DB schema, so bootstrap can't pass it; not passed by upload, so fresh uploads lose it).
- **Fix:** Audit every call site of `enqueueImageProcessing` and ensure they all pass the same complete set of available fields. Consider making the `ImageProcessingJob` type stricter (fewer optionals) for fields that are always available at enqueue time.

**C17-CRIT-02: The iccProfileName vs color_space duality is confusing**
- **Files:** `apps/web/src/lib/process-image.ts`, `apps/web/src/db/schema.ts`
- **Confidence:** Medium
- **Problem:** `extractExifForDb` populates `color_space` from EXIF ColorSpace tag values (1=sRGB, 65535=Uncalibrated). Separately, `saveOriginalAndGetMetadata` extracts `iccProfileName` from Sharp's ICC metadata. These two fields represent similar concepts but come from different sources and have different precision. `color_space` is persisted to DB; `iccProfileName` is NOT. The queue uses `iccProfileName` for AVIF P3 tagging but never falls back to `color_space`.
- **Fix:** Either persist `iccProfileName` to the DB (so bootstrap can use it) or harmonize the two fields into a single canonical colorspace representation.

### LOW SEVERITY

**C17-CRIT-03: Service Worker still has deferred high-severity finding**
- **File:** `apps/web/public/sw.js`
- **Confidence:** High
- **Problem:** C16-HIGH-01 (metadata cache read-modify-write race) was deferred with rationale "SW is a PWA enhancement, not core gallery functionality." While true, the SW is shipped in production and the race condition is real. The LRU eviction can exceed its 50 MB budget, and in extreme cases the cache could grow unbounded until browser quota eviction kicks in.
- **Fix:** Consider a lightweight fix (e.g., per-URL metadata keys in Cache API) rather than a full refactor.

**C17-CRIT-04: idempotency key in checkout uses client-controlled IP**
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts` (line 147)
- **Confidence:** Medium
- **Problem:** When `TRUST_PROXY` is not set, `getClientIp` returns `'unknown'` for ALL requests. The checkout idempotency key collapses all users into a single key per image per minute. Two different legitimate buyers could race each other and one would receive the other's Stripe Checkout session URL.
- **Fix:** Include a cryptographically random nonce or a session identifier in the idempotency key.

## Verdict

The codebase is mature and well-hardened, but the recurring pattern of "fix one call site, miss another" suggests the need for stronger integration tests around cross-module data flows. The `ImageProcessingJob` type has optional fields that encourage silent omissions.
