# Cycle 4 RPF (end-only) — Aggregate Review

## Method

Multi-agent fan-in across: code-reviewer, security-reviewer, perf-reviewer,
critic, architect, test-engineer, verifier, debugger, document-specialist,
designer, tracer. All available reviewer specialists exercised; none failed.

## Gate baseline (fresh)

- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm run lint:api-auth` — clean
- `npm run lint:action-origin` — clean
- `npm test` — 950 passed across 108 files
- `git status` — clean on master

## Cycles 1+2+3 RPF carry-forward verification

All cycle 1, 2, 3 RPF claims verified in current source (verifier-cycle4-rpf-end-only.md). All deferred items still tracked in plan/. Nothing silently dropped.

## Cross-agent agreement (high-signal duplicates)

- **C4-RPF-CR-06 / C4-RPF-SEC-01 / C4-RPF-TR-01** — `customer_email` truncate-bound (320) exceeds DB column width (255). Three agents converge: code-reviewer, security-reviewer, tracer.
- **C4-RPF-CR-04 / C4-RPF-SEC-02** — webhook should defensively SELECT image and warn-log on tier mismatch between Stripe metadata and current `images.license_tier`. Two agents.
- **C4-RPF-CRIT-01 / C4-RPF-TR-02** — `'unpaid'` payment_status is a documented async happy-path; using `console.error` causes false-positive PagerDuty pages. Two agents.
- **C4-RPF-CRIT-05 / C4-RPF-TR-06** — refund-error mapping covers only 3 of 7 RefundErrorCode values; remaining 4 collapse to a non-actionable "Refund failed" message. Two agents.
- **C4-RPF-DBG-01** — `customer_email` should be `.trim()`-ed before lowercase + EMAIL_SHAPE check (defensive against misconfigured callers). Single agent.
- **C4-RPF-PERF-03** — download route's two `realpath()` calls are serial; could be parallelized. Single agent.
- **C4-RPF-CR-09** — `mapStripeRefundError` doesn't handle `StripeAuthenticationError` / `StripeRateLimitError`. Single agent.
- **C4-RPF-UX-01** — refund button text rotation is duplicated between row and AlertDialog. Single agent.
- **C4-RPF-UX-02** — `errorLoad` div lacks `role="alert"` for screen-reader announcement. Single agent.
- **C4-RPF-DOC-01** — `LOG_PLAINTEXT_DOWNLOAD_TOKENS` missing from `.env.local.example`. Single agent.

## Findings (severity-sorted)

### HIGH

(none)

### MEDIUM

(none)

### LOW

#### C4-RPF-01 — `customer_email` truncate-bound exceeds DB column width

- File: `apps/web/src/app/api/stripe/webhook/route.ts:90`, schema:`apps/web/src/db/schema.ts:255`
- Reviewers: code-reviewer (CR-06), security-reviewer (SEC-01), tracer (TR-01)
- Severity: **Low** | Confidence: **High**
- **What:** webhook `customerEmailRaw.slice(0, 320)` permits up to 320 chars but DB column is `varchar(255)`. In MySQL strict mode, an INSERT with a 256-320 char email throws `Data too long for column` and webhook returns 500 → Stripe retries indefinitely → paid customer never gets a token. Each retry mints a new plaintext token in operator log (cycle 3 P262-07 SELECT returns empty since INSERT failed, so token-mint path runs every retry).
- **Fix (this cycle):** change `slice(0, 320)` → `slice(0, 255)` to match column width.

#### C4-RPF-02 — Defensive image-tier cross-check on webhook

- File: `apps/web/src/app/api/stripe/webhook/route.ts:130-217`
- Reviewers: code-reviewer (CR-04), security-reviewer (SEC-02)
- Severity: **Low** | Confidence: **Medium**
- **What:** If admin re-tiers an image after checkout but before webhook, the entitlement is recorded with the OLD tier (per Stripe metadata) but the image's current tier in DB differs. No security impact, but audit-trail integrity drifts.
- **Fix (this cycle):** SELECT image's current `license_tier` after the imageId validation; if it doesn't match `metadata.tier`, log a warning. Behavior unchanged (no rejection); this is an ops-signal addition.

#### C4-RPF-03 — `'unpaid'` payment_status uses console.error (PagerDuty noise on async happy-path)

- File: `apps/web/src/app/api/stripe/webhook/route.ts:71-74`
- Reviewers: critic (CRIT-01), tracer (TR-02)
- Severity: **Low** | Confidence: **High**
- **What:** ACH/OXXO async-paid flow: first webhook delivers `payment_status: 'unpaid'` (legit). Cycle 3 P262-01's `console.error` triggers a PagerDuty alert for what is documented Stripe behavior. Operators desensitize.
- **Fix (this cycle):** Use `console.warn` for `'unpaid'` (async happy-path). Reserve `console.error` for `'no_payment_required'` (genuinely unexpected since the zero-amount gate at line 150 should catch it first).

#### C4-RPF-04 — Refund-error mapping incomplete (4 of 7 codes fall through to generic message)

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:97-108`
- Reviewers: critic (CRIT-05), tracer (TR-06)
- Severity: **Low** | Confidence: **Medium**
- **What:** `RefundErrorCode` has 7 values: 'already-refunded', 'charge-unknown', 'network', 'not-found', 'invalid-id', 'no-payment-intent', 'unknown'. `mapErrorCode` only specifies 3. The other 4 fall through to `t.refundError` ("Refund failed"). Operators can't distinguish "stale list" (not-found) from "session has no payment" (no-payment-intent).
- **Fix (this cycle):** add 3 more localized strings (`refundErrorNotFound`, `refundErrorInvalidId`, `refundErrorNoPaymentIntent`) + 3 more cases. Keep 'unknown' falling through.

#### C4-RPF-05 — `customer_email` should be `.trim()`-ed defensively before lowercase + shape check

- File: `apps/web/src/app/api/stripe/webhook/route.ts:89-90`
- Reviewer: debugger (DBG-01)
- Severity: **Low** | Confidence: **Medium**
- **What:** EMAIL_SHAPE regex disallows whitespace via `[^\s]`. If a Stripe integration sends `' user@example.com '` (leading/trailing whitespace from copy-paste), the regex rejects it and the customer gets no token. Stripe normally trims, but defensive trim is cheap.
- **Fix (this cycle):** add `.trim()` before `.toLowerCase()`.

#### C4-RPF-06 — Parallelize realpath calls in download route

- File: `apps/web/src/app/api/download/[imageId]/route.ts:133-134`
- Reviewer: perf-reviewer (PERF-03)
- Severity: **Low** | Confidence: **High**
- **What:** `realpath(uploadsDir)` and `realpath(filePath)` are independent fs round-trips run serially. `Promise.all` saves one round-trip per download.
- **Fix (this cycle):** wrap in `Promise.all`.

#### C4-RPF-07 — Map Stripe SDK error TYPES (not just codes) in `mapStripeRefundError`

- File: `apps/web/src/app/actions/sales.ts:103-111`
- Reviewer: code-reviewer (CR-09)
- Severity: **Low** | Confidence: **High**
- **What:** `mapStripeRefundError` checks `e.code` for two values plus `e.type` for two values, defaulting to `'unknown'`. Stripe also uses `'StripeAuthenticationError'` (rotated key, ops issue) and `'StripeRateLimitError'` (rate limit, retry-after). Both currently map to 'unknown'.
- **Fix (this cycle):** add cases for these two error types. The existing `'unknown'` code remains the default.

#### C4-RPF-08 — Refund row button text duplicates AlertDialog confirm text rotation

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:226, 268`
- Reviewer: designer (UX-01)
- Severity: **Low** | Confidence: **Medium**
- **What:** Both row button and AlertDialog confirm rotate to `t.refunding` simultaneously. Per shadcn convention, the in-flight indicator goes on the dialog confirm only; the row button stays at `t.refundButton` text + `disabled` for in-flight feedback.
- **Fix (this cycle):** keep row button text at `t.refundButton`; rely on `disabled` for in-flight cue.

#### C4-RPF-09 — `errorLoad` div lacks `role="alert"` for AT announcement

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:163-165`
- Reviewer: designer (UX-02)
- Severity: **Low** | Confidence: **High**
- **What:** Server-side load failure is rendered as a static `<div>` without `role="alert"`. Screen readers don't announce it.
- **Fix (this cycle):** add `role="alert"`.

#### C4-RPF-10 — `LOG_PLAINTEXT_DOWNLOAD_TOKENS` env var not documented in `.env.local.example`

- File: `apps/web/.env.local.example`
- Reviewer: document-specialist (DOC-01)
- Severity: **Low** | Confidence: **Medium**
- **What:** README documents the env var (cycle 2 P260-15) but the example file does not list it.
- **Fix (this cycle):** add the var with a `# false` default and a one-line comment.

#### C4-RPF-11 — Source-contract tests for cycle 4 fixes

- File: `apps/web/src/__tests__/cycle4-rpf-source-contracts.test.ts` (new)
- Reviewer: test-engineer
- Severity: **Low** | Confidence: **High**
- **What:** Cycle 4's fixes need source-contract tests so a future revert is caught.
- **Fix (this cycle):** test for: (a) email slice limit equals 255 and matches schema, (b) `'unpaid'` branch uses `console.warn`, (c) `mapErrorCode` covers all 7 RefundErrorCode values.

### Deferred (with exit criteria)

#### C4-RPF-D01 — Sales table `expiresAt` column for support-triage UX

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:170-235`
- Reviewer: code-reviewer (CR-01)
- Defer: UX scope. Status badge already encodes expired state.
- Exit: at next admin polish-pass or first support ticket about "I paid yesterday and never got my email."

#### C4-RPF-D02 — `verifyTokenAgainstHash` Buffer.from try/catch is unreachable

- File: `apps/web/src/lib/download-tokens.ts:62-70`
- Reviewer: code-reviewer (CR-02)
- Defer: dead-code hardening; STORED_HASH_SHAPE regex makes catch unreachable in practice.
- Exit: when reviewing dead-error paths in next code-quality sweep.

#### C4-RPF-D03 — `image.title` Stripe truncation may slice mid-codepoint

- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:120-122`
- Reviewer: code-reviewer (CR-07)
- Defer: cosmetic; Stripe display usually normalizes; rare in practice.
- Exit: when next i18n / EXIF-title polish pass.

#### C4-RPF-D04 — Email Unicode NFC normalization

- File: `apps/web/src/app/api/stripe/webhook/route.ts:90`
- Reviewer: critic (CRIT-03)
- Defer: rare; Stripe normalizes outbound; would require `.normalize('NFC')`.
- Exit: when first dedup miss observed in production.

#### C4-RPF-D05 — Webhook race comment overstates ON DUPLICATE necessity

- File: `apps/web/src/app/api/stripe/webhook/route.ts:200-203`
- Reviewer: critic (CRIT-02), document-specialist (DOC-02)
- Defer: doc-only; behavior is correct (Stripe serial-delivery makes the race practically zero).
- Exit: at next webhook docs touch.

#### C4-RPF-D06 — Download route stream-error after claim is non-recoverable

- File: `apps/web/src/app/api/download/[imageId]/route.ts:192-205`
- Reviewer: critic (CRIT-06)
- Defer: residual race window is microseconds (lstat → createReadStream); requires DB transaction to unwind.
- Exit: when first observed incident.

#### C4-RPF-D07 — Webhook FK violation when image deleted between checkout and delivery

- File: `apps/web/src/app/api/stripe/webhook/route.ts:198-217`
- Reviewer: debugger (DBG-03)
- Defer: bounded by admin discipline; admin UI doesn't surface in-flight checkouts; refund flow handles customer.
- Exit: when admin UI starts surfacing pending entitlements.

#### C4-RPF-D08 — Sales page LIMIT 500 will benefit from pagination as data grows

- File: `apps/web/src/app/actions/sales.ts:32-52`
- Reviewer: perf-reviewer (PERF-02)
- Defer: admin-only; not on hot path; D04 mobile responsiveness joins this.
- Exit: when /admin/sales has >500 entitlements OR D04 lands.

#### C4-RPF-D09 — Carry-forward of cycle 1+2+3 deferred items

- All cycle 1+2+3 deferred items remain deferred under cycle 4. Same exit criteria preserved (see plan/plan-263-cycle3-rpf-end-only-deferred.md).
- Includes: C2-RPF-D08 (`stripe_refund_id`), C3-RPF-D01 through D11.

## Disposition completeness check

All findings accounted for:
- **Scheduled in cycle 4:** C4-RPF-01 through 11 (11 in-cycle items).
- **Deferred:** C4-RPF-D01 through D09 (9 items, including the carry-forward bucket).
- Cycles 1+2+3 RPF carry-forward: verified in code; nothing silently dropped.

## Severity totals

- HIGH: 0
- MEDIUM: 0
- LOW: 11 in-cycle, 8 deferred + carry-forward bucket

## AGENT FAILURES

None. All reviewer specialists completed without retry.
