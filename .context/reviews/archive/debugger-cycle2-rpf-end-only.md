# Debugger — Cycle 2 RPF (end-only)

## Method

Latent bug surface, failure modes, and regression risks across the
paid-tier subsystem.

## Findings

### C2RPF-DBG-MED-01 — `affectedRows` shape-fallback in download route can mask single-use bypass
- File: `apps/web/src/app/api/download/[imageId]/route.ts:96-106`
- Severity: Medium | Confidence: Medium
- **What:** The cast `as unknown as Array<{ affectedRows?: number }>`
  with optional-chained access and `?? 1` fallback was added to be
  resilient to drizzle MySQL driver shape changes. The fallback
  `?? 1` means "if anything looks unusual, allow the download." For
  a SECOND download with the same token, the prior atomic UPDATE
  would have already cleared `downloadTokenHash` (line 92), so the
  `verifyTokenAgainstHash` check at line 70 would fail before reaching
  this UPDATE — the line-70 guard blocks the practical bypass.
  However, if a future refactor moves the hash-clear out of the same
  atomic UPDATE (e.g., separating "claim" from "invalidate"), the
  fallback would silently allow a re-use. The defensive fallback is
  correct *for now* but assumes the line-70 guard never moves.
- **Fix (planned, low-effort):** Replace the cast+fallback with an
  explicit `Array.isArray(result) && typeof result[0]?.affectedRows
  === 'number' ? result[0].affectedRows === 1 : false` boolean. If
  the shape is unrecognized, return 500 ("internal error reading DB
  result") instead of allowing the download. Tightens the contract
  and adds a log line for ops to spot driver changes.

### C2RPF-DBG-LOW-01 — `verifyTokenAgainstHash` returns false for malformed hex but does not log
- File: `apps/web/src/lib/download-tokens.ts:46-52`
- Severity: Low | Confidence: High
- **What:** `Buffer.from(s, 'hex')` silently truncates at the first
  non-hex char. A storedHash that was clipped during a backup/restore
  or a partial migration would compare as a different-length buffer,
  return false, and the route returns 403. No log line. Operators
  cannot distinguish "attacker submitting wrong token" from "data
  corruption" — both look the same.
- **Fix (planned):** Add a `^[0-9a-f]{64}$` validation on storedHash
  with a `console.warn('[download-tokens] storedHash malformed')`
  when the validation fails. Restores diagnosability.

### C2RPF-DBG-LOW-02 — Refund flow's Stripe error message is shown verbatim to admin
- File: `apps/web/src/app/actions/sales.ts:135` and `sales-client.tsx:57`
- Severity: Low | Confidence: High
- **What:** `return { error: err instanceof Error ? err.message : 'Refund failed' }` →
  surfaced as `${t.refundError}: ${result.error}` in a toast. Stripe
  errors carry messages like `"This charge has already been refunded.
  request_id: req_xxx"` which leak the Stripe-internal request id.
  Not a security bug per se, but a localization/UX gap and an
  observability surface that's better in server logs than UI toasts.
- **Fix (planned):** Map known Stripe error codes to localized strings;
  log full error server-side; return only the localized message.

### C2RPF-DBG-LOW-03 — Webhook returns 200 on `Number.isFinite` failure but doesn't roll back rate-limit context
- File: `apps/web/src/app/api/stripe/webhook/route.ts:96-99`
- Severity: Informational | Confidence: High
- **What:** `parseInt(imageIdStr, 10)` can return NaN if the metadata
  is malformed. The route returns 200 to stop Stripe retrying. There's
  no rate limit on this endpoint (correctly — Stripe is the trusted
  caller). No bug, just confirming.

### C2RPF-DBG-LOW-04 — `entitlements.expiresAt` is a `timestamp` column without timezone semantics
- File: `apps/web/src/db/schema.ts:260` + `webhook/route.ts:107`
- Severity: Low | Confidence: High
- **What:** MySQL `timestamp` stores in UTC and returns in connection
  TZ. The expiresAt value is set via `new Date(Date.now() + 24h)`,
  which is a UTC milliseconds offset, then drizzle persists it via
  the connection. The download route compares
  `new Date() > new Date(entitlement.expiresAt)`. If the connection
  TZ is not UTC, `entitlement.expiresAt` may come back as a local
  time string that `new Date()` parses as the *server's* local TZ —
  off by ~hours. Existing infra suggests the connection TZ is set to
  UTC (Docker default), but this should be confirmed in a unit test.
- **Fix (deferred):** Add a unit test asserting that `expiresAt` round-
  trips through the DB without TZ drift. Or migrate to `bigint` /
  `int` for unix-seconds storage to avoid TZ ambiguity entirely.

### C2RPF-DBG-LOW-05 — `Stripe-Signature` header read pattern matches `nextRequest.headers.get` but underscoring inconsistencies are possible
- File: `apps/web/src/app/api/stripe/webhook/route.ts:35`
- Severity: Informational | Confidence: High
- **What:** `request.headers.get('stripe-signature')` — Next.js Headers
  API is case-insensitive for HTTP headers, matching spec. Stripe
  emits `Stripe-Signature` with capital S. Confirmed safe.

## Sweep for commonly-missed issues

Checked: deadlock between webhook insert and admin refund (no — different
WHERE clauses, both are short-running, MySQL handles); silent string
coercion of imageId in URL params (Number.isFinite + parseInt + sign
check is robust); race between two webhooks for the same sessionId
(handled by UNIQUE constraint + onDuplicateKeyUpdate). No new high
findings.
