# Cycle 6 RPF (end-only) — Aggregate Review

## Method

Multi-agent fan-in across: code-reviewer, security-reviewer, perf-reviewer,
critic, architect, test-engineer, verifier, debugger, document-specialist,
designer, tracer. All agents exercised; none failed.

## Gate baseline (fresh)

- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm run lint:api-auth` — clean
- `npm run lint:action-origin` — clean
- `npm test` — **979 passed across 110 files**
- `npm run build` — clean (route table prints, standalone output)
- `npm run test:e2e` — DEFERRED (no MySQL in environment, carry-forward)
- `git status` — clean on master, 15 commits ahead of origin

## Cycles 1+2+3+4+5 RPF carry-forward verification

All cycle 1, 2, 3, 4, 5 RPF claims verified intact in current source
(`verifier-cycle6-rpf-end-only.md`). All deferred items still tracked.
Nothing silently dropped.

## Cross-agent agreement (high-signal duplicates)

- **C6-RPF-CR-02 / C6-RPF-SEC-01 / C6-RPF-ARCH-01 / C6-RPF-DBG-01 /
  C6-RPF-TR-01** — `stripe.checkout.sessions.create` lacks
  Idempotency-Key. Five agents converge: code-reviewer, security,
  architect, debugger, tracer. High-signal. Direct parallel to cycle
  5's P388-01 refund-idempotency fix.

- **C6-RPF-CR-01 / C6-RPF-SEC-02 / C6-RPF-ARCH-02 / C6-RPF-DBG-02 /
  C6-RPF-TR-02** — Webhook line 195 invalid-imageId log uses
  positional non-structured form (`console.error('label', imageIdStr)`)
  instead of the cycle-5 structured-object form. Missing sessionId
  correlation key. Five agents converge.

- **C6-RPF-CR-03 / C6-RPF-SEC-05 / C6-RPF-ARCH-03 / C6-RPF-DBG-04 /
  C6-RPF-TR-03 / C6-RPF-DOC-01** — Refund action's `error` field exposes
  Stripe `err.message` to the client (latent leak). Doc says "only
  errorCode crosses"; code returns `err.message` too. Six-agent agreement.

- **C6-RPF-CRIT-03 / C6-RPF-DBG-03 / C6-RPF-TR-04** — `mapStripeRefundError`
  unknown branch silently swallows new Stripe error types; no
  proactive ops signal. Three-agent agreement.

- **C6-RPF-CR-04 / C6-RPF-DBG-05 / C6-RPF-TR-05** — Webhook oversized-email
  reject log lacks `cap: 255` self-description. Three-agent agreement.

## Findings (severity-sorted)

### HIGH

(none)

### MEDIUM

(none)

### LOW

#### C6-RPF-01 — Add Stripe Idempotency-Key to Checkout session creation

- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:123`
- Reviewers: code-reviewer (CR-02), security-reviewer (SEC-01),
  architect (ARCH-01), debugger (DBG-01), tracer (TR-01)
- Severity: **Low** | Confidence: **High**
- **What:** `stripe.checkout.sessions.create({...})` POSTs without an
  Idempotency-Key. Cycle 5 P388-01 added one to `stripe.refunds.create`
  for the same Stripe-best-practice reason. Without it, a browser
  double-click creates two unrelated Checkout sessions; user pays one,
  the second remains pending until Stripe times it out (~24h),
  cluttering the dashboard.
- **Fix (this cycle):** pass
  `{ idempotencyKey: \`checkout-${image.id}-${ip}-${Math.floor(Date.now() / 60_000)}\` }`
  as the second argument. Minute-granularity bound keeps distinct
  legitimate buys separate while collapsing rapid double-clicks.

#### C6-RPF-02 — Convert webhook invalid-imageId log to structured-object form (with sessionId)

- File: `apps/web/src/app/api/stripe/webhook/route.ts:195`
- Reviewers: code-reviewer (CR-01), security-reviewer (SEC-02),
  architect (ARCH-02), debugger (DBG-02), tracer (TR-02)
- Severity: **Low** | Confidence: **High**
- **What:** Cycle 5 P388-02 converted the two known legacy log lines
  (idempotent skip, entitlement created) to structured-object form.
  Line 195 is the third surviving outlier:
  `console.error('Stripe webhook: invalid imageId in metadata', imageIdStr)`.
  positional 2nd-arg, no sessionId correlation key, hard to grep.
- **Fix (this cycle):** convert to
  `console.error('Stripe webhook: invalid imageId in metadata', { sessionId, imageIdStr })`.

#### C6-RPF-03 — Drop `err.message` from refund action's error return

- File: `apps/web/src/app/actions/sales.ts:147,201-205`
- Reviewers: code-reviewer (CR-03), security-reviewer (SEC-05),
  architect (ARCH-03), debugger (DBG-04), tracer (TR-03),
  document-specialist (DOC-01)
- Severity: **Low** | Confidence: **Medium**
- **What:** The action's `error` field returns `err.message` (which can
  contain Stripe request IDs). The docblock at line 88-93 says "only
  the mapped identifier crosses the action boundary to the client".
  Doc-code mismatch. The client only consumes `errorCode`, so the
  field is latent dead surface — but a future careless change could
  leak Stripe request IDs into UI toasts.
- **Fix (this cycle):** drop `error` from the action's failure-path
  return shape (and from the `RefundEntitlementResult` type/inline
  return type). Keep it only for non-Stripe errors (origin guard,
  invalid-id) where it carries the localized message.

#### C6-RPF-04 — Warn on unrecognized Stripe error types in `mapStripeRefundError`

- File: `apps/web/src/app/actions/sales.ts:144`
- Reviewers: critic (CRIT-03), debugger (DBG-03), tracer (TR-04)
- Severity: **Low** | Confidence: **Medium**
- **What:** When Stripe ships a new error type, the mapping table
  silently routes it to 'unknown'. No proactive ops signal — operators
  only learn via customer complaint. A `console.warn` inside the
  unknown branch surfaces emerging Stripe types proactively.
- **Fix (this cycle):** add
  `console.warn('Stripe refund: unrecognized error type', { name, type, code })`
  inside the unknown branch. Keep silent in test env via
  `process.env.NODE_ENV !== 'test'` guard.

#### C6-RPF-05 — Add `cap` to webhook oversized-email reject log

- File: `apps/web/src/app/api/stripe/webhook/route.ts:133-140`
- Reviewers: code-reviewer (CR-04), debugger (DBG-05), tracer (TR-05)
- Severity: **Low** | Confidence: **Medium**
- **What:** The reject log emits `length` of the trimmed raw email but
  not the threshold (255). Operator triage requires consulting source.
- **Fix (this cycle):** add `cap: 255` to the structured payload so the
  log is self-describing.

#### C6-RPF-06 — Source-contract tests for cycle 6 fixes

- File: `apps/web/src/__tests__/cycle6-rpf-source-contracts.test.ts` (new)
- Reviewers: test-engineer (TEST-01)
- Severity: **Low** | Confidence: **High**
- **What:** Cycle 6 fixes need source-contract tests so a future revert
  is caught.
- **Fix (this cycle):** test for:
  - C6-RPF-01: `stripe.checkout.sessions.create(...)` followed by
    `idempotencyKey: \`checkout-...\`` in same call
  - C6-RPF-02: invalid-imageId log uses structured object with
    sessionId + imageIdStr fields
  - C6-RPF-03: refund catch path does NOT include `err.message`
    in the `error` field (or `error` field is absent)
  - C6-RPF-04: unknown-branch warn line present
  - C6-RPF-05: oversized-email reject log includes `cap: 255`

### Deferred (with exit criteria)

#### C6-RPF-D01 — Identity mapper in listEntitlements (carry-forward C5-RPF-D01)
- File: `apps/web/src/app/actions/sales.ts:55-67`
- Reviewer: perf-reviewer (PERF-02)
- Defer: cosmetic; LIMIT 500 caps allocations.
- Exit: when next major sales-action refactor.

#### C6-RPF-D02 — Pre-validate `image.filename_original` for path separators (carry-forward C5-RPF-D02)
- File: `apps/web/src/app/api/download/[imageId]/route.ts:118`
- Reviewer: code-reviewer (carry-forward)
- Defer: defense-in-depth; existing realpath+startsWith checks contain.
- Exit: when next download-route hardening pass.

#### C6-RPF-D03 — Length-cap `file` query param before `isValidBackupFilename` (carry-forward C5-RPF-D03)
- File: `apps/web/src/app/api/admin/db/download/route.ts:19`
- Defer: bounded by admin auth; regex rejects long values.
- Exit: at next admin-route hardening pass.

#### C6-RPF-D04 — Confirm dialog state-drift (carry-forward C5-RPF-D04)
- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:127-148`
- Reviewers: critic (CRIT-05), designer (UX-01)
- Defer: cosmetic; AlertDialog disabled covers primary path.
- Exit: at next admin polish pass.

#### C6-RPF-D05 — Behavior tests for `mapStripeRefundError` (carry-forward C5-RPF-D05)
- File: `apps/web/src/app/actions/sales.ts:121-145`
- Reviewer: test-engineer (TEST-02)
- Defer: requires exporting the function.
- Exit: when broader behavior-test pass for sales actions.

#### C6-RPF-D06 — Sales table pagination (carry-forward C5-RPF-D06)
- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:170-235`
- Defer: not on hot path; admin-only.
- Exit: when /admin/sales has >500 entitlements.

#### C6-RPF-D07 — Token shape check on token before SHA-256 (carry-forward C5-RPF-D07)
- File: `apps/web/src/lib/download-tokens.ts:53`
- Defer: bounded by SHA-256 lookup; defense-in-depth only.
- Exit: when broader download-route hardening pass.

#### C6-RPF-D08 — JSDoc Stripe error mapping table (carry-forward C5-RPF-D08)
- File: `apps/web/src/app/actions/sales.ts:101-110`
- Reviewer: document-specialist (DOC-04)
- Defer: nice-to-have. NOTE: Cycle 5 P388-03 actually ADDED a JSDoc
  table at lines 101-110, so this is partially closed already. Remaining
  scope: explicit mapping for the cycle-6 unknown-branch warn.
- Exit: when broader sales-action doc pass.

#### C6-RPF-D09 — Webhook signature-replay log saturation (carry-forward C5-RPF-D09)
- File: `apps/web/src/app/api/stripe/webhook/route.ts:258`
- Defer: bounded by Stripe signature tolerance window.
- Exit: when first observed log-shipper saturation incident.

#### C6-RPF-D10 — Webhook async_payment_succeeded handler missing (carry-forward C5-RPF-D10)
- File: `apps/web/src/app/api/stripe/webhook/route.ts:69`
- Defer: ACH/OXXO not enabled in production.
- Exit: when ACH/OXXO is enabled.

#### C6-RPF-D11 — Tier-mismatch metric (carry-forward C5-RPF-D11)
- File: `apps/web/src/app/api/stripe/webhook/route.ts:212-218`
- Defer: no metrics infra.
- Exit: when metrics infra introduced.

#### C6-RPF-D12 — e2e gate not exercised this cycle (carry-forward C5-RPF-D12)
- Files: `apps/web/playwright.config.ts`, `apps/web/e2e/*.spec.ts`
- Severity: Informational. NOT downgraded.
- Reason: RPF cycle environment lacks `.env.local` and MySQL.
- Exit: re-open and run in any environment with `.env.local`+MySQL.
- Repo rule honored: cycle prompt's no-suppression rule applies to
  errors, not environmental absence.

#### C6-RPF-D13 — `getTierPriceCents` could memoize prices (perf, low-traffic)
- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:41-52`
- Reviewer: perf-reviewer (PERF-01)
- Defer: low traffic; one indexed lookup per checkout.
- Exit: when natural per-day traffic exceeds ~1000 checkouts/day.

#### C6-RPF-D14 — `getTierPriceCents` accepts non-positive prices via inner filter (cosmetic)
- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:51`
- Reviewer: code-reviewer (CR-07)
- Defer: caller's outer `> 0` filter saves it; cosmetic semantics drift only.
- Exit: at next checkout-route polish pass.

## Repo policy honored

- All deferrals are non-security, non-correctness, non-data-loss.
- All cycle 6 in-cycle fixes are Low severity, schedulable.
- Cycle 6 plan numbering will reuse the higher P388 sequence (P390+).
- GPG-signed commits per CLAUDE.md.
- Conventional Commits + gitmoji + no Co-Authored-By per AGENTS.md
  and CLAUDE.md.
- `git pull --rebase` before push.

## Agent failures

None.
