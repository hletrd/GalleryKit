# Security Review — Cycle 3 RPF (end-only)

Agent: security-reviewer
Scope: end-to-end Stripe paid-download flow, plus per-IP rate-limiting, download-token shape, admin same-origin guards, response headers, log-PII surface.

## Inventory

- `apps/web/src/app/api/stripe/webhook/route.ts`
- `apps/web/src/app/api/checkout/[imageId]/route.ts`
- `apps/web/src/app/api/download/[imageId]/route.ts`
- `apps/web/src/lib/download-tokens.ts`
- `apps/web/src/lib/license-tiers.ts`
- `apps/web/src/lib/stripe.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/app/actions/sales.ts`
- `apps/web/src/db/schema.ts` (entitlements)
- `apps/web/.env.local.example`

## Cycle 2 RPF security carry-forward verification

- C2RPF-SEC-MED-01 (email shape guard) — verified at webhook lines 76-81.
- C1RPF-PHOTO-MED-01 (drop tokenHash from log) — verified.
- C1RPF-PHOTO-MED-02 (tier allowlist at webhook ingest) — verified.
- C1RPF-PHOTO-HIGH-01 (rate-limit on /api/checkout) — verified.
- N-CYCLE1-03 (Stripe product_data.name truncation) — verified with ellipsis (P260-09).

## NEW Findings (cycle 3)

### C3RPF-SEC-HIGH-01 — Webhook does not gate on `payment_status === 'paid'`

- File: `apps/web/src/app/api/stripe/webhook/route.ts:57-94`
- Severity: **High** | Confidence: **High**
- **Threat model:** Async-pay flows (ACH, bank transfer, OXXO, Boleto) cause `checkout.session.completed` to fire with `payment_status: 'unpaid'`. Without the gate the gallery issues a download token + plaintext stdout line for an unpaid session. With `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true` the operator emails the token; the customer downloads the original; payment never settles.
- **Fix:** `if (session.payment_status !== 'paid') { console.warn('skipping non-paid session', { sessionId, paymentStatus: session.payment_status }); return NextResponse.json({ received: true }); }` between the signature verify and the INSERT.
- Cross-listed with `code-reviewer` C3RPF-CR-HIGH-01.

### C3RPF-SEC-HIGH-02 — Webhook accepts `amount_total: 0`

- File: `apps/web/src/app/api/stripe/webhook/route.ts:69`
- Severity: **High** (correctness/integrity) | Confidence: **High**
- **Threat:** A 100%-off coupon applied to checkout produces `amount_total: 0`. The webhook records a $0 entitlement with a working download token. Photographer's revenue dashboard misrepresents free downloads as sales; a malicious admin or compromised dashboard could mint $0 sessions to launder real downloads as accounted-for sales.
- **Fix:** `if (!Number.isInteger(amountTotalCents) || amountTotalCents <= 0) { console.warn('skipping zero-amount session', { sessionId, amount: amountTotalCents }); return NextResponse.json({ received: true }); }`. Combine with C3RPF-SEC-HIGH-01 in a single guard block.
- Cross-listed with `code-reviewer` C3RPF-CR-HIGH-02.

### C3RPF-SEC-MED-01 — `Content-Disposition` filename injection via admin-controlled `filename_original`

- File: `apps/web/src/app/api/download/[imageId]/route.ts:142-148`
- Severity: **Medium** | Confidence: **High** (defense-in-depth — exploitation requires admin write)
- **Threat:** `filename_original` is admin-controlled. If an admin uploaded a filename containing `";` or unescaped quotes, `path.extname` returns the trailing tail (no further `.`). The result is interpolated into `filename="..."` and sent to the customer. Admin → customer trust boundary is broken. Some browsers misinterpret a malformed Content-Disposition and write a different filename or set unintended parameters.
- **Threat actor:** A malicious or compromised admin could try to plant a download filename that exploits a customer client. Practical exploit ceiling is low (browsers are largely fixed) but defense-in-depth is cheap.
- **Fix:** Restrict `ext` to `[a-zA-Z0-9.]` and length-cap to 8 chars before interpolation. Or drop the filename parameter altogether (`Content-Disposition: attachment` is valid).
- Cross-listed with `code-reviewer` C3RPF-CR-MED-03.

### C3RPF-SEC-MED-02 — `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true` writes the customer email + plaintext token to a single log line

- File: `apps/web/src/app/api/stripe/webhook/route.ts:158-163`
- Severity: **Medium** | Confidence: **High**
- **Threat:** The opt-in env flag does close the manual-distribution loop, but stdout in containerized environments is collected by log shippers (Loki, Datadog, CloudWatch). The line `[manual-distribution] download_token: imageId=42 tier=editorial session=cs_xxx email=customer@example.com token=dl_xxx` puts the plaintext token AND the customer email together in the same retained record. The operator's stated intent is short-lived stdout grep; the realized lifetime is the log shipper's retention (often 30-90 days).
- **Threat actor:** Anyone with read access to log shipper data can later reconstruct + replay tokens that have not been single-use-claimed. The 24h expiry caps blast radius but the email-token pairing is enough to phish the customer.
- **Mitigations already in place:** opt-in flag; documented in README; tokens are single-use; download-token-hash is cleared on first use.
- **Fix candidates (pick one):**
  1. Write the plaintext token to a write-only file at a documented path (e.g., `/run/gallery/download-tokens.log`) instead of stdout. Operator can `cat | grep | head -1 | rm`. Lifetime is local to the host.
  2. Add a per-line warning header `[manual-distribution][REDACT-AFTER-EMAIL]` so log shippers' redaction rules can match.
  3. Document the retention concern in README + `.env.local.example`.
- Recommended for this cycle: option 3 (docs) — the broader fix (option 1) is a phase 2 / email-pipeline scope.

### C3RPF-SEC-MED-03 — Refund action races on `refunded` flag (TOCTOU on Stripe API)

- File: `apps/web/src/app/actions/sales.ts:120-167`
- Severity: **Medium** | Confidence: **Medium**
- **Threat:** Concurrent refund clicks both pass the `if (row.refunded)` guard, both call Stripe. The second call returns `charge_already_refunded` and the action surfaces a localized error. Practical impact: wasted Stripe API quota; failure mode looks like an attack on the Stripe rate limit if many tabs are open. Not a customer-facing security bug.
- **Fix:** Either (a) wrap in a transaction with `SELECT … FOR UPDATE`, OR (b) add an UPDATE-first pattern that atomically claims `refunded=true` before the Stripe call, then on Stripe failure either roll the row back or persist the failure code.
- Defer-eligible if quota pressure is not observed in production.

### C3RPF-SEC-MED-04 — Token consumed before file streamed

- File: `apps/web/src/app/api/download/[imageId]/route.ts:90-160`
- Severity: **Medium** | Confidence: **High**
- **Threat:** The atomic UPDATE clears the hash before lstat. If the original file is missing (deleted, moved, disk error) the customer gets 404 / 500 but the token is gone. Customer is now blocked on photographer support. From the photographer's view this is data loss / revenue loss / customer trust loss — it presents as a security issue (paid but locked out).
- **Fix:** Move lstat above the atomic claim (preferred) or compensate the claim on stream failure. Cross-listed with `code-reviewer` C3RPF-CR-MED-04.

### C3RPF-SEC-LOW-01 — Refund response leaks raw Stripe error message via `error: err.message`

- File: `apps/web/src/app/actions/sales.ts:160-165`
- Severity: **Low** | Confidence: **High**
- **Code:** `return { error: err instanceof Error ? err.message : 'Refund failed', errorCode: mapStripeRefundError(err) };`
- **Why a problem:** Cycle 2 added the `errorCode` mapping, and the client uses `mapErrorCode(result.errorCode, t)` to render localized text — but the `error` field still contains the raw Stripe error message and crosses the action boundary. If a future client refactor falls back to `result.error`, it leaks Stripe-internal request IDs (`req_xxx`) and English-only text into a Korean toast. Also: the `error` field is read by older test fixtures.
- **Fix:** Drop the `error` string field; keep `errorCode` only. Update the test fixtures and `sales-client.tsx` to no longer reference `result.error`. (The action also returns an `error` field on the not-authorized branch — keep that, but use a stable code rather than a free-form English string.)

### C3RPF-SEC-LOW-02 — `customer_email` not normalized to lowercase before INSERT

- File: `apps/web/src/app/api/stripe/webhook/route.ts:66-67`
- Severity: **Low** | Confidence: **Medium**
- **Why a problem:** `Customer@Example.COM` and `customer@example.com` are RFC-equivalent but stored as separate strings. Future lookups (e.g., "all sales by this customer") will miss case-mismatched rows. Stripe normalizes case in some flows but not all.
- **Fix:** `const customerEmail = customerEmailRaw.slice(0, 320).toLowerCase();` after the slice. Acceptable: also lowercase before the EMAIL_SHAPE check.

### C3RPF-SEC-LOW-03 — `lstat` then `realpath` race on download path

- File: `apps/web/src/app/api/download/[imageId]/route.ts:128-138`
- Severity: **Low** | Confidence: **Medium** (defense-in-depth)
- **Threat:** Between `lstat(filePath)` (line 129) and `realpath(filePath)` (line 135) the file could be replaced with a symlink pointing outside `uploadsDir`. The double-check (lstat for symlink, realpath for traversal) is ordered correctly, but a sufficiently fast TOCTOU could swap. In practice the upload directory is locked down and admin-only-writable, so the threat is non-existent for self-hosters.
- **Fix:** None required at current threat model. Documented for the record.

### C3RPF-SEC-LOW-04 — `getClientIp` warns once globally on missing TRUST_PROXY but never re-arms

- File: `apps/web/src/lib/rate-limit.ts:97,162-167`
- Severity: **Low** | Confidence: **High**
- The `warnedMissingTrustProxy = true` flag is process-global; on a long-running production miss the warning fires once and never again. If an operator restarts after the warning, the warning fires only on first request after restart, which is easy to miss. Not a regression — the cycle 1 fix established this. Worth adding a periodic re-warn (every 1h, say) so the operational signal is maintained.
- **Fix:** Track `lastWarnedAt` and re-warn at most every hour. Defer-eligible.

### C3RPF-SEC-LOW-05 — `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` not validated for shape on first use

- File: `apps/web/src/lib/stripe.ts`
- Severity: **Low** | Confidence: **High**
- The shape `sk_live_…` / `sk_test_…` and `whsec_…` is documented by Stripe. The lib reads `process.env.STRIPE_SECRET_KEY` and passes through. Any garbage value makes Stripe respond with an HTTP 401 at the first call. Worth a startup/lazy-init shape check so the operator gets a config error in the right place.
- **Fix:** `if (!key.startsWith('sk_')) { throw new Error('STRIPE_SECRET_KEY must start with sk_test_ or sk_live_'); }`. Cheap.

### C3RPF-SEC-LOW-06 — `entitlements.customer_email` stored verbatim is PII; no retention policy

- File: `apps/web/src/db/schema.ts:251-266`
- Severity: **Low** | Confidence: **High**
- The customer email is the only PII in the row. It is retained indefinitely (no `expiresAt` for the row itself; only for the download token). For a self-hosted gallery this is acceptable but the README lacks any retention guidance.
- **Fix:** Add a sentence to the README "Paid downloads" section noting that operators are responsible for entitlement retention and refund-history compliance with their local data-protection laws.

## Confirmed vs likely

- **Confirmed:** C3RPF-SEC-HIGH-01, HIGH-02, MED-01, MED-04, LOW-01, LOW-02.
- **Likely:** C3RPF-SEC-MED-02 (depends on log-shipper config), MED-03 (race window).
- **Needs validation:** C3RPF-SEC-LOW-04, LOW-05.
