# Cycle 4 RPF (end-only) — Code Reviewer

## Method
Read every file changed in cycles 1-3 RPF, plus all interdependent code on the
paid-download path: webhook, download route, sales actions, sales-client,
license-tiers, download-tokens, stripe lib, schema. Verified gate baseline:
- lint clean
- typecheck clean
- lint:api-auth clean
- lint:action-origin clean
- npm test 950 passed across 108 files
- master clean

## Cycle 1+2+3 verification (carry-forward)

All cycle 3 RPF in-cycle fixes (P262-01..P262-14) are present in source and
covered by source-contract tests in `cycle3-rpf-source-contracts.test.ts`. No
regressions detected.

## Findings

### LOW

#### C4-RPF-CR-01 — `entitlements.expiresAt` rendered without timezone disclosure on admin /sales

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:189-200`
- The expiry column shows `new Date(row.createdAt).toLocaleDateString(locale)` — but the table doesn't surface `expiresAt` at all. An entitlement that has been pending for >24h is silently expired (status badge handles this), but admins cannot see WHEN it will/did expire to triage support tickets like "I paid but never got an email."
- Severity: **Low** | Confidence: **Medium**
- Failure scenario: Customer says "I paid yesterday." Operator opens /sales, sees "expired" status. No way to know whether it expired 1 hour ago (re-issue) or 12 hours ago (refund window discussion).
- **Defer:** UX scope; admin UI growth.

#### C4-RPF-CR-02 — `verifyTokenAgainstHash` swallows hex-decode errors as `false` without log

- File: `apps/web/src/lib/download-tokens.ts:62-70`
- `Buffer.from(candidateHash, 'hex')` and `Buffer.from(storedHash, 'hex')` are wrapped in try/catch with empty `return false`. The shape regex above ensures storedHash is well-formed, and `hashToken` always returns a 64-char hex digest — so the catch is actually unreachable in practice. But: if a future refactor drops `STORED_HASH_SHAPE` validation, the catch becomes a silent fail path with no log signal.
- Severity: **Low** | Confidence: **Medium**
- **Defer:** dead-code hardening; current shape is correct.

#### C4-RPF-CR-03 — Webhook idempotency SELECT lacks index hint

- File: `apps/web/src/app/api/stripe/webhook/route.ts:171-179`
- `SELECT id FROM entitlements WHERE session_id = ? LIMIT 1` runs the new idempotency check on every retry. The schema has a UNIQUE constraint on `sessionId` (line 256), which auto-creates an index in MySQL, so this is fine in practice. No explicit covering index needed.
- Severity: **Informational** | Confidence: **High**
- **No action needed.**

#### C4-RPF-CR-04 — Webhook tier-allowlist check uses tier from metadata; the tier-vs-imageId mismatch case is silent

- File: `apps/web/src/app/api/stripe/webhook/route.ts:130-134`
- The webhook accepts whatever tier Stripe sends in metadata (after allowlist filter). The image's actual `license_tier` in DB is not cross-checked against the metadata tier. So if checkout was created for image #100 at tier "editorial" but the image's tier was later edited to "commercial" in the admin UI, the webhook stores an "editorial" entitlement on a "commercial" image. Customer downloads the file (since the download path doesn't check tier match) but the audit trail is wrong.
- Severity: **Low** | Confidence: **Medium**
- Failure scenario: Admin edits license_tier in /admin/edit/[id] between checkout and webhook completion. Stripe paid for tier X; entitlement is for tier X; image shows tier Y. Refund / dispute investigation gets confused.
- Concrete mitigation: SELECT `images.license_tier` and verify it still matches `metadata.tier`. If mismatch, log warning and either accept (current behavior) or reject (more conservative).
- **In-cycle fix:** Add a defensive SELECT image and warn-log on tier mismatch (no behavioral change, ops signal only). 

#### C4-RPF-CR-05 — Download route does not check `images.license_tier` for `'none'`

- File: `apps/web/src/app/api/download/[imageId]/route.ts:108-116`
- Only checks the entitlement exists and matches the token. If admin sets the image's license_tier back to 'none' AFTER a paid entitlement exists, the customer's token still works (correct, since they paid). But the download path could log a warning that the image's current public tier is 'none' for ops awareness.
- Severity: **Informational** | Confidence: **High**
- **No action needed** (current behavior is correct — paid customer keeps their entitlement).

#### C4-RPF-CR-06 — `customer_email` varchar(255) but webhook accepts up to 320 chars

- File: `apps/web/src/db/schema.ts:255` (255-char column), `apps/web/src/app/api/stripe/webhook/route.ts:90` (slice to 320)
- The schema column is `varchar(255)` but the webhook truncates to 320 (RFC-5321 max). Strictly: any email between 256 and 320 chars would be silently truncated by MySQL on INSERT (in strict mode) or rejected (with strict_mode=STRICT_TRANS_TABLES). MySQL default is strict in 8.0+, so the INSERT would fail and Stripe would retry forever (500 → backoff → eventual abandon).
- Severity: **Low** | Confidence: **High**
- Failure scenario: Email of length 256-320 chars (rare but legal per RFC-5321) → webhook 500s on every retry → entitlement never created → customer paid but has no token.
- **In-cycle fix:** Truncate at the schema's 255-char limit, not 320. Change `slice(0, 320)` → `slice(0, 255)`.

#### C4-RPF-CR-07 — `image.title` truncation mid-codepoint (cycle 2's P260-09 ellipsis fix)

- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:120-122`
- `image.title.slice(0, 199) + '…'` slices at 199 UTF-16 code units. Korean / Japanese characters are typically 1 unit each, but emoji and surrogate pairs can split mid-codepoint, leaving a malformed character before the ellipsis. Stripe normalizes this fine on display but the raw `product_data.name` payload contains a malformed UTF-16 sequence.
- Severity: **Low** | Confidence: **Medium**
- **Defer:** rare in practice (titles up to 199 chars with surrogate pair at exact boundary); cosmetic display issue.

#### C4-RPF-CR-08 — `Content-Disposition` filename uses unquoted ASCII path; missing `filename*=UTF-8''` for non-ASCII titles

- File: `apps/web/src/app/api/download/[imageId]/route.ts:179-186`
- `downloadName = photo-${imageId}${safeExt}` is purely ASCII (digits + sanitized ext). This is safe. But: if a future cycle adds the image title to the download name, RFC 6266 requires `filename*=UTF-8''<percent-encoded>` for non-ASCII. Current path is safe; just noting for future hardening.
- Severity: **Informational** | Confidence: **High**
- **No action needed.**

#### C4-RPF-CR-09 — `mapStripeRefundError` only handles 4 cases; long tail returns `'unknown'`

- File: `apps/web/src/app/actions/sales.ts:103-111`
- Stripe error codes documented at https://stripe.com/docs/error-codes include `expired_card`, `card_declined`, `processing_error`, etc. for refund flows. Most non-user-input refund errors come from `'StripeAuthenticationError'` (mis-rotated key), `'StripeRateLimitError'` (rate limit), `'StripeIdempotencyError'`. Currently all of these collapse to `'unknown'` and the operator just sees "Unknown error" with no actionable next step.
- Severity: **Low** | Confidence: **High**
- **In-cycle fix:** Map `'StripeAuthenticationError'` and `'StripeRateLimitError'` to dedicated codes with i18n strings.

#### C4-RPF-CR-10 — Refund AlertDialog template literal injects `email` and `title` without escaping

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:251-258`
- `t.refundConfirmDescTemplate({ amount, email, title })` — values are inserted into a translated string via next-intl's ICU message format, which auto-escapes. React then renders the string as a child of `<AlertDialogDescription>`, which is also auto-escaped. So no XSS vector. Safe.
- Severity: **Informational** | Confidence: **High**
- **No action needed.**

### Carry-forward verification

- C3-RPF-01 (payment_status gate) — present line 70-76
- C3-RPF-02 (zero-amount reject) — present line 150-156
- C3-RPF-03 (UPLOAD_DIR_ORIGINAL) — present line 26, 99
- C3-RPF-04 (filename ext sanitize) — present line 179-180
- C3-RPF-05 (lstat-before-claim) — present lines 108-148, claim at 150-156
- C3-RPF-06 (delete getTotalRevenueCents) — verified absent in sales.ts
- C3-RPF-07 (idempotent SELECT before token gen) — present line 171-179
- C3-RPF-08 (refund button outline variant) — present line 220
- C3-RPF-09 (lowercase customer_email) — present line 90
- C3-RPF-10 (errorLoad i18n) — verified in en.json/ko.json
- C3-RPF-11 (escalate to console.error) — verified at lines 71, 103, 112, 131, 138, 151
- C3-RPF-12 (source-contract tests) — verified in cycle3-rpf-source-contracts.test.ts
- C3-RPF-13 (download-tokens JSDoc lowercase) — verified at line 6 ("lowercase SHA-256 hex digest")

## Aggregate severity

- HIGH: 0
- MEDIUM: 0
- LOW: 7 (C4-RPF-CR-01, 02, 04, 06, 07, 09; deferring 01/02/05/07/08 + plan 06/09)
- INFO: 3 (CR-03, 05, 08, 10)

## In-cycle scheduling proposal

- C4-RPF-CR-04 — defensive image-tier SELECT cross-check
- C4-RPF-CR-06 — truncate to 255-char column limit
- C4-RPF-CR-09 — map StripeAuthenticationError + StripeRateLimitError refund errors
