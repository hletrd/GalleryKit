# Cycle 4 RPF (end-only) — Security Reviewer

## Method
Threat-modeled the paid-download surface end to end:
- Stripe webhook signature verification
- Tier allowlist + payment_status + amount guards
- Download token generation, storage, single-use enforcement
- Path traversal protection on download
- Refund flow + token clearing
- PII handling (customer_email logging, retention)

Reviewed cycle 1 RPF + cycle 2 RPF + cycle 3 RPF fixes are all in place.

## Findings

### LOW

#### C4-RPF-SEC-01 — `customer_email` truncate-bound exceeds DB column width

- File: `apps/web/src/app/api/stripe/webhook/route.ts:90` (slice to 320), `apps/web/src/db/schema.ts:255` (varchar 255)
- Per RFC-5321 the local-part is limited to 64 octets and the domain to 255 octets, so a fully-conformant address can be up to 320 chars total. The schema's `varchar(255)` cannot hold a max-length address. In MySQL strict mode, the INSERT throws `Data too long for column 'customer_email'` and the webhook returns 500 → Stripe retries indefinitely.
- Severity: **Low** (rare to encounter such addresses, but corrupting state is bad) | Confidence: **High**
- Concrete failure: long enterprise email (256-320 chars) → permanent webhook failure → paid customer receives no token → support burden.
- Fix (this cycle): change `slice(0, 320)` to `slice(0, 255)` to match the column. Document the column width limit in a comment.

#### C4-RPF-SEC-02 — Webhook does NOT validate `imageId` exists or that current `license_tier` matches `metadata.tier`

- File: `apps/web/src/app/api/stripe/webhook/route.ts:136-140`
- The webhook validates `imageId` is a positive integer but doesn't SELECT to confirm it exists and isn't soft-deleted (no soft-delete in current schema, but the contract is "image must exist"). It also doesn't cross-check that `images.license_tier` in DB still equals `metadata.tier`.
- Severity: **Low** (audit-trail integrity, not security) | Confidence: **High**
- Failure scenario: admin re-tiers an image after checkout creation but before webhook delivery; or admin deletes an image (FK ON DELETE CASCADE on entitlements would purge the row anyway, so this is bounded). The mismatch case can't escalate privileges.
- Fix (this cycle): SELECT image and warn-log on mismatch. The defensive SELECT is cheap and provides a useful audit signal.

#### C4-RPF-SEC-03 — Refund action's `Stripe.checkout.sessions.retrieve` lacks an idempotency key

- File: `apps/web/src/app/actions/sales.ts:138-144`
- Concurrent refund clicks (admin double-clicks the AlertDialogAction button while the response is in-flight) will both call `stripe.refunds.create()`. Stripe handles the second call with a `charge_already_refunded` error, which `mapStripeRefundError` correctly maps. So the user-visible behavior is fine.
- Severity: **Informational** | Confidence: **High**
- Mitigation already in place: client-side `disabled={refundingId !== null}` (line 265 of sales-client.tsx).
- **No action needed.**

#### C4-RPF-SEC-04 — `LOG_PLAINTEXT_DOWNLOAD_TOKENS` does not have a TTL on log emission

- File: `apps/web/src/app/api/stripe/webhook/route.ts:230-235`, `apps/web/README.md` (operator workflow)
- The opt-in flag emits the plaintext token to stdout. Operators retrieve the token from log shippers and email it manually. There's no time-bound on log retention; if the log shipper retains for 90 days, the plaintext token sits in retention even though the customer has long since downloaded.
- Severity: **Low** | Confidence: **High**
- Mitigation: token is invalidated by single-use claim or expiry (24h). After 24h the token is dead.
- **Defer:** the broader log-shipper redaction guidance is C3-RPF-D07 (already deferred).

#### C4-RPF-SEC-05 — Download route 404s on missing image leak entitlement existence

- File: `apps/web/src/app/api/download/[imageId]/route.ts:114-115` ("Image not found" 404)
- Reaching the "Image not found" branch requires presenting a valid token. Token holders are already authenticated by the entitlement record. So the existence leak is bounded to the customer who paid.
- Severity: **Informational** | Confidence: **High**
- **No action needed.**

#### C4-RPF-SEC-06 — `EMAIL_SHAPE` regex does not enforce TLD length

- File: `apps/web/src/app/api/stripe/webhook/route.ts:101`
- `^[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+$` accepts `a@b.c` (single-char TLD). RFC-1035 says TLDs are at least 2 chars, but localhost-like dev emails should still be accepted. Current behavior is acceptably loose.
- Severity: **Informational** | Confidence: **Medium**
- **No action needed.**

#### C4-RPF-SEC-07 — Download token is base64url WITHOUT bcrypt/argon2; pure SHA-256 hash storage

- File: `apps/web/src/lib/download-tokens.ts:33-36`
- Storage is sha256 hex; tokens are 32-byte base64url. Token entropy is 256 bits; SHA-256 makes brute-force on the hash infeasible (2^256 keyspace). Current design is correct — bcrypt/argon2 would be overkill (the token is high-entropy, not a low-entropy password).
- Severity: **Informational** | Confidence: **High**
- **No action needed.**

### Carry-forward verification

- C2-RPF-D08 (`stripe_refund_id` persistence) — still deferred per cycle 3 plan; no regression.
- C3-RPF-D07 (log-shipper redaction guidance) — broader doc work still deferred.
- All cycle 1-3 RPF security fixes (rate-limit rollback, tier allowlist, lowercase email, webhook signature) verified present.

## Aggregate severity

- HIGH: 0
- MEDIUM: 0
- LOW: 2 in-cycle (SEC-01, SEC-02), 1 deferred (SEC-04)
- INFO: 4 (SEC-03, SEC-05, SEC-06, SEC-07)

## In-cycle scheduling proposal

- C4-RPF-SEC-01 — column-width truncation (overlaps with code-reviewer C4-RPF-CR-06)
- C4-RPF-SEC-02 — defensive image-tier SELECT (overlaps with code-reviewer C4-RPF-CR-04)
