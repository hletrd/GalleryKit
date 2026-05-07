# security-reviewer — cycle 5 RPF (end-only)

## Method

Threat-modeled the Stripe checkout → webhook → token-mint → download chain
for the post-cycle-4 source. Verified cycle 1-4 hardenings still in place.

## Findings

### SEC-01 — Refund mutation has no idempotency key on the Stripe call

- File: `apps/web/src/app/actions/sales.ts:150`
- Severity: **Low** | Confidence: **High**
- Stripe Idempotency-Key is industry standard for refund mutations. While
  the entitlement row already prevents double-refund database-side
  (`row.refunded` check at line 139), a network race between admin
  click and DB commit could in principle land two POSTs at Stripe.
  Stripe will reject the second (already_refunded), but adding the
  idempotency key formalizes the guarantee.
- **Threat:** double-refund or accidental over-credit (in practice
  Stripe blocks). Severity-Low because Stripe is the source of truth.
- **Fix:** pass `{ idempotencyKey: \`refund-${entitlementId}\` }` to
  `stripe.refunds.create`.

### SEC-02 — `customer_email` not validated for length BEFORE `EMAIL_SHAPE` regex on a misconfigured Stripe metadata path

- File: `apps/web/src/app/api/stripe/webhook/route.ts:108-124`
- Severity: **Low** | Confidence: **Medium**
- Cycle 4 P264-01 set the slice to 255 to match column width. But the
  `EMAIL_SHAPE` regex runs AFTER the slice. If the original email was
  e.g. 1000 characters (Stripe shouldn't send this, but a malicious
  upstream could), the regex now runs against the 255-char-truncated
  body, which could pass the regex with a malformed local part because
  the truncation cut mid-domain. Then the slice-truncated value is
  persisted.
- **Threat:** a 1000-char email truncated mid-domain to 255 chars would
  not match `EMAIL_SHAPE` (it requires `@` and `.` in the truncated
  body), so most cases are still rejected. However, a 250-char local
  part + valid domain (which fits in 255) would pass. The customer's
  actual mailbox was different (shortened), so emails sent to the
  truncated address bounce. Operator sees nothing wrong in admin/sales.
- **Fix (defer):** treat `customerEmailRaw.length > 255` as malformed
  and reject (200, no retry) rather than silently truncate. Truncation
  is acceptable for hygiene only; truncated-and-persisted is a data
  integrity risk.

### SEC-03 — Plaintext download token logged to stdout when `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true`

- File: `apps/web/src/app/api/stripe/webhook/route.ts:269-274`
- Severity: **Low** | Confidence: **High** (documented behavior)
- The opt-in flag is correct security posture. Cycle 3 P262-14 added
  retention warnings to README and cycle 4 P264-10 added the env
  example. The remaining residual risk is operator error: enabling the
  flag in a production environment without tightening log retention.
- **Mitigation:** acknowledge the residual risk in code comment + env
  example. Already done in current source. No further action.

### SEC-04 — `customer_email` logged with full plaintext in idempotent-skip path's caller (operator log)

- File: `apps/web/src/app/api/stripe/webhook/route.ts:216, 268-273`
- Severity: **Informational** | Confidence: **High**
- The idempotent-skip path at line 216 does NOT log the email; only the
  manual-distribution log at 270-273 does (gated by env flag). The first
  successful path's `Entitlement created` line at 268 also does NOT log
  email. This is correct minimization. No action.

### SEC-05 — Admin db backup download `Content-Disposition` interpolates `file` directly

- File: `apps/web/src/app/api/admin/db/download/route.ts:76`
- Severity: **Low** | Confidence: **High**
- Mitigated: `isValidBackupFilename` (line 20-25) restricts filenames to
  the well-known backup pattern. So the value reaching line 76 cannot
  contain `"` or `;`. Defense in depth could still escape per RFC 6266
  (`filename*=UTF-8''<urlencoded>`), but for the constrained shape it's
  fine. No action.

### SEC-06 — Download route uses `application/octet-stream`; some browsers will sniff and execute

- File: `apps/web/src/app/api/download/[imageId]/route.ts:191-197`
- Severity: **Informational** | Confidence: **High**
- `X-Content-Type-Options: nosniff` is set (line 194) which prevents
  browser MIME-sniffing. Combined with `Content-Disposition: attachment`,
  this is the correct download-only posture. No action.

### SEC-07 — Token format check is `startsWith('dl_')` only, not full shape

- File: `apps/web/src/lib/download-tokens.ts:53; apps/web/src/app/api/download/[imageId]/route.ts:48`
- Severity: **Informational** | Confidence: **Medium**
- Current path: any value starting with `dl_` makes it past the prefix
  check, then `hashToken(token)` SHA-256s the string and looks up the
  entitlement by hash. A mismatched hash returns 404. So the only attack
  surface is the SHA-256 universe (effectively impossible to forge).
- **Defense-in-depth (defer):** also enforce the post-prefix shape
  (`/^dl_[A-Za-z0-9_-]{43}$/`). This rejects malformed tokens earlier and
  stops mass-enumeration probing from hitting the DB layer. Already
  bounded by SHA-256 lookup so the value is operational, not security.

### SEC-08 — `webhook` route reads raw body via `request.text()` — Node.js runtime explicit

- File: `apps/web/src/app/api/stripe/webhook/route.ts:31, 44`
- Severity: **Informational** | Confidence: **High**
- `runtime = 'nodejs'` is explicit, the only correct setting for raw-body
  signature verification. No action.

## Confidence summary

| Finding | Severity | Confidence | Schedule |
|---------|----------|------------|----------|
| SEC-01  | Low      | High       | This cycle |
| SEC-02  | Low      | Medium     | This cycle |
| SEC-03  | Low      | High       | No action (already mitigated) |
| SEC-04  | Info     | High       | No action |
| SEC-05  | Low      | High       | No action |
| SEC-06  | Info     | High       | No action |
| SEC-07  | Info     | Medium     | Defer |
| SEC-08  | Info     | High       | No action |
