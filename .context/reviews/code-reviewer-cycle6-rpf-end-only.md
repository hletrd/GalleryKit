# code-reviewer — Cycle 6 RPF (end-only)

## Method

Fresh end-to-end pass over: `apps/web/src/app/api/checkout/[imageId]/route.ts`,
`apps/web/src/app/api/stripe/webhook/route.ts`,
`apps/web/src/app/actions/sales.ts`,
`apps/web/src/app/api/download/[imageId]/route.ts`,
`apps/web/src/lib/stripe.ts`,
`apps/web/src/lib/license-tiers.ts`,
`apps/web/src/lib/rate-limit.ts`,
`apps/web/src/lib/download-tokens.ts`,
`apps/web/src/lib/action-guards.ts`,
`apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx`,
`apps/web/src/app/[locale]/admin/(protected)/sales/page.tsx`,
`apps/web/src/__tests__/cycle5-rpf-source-contracts.test.ts`,
`apps/web/messages/en.json`, `apps/web/messages/ko.json`.

Cycle 5 fixes verified intact in source. All gates green
(lint / typecheck / lint:api-auth / lint:action-origin / vitest 979 / build).

## Findings

### CR-01 — `console.error` for invalid imageId uses positional non-object form
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:195`
- **Severity:** Low | Confidence: High
- **What:** Every other webhook log line uses the structured-object form
  (`console.error('label', { sessionId, ... })` — see lines 90, 95, 134, 160,
  169, 188, 212, 229, 258, 295, 312). The only outlier is line 195:
  `console.error('Stripe webhook: invalid imageId in metadata', imageIdStr)`,
  which logs `imageIdStr` positionally as the 2nd argument. Cycle 5
  P388-02 explicitly converted the two remaining legacy template-literal
  log lines (idempotent skip, entitlement created) to the structured form
  for log-shipper parser consistency; this line was missed in that pass.
- **Why a problem:** Datadog/Loki JSON parsers expect a single string
  message + structured metadata object. A positional 2nd-argument string
  becomes a separate untagged blob in most shippers — operators searching
  `imageId:"abc"` won't find this line.
- **Failure scenario:** Stripe Checkout misconfig sends
  `metadata.imageId="abc"`. Webhook logs `Stripe webhook: invalid imageId
  in metadata abc`. Operator searching by `imageId:"abc"` for the failure
  trail finds neither the imageId facet (it's a free-form string) nor the
  sessionId (which is missing from this line entirely — also a defect).
- **Fix:** convert to structured form including sessionId (which IS in
  scope at this line):
  ```ts
  console.error('Stripe webhook: invalid imageId in metadata', {
      sessionId,
      imageIdStr,
  });
  ```

### CR-02 — Stripe Checkout session creation lacks `idempotencyKey`
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:123`
- **Severity:** Low | Confidence: High
- **What:** `stripe.checkout.sessions.create({...})` runs without an
  Idempotency-Key. Cycle 5 P388-01 added one to `stripe.refunds.create`
  for the same reason — Stripe best-practice for ALL POST mutations.
  Without it, a user clicking Buy twice quickly creates two unrelated
  Stripe Checkout sessions; the user pays one and abandons the other,
  but the second session still exists in the Stripe dashboard until
  expiry, cluttering the dashboard and triggering needless support
  inquiries when an operator misreads the duplicate session as a payment
  attempt.
- **Why a problem:** Browser double-click is common; transient network
  retries on the inner `fetch` to Stripe also re-invoke without the SDK's
  retry semantics deduping. The fix is a single-line addition that
  matches the cycle 5 refund pattern.
- **Failure scenario:** User double-clicks Buy on a paid image. The
  client fetches `/api/checkout/[imageId]` twice. Server creates two
  separate Stripe sessions. User pays the first; the second remains
  pending. Operators see a "second pending session" alert that resolves
  to nothing (false positive on payment monitoring).
- **Fix:** pass an idempotencyKey derived from imageId+ip+second-window
  (or just imageId+minute):
  ```ts
  const idempotencyKey = `checkout-${image.id}-${ip}-${Math.floor(Date.now() / 60_000)}`;
  const session = await stripe.checkout.sessions.create({...}, { idempotencyKey });
  ```
  The minute-window keeps successive distinct buys (e.g., the same user
  buying the same image at minute N+1 after a refund) from collapsing
  into one — which is exactly the desired semantics.

### CR-03 — `mapStripeRefundError` 'unknown' code paired with `err.message`
- **File:** `apps/web/src/app/actions/sales.ts:199-205`
- **Severity:** Low | Confidence: Medium
- **What:** When the catch block runs, the action returns
  `{ error: err instanceof Error ? err.message : 'Refund failed', errorCode: mapStripeRefundError(err) }`.
  The `error` field exposes the raw Stripe `err.message` to the client
  while `errorCode` is the mapped 'unknown'/'network'/etc. The
  comment block at line 88-93 says "The full Stripe error is logged
  server-side; only the mapped identifier crosses the action boundary
  to the client". But `err.message` IS crossing the action boundary —
  it's just not consumed by `mapErrorCode` in `sales-client.tsx`
  (which uses `errorCode`, not `error`). Dead/noisy data.
- **Why a problem:** Inconsistent intent. The doc says "only the mapped
  identifier crosses"; the code returns `err.message` too. Future client
  code (or a careless test) could surface `err.message` (e.g., "stripe:
  rate-limited (request id req_abc123)") in a toast, leaking Stripe
  request IDs / internal info that the doc explicitly says we don't
  want to leak.
- **Failure scenario:** A new dev adds a console.warn(result.error) for
  debugging during a later refactor. Stripe request IDs end up in
  browser DevTools traces in production.
- **Fix:** drop the `error` field from the error return path entirely
  (or set it to a stable string like 'Refund failed' regardless of
  err.message). Leaves `errorCode` as the sole client-visible signal,
  matching the docstring intent.

### CR-04 — Webhook: oversized email reject does not include `length` cap source
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:133-140`
- **Severity:** Low | Confidence: Medium
- **What:** The reject log at line 134 emits `length` of the trimmed raw
  email but does not say what threshold was crossed (255). When operators
  triage, they have to consult the source to map "length: 1024 → why
  rejected?" — adding `cap: 255` to the structured object makes the
  intent self-documenting.
- **Why a problem:** Cycle 4-5 added rate-limit headers (Retry-After) and
  structured logs precisely so operators don't have to chase code for
  thresholds. This line drops the cap.
- **Fix:** include `cap: 255` in the structured-object payload so the log
  is self-describing.

### CR-05 — Cycle 5 source-contract test imports use `.test.ts` filename mid-cycle
- **File:** `apps/web/src/__tests__/cycle5-rpf-source-contracts.test.ts`
- **Severity:** Informational | Confidence: High
- **What:** The test file is named `cycle5-rpf-source-contracts.test.ts`
  but the in-cycle plan IDs reference both `P266` (in commits) and `P388`
  (in plan file/test comments). Plan numbering drift across the repo's
  plan-RR sequence (renamed in commit `cab68b8`). This is a cosmetic
  consistency issue — code is correct.
- **Fix:** none required this cycle; just note for next planning pass.

### CR-06 — Refund action: `Number.isFinite(entitlementId)` check on TypeScript number
- **File:** `apps/web/src/app/actions/sales.ts:152`
- **Severity:** Informational | Confidence: High
- **What:** `entitlementId` is typed `number` from the client. The
  `Number.isFinite(entitlementId)` + `<= 0` check is correct
  defense-in-depth (a malicious client could POST `Infinity` or `NaN` via
  an untyped runtime path). No bug, just informational.
- **Fix:** none.

### CR-07 — Checkout route: `parseInt(row.value, 10)` accepts negatives, then `>= 0` filter saves it
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:50-51`
- **Severity:** Informational | Confidence: High
- **What:** `getTierPriceCents` reads `adminSettings.value` as text,
  parses as int, and returns 0 for negatives. The 0 then triggers the
  caller's `priceCents <= 0 → "not priced for sale"` reject. Correct
  belt-and-suspenders, but the inner `>= 0` filter implies "0 is
  acceptable" while the caller says "0 is not acceptable" — noise.
  Tightening the inner filter to `> 0` makes the semantics consistent.
- **Fix:** optional cleanup for next polish pass.

## Confirmed working / no findings

- Idempotency on Stripe webhook (sessionId UNIQUE + SELECT-then-INSERT):
  cycle 3 + cycle 5 are both intact.
- Refund idempotency-key (cycle 5 P388-01): present and stable.
- 255-char raw email reject (cycle 5 P388-06): present.
- EMAIL_SHAPE module-scope (cycle 5 P388-04): present.
- Auth-error split (cycle 5 P388-03): present in actions, client, page,
  en.json, ko.json.
- AbortError + ETIMEDOUT/ECONNREFUSED handling (cycle 5 P388-05): present.
- Structured-object log shapes (cycle 5 P388-02): present at lines 258
  and 312.

All cycle 1-5 RPF claims verified intact.
