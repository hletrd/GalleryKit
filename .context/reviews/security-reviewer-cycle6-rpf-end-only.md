# security-reviewer — Cycle 6 RPF (end-only)

## Method

Threat-model pass over Stripe surfaces (checkout, webhook, refund,
download token), action-origin guards, rate limiting, and admin-route
authentication.

## Findings

### SEC-01 — Stripe Checkout session creation lacks Idempotency-Key
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:123`
- **Severity:** Low | Confidence: High
- **What:** `stripe.checkout.sessions.create({...})` POSTs without an
  Idempotency-Key. Cycle 5 P388-01 added one to `stripe.refunds.create`;
  this is the parallel public-facing route. Without it, an attacker
  hitting the rate-limit-bypass (e.g., a botnet across many IPs each
  doing 10 checkouts/min within budget) can multiply Stripe API calls
  by N for free, since Stripe's rate-limit per-key is the actual bound,
  not our per-IP budget.
- **Risk:** low (admin pays Stripe API budget, customer experience is
  identical), but adding the idempotency key is a single-line defensive
  measure that matches Stripe SDK best-practice docs.
- **Fix:** pass `{ idempotencyKey: \`checkout-${image.id}-${ip}-${Math.floor(Date.now() / 60_000)}\` }`
  as the second arg.

### SEC-02 — Webhook: `console.error('...invalid imageId in metadata', imageIdStr)` leaks user-controlled string
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:195`
- **Severity:** Informational | Confidence: High
- **What:** When `parseInt(imageIdStr, 10)` fails, the handler logs the
  raw `imageIdStr` (which came from `session.metadata.imageId` — set by
  whoever created the Checkout session, but Stripe metadata is itself
  size-bounded so the universe is small). Operationally, the string is
  bounded; risk is informational only. The fix is to wrap into a
  structured-object log with sessionId + imageIdStr so an operator can
  trace which session triggered the reject. (See code-reviewer CR-01.)
- **Risk:** very low — Stripe metadata values are length-capped at 500
  chars by Stripe; impossible to inject log-shipper escape sequences
  beyond what already passes the JSON encoder. Not a vector for log
  injection in any modern shipper.
- **Fix:** see CR-01.

### SEC-03 — Download route: `Content-Disposition` filename is doubly-quoted but no RFC-6266 `filename*=UTF-8''...` fallback
- **File:** `apps/web/src/app/api/download/[imageId]/route.ts:185-192`
- **Severity:** Low | Confidence: Medium
- **What:** The route renames the download to `photo-${imageId}${safeExt}`
  for the Content-Disposition header. `safeExt` is sanitized to
  `[a-zA-Z0-9.]` and length-capped at 8, then defaults to `.jpg`. So the
  filename is always pure ASCII. RFC-6266 quoting is fine here. No fix
  needed — just verifying defense is intact.
- **Status:** confirmed safe. No finding; informational only.

### SEC-04 — `requireSameOriginAdmin` returns user-visible string on failure
- **File:** `apps/web/src/lib/action-guards.ts:42`
- **Severity:** Informational | Confidence: High
- **What:** The helper returns `t('unauthorized')` from the
  `serverActions` namespace. The string is user-visible (shows up as
  toast text). No information leakage — just a localized "unauthorized"
  message. Defense remains intact: the action returns BEFORE any DB
  mutation when the same-origin check fails.
- **Status:** confirmed safe.

### SEC-05 — Refund action: error message exposes Stripe `err.message`
- **File:** `apps/web/src/app/actions/sales.ts:202`
- **Severity:** Low | Confidence: Medium
- **What:** `err instanceof Error ? err.message : 'Refund failed'` —
  Stripe error messages can include request IDs (req_xxx). The doc
  block at line 88-93 explicitly says "only the mapped identifier
  crosses the action boundary to the client". The current code returns
  `err.message` in the `error` field anyway. No client uses it now
  (`mapErrorCode` reads `errorCode`, not `error`), so the leak is
  latent — but a future careless client log could expose it.
- **Risk:** low; data-flow analysis shows no client surface uses the
  field. The fix is to remove the `error` field from the failure return
  path so the comment matches the code.
- **Fix:** see code-reviewer CR-03.

### SEC-06 — Webhook: `LOG_PLAINTEXT_DOWNLOAD_TOKENS` opt-in still uses template-literal log
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:313-318`
- **Severity:** Informational | Confidence: High
- **What:** The opt-in plaintext-token log uses `console.info(`...token=${downloadToken}`)`
  format (template literal, single string). This is by design — operators
  `grep` for the prefix `[manual-distribution]` and copy-paste the line
  to email. Converting to structured form would break the operator
  workflow. Keep as-is.
- **Status:** intentional and documented. No fix.

## Cycle 1-5 carry-forward verification

- **Webhook signature verification:** intact at line 65.
- **Path traversal containment in download route:** intact at lines
  121, 141.
- **Symlink reject in download route:** intact at line 129.
- **Constant-time token compare:** intact at `verifyTokenAgainstHash`.
- **Email shape regex (post-truncation):** intact at line 159.
- **PII redaction in error logs:** intact (line 169, 173 omit
  `customerEmail` from log).
- **Rate-limit bypass via X-Forwarded-For:** intact (only trusted when
  `TRUST_PROXY=true`).
- **Admin DB download containment:** intact (realpath + startsWith).

All cycle 1-5 security claims hold in current source.
