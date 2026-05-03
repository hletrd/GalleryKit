# Cycle 3 RPF (end-only) — Aggregate Review

## Method

Multi-agent fan-in across: code-reviewer, security-reviewer, perf-reviewer,
critic, architect, test-engineer, verifier, debugger, document-specialist,
designer, tracer. All available specialists exercised; none failed.

## Gate baseline

- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run lint:api-auth` clean.
- `npm run lint:action-origin` clean.
- `npm test` 937 passed across 107 files.
- `git status` clean on master.

## Cycles 1+2 RPF carry-forward verification

All cycle 1 RPF claims verified in code (verifier-cycle3-rpf-end-only.md).
All cycle 2 RPF in-cycle fixes verified (P260-01..P260-15).

## Cross-agent agreement (high-signal duplicates)

- **C3-RPF-01 (`payment_status` gate)** — code-reviewer (HIGH-01), security-reviewer (HIGH-01), critic (CRITIC-01), debugger (DBG-HIGH-01), tracer (TR-H1). Five agents converge.
- **C3-RPF-02 (positive-amount gate)** — code-reviewer (HIGH-02), security-reviewer (HIGH-02). Two agents.
- **C3-RPF-03 (`Content-Disposition` filename safety)** — code-reviewer (MED-03), security-reviewer (MED-01), test-engineer (TEST-MED-03).
- **C3-RPF-04 (lstat before claim / token consumed on file failure)** — code-reviewer (MED-04), security-reviewer (MED-04), tracer (TR-M1). Three agents.
- **C3-RPF-05 (delete dead `getTotalRevenueCents`)** — code-reviewer (MED-02), critic (CRITIC-05), perf-reviewer (PERF-MED-01), architect (ARCH-LOW-02), debugger (DBG-LOW-04). Five agents.
- **C3-RPF-06 (download route hardcodes `data/uploads/original/` instead of using `UPLOAD_DIR_ORIGINAL`)** — critic (CRITIC-09), tracer (TR-M2), document-specialist (DOC-MED-02), architect (ARCH-LOW-04). Confirmed: download route bypasses `lib/upload-paths.ts` which DOES respect `UPLOAD_ORIGINAL_ROOT` env var, the Dockerfile sets `UPLOAD_ORIGINAL_ROOT=/app/data/uploads/original`, but the route hardcodes `path.resolve(process.cwd(), 'data', 'uploads', 'original')`. **Confirmed bug.** Any deployment with a different `UPLOAD_ORIGINAL_ROOT` (e.g., NFS mount) would 404.
- **C3-RPF-07 (Stripe retry generates a second token, second log line, but the second token is never stored)** — tracer (TR-M4) standalone but high signal. Idempotency contract is broken in the manual-distribution log.
- **C3-RPF-08 (refund row button + AlertDialog double-destructive)** — designer (MED-01), critic (CRITIC-03).

## Findings (severity-sorted)

### HIGH

#### C3-RPF-01 — Webhook does not gate on `session.payment_status === 'paid'`

- File: `apps/web/src/app/api/stripe/webhook/route.ts:57-94`
- Reviewers: code-reviewer, security-reviewer, critic, debugger, tracer
- Severity: **High** | Confidence: **High**
- **What:** `checkout.session.completed` fires for ALL payment methods including async (ACH, bank transfer, OXXO, Boleto). Without the gate, the webhook creates an entitlement and (under `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true`) writes the manual-distribution log line for an `'unpaid'` session. Operator emails the token; customer downloads; payment never settles.
- **Fix (this cycle):** Add `if (session.payment_status !== 'paid') { console.warn('skipping non-paid session', { sessionId, paymentStatus: session.payment_status }); return NextResponse.json({ received: true }); }` between signature verify and INSERT.

#### C3-RPF-02 — Webhook accepts `amount_total: 0` (coupon / 100%-off)

- File: `apps/web/src/app/api/stripe/webhook/route.ts:69`
- Reviewers: code-reviewer, security-reviewer
- Severity: **High** | Confidence: **High**
- **What:** Stripe coupons can drop `amount_total` to 0 in checkout. Webhook stores a $0 entitlement and writes a working download token. Photographer's revenue dashboard misrepresents free downloads as sales.
- **Fix (this cycle):** Add `if (!Number.isInteger(amountTotalCents) || amountTotalCents <= 0) { console.warn('skipping zero-amount session', { sessionId, amount: amountTotalCents }); return NextResponse.json({ received: true }); }`.

### MEDIUM

#### C3-RPF-03 — Download route hardcodes `data/uploads/original/` instead of using `UPLOAD_DIR_ORIGINAL`

- File: `apps/web/src/app/api/download/[imageId]/route.ts:120-121`
- Reviewers: critic, tracer, document-specialist, architect
- Severity: **Medium** | Confidence: **High**
- **What:** `path.resolve(process.cwd(), 'data', 'uploads', 'original')` is hardcoded. `lib/upload-paths.ts:UPLOAD_DIR_ORIGINAL` reads `UPLOAD_ORIGINAL_ROOT` env var. The Dockerfile sets `UPLOAD_ORIGINAL_ROOT=/app/data/uploads/original` (currently identical, so no observed bug). But: any deployment that overrides `UPLOAD_ORIGINAL_ROOT` (NFS mount, custom volume) breaks paid downloads with 404 ENOENT.
- **Fix (this cycle):** Replace the hardcoded path with `UPLOAD_DIR_ORIGINAL` from `@/lib/upload-paths`.

#### C3-RPF-04 — `Content-Disposition` filename injection via admin-controlled extension

- File: `apps/web/src/app/api/download/[imageId]/route.ts:142-148`
- Reviewers: code-reviewer, security-reviewer, test-engineer
- Severity: **Medium** | Confidence: **High**
- **What:** `path.extname(filename_original)` returns the substring after the last `.`. If admin-uploaded `filename_original` contains `";` or quotes after the last dot, those characters land verbatim in `Content-Disposition: attachment; filename="..."`.
- **Fix (this cycle):** Sanitize ext to `[a-zA-Z0-9.]` and length-cap to 8 chars before interpolation.

#### C3-RPF-05 — Atomic single-use claim consumes token even when file streaming fails (lstat-after-claim)

- File: `apps/web/src/app/api/download/[imageId]/route.ts:90-160`
- Reviewers: code-reviewer, security-reviewer, tracer
- Severity: **Medium** | Confidence: **High**
- **What:** UPDATE clears `downloadTokenHash` and sets `downloadedAt = NOW()` BEFORE lstat. If the original file is missing, customer hits 404 / 500 but token is gone. Customer is stuck.
- **Fix (this cycle):** Move lstat + realpath check BEFORE the atomic claim. If file is OK, then claim and stream.

#### C3-RPF-06 — Delete dead `getTotalRevenueCents` action and prop

- File: `apps/web/src/app/actions/sales.ts:75-91`, `page.tsx:10-13`, `sales-client.tsx:54,150-152`
- Reviewers: code-reviewer, critic, perf-reviewer, architect, debugger
- Severity: **Medium** | Confidence: **High**
- **What:** Dead code path post P260-05. Used as fallback when `rows.length === 0`, but in that case the all-time sum is 0 anyway. Only fires on silent error (where the UI also shows "No sales yet."). Kills the contradictory display, removes a full-table SUM per page load.
- **Fix (this cycle):** Delete the action; remove the import + Promise.all arm in page.tsx; drop the prop in sales-client.tsx.

#### C3-RPF-07 — Stripe webhook retries write a second `[manual-distribution]` log line with a token that was NEVER stored

- File: `apps/web/src/app/api/stripe/webhook/route.ts:126-163`
- Reviewers: tracer (TR-M4)
- Severity: **Medium** | Confidence: **High**
- **What:** On Stripe retry, `generateDownloadToken()` produces a fresh token. The INSERT is a no-op (sessionId UNIQUE → ON DUPLICATE KEY UPDATE). The plaintext log line writes the new token. Operator running `tail -1` emails token2 → customer's download fails (DB has token1's hash).
- **Fix (this cycle):** Check whether the INSERT was a fresh insert (affectedRows === 1) vs ON DUPLICATE (affectedRows === 2 in MySQL). Only log the manual-distribution line on fresh insert. Skip the entire token + log path on retry.

#### C3-RPF-08 — Row Refund button is `variant="destructive"` AND opens an AlertDialog with destructive confirm

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:206-217`
- Reviewers: designer, critic
- Severity: **Medium** (UX) | Confidence: **High**
- **What:** Two layers of red. The shadcn convention places destructive emphasis on the dialog confirm button only.
- **Fix (this cycle):** Change row Refund button to `variant="outline"`. Keep AlertDialog action as destructive.

### LOW

#### C3-RPF-09 — `customer_email` not lowercased before INSERT

- File: `apps/web/src/app/api/stripe/webhook/route.ts:66-67`
- Reviewer: security-reviewer (LOW-02)
- Severity: **Low** | Confidence: **Medium**
- **Fix (this cycle):** `.toLowerCase()` after the slice. Also lowercase before EMAIL_SHAPE check.

#### C3-RPF-10 — `errorLoad` prop renders server English string verbatim

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/page.tsx:45`, `sales-client.tsx:163-165`
- Reviewers: code-reviewer (LOW-06), critic (CRITIC-06)
- Severity: **Low** | Confidence: **High**
- **Fix (this cycle):** When `salesResult.error` is truthy, page passes `t('errorLoad')`. Add the i18n key.

#### C3-RPF-11 — Webhook missing-metadata branch logs `console.error` but tier-allowlist / amount / payment_status branches log `console.warn`

- Files: `apps/web/src/app/api/stripe/webhook/route.ts:84-106`
- Reviewer: critic (CRITIC-04)
- Severity: **Low** | Confidence: **High**
- **What:** Operators usually have alerts on `console.error` but not `console.warn`. Tier reject / async-pay reject / zero-amount reject are silent failures.
- **Fix (this cycle):** Escalate the tier / amount / payment_status reject branches to `console.error` (in addition to the existing missing-metadata branch).

#### C3-RPF-12 — Add source-contract tests for cycle 3 fixes

- Files: `apps/web/src/__tests__/stripe-webhook-source.test.ts`, new tests
- Reviewer: test-engineer
- Severity: **Low** | Confidence: **High**
- **Fix (this cycle):** Add tests asserting:
  - `payment_status !== 'paid'` guard precedes INSERT
  - `amountTotalCents <= 0` guard precedes INSERT
  - `Content-Disposition` filename has sanitization (`replace` of non-alnum)
  - `lstat(...)` precedes `.update(entitlements).set({ downloadedAt:` in download route
  - `customerEmail` lowercased before INSERT
  - download route imports `UPLOAD_DIR_ORIGINAL` from upload-paths

#### C3-RPF-13 — `download-tokens.ts` JSDoc lacks "lowercase" qualifier

- File: `apps/web/src/lib/download-tokens.ts:8-15`
- Reviewer: document-specialist (LOW-06)
- Severity: **Informational** | Confidence: **High**
- **Fix (this cycle):** Update JSDoc to say lowercase hex.

### Deferred (with exit criteria)

#### C3-RPF-D01 — Refund action TOCTOU on `refunded` flag

- File: `apps/web/src/app/actions/sales.ts:120-167`
- Reviewers: code-reviewer (MED-01), security-reviewer (MED-03)
- Defer: the row-side `if (row.refunded)` plus Stripe's own `charge_already_refunded` mapping bound the practical risk; the wasted-Stripe-call cost is bounded.
- Exit: when first Stripe rate-limit pressure observed, OR when `stripe_refund_id` schema migration (C2-RPF-D08) lands.

#### C3-RPF-D02 — Refund Stripe-vs-DB split-brain (Stripe succeeds, DB update fails)

- File: `apps/web/src/app/actions/sales.ts:142-167`
- Reviewer: debugger (MED-02), tracer (TR-M3)
- Defer: requires `stripe_refund_id` persistence (C2-RPF-D08) for safe replay.
- Exit: when migration 0014 ships.

#### C3-RPF-D03 — Webhook event-type dispatcher is in-line; will balloon as event types grow

- File: `apps/web/src/app/api/stripe/webhook/route.ts:57-164`
- Reviewer: architect (MED-01)
- Defer: refactor scope; current single-event handler is correct.
- Exit: when adding `checkout.session.async_payment_succeeded` or `charge.refunded` event handling.

#### C3-RPF-D04 — Sales table not responsive on small screens

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:170-222`
- Reviewer: designer (MED-02)
- Defer: refactor scope; admin /sales is desktop-primary.
- Exit: when first usage analytics show meaningful mobile admin sessions, or when next admin polish-pass.

#### C3-RPF-D05 — Buy button lacks aria-label with photo title

- File: `apps/web/src/components/photo-viewer.tsx:450-494`
- Reviewer: designer (LOW-04)
- Defer: photo-viewer cycle 1 RPF added many a11y improvements; this is cosmetic.
- Exit: at next a11y audit pass.

#### C3-RPF-D06 — Customer email cell needs `break-all` styling

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:199`
- Reviewer: designer (LOW-05)
- Defer: cosmetic; only affects very long emails.
- Exit: at next product polish-pass.

#### C3-RPF-D07 — `LOG_PLAINTEXT_DOWNLOAD_TOKENS` retention warning in docs

- File: `apps/web/README.md:67-75`, `apps/web/.env.local.example`
- Reviewers: security-reviewer (MED-02), document-specialist (LOW-01)
- Defer (in-cycle subset): add the retention sentence in this cycle. Larger redaction-rule additions defer.
- Exit: when log-shipper guidance becomes a real operator question.

#### C3-RPF-D08 — `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` shape validation

- File: `apps/web/src/lib/stripe.ts`
- Reviewers: security-reviewer (LOW-05), architect (LOW-03)
- Defer: cosmetic safety net; any garbage value fails fast at first Stripe call anyway.
- Exit: when first deployment misconfig surfaces.

#### C3-RPF-D09 — `stripe_refund_id` persistence (carry-forward C2-RPF-D08)

- File: schema, sales action
- Defer: migration 0014 scope.

#### C3-RPF-D10 — Move `deriveLocaleFromReferer` out of `lib/license-tiers.ts`

- File: `apps/web/src/lib/license-tiers.ts:46-60`
- Reviewer: architect (LOW-01)
- Defer: cosmetic refactor; helpers work as-is.
- Exit: at next i18n-utility pass.

#### C3-RPF-D11 — Carry-forward of cycle 2 deferred items D01, D03, D05, D06, D08, D10, D11, D12, D13, D15, D16, D17

- See `plan/plan-261-cycle2-rpf-end-only-deferred.md`. Re-deferred for cycle 3 with same exit criteria. Cycle 3 closes D02 (delete `getTotalRevenueCents`) and D04 (lstat-before-claim aligned with C3-RPF-05).

## Disposition completeness check

Every cycle 3 RPF aggregate finding is accounted for:
- Scheduled in Plan 262 (cycle 3 RPF in-cycle): C3-RPF-01..13.
- Deferred in Plan 263: D01, D02, D03, D04, D05, D06, D07 (broader docs), D08, D09, D10, D11.
- Cycle 1+2 RPF carry-forward: verified in code; nothing silently dropped.

## AGENT FAILURES

None.

## Summary

Cycle 3 RPF surfaces two HIGH-severity correctness bugs in the Stripe paid-downloads path that cycles 1+2 missed because both reviewers were focused on UI/UX and on the manual-distribution closure rather than on Stripe webhook semantics:

1. The webhook treats `checkout.session.completed` as paid, but Stripe's contract says async payment methods can fire the event with `payment_status: 'unpaid'`.
2. The webhook accepts `amount_total: 0` from coupon flows, recording free downloads as sales.

The rest are MED/LOW polish, dead-code removal, idempotency tightening (Stripe retry double-token), env-path correctness (download route hardcoded path), filename safety, lstat-before-claim ordering, double-destructive UI styling, and i18n consistency. Total cycle 3 in-cycle work: 13 items. Deferred: 11 items (mostly carry-forward + scope-bounded items requiring schema migrations).
