# debugger — cycle 5 RPF (end-only)

## Method

Trace failure modes through the Stripe paid-download flow. Look for
unhandled error paths and edge cases that could surface as production
incidents.

## Findings

### DBG-01 — Refund mutation: double-click in browser produces two requests

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:130-149`
- Severity: **Low** | Confidence: **Medium**
- The `handleRefund` function checks `refundingId !== null` to early-return
  on a re-entry, BUT before `setRefundingId(id)` lands, two near-simultaneous
  clicks can both pass the check. React batches setState; the early-return
  guard relies on synchronous state read which is stale.
- **Failure scenario:** admin double-clicks the AlertDialog confirm button.
  Two `refundEntitlement(id)` calls fire in parallel. First completes the
  refund. Second hits `row.refunded === true` and returns
  `'already-refunded'` errorCode → toast "This charge was already
  refunded." which is confusing because the original refund DID succeed.
- **Fix:** add Stripe-side `Idempotency-Key` (rolled into ARCH-01).
  Browser-side, the `disabled={refundingId !== null}` on the
  AlertDialogAction (line 298) already protects against the double-click
  AT the dialog button level. Race window is microseconds.

### DBG-02 — Webhook tier-mismatch warn does NOT fail closed

- File: `apps/web/src/app/api/stripe/webhook/route.ts:172-179`
- Severity: **Informational** | Confidence: **High**
- Cycle 4 P264-02 says the cross-check "is an audit signal only so
  operators can spot the drift" — code matches: warn-log only, no behavior
  change. Customer paid for X tier per Stripe metadata, gets X tier
  entitlement. Correct posture.

### DBG-03 — `LIMIT 500` on listEntitlements means revenue computed in UI undercounts after 500 entries

- File: `apps/web/src/app/actions/sales.ts:32-52, sales-client.tsx:162-165`
- Severity: **Low** | Confidence: **High**
- After 500 sales, the sales page caps to most-recent 500 rows. The
  revenue total at the top is computed FROM THOSE 500 only, so it shows
  "revenue from the last 500 sales", not all-time revenue. This is
  semantically correct for the displayed table but visually misleading
  (operators expect a "total revenue" label to be all-time).
- **Failure scenario:** post-500-sales, the displayed total is incorrect
  for "all-time" interpretation.
- **Fix:** rename the label to "Recent revenue" or "Revenue (last 500)"
  OR add pagination.
- Scheduled in cycle 4 deferred D08; carry forward.

### DBG-04 — `mapStripeRefundError` does not catch Promise rejections of non-Error type

- File: `apps/web/src/app/actions/sales.ts:103-104`
- Severity: **Low** | Confidence: **Medium**
- If the Stripe SDK ever throws a string or object, `instanceof Error`
  is false → returns `'unknown'`. The Stripe SDK does always throw
  Errors, but defense-in-depth would also handle non-Error throws.
  Already noted by code-reviewer CR-01.
- No additional action beyond CR-01.

## Confidence summary

| Finding  | Severity | Confidence | Schedule |
|----------|----------|------------|----------|
| DBG-01   | Low      | Medium     | This cycle (rolled into ARCH-01) |
| DBG-02   | Info     | High       | No action |
| DBG-03   | Low      | High       | Defer (carry forward C4-RPF-D08) |
| DBG-04   | Low      | Medium     | This cycle (rolled into CR-01) |
