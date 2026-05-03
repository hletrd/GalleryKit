# test-engineer — Cycle 6 RPF (end-only)

## Method

Test-coverage review of cycle 1-5 fixes plus identification of cycle 6
test gaps.

## Gate baseline

- `npm test` — **979 passed, 110 files**, 0 failures (vitest 4.1.4).
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm run lint:api-auth` — clean.
- `npm run lint:action-origin` — clean.
- `npm run build` — clean.
- `npm run test:e2e` — DEFERRED (no MySQL in environment).

## Findings

### TEST-01 — Cycle 6 fixes need source-contract tests (parallel to cycle 5)
- **File:** new file `apps/web/src/__tests__/cycle6-rpf-source-contracts.test.ts`
- **Severity:** Low | Confidence: High
- **What:** Cycle 5 introduced source-contract tests because behavior
  tests for Stripe + DB paths require fakes. Cycle 6's findings are the
  same shape (idempotency-key on checkout, structured-object log line
  on imageId reject). They need the same source-text guard so a future
  revert is caught at CI time.
- **Coverage required:**
  - C6-RPF-01: `stripe.checkout.sessions.create(` followed by
    `idempotencyKey:` in the same call.
  - C6-RPF-02: `console.error` for invalid imageId uses structured
    object with `sessionId` and `imageIdStr`.
  - C6-RPF-03: refund action's catch path drops `err.message` from the
    `error` field (or removes the field entirely).
  - C6-RPF-04: webhook oversized email reject log includes `cap` field.
  - C6-RPF-05: `mapStripeRefundError` unknown branch emits a warn (or
    documented absence).

### TEST-02 — Behavior test for `mapStripeRefundError` still deferred
- **File:** existing C5-RPF-D05.
- **Status:** carry-forward, no new finding.

### TEST-03 — `cycle5-rpf-source-contracts.test.ts` still references P388 numbering
- **File:** `apps/web/src/__tests__/cycle5-rpf-source-contracts.test.ts:8-22`
- **Severity:** Informational | Confidence: High
- **What:** Cosmetic; commits used P266 numbering. No functional impact.

### TEST-04 — E2E suite skipped this cycle
- **File:** `apps/web/playwright.config.ts`
- **Severity:** Informational
- **What:** carry-forward C5-RPF-D12. The cycle prompt's GATES list
  includes `npm run test:e2e`, but the cycle environment lacks MySQL
  + `.env.local` to start the dev server. Per cycle prompt: "e2e may
  be blocked by environmental MySQL absence — pre-existing, not a
  regression. Document but don't treat as ERROR."

## Cycle 1-5 test claims verified

- 979 tests pass (cycle 5 added ~10 new contracts).
- All cycle 5 P388-* contracts survive in source.
- Run reproducible at `npm test`.
