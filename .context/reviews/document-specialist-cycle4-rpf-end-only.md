# Cycle 4 RPF (end-only) — Document Specialist

## Method
Audited code comments vs. behavior, JSDoc accuracy, README coverage of new
behaviors, env-var docs.

## Findings

### LOW

#### C4-RPF-DOC-01 — `apps/web/.env.local.example` missing `LOG_PLAINTEXT_DOWNLOAD_TOKENS`

- File: `apps/web/.env.local.example`
- The cycle 2 RPF P260-01 fix adds an env var that gates plaintext token logging. README documents it but `.env.local.example` does not list it as a configurable.
- Severity: **Low** | Confidence: **Medium**
- **In-cycle fix:** add the var with a `# false` default and a one-line comment.

#### C4-RPF-DOC-02 — Webhook comment at lines 200-203 overstates ON DUPLICATE race protection

- File: `apps/web/src/app/api/stripe/webhook/route.ts:200-203`
- The comment says "this ON DUPLICATE KEY UPDATE remains as belt-and-suspenders against a race between the SELECT and the INSERT." Stripe webhook deliveries are serially-ordered per event_id (Stripe holds the next retry until the prior is acked or times out). The race is practically zero.
- Severity: **Informational** | Confidence: **Medium**
- **Defer:** comment can be tightened in a future doc pass; no behavioral impact.

#### C4-RPF-DOC-03 — `apps/web/src/lib/download-tokens.ts` JSDoc accurate (cycle 3 P262-13 update verified)

- File: `apps/web/src/lib/download-tokens.ts:6`
- Cycle 3 P262-13 added "lowercase" qualifier to the JSDoc. Verified at line 6 (`lowercase SHA-256 hex digest`).
- **No action needed.**

#### C4-RPF-DOC-04 — `apps/web/README.md` lacks a "Stripe webhook idempotency" section

- File: `apps/web/README.md`
- Cycle 3 P262-07 added the SELECT-before-INSERT for idempotency. Operators don't need to know the implementation, but the operator workflow page doesn't explicitly say "Stripe retries are safe; do not manually re-deliver events."
- Severity: **Informational** | Confidence: **Medium**
- **Defer:** Stripe SDK already documents this; README doesn't need to repeat.

#### C4-RPF-DOC-05 — Sales /admin doc missing for new operators

- File: `apps/web/README.md`
- Documents the operator paid-downloads workflow but not the /admin/sales page itself (where to find it, what statuses mean, when to refund).
- Severity: **Informational** | Confidence: **Medium**
- **Defer:** UX-discoverable; future doc pass.

#### C4-RPF-DOC-06 — Webhook comment mentions `checkout.session.async_payment_succeeded` as future work

- File: `apps/web/src/app/api/stripe/webhook/route.ts:67-69`
- Comment says "Async-paid flows are not currently supported; a future cycle should add a handler for `checkout.session.async_payment_succeeded` to round out coverage." Aligns with cycle 1+2 PRD which gates async flows behind D03.
- **No action needed.** Comment correctly flags future work.

## Aggregate severity

- HIGH: 0
- MEDIUM: 0
- LOW: 1 in-cycle (DOC-01)
- INFO: 5

## In-cycle scheduling proposal

- C4-RPF-DOC-01 — add `LOG_PLAINTEXT_DOWNLOAD_TOKENS` to `.env.local.example`.
