# critic — Cycle 6 RPF (end-only)

## Method

Adversarial pass: assume cycle 1-5 are clean (verifier confirmed), look
for what humans missed across the Stripe + admin surfaces.

## Findings

### CRIT-01 — Cycle-5 idempotency key format may be at Stripe length limit on long entitlement IDs
- **File:** `apps/web/src/app/actions/sales.ts:189`
- **Severity:** Informational | Confidence: Medium
- **What:** `idempotencyKey: \`refund-${entitlementId}\`` produces e.g.
  `refund-12345`. Stripe documents idempotency keys must be ≤ 255 chars.
  `entitlementId` is a MySQL `bigint` from Drizzle's `serial` type with
  effectively-unbounded growth in theory but practically capped at
  ~10^10 for ≥30 years of typical issuance. So the key is always ≤ 17
  chars. Safe. No fix.
- **Status:** confirmed safe.

### CRIT-02 — Refund retry replays the same idempotency key after the entitlement row is gone
- **File:** `apps/web/src/app/actions/sales.ts:147-205`
- **Severity:** Informational | Confidence: Medium
- **What:** The deterministic `refund-${entitlementId}` key is correct
  semantics: each entitlement is refunded at most once. If the
  entitlement row is later deleted (admin cleanup, DB restore), the next
  insert with the same auto-increment ID would collide on the Stripe
  side. MySQL auto-increment doesn't reuse IDs after deletion in the
  default config (auto_increment_offset persists), so this is moot in
  practice. No fix.
- **Status:** confirmed safe under MySQL's default auto-increment policy.

### CRIT-03 — `mapStripeRefundError` does not log the unknown branch
- **File:** `apps/web/src/app/actions/sales.ts:144`
- **Severity:** Low | Confidence: Medium
- **What:** When the Stripe error is none of the recognized types/codes,
  the function returns `'unknown'` silently. The caller logs the raw
  error in the catch block (`console.error('Stripe refund failed:', err)`)
  so this is covered, but the unknown-branch frequency is invisible to
  ops dashboards (no metric, no `.warn` for "unrecognized Stripe error
  type seen — please add to mapping"). A 1-line `console.warn` inside
  the unknown branch would surface emerging Stripe error types
  proactively.
- **Why this matters:** when Stripe introduces a new error type
  (e.g., `StripeIdempotencyError`), the mapping table silently routes
  it to 'unknown' and the operator only finds out via customer
  complaints. A dedicated warn line keeps the mapping current.
- **Fix:** add
  ```ts
  if (process.env.NODE_ENV !== 'test') {
      console.warn('Stripe refund: unrecognized error type', {
          name: maybeNonError?.name, type: e.type, code: e.code,
      });
  }
  return 'unknown';
  ```
  inside the unknown branch.

### CRIT-04 — Webhook idempotent-skip log: high-rate logging risk on signature replay
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:258`
- **Severity:** Informational | Confidence: Medium
- **What:** Same as cycle-5 D09 (deferred). Stripe signature window
  bounds the replay rate (~5 min). No regression. Carry-forward.
- **Status:** deferred (existing item).

### CRIT-05 — Confirm dialog state-drift (cycle 5 D04 carry-forward)
- **File:** `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:127-148`
- **Severity:** Low | Confidence: Medium
- **Status:** carry-forward, no new finding.

### CRIT-06 — Cycle-5 source-contract test depends on exact whitespace of multi-line idempotencyKey
- **File:** `apps/web/src/__tests__/cycle5-rpf-source-contracts.test.ts:71`
- **Severity:** Informational | Confidence: Medium
- **What:** The test matches `idempotencyKey:\s*\`refund-\$\{entitlementId\}\``.
  Backtick + template-literal interpolation in the regex is correct, but
  a future Prettier reformat that changes single-line → multi-line
  argument formatting could shift the string. The current source has
  the call on multiple lines (lines 187-190); the regex matches anyway
  because `\s*` allows newlines. Robust.
- **Status:** confirmed robust.

### CRIT-07 — Plan ID drift between commit messages (P266) and test comments (P388)
- **Files:** `apps/web/src/__tests__/cycle5-rpf-source-contracts.test.ts:8-22`,
  recent commit messages
- **Severity:** Informational | Confidence: High
- **What:** The test file references plan IDs P388-01 through P388-07.
  The commits use P266-01 through P266-07. Both refer to the same cycle
  5 work; the rename happened mid-cycle. Cosmetic; no functional impact.
- **Fix:** none required. Cycle 6 plan should keep the higher (P388)
  numbering or pick its own next number from the existing range.

## Confirmed clean

- Webhook signature verification.
- Path traversal containment.
- Constant-time token compare.
- 255-char raw email reject.
- AbortError handling.
- Auth-error split.

All cycle 1-5 critic concerns either resolved or carry-forward.
