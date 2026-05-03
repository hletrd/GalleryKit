# Cycle 8 RPF (end-only) — Aggregate Review

## Method

Multi-agent fan-in across: code-reviewer, security-reviewer, perf-reviewer,
critic, architect, test-engineer, verifier, debugger, document-specialist,
designer, tracer. All agents exercised; none failed.

## Gate baseline (fresh)

- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm run lint:api-auth` — clean
- `npm run lint:action-origin` — clean
- `npm test` — **991 passed across 112 files**
- `npm run build` — clean
- `npm run test:e2e` — DEFERRED (no MySQL in environment, carry-forward)
- `git status` — clean on master, 27 commits ahead of origin

## Cycles 1+2+3+4+5+6+7 RPF carry-forward verification

All cycles 1-7 RPF claims verified intact in current source
(`verifier-cycle8-rpf-end-only.md` table). All deferred items still
tracked. Nothing silently dropped.

## Cross-agent agreement (high-signal duplicates)

- **C8-RPF-CR-01 / C8-RPF-CRIT-01 / C8-RPF-ARCH-01 / C8-RPF-DBG-01 /
  C8-RPF-TR-01 / C8-RPF-SEC-01 / C8-RPF-TEST-01 / C8-RPF-DOC-01** —
  Seven agents converge on the same finding: the download route's
  lstat/realpath catch on line 151 of
  `apps/web/src/app/api/download/[imageId]/route.ts` uses the legacy
  positional log form, while the SAME file's stream-error catch on
  line 206 already follows the cycle 5/6/7 structured-object contract
  with `entitlementId` correlation key. This intra-file inconsistency
  is the only remaining catch on the paid-content surface that drops
  the `entitlementId` correlation key, breaking the audit chain.

## Findings (severity-sorted)

### HIGH

(none)

### MEDIUM

(none)

### LOW

#### C8-RPF-01 — Convert download lstat/realpath catch log to structured-object form

- File: `apps/web/src/app/api/download/[imageId]/route.ts:151`
- Reviewers: code-reviewer (CR-01), security-reviewer (SEC-01),
  architect (ARCH-01), debugger (DBG-01), tracer (TR-01),
  critic (CRIT-01), document-specialist (DOC-01)
- Severity: **Low** | Confidence: **High**
- **What:** `console.error('Download lstat/realpath error:', err)`
  uses positional 2nd-arg form. The same file's stream-error catch on
  line 206 already follows the cycle 5/6/7 structured-object contract
  (`console.error('Download stream error:', { entitlementId, code: errCode })`).
  The download route is the **paid asset delivery** path that consumes
  Stripe-issued entitlement tokens, so it carries the same audit /
  correlation semantics as the upstream Stripe surface.
- **Fix (this cycle):** convert to
  `console.error('Download lstat/realpath error', { entitlementId: entitlement.id, err })`.
  `entitlement` is in scope (fetched on line 55).

#### C8-RPF-02 — Source-contract test for cycle 8 fix

- File: `apps/web/src/__tests__/cycle8-rpf-source-contracts.test.ts` (new)
- Reviewers: test-engineer (TEST-01)
- Severity: **Low** | Confidence: **High**
- **Fix (this cycle):** test for:
  - C8-RPF-01: structured-object form on the lstat/realpath catch line,
    `entitlementId: entitlement.id` field present;
    legacy positional form (`'Download lstat/realpath error:'` with
    trailing colon and `err` as 2nd positional arg) absent.

### Deferred (with exit criteria)

#### C8-RPF-D01 — Identity mapper in listEntitlements (carry-forward C5/C6/C7-RPF-D01)
- File: `apps/web/src/app/actions/sales.ts:55-67`
- Reviewer: perf-reviewer (carry-forward)
- Defer: cosmetic; LIMIT 500 caps allocations.
- Exit: when next major sales-action refactor.

#### C8-RPF-D02 — Pre-validate `image.filename_original` for path separators (carry-forward C5/C6/C7-RPF-D02)
- File: `apps/web/src/app/api/download/[imageId]/route.ts:118`
- Defer: defense-in-depth; existing realpath+startsWith checks contain.
- Exit: when next download-route hardening pass.

#### C8-RPF-D03 — Length-cap `file` query param before `isValidBackupFilename` (carry-forward C5/C6/C7-RPF-D03)
- File: `apps/web/src/app/api/admin/db/download/route.ts:19`
- Defer: bounded by admin auth; regex rejects long values.
- Exit: at next admin-route hardening pass.

#### C8-RPF-D04 — Confirm dialog state-drift (carry-forward C5/C6/C7-RPF-D04)
- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:127-148`
- Defer: cosmetic; AlertDialog disabled covers primary path.
- Exit: at next admin polish pass.

#### C8-RPF-D05 — Behavior tests for `mapStripeRefundError` (carry-forward C5/C6/C7-RPF-D05)
- File: `apps/web/src/app/actions/sales.ts:121-145`
- Defer: requires exporting the function.
- Exit: when broader behavior-test pass for sales actions.

#### C8-RPF-D06 — Sales table pagination (carry-forward C5/C6/C7-RPF-D06)
- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:170-235`
- Defer: not on hot path; admin-only.
- Exit: when /admin/sales has >500 entitlements.

#### C8-RPF-D07 — Token shape check on token before SHA-256 (carry-forward C5/C6/C7-RPF-D07)
- File: `apps/web/src/lib/download-tokens.ts:53`
- Defer: bounded by SHA-256 lookup; defense-in-depth only.
- Exit: when broader download-route hardening pass.

#### C8-RPF-D08 — JSDoc Stripe error mapping table — add cycle 6 unknown-warn note (carry-forward C5/C6/C7-RPF-D08)
- File: `apps/web/src/app/actions/sales.ts:101-110`
- Reviewer: document-specialist (DOC-completeness)
- Defer: nice-to-have; cycle 5 P388-03 added the table, cycle 6 added inline warn comment.
- Exit: when broader sales-action doc pass.

#### C8-RPF-D09 — Webhook signature-replay log saturation (carry-forward C5/C6/C7-RPF-D09)
- File: `apps/web/src/app/api/stripe/webhook/route.ts:67`
- Defer: bounded by Stripe signature tolerance window.
- Exit: when first observed log-shipper saturation incident.

#### C8-RPF-D10 — Webhook async_payment_succeeded handler missing (carry-forward C5/C6/C7-RPF-D10)
- File: `apps/web/src/app/api/stripe/webhook/route.ts:69`
- Defer: ACH/OXXO not enabled in production.
- Exit: when ACH/OXXO is enabled.

#### C8-RPF-D11 — Tier-mismatch metric (carry-forward C5/C6/C7-RPF-D11)
- File: `apps/web/src/app/api/stripe/webhook/route.ts:212-218`
- Defer: no metrics infra.
- Exit: when metrics infra introduced.

#### C8-RPF-D12 — e2e gate not exercised this cycle (carry-forward C5/C6/C7-RPF-D12)
- Files: `apps/web/playwright.config.ts`, `apps/web/e2e/*.spec.ts`
- Severity: Informational. NOT downgraded.
- Reason: RPF cycle environment lacks `.env.local` and MySQL.
- Exit: re-open and run in any environment with `.env.local`+MySQL.

#### C8-RPF-D13 — `getTierPriceCents` could memoize prices (carry-forward C6/C7-RPF-D13)
- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:41-52`
- Defer: low traffic; one indexed lookup per checkout.
- Exit: when natural per-day traffic exceeds ~1000 checkouts/day.

#### C8-RPF-D14 — `getTierPriceCents` accepts non-positive prices via inner filter (carry-forward C6/C7-RPF-D14)
- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:51`
- Defer: caller's outer `> 0` filter saves it; cosmetic semantics drift only.
- Exit: at next checkout-route polish pass.

## Repo policy honored

- All deferrals are non-security, non-correctness, non-data-loss.
- All cycle 8 in-cycle fixes are Low severity, schedulable.
- Cycle 8 plan numbering will reuse the higher P392 sequence (P394+).
- GPG-signed commits per CLAUDE.md.
- Conventional Commits + gitmoji + no Co-Authored-By per AGENTS.md.
- `git pull --rebase` before push.

## Agent failures

None.
