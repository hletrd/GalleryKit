# Test Engineer Review — Cycle 3 RPF (end-only)

Agent: test-engineer
Scope: gap analysis on test coverage for cycles 1-2 RPF deltas + cycle 3 findings.

## Inventory

- 107 test files, 937 tests passing.
- Cycle 2 RPF added: `license-tiers.test.ts`, `refund-clears-download-token.test.ts`, `stripe-webhook-source.test.ts`.

## Coverage gaps for cycle 3

### C3RPF-TEST-MED-01 — No test asserts `payment_status` gate (does not exist yet)

- Severity: **Medium** | Confidence: **High**
- Once the cycle 3 fix lands (C3RPF-CR-HIGH-01), add a source-contract test in `stripe-webhook-source.test.ts` that asserts the webhook source contains the gate `payment_status !== 'paid'` BEFORE the `db.insert(entitlements)` call.
- **Fix:** Add to `stripe-webhook-source.test.ts`.

### C3RPF-TEST-MED-02 — No test asserts `amount_total <= 0` rejection

- Severity: **Medium** | Confidence: **High**
- Same shape as above; assert the source contains a positive-amount guard before INSERT.
- **Fix:** Add to `stripe-webhook-source.test.ts`.

### C3RPF-TEST-MED-03 — No test for `Content-Disposition` filename safety

- Severity: **Medium** | Confidence: **High**
- The download route's `downloadName` interpolation is admin-controlled via `image.filename_original` extension. Add a test that asserts the route source contains a sanitization step before interpolating into `Content-Disposition`.
- **Fix:** Add a source-contract test in a new `download-route-content-disposition.test.ts` (or extend existing) that asserts the source slices/sanitizes `ext` before the template literal.

### C3RPF-TEST-MED-04 — No test asserts the lstat-before-claim ordering (post-fix)

- Severity: **Medium** | Confidence: **High**
- After C3RPF-CR-MED-04 lands, add a source-contract test asserting `lstat(filePath)` appears BEFORE `db.update(entitlements).set({ downloadedAt:` in `download/[imageId]/route.ts`.
- **Fix:** Add to existing `serve-upload.test.ts` or a new `download-route-claim-order.test.ts`.

### C3RPF-TEST-LOW-01 — Webhook unsigned-request test is missing

- Severity: **Low** | Confidence: **High**
- See critic CRITIC-08. Add a fixture-based test that POSTs without `stripe-signature` and asserts 400.
- **Fix:** New test file `stripe-webhook-signature.test.ts` (behavioral, not source).

### C3RPF-TEST-LOW-02 — `formatCents` and `computeStatus` not unit-tested

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx`
- Severity: **Low** | Confidence: **High** (already C2-RPF-D16)
- The C2-deferred refactor was not actioned. Sales-client logic only exercised through e2e/UI integration. The deferral is fine as-is, but locking via source-contract test is cheap.

### C3RPF-TEST-LOW-03 — `expiresAt` TZ roundtrip test missing

- File: `apps/web/src/db/schema.ts`
- Severity: **Low** | Confidence: **High** (already C2-RPF-D10)
- Documented but not implemented.

### C3RPF-TEST-LOW-04 — `RefundErrorCode` union completeness test missing

- File: `apps/web/src/app/actions/sales.ts:101-118`
- Severity: **Low** | Confidence: **High**
- Cross-listed with architect C3RPF-ARCH-LOW-05.

### C3RPF-TEST-LOW-05 — `STRIPE_SECRET_KEY` shape test missing

- File: `apps/web/src/lib/stripe.ts`
- Severity: **Low** | Confidence: **Medium**
- After security C3RPF-SEC-LOW-05 fix lands, add a test that imports `getStripe`, sets `STRIPE_SECRET_KEY=garbage`, and asserts a thrown error.

### C3RPF-TEST-LOW-06 — `Customer_email` lowercasing test missing

- File: `apps/web/src/app/api/stripe/webhook/route.ts:66-67`
- Severity: **Low** | Confidence: **High**
- After security C3RPF-SEC-LOW-02 fix lands, add a source-contract test.

## Test plan summary

For cycle 3 in-cycle fixes, add the following tests:
1. Source-contract: `payment_status` gate (TEST-MED-01).
2. Source-contract: positive-amount gate (TEST-MED-02).
3. Source-contract: filename sanitization (TEST-MED-03).
4. Source-contract: lstat-before-claim ordering (TEST-MED-04).
5. Source-contract: customerEmail lowercasing (TEST-LOW-06).

Defer:
- Behavioral webhook signature test (TEST-LOW-01) — ride along with phase 2 email pipeline.
- `formatCents`/`computeStatus` extraction (TEST-LOW-02) — already deferred.
- TZ roundtrip (TEST-LOW-03) — already deferred.
- `RefundErrorCode` completeness (TEST-LOW-04) — defer until next refund-error-code addition.
- `STRIPE_SECRET_KEY` shape (TEST-LOW-05) — defer with C3RPF-SEC-LOW-05.
