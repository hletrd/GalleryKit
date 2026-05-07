# Debugger — Cycle 7 RPF (end-only)

## Inventory

- Stripe error paths and triage signals

## Findings

### C7-RPF-DBG-01 — Five log lines lack correlation keys for triage

- Files:
  - `checkout/[imageId]/route.ts:165` — no imageId/ip
  - `webhook/route.ts:67` — no event.id (signature failure pre-parse, so
    not always available; but the request-id from Stripe headers IS
    available via `request.headers.get('stripe-event-id')` if Stripe set it)
  - `webhook/route.ts:309` — no sessionId/imageId/tier
  - `sales.ts:70` — no caller
  - `sales.ts:214` — no entitlementId
- Severity: **Low** | Confidence: **High**
- **What:** When a Stripe outage causes a flurry of failures, the operator
  needs to bucket failures by entity (sessionId, imageId, entitlementId).
  Five lines force the operator to back-fill from other context. Each is
  individually small, but cumulatively the time-to-triage doubles.
- **Fix:** Add the structured object with the available correlation keys
  (see CR-01..CR-05 in code-reviewer review).

### C7-RPF-DBG-02 — Webhook signature-verify error: log signature length only

- File: `apps/web/src/app/api/stripe/webhook/route.ts:67`
- Severity: **Low** | Confidence: **Low**
- **What:** A signature failure could be a malformed signature header (length
  0, length truncated, missing 't=' / 'v1=' parts). Logging only `err` swallows
  this. A small enrichment: log `signatureLength: signature.length` so
  operators can distinguish "header missing" (already handled separately) from
  "header malformed/truncated".
- **Fix:** Convert to
  `console.error('Stripe webhook signature verification failed', { signatureLength: signature.length, err })`.

## Reproduction recipes

For C7-RPF-DBG-01:
1. Trigger a Stripe-side error (e.g., revoke key) to see what fields are
   present in the log. Confirm the positional form omits sessionId.
2. Convert to structured form. Confirm sessionId is now grep-able.
