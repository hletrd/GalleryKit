# Plan 266 — Cycle 5 (RPF, end-only deploy) implementation fixes

This plan addresses the seven new findings from
`.context/reviews/_aggregate-cycle5-rpf-end-only.md`. Each finding is Low
severity but each represents a real defense-in-depth, ops-UX, or
log-consistency improvement. All are schedulable for this cycle since
they are small, isolated edits with unit-test coverage.

## Source review

`.context/reviews/_aggregate-cycle5-rpf-end-only.md`
+ provenance per-agent files `*-cycle5-rpf-end-only.md` in same dir.

## Repo policy honored

Per `CLAUDE.md` and `AGENTS.md`:
- GPG-sign every commit (`-S`).
- Commit small / fine-grained: one feature/fix per commit.
- `git pull --rebase` before push.
- Conventional Commits + gitmoji format.
- No `Co-Authored-By` lines.
- Latest stable Node 24 / Next 16 / React 19 / TypeScript 6 (already in
  use).

## Tasks

### Task 1 — Add Stripe Idempotency-Key to refund mutation (C5-RPF-01)
**File:** `apps/web/src/app/actions/sales.ts`
**Severity:** LOW (High confidence)
**Why:** Stripe Idempotency-Key is best-practice for POST mutations.
Without it, a transient network error during refund or a browser
double-click could lead Stripe to receive two refund attempts. Stripe
auto-rejects the second with `charge_already_refunded`, which the UI
maps to a confusing "already-refunded" toast on a successful refund.
**Change:** pass `{ idempotencyKey: \`refund-${entitlementId}\` }` as
the second argument to `stripe.refunds.create`. The deterministic key
allows safe retries.

### Task 2 — Convert legacy webhook log lines to structured-object form (C5-RPF-02)
**File:** `apps/web/src/app/api/stripe/webhook/route.ts`
**Severity:** LOW (High confidence)
**Why:** All cycle 1-4 webhook log lines use structured object form
(`{ sessionId, ... }`). Two pre-existing legacy lines use template
literal interpolation, which costs more in log-shipper parsing.
**Change:** convert
- line 216: `console.info(\`Stripe webhook: idempotent skip — entitlement already exists session=${sessionId}\`)`
  → `console.info('Stripe webhook: idempotent skip', { sessionId })`
- line 268: `console.info(\`Entitlement created: imageId=${imageId} tier=${tier} session=${sessionId}\`)`
  → `console.info('Entitlement created', { imageId, tier, sessionId })`

### Task 3 — Split `'auth-error'` from `'network'` in RefundErrorCode (C5-RPF-03)
**Files:** `apps/web/src/app/actions/sales.ts`,
`apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx`,
`apps/web/src/app/[locale]/admin/(protected)/sales/page.tsx`,
`apps/web/messages/en.json`, `apps/web/messages/ko.json`
**Severity:** LOW (Medium confidence)
**Why:** `StripeAuthenticationError` (rotated key, requires ops to
rotate STRIPE_SECRET_KEY) and `StripeConnectionError` (transient
network) both map to `'network'`. Operators see "try again shortly"
even when the actual fix is to rotate the API key.
**Change:**
- Add `'auth-error'` to the `RefundErrorCode` union.
- In `mapStripeRefundError`, return `'auth-error'` for
  `StripeAuthenticationError` (split it from `'network'`).
- Keep `StripeRateLimitError` → `'network'` (transient by definition).
- Add `refundErrorAuth` localized string to en.json and ko.json.
- Wire through page.tsx → sales-client.tsx mapErrorCode switch.

### Task 4 — Hoist `EMAIL_SHAPE` regex to module scope (C5-RPF-04)
**File:** `apps/web/src/app/api/stripe/webhook/route.ts`
**Severity:** LOW (High confidence)
**Why:** Consistency with `STORED_HASH_SHAPE` in download-tokens.ts.
**Change:** move `const EMAIL_SHAPE = /.../;` from inside POST handler
to module scope above `export async function POST`.

### Task 5 — Handle non-Error throws (AbortError) in `mapStripeRefundError` (C5-RPF-05)
**File:** `apps/web/src/app/actions/sales.ts`
**Severity:** LOW (Medium confidence)
**Why:** `instanceof Error` returns 'unknown' for non-Error throws
(e.g. AbortError DOMException). Falls through to a generic toast.
**Change:** before the `instanceof Error` guard, check
`(err as { name?: string })?.name === 'AbortError'` and check for
common network error codes (`ETIMEDOUT`, `ECONNREFUSED`); both map to
`'network'`. Else preserve the existing instanceof check.

### Task 6 — Reject 256+-char raw email instead of silent-truncate (C5-RPF-06)
**File:** `apps/web/src/app/api/stripe/webhook/route.ts`
**Severity:** LOW (Medium confidence)
**Why:** Cycle 4 P264-01 set the slice to 255, but truncation is silent.
A misconfigured email longer than 255 chars could still pass
`EMAIL_SHAPE` (rare, 250-char-local + valid domain fits 255) and get
persisted with a different mailbox than the customer intended.
**Change:** if `customerEmailRaw.trim().length > 255`, log and reject
(200, no retry). Slice remains for the legitimate sub-255 case.

### Task 7 — Source-contract tests for cycle 5 fixes (C5-RPF-07)
**File:** `apps/web/src/__tests__/cycle5-rpf-source-contracts.test.ts` (new)
**Severity:** LOW (High confidence)
**Why:** Cycle 5's fixes need source-contract tests so a future revert
is caught.

### Task 8 — Verify all gates and ensure 970+ tests pass
- `npm run lint`
- `npm run typecheck`
- `npm run lint:api-auth`
- `npm run lint:action-origin`
- `npm test`
- `npm run build`
- `npm run test:e2e` — DEFERRED: requires DB + dev server, not available
  in this RPF cycle environment (see plan-267).

## Commit plan (fine-grained, GPG-signed, gitmoji + conventional)

1. `feat(sales): :sparkles: pass Stripe idempotency-key on refund (P266-01)`
2. `refactor(api): :recycle: structured-object logs for webhook idempotency + entitlement-created lines (P266-02)`
3. `feat(sales): :sparkles: split auth-error from network in RefundErrorCode (P266-03)`
4. `refactor(api): :recycle: hoist EMAIL_SHAPE regex to module scope (P266-04)`
5. `fix(sales): :bug: detect non-Error throws (AbortError + common net codes) in mapStripeRefundError (P266-05)`
6. `fix(api): :lock: reject 256+-char raw customer email instead of silent-truncate (P266-06)`
7. `test(stripe): :white_check_mark: cycle 5 source-contract tests (P266-07)`
8. `docs(plan): :memo: archive plan-266 cycle 5 RPF end-only fixes`

## Progress

- [x] Plan written
- [x] Task 1 — implemented (sales.ts:188-191 idempotencyKey)
- [x] Task 2 — implemented (webhook.ts structured logs)
- [x] Task 3 — implemented (auth-error path through code+i18n+page+client)
- [x] Task 4 — implemented (EMAIL_SHAPE hoisted)
- [x] Task 5 — implemented (AbortError + ETIMEDOUT/ECONNREFUSED)
- [x] Task 6 — implemented (256+ raw email reject)
- [x] Task 7 — implemented (cycle5-rpf-source-contracts.test.ts)
- [x] Task 8 — gates clean (lint, typecheck, both linters, tests=979/979, build)
