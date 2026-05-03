# Cycle 4 RPF (end-only) — Critic

## Method
Skeptical re-read of cycles 1-3 fixes. Looked for: dropped invariants,
masked errors, premature abstractions, comment-vs-code drift.

## Findings

### LOW

#### C4-RPF-CRIT-01 — Cycle 3's payment_status gate uses `console.error` for a NORMAL operational case

- File: `apps/web/src/app/api/stripe/webhook/route.ts:70-76`
- Async payment methods (ACH, OXXO) genuinely send `'unpaid'` first and `'paid'` later (via `checkout.session.async_payment_succeeded`). With the cycle 3 gate, every async-paid customer's first webhook fires `console.error('rejecting non-paid session')` even though this is the documented happy-path for ACH. Operators with PagerDuty hooked to error logs will get false alerts.
- Severity: **Low** | Confidence: **High**
- Failure scenario: gallery enables Stripe ACH/OXXO; every initial event triggers a PagerDuty page; operators desensitize and miss real signal.
- **In-cycle fix:** Use `console.warn` for the `'unpaid'` branch (or reserve `console.error` for the OTHER non-paid statuses like `'no_payment_required'` which is unexpected). Right now `'unpaid'` and `'no_payment_required'` are treated identically.

#### C4-RPF-CRIT-02 — Webhook idempotent SELECT comment claims "first-insert path is the only one that mints a token + log line" — but ON DUPLICATE KEY UPDATE remains

- File: `apps/web/src/app/api/stripe/webhook/route.ts:201-212` (comment vs code)
- Comment at line 200-203 says "The SELECT above is the primary idempotency guard for the manual-distribution log line; this ON DUPLICATE KEY UPDATE remains as belt-and-suspenders against a race." The race scenario (two concurrent retries hitting between SELECT and INSERT) is plausible but: in that race, BOTH SELECTs return empty, BOTH go to INSERT, BOTH call `generateDownloadToken()` (different tokens!), the SECOND INSERT becomes ON DUPLICATE → updates `sessionId = sessionId` (no-op). But: BOTH paths reached `console.info('[manual-distribution] ... token=...')` — meaning in the race scenario, a SECOND plaintext token line gets logged with a token that won't work.
- Severity: **Low** | Confidence: **Medium** (genuine race; bounded by Stripe's serial retry behavior)
- Stripe webhook deliveries are serial per event ID (Stripe holds the next retry until the prior is acked or times out), so the race is practically near-zero. But the comment overstates the guarantee.
- **Defer:** the practical risk is bounded by Stripe's serial-delivery model. The comment can be tightened in a future doc pass.

#### C4-RPF-CRIT-03 — Cycle 3 P262-09 lowercases email but doesn't normalize Unicode

- File: `apps/web/src/app/api/stripe/webhook/route.ts:90`
- `.toLowerCase()` does basic Unicode case folding but does NOT NFC-normalize. So `nöel@example.com` and `nöel@example.com` (one composed, one decomposed) coalesce to different rows.
- Severity: **Low** | Confidence: **High**
- Stripe normalizes emails before sending, so this is unlikely in practice. But if a future integration sends decomposed Unicode, the dedup will fail.
- **Defer:** rare in practice; would require `.normalize('NFC')` after `.toLowerCase()`.

#### C4-RPF-CRIT-04 — Sales page passes empty string `''` for errorLoad when there's no error

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/page.tsx:52`
- `salesResult.error ? t('errorLoad') : ''` always passes a string. The client checks `t.errorLoad &&` which evaluates `'' = falsy`. This works but: it's slightly idiomatic-fragile because next-intl returns the key as a fallback for missing translations. If the i18n setup ever returns `'errorLoad'` (key, not value) on missing translation, the falsy check still works since both 'errorLoad' and the actual translated string are truthy.
- Severity: **Informational** | Confidence: **High**
- **No action needed.**

#### C4-RPF-CRIT-05 — `mapErrorCode` defaults to `t.refundError` for unknown error codes; no localized string for `'no-payment-intent'`, `'invalid-id'`, `'not-found'`

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:97-108`
- The `RefundErrorCode` enum has 7 values but `mapErrorCode` only handles 3 specifically (already-refunded, charge-unknown, network) plus `default`. So `'no-payment-intent'`, `'invalid-id'`, `'not-found'`, and `'unknown'` all fall through to `t.refundError`. That's fine as a fallback, but operators would benefit from distinguishing "this entitlement is gone" (not-found) from "this Stripe session has no payment" (no-payment-intent) — they suggest different next steps.
- Severity: **Low** | Confidence: **Medium**
- **In-cycle fix:** add 4 more localized strings + 4 more cases in mapErrorCode.

#### C4-RPF-CRIT-06 — Download route catches stream errors but the entitlement is already claimed

- File: `apps/web/src/app/api/download/[imageId]/route.ts:192-205`
- Cycle 3's lstat-before-claim closes the main "missing file" hole. But the catch at line 192 handles a residual race: file exists at lstat time, gets deleted between lstat and `createReadStream`. In that case the token is consumed but the customer gets a 404. The catch logs but doesn't unwind the claim.
- Severity: **Low** | Confidence: **High**
- Mitigation: this race is bounded by the time between lstat (line 128) and createReadStream (line 169) — typically microseconds. Operator action (delete original) during this window is statistically improbable.
- **Defer:** practical risk near-zero; unwinding the claim atomically would require a transaction.

#### C4-RPF-CRIT-07 — `parseInt(imageIdStr, 10)` allows leading `+` and `-` signs

- File: `apps/web/src/app/api/stripe/webhook/route.ts:136`, `apps/web/src/app/api/checkout/[imageId]/route.ts:76`, `apps/web/src/app/api/download/[imageId]/route.ts:42`
- `parseInt('+5', 10) === 5`. The `imageId <= 0` guard at line 137/77/43 rejects non-positive, so `'+5'` would pass and resolve to image 5. Probably benign, but defense-in-depth would use `Number(imageIdStr)` + `Number.isInteger` to reject.
- Severity: **Informational** | Confidence: **High**
- **No action needed.** Path resolution by ID is well-bounded.

#### C4-RPF-CRIT-08 — Stripe webhook `'no_payment_required'` is treated as non-paid, but it's actually a $0-promo paid case

- File: `apps/web/src/app/api/stripe/webhook/route.ts:70-76`
- Stripe documents `payment_status` as `'paid' | 'unpaid' | 'no_payment_required'`. The cycle 3 gate `!== 'paid'` excludes ALL three non-paid statuses. `'no_payment_required'` happens for $0 promotions where Stripe didn't charge anything — these are NOT customer-funded, but they ARE legitimate completions. The cycle 3 zero-amount gate (P262-02) would catch them too, since `amount_total === 0`.
- Severity: **Informational** | Confidence: **High**
- The two gates compose correctly: `'no_payment_required'` would be rejected by EITHER gate. No action needed.
- **No action needed.**

## Aggregate severity

- HIGH: 0
- MEDIUM: 0
- LOW: 4 (CRIT-01, 02, 03, 05)
- INFO: 3 (CRIT-04, 06, 07, 08)

## In-cycle scheduling proposal

- C4-RPF-CRIT-01 — downgrade `'unpaid'` log to console.warn (separate ACH happy-path from operational error)
- C4-RPF-CRIT-05 — add 4 more localized refund-error strings
