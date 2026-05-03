# Plan 264 — Cycle 4 RPF (end-only) in-cycle fixes

Status: active

## Source

- `./.context/reviews/_aggregate-cycle4-rpf-end-only.md`
- Per-agent reviews under `./.context/reviews/*-cycle4-rpf-end-only.md`

## Fixes (all severity Low; gate clean before & after each fix)

### P264-01 / C4-RPF-01 — Slice customer email to schema column width

- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:90`
- **Before:** `const customerEmail = customerEmailRaw.slice(0, 320).toLowerCase();`
- **After:** `const customerEmail = customerEmailRaw.trim().slice(0, 255).toLowerCase();`
- **Why:** schema is `varchar(255)`; slicing to 320 would let MySQL strict mode reject 256-320 char emails as "Data too long for column", causing webhook 500s and Stripe retries indefinitely. Folds C4-RPF-01 + C4-RPF-05 (trim) into one site.
- **Verification:** Existing source-contract `cycle3-rpf-source-contracts.test.ts:86` matches `\.slice\(0, 320\)\.toLowerCase\(\)`. Update to `slice(0, 255)`. Add new assertion that the slice limit equals the schema column width (parsed from schema.ts).

### P264-02 / C4-RPF-02 — Defensive image-tier cross-check on webhook

- **File:** `apps/web/src/app/api/stripe/webhook/route.ts` (insert after the `imageId` validation block, before the SELECT for entitlement idempotency)
- **Add:**
  ```ts
  const [currentImage] = await db
      .select({ license_tier: images.license_tier })
      .from(images)
      .where(eq(images.id, imageId))
      .limit(1);
  if (currentImage && currentImage.license_tier !== tier) {
      console.warn('Stripe webhook: tier mismatch between Stripe metadata and current image tier', {
          sessionId,
          imageId,
          metadataTier: tier,
          currentTier: currentImage.license_tier,
      });
      // Behavior unchanged: still proceed with INSERT using metadata tier.
  }
  ```
- **Why:** if admin re-tiers an image between checkout and webhook delivery, the entitlement is recorded with stale metadata tier. Provides ops audit signal; behavior unchanged (no rejection).
- **Verification:** new test asserting source contains `currentImage.license_tier !== tier` and `console.warn` precedes any DB INSERT.

### P264-03 / C4-RPF-03 — Downgrade `'unpaid'` log to console.warn

- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:71-74`
- **Before:**
  ```ts
  console.error('Stripe webhook: rejecting non-paid session', { sessionId, paymentStatus: session.payment_status });
  ```
- **After:**
  ```ts
  // 'unpaid' is the documented async-paid happy path (ACH, OXXO, Boleto);
  // keep at warn so operator alerts are not noisy. 'no_payment_required'
  // is unexpected at this gate (zero-amount gate below should catch it
  // first) — escalate that to error.
  if (session.payment_status === 'unpaid') {
      console.warn('Stripe webhook: rejecting non-paid (async) session', { sessionId, paymentStatus: session.payment_status });
  } else {
      console.error('Stripe webhook: rejecting unexpected non-paid status', { sessionId, paymentStatus: session.payment_status });
  }
  ```
- **Why:** prevent PagerDuty noise on the documented async-paid happy path while keeping error-level alerting for unexpected statuses.
- **Verification:** new test asserting the `'unpaid'` branch uses `console.warn` and the `else` branch uses `console.error`.

### P264-04 / C4-RPF-04 — Refund-error mapping coverage (i18n + switch cases)

- **Files:**
  - `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:97-108` (mapErrorCode)
  - `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:36-46` (translation interface)
  - `apps/web/src/app/[locale]/admin/(protected)/sales/page.tsx:34-45` (pass-through)
  - `apps/web/messages/en.json` (sales section)
  - `apps/web/messages/ko.json` (sales section)
- **Add 3 i18n keys to `sales`:**
  - `refundErrorNotFound`: "This sale no longer exists. The list may be stale; refresh and try again."
  - `refundErrorInvalidId`: "Invalid sale ID. Please refresh the page and try again."
  - `refundErrorNoPaymentIntent`: "This Stripe session has no associated payment. Refund cannot be processed automatically."
- **Korean equivalents** (matching tone of existing keys).
- **Update `mapErrorCode`** to handle 'not-found', 'invalid-id', 'no-payment-intent'. 'unknown' falls through.
- **Verification:** test asserting `mapErrorCode` switch handles all 7 RefundErrorCode values explicitly OR falls through (test all 7 inputs).

### P264-05 / C4-RPF-05 — Trim customer email before slice

- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:90` (folded into P264-01)
- **Done as part of P264-01.**

### P264-06 / C4-RPF-06 — Parallelize realpath calls

- **File:** `apps/web/src/app/api/download/[imageId]/route.ts:133-134`
- **Before:**
  ```ts
  const resolvedUploadsDir = await realpath(uploadsDir).catch(() => uploadsDir);
  resolvedFilePath = await realpath(filePath);
  ```
- **After:**
  ```ts
  const [resolvedUploadsDir, _resolvedFilePath] = await Promise.all([
      realpath(uploadsDir).catch(() => uploadsDir),
      realpath(filePath),
  ]);
  resolvedFilePath = _resolvedFilePath;
  ```
- **Why:** independent fs round-trips run serially; trivial parallelization.
- **Verification:** new test asserting source contains `Promise.all` over the two realpath calls.

### P264-07 / C4-RPF-07 — Map two more Stripe error types

- **File:** `apps/web/src/app/actions/sales.ts:103-111`
- **Before:**
  ```ts
  if (e.type === 'StripeConnectionError' || e.type === 'StripeAPIError') return 'network';
  return 'unknown';
  ```
- **After:**
  ```ts
  if (e.type === 'StripeConnectionError' || e.type === 'StripeAPIError') return 'network';
  if (e.type === 'StripeAuthenticationError' || e.type === 'StripeRateLimitError') return 'network';
  return 'unknown';
  ```
- **Why:** these two error types currently collapse to 'unknown'; treating them as 'network' (a transient/operational issue) gives operators a more actionable signal. Both are recoverable: rotate key (auth) or wait (rate limit).
- **Verification:** new test asserting source maps both error types to 'network'.

### P264-08 / C4-RPF-08 — Pin row Refund button text while in-flight

- **File:** `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:226`
- **Before:**
  ```tsx
  {refundingId === row.id ? t.refunding : t.refundButton}
  ```
- **After:**
  ```tsx
  {t.refundButton}
  ```
- **Why:** in-flight feedback is on the AlertDialog confirm (`refundingId !== null` disables the action button); duplicating the text rotation on the row button is shadcn-discouraged.
- **Verification:** snapshot/regex test asserting source no longer toggles row button text on `refundingId`.

### P264-09 / C4-RPF-09 — `role="alert"` on errorLoad div

- **File:** `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:163-165`
- **Before:**
  ```tsx
  <div className="text-destructive text-sm">{t.errorLoad}</div>
  ```
- **After:**
  ```tsx
  <div role="alert" className="text-destructive text-sm">{t.errorLoad}</div>
  ```
- **Why:** screen-reader announcement for live error state.
- **Verification:** test asserting the source contains `role="alert"` adjacent to `t.errorLoad`.

### P264-10 / C4-RPF-10 — Document `LOG_PLAINTEXT_DOWNLOAD_TOKENS` in env example

- **File:** `apps/web/.env.local.example`
- **Add (with surrounding comment):**
  ```env
  # Cycle 2 RPF / P260-01: opt-in plaintext token logging for the manual
  # download-distribution workflow. When set to 'true', the Stripe webhook
  # writes a `[manual-distribution]` line to stdout containing the
  # plaintext download token + customer email so operators can email it
  # manually until the email pipeline ships. Default: not set (off).
  # See apps/web/README.md "Paid downloads" section for the operator workflow.
  # LOG_PLAINTEXT_DOWNLOAD_TOKENS=false
  ```
- **Why:** discoverable configuration for paid-downloads operators.
- **Verification:** test asserting the example file contains `LOG_PLAINTEXT_DOWNLOAD_TOKENS`.

### P264-11 / C4-RPF-11 — Source-contract tests for cycle 4 fixes

- **File (new):** `apps/web/src/__tests__/cycle4-rpf-source-contracts.test.ts`
- **Tests:**
  - P264-01: webhook source contains `slice(0, 255)` (NOT `slice(0, 320)`); customer_email column varchar matches.
  - P264-01: webhook source contains `.trim().slice(0, 255).toLowerCase()`.
  - P264-02: webhook contains `currentImage.license_tier !== tier` AND a `console.warn` after.
  - P264-03: webhook 'unpaid' branch uses `console.warn`; non-unpaid (else) branch uses `console.error`.
  - P264-04: sales-client `mapErrorCode` switch contains all 4 mapped codes ('already-refunded', 'charge-unknown', 'network', 'not-found' / 'invalid-id' / 'no-payment-intent') + default; en.json/ko.json contain new keys.
  - P264-06: download route source contains `Promise.all` over `realpath(uploadsDir)` and `realpath(filePath)`.
  - P264-07: sales.ts `mapStripeRefundError` maps `StripeAuthenticationError` and `StripeRateLimitError` to `'network'`.
  - P264-08: sales-client row button text is pinned to `t.refundButton` (not `refundingId === row.id ? ...`).
  - P264-09: sales-client `errorLoad` div has `role="alert"`.
  - P264-10: `.env.local.example` contains `LOG_PLAINTEXT_DOWNLOAD_TOKENS`.

## Order of execution (one commit per fix where feasible)

1. P264-01 (webhook slice + trim)
2. P264-03 (webhook unpaid warn)
3. P264-02 (webhook defensive tier check) — depends on P264-01 stability
4. P264-06 (download route Promise.all)
5. P264-07 (sales.ts error type mapping)
6. P264-04 (i18n + sales-client mapErrorCode)
7. P264-08, P264-09 (sales-client UI tweaks)
8. P264-10 (env example doc)
9. P264-11 (source-contract tests) — final commit; verifies all prior

## Gate plan

After every commit:
- `npm run lint`
- `npm run typecheck`
- `npm run lint:api-auth`
- `npm run lint:action-origin`
- `npm test`

Final: `npm run build` (per RUN CONTEXT gate list).

## Done when

- All P264-01..11 commits land.
- All gates pass on the final HEAD.
- Plan moves to plan/done/.
