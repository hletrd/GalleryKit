# Cycle 7 RPF (end-only) — Aggregate Review

## Method

Multi-agent fan-in across: code-reviewer, security-reviewer, perf-reviewer,
critic, architect, test-engineer, verifier, debugger, document-specialist,
designer, tracer. All agents exercised; none failed.

## Gate baseline (fresh)

- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm run lint:api-auth` — clean
- `npm run lint:action-origin` — clean
- `npm test` — **985 passed across 111 files**
- `npm run build` — clean
- `npm run test:e2e` — DEFERRED (no MySQL in environment, carry-forward)
- `git status` — clean on master, 21 commits ahead of origin

## Cycles 1+2+3+4+5+6 RPF carry-forward verification

All cycles 1-6 RPF claims verified intact in current source
(`verifier-cycle7-rpf-end-only.md`). All deferred items still tracked.
Nothing silently dropped.

## Cross-agent agreement (high-signal duplicates)

- **C7-RPF-CR-01..05 / C7-RPF-CRIT-01 / C7-RPF-ARCH-01 / C7-RPF-DBG-01 / C7-RPF-TR-01..03 / C7-RPF-SEC-01..03** — Five log lines on the Stripe surface remain in legacy positional 2nd-arg form (`console.error('label:', err)`) instead of the cycle 5/6 structured-object contract. Strong cross-agent agreement (8 agents converge on the same pattern). Each missing the corresponding correlation key (sessionId, imageId, entitlementId).

- **C7-RPF-CR-06 / C7-RPF-CRIT-02 / C7-RPF-ARCH-02 / C7-RPF-DOC-01 / C7-RPF-PERF-01** — `customer_email: undefined` at checkout route is dead-code noise: identical SDK behavior to omitting the key, but reads as TODO scaffolding. Five-agent convergence.

## Findings (severity-sorted)

### HIGH

(none)

### MEDIUM

(none)

### LOW

#### C7-RPF-01 — Convert checkout failure log to structured object form

- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:165`
- Reviewers: code-reviewer (CR-01), security-reviewer (SEC-01),
  architect (ARCH-01), debugger (DBG-01), tracer (TR-01),
  critic (CRIT-01)
- Severity: **Low** | Confidence: **High**
- **What:** `console.error('Stripe checkout session creation failed:', err)`
  uses positional 2nd-arg form — operators cannot grep by imageId. The
  cycle 5/6 contract (12+ webhook lines converted) calls for structured
  object with correlation keys.
- **Fix (this cycle):** convert to
  `console.error('Stripe checkout session creation failed', { imageId: image.id, ip, err })`.

#### C7-RPF-02 — Convert webhook signature-verify log to structured object form

- File: `apps/web/src/app/api/stripe/webhook/route.ts:67`
- Reviewers: code-reviewer (CR-02), architect (ARCH-01), debugger (DBG-02),
  critic (CRIT-01)
- Severity: **Low** | Confidence: **High**
- **What:** `console.error('Stripe webhook signature verification failed:', err)`
  is positional. Add `signatureLength` so operators can distinguish a
  malformed/truncated signature header from a genuine signature mismatch.
- **Fix (this cycle):** convert to
  `console.error('Stripe webhook signature verification failed', { signatureLength: signature.length, err })`.

#### C7-RPF-03 — Convert webhook insert-failure log to structured object form

- File: `apps/web/src/app/api/stripe/webhook/route.ts:309`
- Reviewers: code-reviewer (CR-03), security-reviewer (SEC-02),
  architect (ARCH-01), debugger (DBG-01), tracer (TR-02), critic (CRIT-01)
- Severity: **Low** | Confidence: **High**
- **What:** `console.error('Stripe webhook: failed to insert entitlement:', err)`
  drops sessionId/imageId/tier — keys an operator needs for retry analysis.
- **Fix (this cycle):** convert to
  `console.error('Stripe webhook: failed to insert entitlement', { sessionId, imageId, tier, err })`.

#### C7-RPF-04 — Convert refund failure log to structured object form

- File: `apps/web/src/app/actions/sales.ts:214`
- Reviewers: code-reviewer (CR-04), security-reviewer (SEC-03),
  architect (ARCH-01), debugger (DBG-01), tracer (TR-03), critic (CRIT-01)
- Severity: **Low** | Confidence: **High**
- **What:** `console.error('Stripe refund failed:', err)` is positional;
  missing entitlementId. Admin retries cannot be correlated.
- **Fix (this cycle):** convert to
  `console.error('Stripe refund failed', { entitlementId, err })`.

#### C7-RPF-05 — Convert listEntitlements failure log to structured object form

- File: `apps/web/src/app/actions/sales.ts:70`
- Reviewers: code-reviewer (CR-05), critic (CRIT-01)
- Severity: **Low** | Confidence: **Medium**
- **What:** `console.error('listEntitlements failed:', err)` is positional.
  Pure consistency fix.
- **Fix (this cycle):** convert to
  `console.error('listEntitlements failed', { err })`.

#### C7-RPF-06 — Drop dead `customer_email: undefined` key

- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:156`
- Reviewers: code-reviewer (CR-06), critic (CRIT-02), architect (ARCH-02),
  document-specialist (DOC-01), perf-reviewer (PERF-01)
- Severity: **Low** | Confidence: **Medium**
- **What:** Stripe SDK behavior is identical to omitting the key. Reads as
  TODO scaffolding. Five-agent convergence.
- **Fix (this cycle):** delete the line.

#### C7-RPF-07 — Source-contract tests for cycle 7 fixes

- File: `apps/web/src/__tests__/cycle7-rpf-source-contracts.test.ts` (new)
- Reviewers: test-engineer (TEST-01)
- Severity: **Low** | Confidence: **High**
- **Fix (this cycle):** test for:
  - C7-RPF-01: structured-object form on checkout catch line; assert no `'Stripe checkout session creation failed:'` (with trailing colon) survives.
  - C7-RPF-02: structured-object form on signature-verify line.
  - C7-RPF-03: structured-object form on insert-failure line, sessionId field present.
  - C7-RPF-04: structured-object form on refund catch, entitlementId field present.
  - C7-RPF-05: structured-object form on listEntitlements catch.
  - C7-RPF-06: assert `customer_email: undefined` is absent in checkout route.

### Deferred (with exit criteria)

#### C7-RPF-D01 — Identity mapper in listEntitlements (carry-forward C5-RPF-D01 / C6-RPF-D01)
- File: `apps/web/src/app/actions/sales.ts:55-67`
- Reviewer: perf-reviewer (carry-forward)
- Defer: cosmetic; LIMIT 500 caps allocations.
- Exit: when next major sales-action refactor.

#### C7-RPF-D02 — Pre-validate `image.filename_original` for path separators (carry-forward C5/C6-RPF-D02)
- File: `apps/web/src/app/api/download/[imageId]/route.ts:118`
- Defer: defense-in-depth; existing realpath+startsWith checks contain.
- Exit: when next download-route hardening pass.

#### C7-RPF-D03 — Length-cap `file` query param before `isValidBackupFilename` (carry-forward C5/C6-RPF-D03)
- File: `apps/web/src/app/api/admin/db/download/route.ts:19`
- Defer: bounded by admin auth; regex rejects long values.
- Exit: at next admin-route hardening pass.

#### C7-RPF-D04 — Confirm dialog state-drift (carry-forward C5/C6-RPF-D04)
- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:127-148`
- Defer: cosmetic; AlertDialog disabled covers primary path.
- Exit: at next admin polish pass.

#### C7-RPF-D05 — Behavior tests for `mapStripeRefundError` (carry-forward C5/C6-RPF-D05)
- File: `apps/web/src/app/actions/sales.ts:121-145`
- Defer: requires exporting the function.
- Exit: when broader behavior-test pass for sales actions.

#### C7-RPF-D06 — Sales table pagination (carry-forward C5/C6-RPF-D06)
- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:170-235`
- Defer: not on hot path; admin-only.
- Exit: when /admin/sales has >500 entitlements.

#### C7-RPF-D07 — Token shape check on token before SHA-256 (carry-forward C5/C6-RPF-D07)
- File: `apps/web/src/lib/download-tokens.ts:53`
- Defer: bounded by SHA-256 lookup; defense-in-depth only.
- Exit: when broader download-route hardening pass.

#### C7-RPF-D08 — JSDoc Stripe error mapping table — add cycle 6 unknown-warn note (carry-forward C5/C6-RPF-D08)
- File: `apps/web/src/app/actions/sales.ts:101-110`
- Reviewer: document-specialist (DOC-completeness)
- Defer: nice-to-have; cycle 5 P388-03 added the table, cycle 6 added inline warn comment, but the JSDoc table itself does not yet mention the unknown-branch warn.
- Exit: when broader sales-action doc pass.

#### C7-RPF-D09 — Webhook signature-replay log saturation (carry-forward C5/C6-RPF-D09)
- File: `apps/web/src/app/api/stripe/webhook/route.ts:67` (now structured per C7-RPF-02)
- Defer: bounded by Stripe signature tolerance window.
- Exit: when first observed log-shipper saturation incident.

#### C7-RPF-D10 — Webhook async_payment_succeeded handler missing (carry-forward C5/C6-RPF-D10)
- File: `apps/web/src/app/api/stripe/webhook/route.ts:69`
- Defer: ACH/OXXO not enabled in production.
- Exit: when ACH/OXXO is enabled.

#### C7-RPF-D11 — Tier-mismatch metric (carry-forward C5/C6-RPF-D11)
- File: `apps/web/src/app/api/stripe/webhook/route.ts:212-218`
- Defer: no metrics infra.
- Exit: when metrics infra introduced.

#### C7-RPF-D12 — e2e gate not exercised this cycle (carry-forward C5/C6-RPF-D12)
- Files: `apps/web/playwright.config.ts`, `apps/web/e2e/*.spec.ts`
- Severity: Informational. NOT downgraded.
- Reason: RPF cycle environment lacks `.env.local` and MySQL.
- Exit: re-open and run in any environment with `.env.local`+MySQL.

#### C7-RPF-D13 — `getTierPriceCents` could memoize prices (carry-forward C6-RPF-D13)
- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:41-52`
- Defer: low traffic; one indexed lookup per checkout.
- Exit: when natural per-day traffic exceeds ~1000 checkouts/day.

#### C7-RPF-D14 — `getTierPriceCents` accepts non-positive prices via inner filter (carry-forward C6-RPF-D14)
- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:51`
- Defer: caller's outer `> 0` filter saves it; cosmetic semantics drift only.
- Exit: at next checkout-route polish pass.

## Repo policy honored

- All deferrals are non-security, non-correctness, non-data-loss.
- All cycle 7 in-cycle fixes are Low severity, schedulable.
- Cycle 7 plan numbering will reuse the higher P390 sequence (P392+).
- GPG-signed commits per CLAUDE.md.
- Conventional Commits + gitmoji + no Co-Authored-By per AGENTS.md.
- `git pull --rebase` before push.

## Agent failures

None.
