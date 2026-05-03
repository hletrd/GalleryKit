# code-reviewer — cycle 5 RPF (end-only)

## Method

Reviewed everything that landed in cycles 1-4 of this RPF run plus the
adjacent code paths. All cycles 1-4 fixes verified in current source. Looking
for remaining gaps in the Stripe checkout/webhook/refund/download chain and
adjacent admin routes.

## Findings

### CR-01 — `mapStripeRefundError` doesn't catch the explicit Stripe SDK type fields when the error is thrown without an `Error.message`

- File: `apps/web/src/app/actions/sales.ts:103-117`
- Severity: **Low** | Confidence: **Medium**
- Stripe SDK throws subclasses of `StripeError`. The current code casts
  `err as Error & { code?: string; type?: string }` and reads `e.code`/`e.type`
  on a value that is already typed `Error`. This works but won't reflect a
  rare case: when an HTTP layer (fetch/timeout abort) throws something that
  is not an Error instance (e.g. a `DOMException` from `AbortController`).
  In that case `mapStripeRefundError` returns `'unknown'` and no
  network-class toast is rendered.
- **Failure scenario:** customer support hits Refund. Network is hung,
  request aborts. Stripe SDK propagates a `DOMException` (the actual
  `instanceof Error` check could be false in some Node versions for
  AbortError-shaped values). Operator sees the generic "Refund failed"
  toast instead of the actionable "Stripe could not be reached" toast.
- **Fix:** detect `e?.name === 'AbortError'` and `e?.code === 'ETIMEDOUT'`
  before falling through to `'unknown'`; map both to `'network'`.

### CR-02 — Refund flow calls `stripe.refunds.create` without an idempotency key

- File: `apps/web/src/app/actions/sales.ts:150`
- Severity: **Low** | Confidence: **High**
- The Stripe API supports `Idempotency-Key` on POST endpoints. Without
  one, a transient network error during refund could lead the operator to
  click again, and Stripe might process a second refund call (it WILL
  reject duplicates server-side because the charge is already-refunded
  → mapped to `'already-refunded'`, so user-facing impact is low). However,
  best-practice per Stripe docs is to always pass an idempotency key on
  mutations.
- **Failure scenario:** double-click before optimistic UI flips state →
  two refund attempts; first succeeds, second 400s. Customer behavior is
  correct because the second refund is rejected by Stripe, but operator
  sees an "already-refunded" error toast on a successful refund — confusing UX.
- **Fix:** pass `{ payment_intent: piId }, { idempotencyKey: \`refund-${entitlementId}\` }`
  on `stripe.refunds.create`. This makes Stripe deduplicate at API level.

### CR-03 — `expiresAt` cast to `Date` is unnecessary in the listEntitlements mapper

- File: `apps/web/src/app/actions/sales.ts:55-67`
- Severity: **Low** | Confidence: **Low**
- Drizzle MySQL returns `Date` objects for `timestamp`. The existing
  mapper just re-emits the same shape. Dead boilerplate. Cycle's not
  dropping correctness; this is minor noise for code-reviewers down the
  road.

### CR-04 — Webhook `customer_details?.email` and `customer_email` fall through pattern misses `customer_details?.name`

- File: `apps/web/src/app/api/stripe/webhook/route.ts:107`
- Severity: **Informational** | Confidence: **Low**
- We only persist `customer_email`. The customer's NAME from Stripe is
  not retained, so the operator's manual-distribution log line and the
  /admin/sales view show only the email. This is a deliberate privacy
  posture (less PII retained), not a defect.

### CR-05 — Download route's `path.resolve(uploadsDir, image.filename_original)` does not pre-validate `image.filename_original`

- File: `apps/web/src/app/api/download/[imageId]/route.ts:118`
- Severity: **Low** | Confidence: **Medium**
- `image.filename_original` is admin-controlled. If the admin somehow set
  it to `../../../etc/passwd` (would require DB write or bypass), the
  startsWith containment check at line 121 catches it, then the
  realpath+startsWith check at line 141 catches the symlink-traversal
  case. So it IS defended. But the lstat at line 128 runs against the
  unvalidated path FIRST, which could leak existence-of-path signal via
  timing (microseconds — not exploitable). Defense-in-depth would be to
  reject `filename_original` containing `/` or `\\` early.
- **Failure scenario:** functionally none in current path. This is purely
  a defense-in-depth signal-shape note.
- **Fix (defer):** add an early-reject for `image.filename_original`
  containing path separators before the `path.resolve` call.

### CR-06 — Backup download route has no length cap on the `file` query param before `isValidBackupFilename`

- File: `apps/web/src/app/api/admin/db/download/route.ts:19-25`
- Severity: **Low** | Confidence: **Medium**
- Admin-only and gated by `withAdminAuth`. `isValidBackupFilename` has its
  own shape rule, but a several-MB query string could be sent before the
  validator rejects it. Minor DoS surface.
- **Fix (defer):** length-cap the `file` param at e.g. 256 chars before
  passing to `isValidBackupFilename`. `isValidBackupFilename` already
  imposes a tight regex but the early-cap saves the work and slightly
  hardens the parser.

### CR-07 — `customer_email` is logged in the manual-distribution line; no `mailbox+tag@domain` shape change after `.toLowerCase()`

- File: `apps/web/src/app/api/stripe/webhook/route.ts:108, 270-273`
- Severity: **Informational** | Confidence: **High**
- After `toLowerCase()`, addresses like `Customer+Tag@Example.COM` become
  `customer+tag@example.com`. Both normalize to the same RFC mailbox in
  practice (most providers are case-insensitive on the local part too,
  although RFC technically allows case-sensitive local parts). Cycle 3
  P262-09 and cycle 4 P264-05/01 already established this. No action.

### CR-08 — `console.info` (`Stripe webhook: idempotent skip`) uses string concatenation instead of structured object

- File: `apps/web/src/app/api/stripe/webhook/route.ts:216`
- Severity: **Low** | Confidence: **High**
- All the cycle 1-4 webhook logs use structured objects (`{ sessionId, ... }`)
  except this one, which uses a template literal. Inconsistent log shape
  makes ops dashboards harder.
- **Fix:** convert to structured `console.info('Stripe webhook: idempotent skip', { sessionId })`.

### CR-09 — `Entitlement created` log line at 268 also uses string concatenation

- File: `apps/web/src/app/api/stripe/webhook/route.ts:268`
- Severity: **Low** | Confidence: **High**
- Same pattern as CR-08. The cycle 4 log lines are structured; these two
  legacy lines are not.
- **Fix:** convert to structured `console.info('Entitlement created', { imageId, tier, sessionId })`.

## Confidence summary

| Finding | Severity | Confidence | Schedule |
|---------|----------|------------|----------|
| CR-01   | Low      | Medium     | This cycle |
| CR-02   | Low      | High       | This cycle |
| CR-03   | Low      | Low        | Defer (cosmetic) |
| CR-04   | Info     | Low        | Defer (no defect) |
| CR-05   | Low      | Medium     | Defer (defense-in-depth) |
| CR-06   | Low      | Medium     | Defer |
| CR-07   | Info     | High       | No action |
| CR-08   | Low      | High       | This cycle |
| CR-09   | Low      | High       | This cycle |
