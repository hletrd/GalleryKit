# Debugger Review — Cycle 3 RPF (end-only)

Agent: debugger
Scope: failure-mode analysis. What could go wrong silently? Where do error paths leak?

## Findings

### C3RPF-DBG-HIGH-01 — Webhook silently swallows non-paid `checkout.session.completed`

- File: `apps/web/src/app/api/stripe/webhook/route.ts:57-94`
- Severity: **High** | Confidence: **High**
- **Failure mode:** Async-pay session fires the event with `payment_status: 'unpaid'`. Webhook stores entitlement, generates token, returns 200. No log signal differentiates this from a paid session. Operator has zero visibility into "did the customer actually pay?". Cross-listed with code-reviewer C3RPF-CR-HIGH-01.
- **Debug remedy:** Even before the gate lands, log `payment_status` on the structured info line so operators can audit historical webhook events.

### C3RPF-DBG-MED-01 — `download/route.ts` swallows the file-stream error type

- File: `apps/web/src/app/api/download/[imageId]/route.ts:154-160`
- Severity: **Medium** | Confidence: **High**
- **Code:**
  ```ts
  } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          return new NextResponse('File not found', { status: 404 });
      }
      console.error('Download stream error:', err);
      return new NextResponse('Internal Server Error', { status: 500 });
  }
  ```
- **Failure mode:** Permission errors (`EACCES`), disk-full (`ENOSPC`), I/O errors (`EIO`) all hit the generic 500 path with the same message. From the customer's perspective every infrastructure failure looks identical. Operators can't triage by error code without parsing the `console.error` output.
- **Debug remedy:** Log the `err.code` separately (`console.error('Download stream error', { code: errCode, sessionId: entitlement.sessionId })`); also map `EACCES` to a separate user-visible message.

### C3RPF-DBG-MED-02 — Refund action conflates "Stripe refund failed" with "DB update failed"

- File: `apps/web/src/app/actions/sales.ts:142-167`
- Severity: **Medium** | Confidence: **High**
- **Failure mode:** The try block wraps both `stripe.refunds.create` AND `db.update(entitlements)`. If the Stripe refund succeeds but the DB update fails, the action returns an error and the customer's row still has `refunded=false` AND a non-null `downloadTokenHash`. The customer can still download. The photographer's books say "no refund". The Stripe dashboard says "refund issued". Reconciliation hell.
- **Debug remedy:** Either split the try into two sequential blocks with discrete error handling and compensating actions, OR persist `stripe_refund_id` after the Stripe call and re-attempt the DB update.
- This is a pre-existing issue, not a cycle 3 regression. Promoted to medium because it directly affects revenue accounting.

### C3RPF-DBG-LOW-01 — `verifyTokenAgainstHash` returns `false` on every malformed-storedHash case but only logs once

- File: `apps/web/src/lib/download-tokens.ts:53-58`
- Severity: **Low** | Confidence: **High**
- **Failure mode:** The `console.warn` fires on every download attempt against a malformed hash. If a single corrupted row is being repeatedly hit (e.g., a customer keeps clicking the URL), the log floods. Also: the warn doesn't include the entitlement ID, so operators cannot identify which row is corrupted.
- **Debug remedy:** Pass the entitlement ID into `verifyTokenAgainstHash` (or move the shape check into the route where the ID is available). Once-per-row log dedup is overkill; including the ID is enough.

### C3RPF-DBG-LOW-02 — Webhook missing-metadata branch logs only presence flags, not the offending session

- File: `apps/web/src/app/api/stripe/webhook/route.ts:84-92`
- Severity: **Low** | Confidence: **High**
- **Failure mode:** When a metadata field is missing the log line shows `hasImageIdStr: false, hasTier: true, ...` but does NOT include the `sessionId`. Operators cannot easily look up the offending session in the Stripe dashboard.
- **Debug remedy:** Add `sessionId: sessionId ?? '<missing>'` to the structured log payload. Cheap.

### C3RPF-DBG-LOW-03 — `Stripe refund failed:` log line dumps the raw error

- File: `apps/web/src/app/actions/sales.ts:161`
- Severity: **Low** | Confidence: **High**
- **Failure mode:** `console.error('Stripe refund failed:', err)` dumps the entire error object. In structured-log environments the object is JSON-stringified. The Stripe error contains the original request body, which may include payment_intent metadata. Mostly safe but worth noting.
- **Debug remedy:** Log only `{ entitlementId, code, type, message }` from the error.

### C3RPF-DBG-LOW-04 — `getTotalRevenueCents` swallows all DB errors as "Failed to calculate revenue"

- File: `apps/web/src/app/actions/sales.ts:87-89`
- Severity: **Low** | Confidence: **High** (and item is destined for deletion per CRITIC-05)
- **Failure mode:** Any DB error returns the same message. Operators cannot distinguish a transient blip from a schema regression.
- **Debug remedy:** When the action is deleted (per CRITIC-05), this becomes moot.

## Cross-cutting

The Stripe paid-downloads flow has multiple try/catch blocks that conflate distinct failure modes. The cleanest debug fix is a small `lib/stripe-errors.ts` that maps Stripe error codes to a discriminated union. The mapStripeRefundError function (sales.ts) already does this for refunds; extend the pattern to webhook insert errors and download stream errors.
