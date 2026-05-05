# Cycle 17 Review Aggregate

Date: 2026-05-06
Cycles included: 17
Reviewers: code-reviewer, security-reviewer, perf-reviewer, test-engineer, critic, architect, debugger

## Aggregate Findings

### HIGH SEVERITY

None new in cycle 17. C16-HIGH-01 (SW metadata cache race) remains deferred.

---

### MEDIUM SEVERITY

**C17-MED-01: uploadImages omits EXIF caption hints from enqueueImageProcessing**
- **Files:** `apps/web/src/app/actions/images.ts` (lines 407-421)
- **Confidence:** High
- **Cross-agent agreement:** code-reviewer, test-engineer, critic, architect, debugger
- **Problem:** `uploadImages` calls `enqueueImageProcessing` without `camera_model` and `capture_date`, even though these values are available in `exifDb` (extracted at line 286). The bootstrap query (fixed in cycle 16) DOES pass these fields. Fresh uploads therefore lose EXIF hints for the `generateCaption` fire-and-forget hook, degrading caption quality.
- **Fix:** Pass `camera_model: exifDb.camera_model` and `capture_date: exifDb.capture_date` to `enqueueImageProcessing`.

**C17-MED-02: uploadImages omits iccProfileName from enqueueImageProcessing, breaking P3 AVIF tagging for fresh uploads**
- **Files:** `apps/web/src/app/actions/images.ts` (lines 407-421), `apps/web/src/lib/process-image.ts`
- **Confidence:** High
- **Cross-agent agreement:** code-reviewer, perf-reviewer, test-engineer, critic, architect, debugger
- **Problem:** `saveOriginalAndGetMetadata` returns `iccProfileName` (from Sharp ICC metadata), which controls whether AVIF derivatives are tagged as P3 or sRGB. `uploadImages` does NOT pass this to `enqueueImageProcessing`. The queue passes `job.iccProfileName` to `processImageFormats`, which defaults to `undefined` → `'srgb'`. All freshly uploaded wide-gamut images therefore get sRGB-tagged AVIF instead of P3, causing visible color degradation on P3 displays.
- **Fix:** Pass `iccProfileName: data.iccProfileName` to `enqueueImageProcessing`.

**C17-MED-03: iccProfileName is not persisted to DB, so bootstrap can never pass it**
- **File:** `apps/web/src/db/schema.ts`
- **Confidence:** High
- **Cross-agent agreement:** architect, critic
- **Problem:** The `images` table has no `icc_profile_name` column. Bootstrapped queue jobs can never receive `iccProfileName`, so server restarts permanently lose this metadata for all pending images. This is a structural gap that makes the bootstrap path permanently inferior to the upload path.
- **Fix:** Add `icc_profile_name` to the schema, persist it at upload time, and include it in the bootstrap query.

**C17-SEC-01: checkout route idempotency key collision when TRUST_PROXY is unset**
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts` (line 147)
- **Confidence:** Medium
- **Cross-agent agreement:** security-reviewer, debugger, critic
- **Problem:** When `TRUST_PROXY` is not set, `getClientIp` returns `'unknown'` for all requests. The checkout idempotency key becomes `checkout-<imageId>-unknown-<minute>`, which is identical for all users. Concurrent checkout attempts from different users for the same image within the same minute are deduplicated by Stripe, causing one user to receive another's session URL.
- **Fix:** Include a per-request nonce or session-derived identifier in the idempotency key.

---

### LOW SEVERITY

**C17-LOW-01: Service Worker networkFirstHtml timestamp validation gap**
- **File:** `apps/web/public/sw.js` (lines 162-169)
- **Confidence:** Medium
- **Cross-agent agreement:** code-reviewer, debugger
- **Problem:** If the `sw-cached-at` header is corrupted (returns NaN when parsed), `NaN > HTML_MAX_AGE_MS` is always `false`, so stale HTML is served indefinitely.
- **Fix:** Validate `!Number.isNaN(age)` before the age comparison.

**C17-LOW-02: withAdminAuth uses duck-typed header extraction**
- **File:** `apps/web/src/lib/api-auth.ts` (lines 53-58)
- **Confidence:** Medium
- **Cross-agent agreement:** security-reviewer
- **Problem:** Header resolution uses duck typing instead of instanceof checks. While the deny-by-default behavior of `hasTrustedSameOrigin` mitigates the risk, the pattern is fragile.
- **Fix:** Use explicit type narrowing (e.g., `request instanceof NextRequest`).

**C17-LOW-03: getImagesLitePage COUNT(*) OVER() may be expensive at scale**
- **File:** `apps/web/src/lib/data.ts` (line 694)
- **Confidence:** Low
- **Cross-agent agreement:** perf-reviewer
- **Problem:** Window function repeats total count on every row. Acceptable at current scale but may become a bottleneck beyond ~50k images.
- **Fix:** Monitor and consider separate count query if needed.

**C17-LOW-04: process-image.ts decimalToRational precision loss for values >= 1**
- **File:** `apps/web/src/lib/process-image.ts` (lines 832-839)
- **Confidence:** Low
- **Cross-agent agreement:** code-reviewer
- **Problem:** Exposure times >= 1s are rounded to 2 decimal places. Cosmetic only.
- **Fix:** Optional: use higher precision.

**C17-LOW-05: download route Content-Type is always application/octet-stream**
- **File:** `apps/web/src/app/api/download/[imageId]/route.ts` (line 241)
- **Confidence:** Low
- **Cross-agent agreement:** security-reviewer
- **Problem:** Original files are served with generic Content-Type. Mitigated by Content-Disposition: attachment and nosniff.
- **Fix:** Optional: map extensions to actual MIME types.

---

## Cross-Agent Agreement Summary

- C17-MED-01 (missing EXIF hints in upload): **6/7 agents** — near-universal agreement.
- C17-MED-02 (missing iccProfileName in upload): **6/7 agents** — near-universal agreement.
- C17-MED-03 (iccProfileName not in schema): **2/7 agents** — architecturally significant.
- C17-SEC-01 (checkout idempotency collision): **3/7 agents** — security-focused consensus.
- C17-LOW-01 (SW NaN age): **2/7 agents** — edge case but easily fixable.

## Agent Failures

None.

## Deferred Items (from prior cycles, still valid)

- **C16-HIGH-01:** SW metadata cache read-modify-write race condition — deferred, requires SW architecture refactor.
- **C16-LOW-03:** getRateLimitBucketStart truncates sub-second windows — deferred, all current windows are whole-second.
- **C16-LOW-04:** Service Worker caches non-image responses as images — deferred, requires Content-Type verification.
- **C16-LOW-05:** Analytics record functions don't validate entity existence — deferred, extra SELECTs would add latency.
