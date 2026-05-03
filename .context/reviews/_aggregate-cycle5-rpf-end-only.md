# Cycle 5 RPF (end-only) — Aggregate Review

## Method

Multi-agent fan-in across: code-reviewer, security-reviewer, perf-reviewer,
critic, architect, test-engineer, verifier, debugger, document-specialist,
designer, tracer. All available reviewer specialists exercised; none failed.

## Gate baseline (fresh)

- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm run lint:api-auth` — clean
- `npm run lint:action-origin` — clean
- `npm test` — 964 passed across 109 files
- `git status` — clean on master, 9 commits ahead of origin

## Cycles 1+2+3+4 RPF carry-forward verification

All cycle 1, 2, 3, 4 RPF claims verified in current source
(verifier-cycle5-rpf-end-only.md). All deferred items still tracked in
`plan/`. Nothing silently dropped.

## Cross-agent agreement (high-signal duplicates)

- **C5-RPF-CR-02 / C5-RPF-SEC-01 / C5-RPF-ARCH-01 / C5-RPF-DBG-01 /
  C5-RPF-TR-02** — Refund mutation lacks Stripe `Idempotency-Key`. Five
  agents converge: code-reviewer, security-reviewer, architect, debugger,
  tracer. High-signal.
- **C5-RPF-CR-08+09 / C5-RPF-ARCH-02 / C5-RPF-TR-03+04** — Two pre-existing
  webhook log lines (`idempotent skip`, `Entitlement created`) use
  template-literal interpolation while all cycle 1-4 fixes use structured
  object form. Inconsistent log shape.
- **C5-RPF-ARCH-03 / C5-RPF-CRIT-08 / C5-RPF-TR-01** — `mapStripeRefundError`
  conflates `StripeAuthenticationError` (rotated key, ops issue) and
  `StripeConnectionError` (transient) into the same `'network'` code,
  obscuring the diagnosis when a key is rotated.
- **C5-RPF-PERF-05 / C5-RPF-TR-05** — `EMAIL_SHAPE` regex declared inside
  the POST handler instead of at module scope (consistency with
  `STORED_HASH_SHAPE` in download-tokens.ts).
- **C5-RPF-CR-01 / C5-RPF-DBG-04** — `mapStripeRefundError` does not
  handle non-Error throws (e.g. `AbortError` `DOMException` from
  AbortController) — falls through to 'unknown'.

## Findings (severity-sorted)

### HIGH

(none)

### MEDIUM

(none)

### LOW

#### C5-RPF-01 — Add Stripe `Idempotency-Key` to refund mutation

- File: `apps/web/src/app/actions/sales.ts:150`
- Reviewers: code-reviewer (CR-02), security-reviewer (SEC-01),
  architect (ARCH-01), debugger (DBG-01), tracer (TR-02)
- Severity: **Low** | Confidence: **High**
- **What:** `stripe.refunds.create({ payment_intent: piId })` runs
  without an idempotency key. Best-practice for Stripe POSTs is to pass
  `Idempotency-Key` so retries (network or user double-click) are
  deduped server-side. Without it, a successful-then-double-clicked
  refund flow shows the operator "This charge was already refunded"
  toast on a refund that DID succeed — confusing UX.
- **Fix (this cycle):** pass `{ idempotencyKey: \`refund-${entitlementId}\` }`
  as the second argument. Add JSDoc explaining the deterministic key
  choice.

#### C5-RPF-02 — Convert legacy webhook log lines to structured-object form

- File: `apps/web/src/app/api/stripe/webhook/route.ts:216, 268`
- Reviewers: code-reviewer (CR-08, CR-09), architect (ARCH-02),
  tracer (TR-03, TR-04)
- Severity: **Low** | Confidence: **High**
- **What:** All cycle 1-4 webhook log lines use structured object form
  (`{ sessionId, ... }`). Two pre-existing legacy lines (idempotent skip,
  Entitlement created) use template literal interpolation. Inconsistent
  log shape costs more in log-shipper parsing & Datadog facet config.
- **Fix (this cycle):** convert both to
  `console.info('Stripe webhook: idempotent skip', { sessionId })` and
  `console.info('Entitlement created', { imageId, tier, sessionId })`.

#### C5-RPF-03 — Split `'auth-error'` from `'network'` in RefundErrorCode

- File: `apps/web/src/app/actions/sales.ts:115; sales-client.tsx:100`
- Reviewers: architect (ARCH-03), critic (CRIT-08), tracer (TR-01)
- Severity: **Low** | Confidence: **Medium**
- **What:** `StripeAuthenticationError` (rotated key, requires ops to
  rotate STRIPE_SECRET_KEY) and `StripeConnectionError` (transient
  network) both map to `'network'`. The user-facing toast is "Stripe
  could not be reached. Try again shortly." which is wrong for the auth
  case (retry won't help — the key is bad). Operator wastes time
  retrying instead of rotating the key.
- **Fix (this cycle):** add `'auth-error'` to the RefundErrorCode union;
  return it from `mapStripeRefundError` for `StripeAuthenticationError`;
  add a localized toast string ("Stripe authentication failed; please
  check the API key configuration.") for both en and ko.

#### C5-RPF-04 — Hoist `EMAIL_SHAPE` regex to module scope

- File: `apps/web/src/app/api/stripe/webhook/route.ts:119`
- Reviewers: perf-reviewer (PERF-05), tracer (TR-05)
- Severity: **Low** | Confidence: **High**
- **What:** `EMAIL_SHAPE` regex is declared inside the POST handler.
  Reference example `STORED_HASH_SHAPE` in `download-tokens.ts:46` is
  module-scoped. V8 caches regex literals so micro-perf is essentially
  free, but consistency is a real readability win.
- **Fix (this cycle):** hoist `EMAIL_SHAPE` to module scope.

#### C5-RPF-05 — Handle non-Error throws (AbortError) in `mapStripeRefundError`

- File: `apps/web/src/app/actions/sales.ts:103-117`
- Reviewers: code-reviewer (CR-01), debugger (DBG-04)
- Severity: **Low** | Confidence: **Medium**
- **What:** `instanceof Error` guard returns 'unknown' for non-Error
  throws (e.g. AbortError DOMException from AbortController). Falls
  through to a generic toast.
- **Fix (this cycle):** detect `name === 'AbortError'` and standard
  network error codes (ETIMEDOUT/ECONNREFUSED) before falling through
  to 'unknown'; map both to 'network'.

#### C5-RPF-06 — Reject 256+-char raw email instead of silent-truncate

- File: `apps/web/src/app/api/stripe/webhook/route.ts:108`
- Reviewers: security-reviewer (SEC-02)
- Severity: **Low** | Confidence: **Medium**
- **What:** Cycle 4 P264-01 set the slice to 255. But truncation is
  silent: a 1000-char misconfigured email truncated to 255 chars could
  still pass `EMAIL_SHAPE` (rare, but a 250-char-local + valid domain
  fits) and get persisted with a different mailbox than the customer
  intended. The customer's actual mailbox doesn't match the persisted
  one → emails sent to it bounce.
- **Fix (this cycle):** if `customerEmailRaw.trim().length > 255`,
  treat as malformed and reject (200, no retry). Truncation is fine
  for hygiene but silent-truncate-and-persist is data integrity risk.

#### C5-RPF-07 — Source-contract tests for cycle 5 fixes

- File: `apps/web/src/__tests__/cycle5-rpf-source-contracts.test.ts` (new)
- Reviewers: test-engineer (TEST-01)
- Severity: **Low** | Confidence: **High**
- **What:** Cycle 5 fixes need source-contract tests so a future revert
  is caught.
- **Fix (this cycle):** test for: idempotency-key shape, hoisted regex
  position, structured log lines, auth-error mapping, 256+-char reject.

### Deferred (with exit criteria)

#### C5-RPF-D01 — Identity mapper in listEntitlements

- File: `apps/web/src/app/actions/sales.ts:55-67`
- Reviewer: perf-reviewer (PERF-01)
- Defer: cosmetic; LIMIT 500 caps allocations to 500/page-load.
- Exit: when next major sales-action refactor.

#### C5-RPF-D02 — Pre-validate `image.filename_original` for path separators

- File: `apps/web/src/app/api/download/[imageId]/route.ts:118`
- Reviewer: code-reviewer (CR-05)
- Defer: defense-in-depth; existing realpath+startsWith checks already
  contain the threat.
- Exit: when next download-route hardening pass.

#### C5-RPF-D03 — Length-cap `file` query param before `isValidBackupFilename`

- File: `apps/web/src/app/api/admin/db/download/route.ts:19`
- Reviewer: code-reviewer (CR-06)
- Defer: bounded by admin auth; `isValidBackupFilename` regex itself
  rejects long values quickly.
- Exit: at next admin-route hardening pass.

#### C5-RPF-D04 — Confirm dialog state-drift between `confirmTarget` and `refundingId`

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:127-148`
- Reviewer: critic (CRIT-06), designer (UX-01)
- Defer: cosmetic UX gap; AlertDialog `disabled` already protects against
  the primary double-click case.
- Exit: at next admin polish pass.

#### C5-RPF-D05 — Behavior tests for `mapStripeRefundError`

- File: `apps/web/src/app/actions/sales.ts:103-117`
- Reviewer: test-engineer (TEST-02)
- Defer: requires exporting the function, source-contract tests cover
  the regression risk.
- Exit: when broader behavior-test pass for sales actions.

#### C5-RPF-D06 — Sales table `Recent revenue` label or pagination at >500 sales

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:170-235`
- Reviewer: debugger (DBG-03), carry-forward C4-RPF-D08
- Defer: not on hot path; admin-only.
- Exit: when /admin/sales has >500 entitlements OR D04 lands.

#### C5-RPF-D07 — `'dl_' + 43-char base64url` shape check on token before SHA-256

- File: `apps/web/src/lib/download-tokens.ts:53`
- Reviewer: security-reviewer (SEC-07)
- Defer: bounded by SHA-256 lookup; defense-in-depth.
- Exit: when broader download-route hardening pass.

#### C5-RPF-D08 — JSDoc table mapping Stripe error type → RefundErrorCode

- File: `apps/web/src/app/actions/sales.ts:103-117`
- Reviewer: document-specialist (DOC-04)
- Defer: nice-to-have docs.
- Exit: when broader sales-action doc pass.

#### C5-RPF-D09 — `webhook` logs unbounded under signature-replay storm

- File: `apps/web/src/app/api/stripe/webhook/route.ts:216`
- Reviewer: critic (CRIT-02)
- Defer: bounded by Stripe signature verification (line 52) which has
  a tolerance window. Risk is low.
- Exit: when first observed log-shipper saturation incident.

#### C5-RPF-D10 — Webhook async_payment_succeeded handler missing

- File: `apps/web/src/app/api/stripe/webhook/route.ts:69`
- Reviewer: architect (ARCH-04)
- Defer: cycle 1 webhook drops async sessions; existing comment at
  line 68-69 tracks the future-cycle requirement.
- Exit: when ACH/OXXO is enabled in production.

#### C5-RPF-D11 — Tier-mismatch metric (instead of warn-only log)

- File: `apps/web/src/app/api/stripe/webhook/route.ts:172-179`
- Reviewer: architect (ARCH-05)
- Defer: no metrics infrastructure in repo currently.
- Exit: when metrics infra is introduced.

#### C5-RPF-D12 — Carry-forward of cycle 1+2+3+4 deferred items

- All cycle 1, 2, 3, 4 deferred items remain deferred under cycle 5. Same
  exit criteria preserved (see plan/plan-265-cycle4-rpf-end-only-deferred.md).

## Disposition completeness check

All findings accounted for:
- **Scheduled in cycle 5:** C5-RPF-01 through 07 (7 in-cycle items).
- **Deferred:** C5-RPF-D01 through D12 (12 items, including the
  carry-forward bucket).
- Cycles 1+2+3+4 RPF carry-forward: verified in code; nothing silently
  dropped.

## Severity totals

- HIGH: 0
- MEDIUM: 0
- LOW: 7 in-cycle, 11 deferred + carry-forward bucket

## AGENT FAILURES

None. All reviewer specialists completed without retry.
