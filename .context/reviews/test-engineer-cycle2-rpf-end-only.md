# Test Engineer — Cycle 2 RPF (end-only)

## Method

Reviewed all paid-tier test coverage. Mapped tests to the user journey
(checkout → webhook → download → refund) and identified coverage gaps.

## Gate baseline

- 900 vitest tests pass across 104 files.
- E2E: not re-run (orchestrator runs in PROMPT 3).

## Findings

### C2RPF-TEST-MED-01 — No test asserts that `refundEntitlement` clears the download token hash
- File: `apps/web/src/__tests__/stripe-download-tokens.test.ts` (existing) +
  `apps/web/src/app/actions/sales.ts:127-130`
- Severity: Medium | Confidence: High
- **What:** The refund flow sets `refunded: true, downloadTokenHash: null`
  to immediately invalidate any in-flight download tokens. There is no
  test asserting that a refunded entitlement *cannot* be downloaded —
  i.e., that the route's `if (entitlement.refunded)` check fires
  *and* the token-hash clear leaves nothing for verifyTokenAgainstHash
  to match against. Without coverage, a regression in the refund action
  (forgetting to null the hash, or moving the order of operations)
  could silently allow refunded customers to still download.
- **Fix (planned):** Add a unit test that simulates: (1) entitlement
  with valid token → download succeeds, (2) refund the entitlement,
  (3) attempt download with the same token → 410 Gone. Use the existing
  vitest fixture pattern in `stripe-download-tokens.test.ts`.

### C2RPF-TEST-MED-02 — No test for `deriveLocaleFromReferer`
- File: `apps/web/src/lib/license-tiers.ts:44-58`
- Severity: Medium | Confidence: High
- **What:** The function was introduced in cycle 1 RPF to fix
  C1RPF-PHOTO-LOW-03 (locale-aware redirect URLs). It has multiple
  edge cases (null referer, malformed URL, unsupported locale,
  case-insensitive locale, root-path referer) and zero direct unit
  tests. The function is small (~14 lines), but the regex + URL parse
  combination has historically been a bug source elsewhere in the app
  (see proxy.ts cycle history).
- **Fix (planned):** Add a vitest unit suite covering: null/undefined
  referer → DEFAULT_LOCALE; malformed URL → DEFAULT_LOCALE;
  `https://example.com/en/p/1` → 'en'; `https://example.com/ko/p/1` → 'ko';
  `https://example.com/EN/p/1` → 'en' (case-insensitive); `https://example.com/p/1`
  → DEFAULT_LOCALE (no locale prefix); `https://example.com/de/p/1` →
  DEFAULT_LOCALE (unsupported locale).

### C2RPF-TEST-LOW-01 — `lint:action-origin` does not run on the new `actions/sales.ts` file
- Files: `scripts/check-action-origin.ts`, `actions/sales.ts:30,75`
- Severity: Low | Confidence: Medium
- **What:** `actions/sales.ts` declares `@action-origin-exempt: read-only
  admin getter` for `listEntitlements` and `getTotalRevenueCents`. The
  scanner needs to recognize this comment marker. Without a regression
  test, future refactors that drop or rename the marker would silently
  skip the origin check on the action — inverse of the current intent
  (these *should* stay exempt; the test is "make sure the marker
  registry is consistent").
- **Fix (deferred):** Add an integration test that runs
  `check-action-origin.ts` against the actual repo and asserts no
  failures. This already runs as a npm script gate, so the CI signal
  is strong; lower priority.

### C2RPF-TEST-LOW-02 — Missing test for webhook tier allowlist rejection
- File: `apps/web/src/app/api/stripe/webhook/route.ts:90-94`
- Severity: Low | Confidence: High
- **What:** Cycle 1 RPF / C1RPF-PHOTO-MED-02 added the tier allowlist
  check at webhook ingest. There is no unit test asserting that an
  event with `metadata.tier = 'admin'` (or any non-allowlisted value)
  is rejected with a 200 + warn-log without inserting an entitlement
  row. A regression in `isPaidLicenseTier` would silently break the
  guarantee.
- **Fix (planned):** Add a vitest test that constructs a fake
  `Stripe.Event` with metadata.tier='admin' and asserts the route
  returns 200 with no DB insert. Mock `db.insert` to fail the test if
  called.

### C2RPF-TEST-LOW-03 — No test for the `?checkout=success|cancel` query param flow
- Files: `p/[id]/page.tsx:139-144`, `photo-viewer.tsx:104-118`
- Severity: Low | Confidence: High
- **What:** The whole point of cycle 1 RPF / HIGH-02 was to wire
  `?checkout=` from URL → server component → client viewer → toast.
  There is no test (unit or e2e) covering: (a) page extracts the param;
  (b) viewer renders the toast on first mount; (c) the param is
  stripped from the URL on dismissal; (d) re-renders do NOT re-toast
  (the `checkoutToastFiredRef` guard).
- **Fix (deferred to e2e):** Add a Playwright test that visits
  `/p/1?checkout=success` and asserts the success toast renders and
  the URL becomes `/p/1` after toast dismissal. Out of scope for unit
  tests; e2e is the right surface.

### C2RPF-TEST-LOW-04 — `formatCents` and `getStatus` in sales-client are untested
- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:36-45`
- Severity: Low | Confidence: High
- **What:** Both helpers are pure functions with edge cases (refunded,
  expired, downloaded, pending status; cents=0 / negative / fractional
  formatting). They live inside a `'use client'` file but are not
  exported, so vitest cannot import them directly without refactor.
- **Fix (deferred):** Extract to `lib/sales-status.ts` and import in
  the client. Add unit tests for the four-state status decision tree
  (refunded > downloaded > expired > pending) and for currency
  formatting once the locale-aware fix lands (C2RPF-CR-LOW-01). Pure
  refactor + tests; no behavior change.

## Issues NOT found this cycle

- The download-token round-trip is well covered (token sign / verify /
  single-use enforcement is in `stripe-download-tokens.test.ts`).
- Webhook signature verification has a test.

## Sweep for commonly-missed test gaps

Checked: e2e for /admin/sales (none — listed in earlier cycle deferred
plans for sales-page e2e); fuzz tests for token format (none, but the
prefix + base64url + length contract is tightly bounded by the SHA-256
hex and `dl_` prefix); load tests for rate-limit (none — covered by
existing pattern tests). No additional high-priority gaps.
