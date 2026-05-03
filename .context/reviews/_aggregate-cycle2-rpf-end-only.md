# Cycle 2 RPF (end-only) — Aggregate Review

## Method

Multi-agent fan-in review covering: code-reviewer, security-reviewer,
perf-reviewer, critic, architect, test-engineer, verifier, tracer,
debugger, document-specialist, designer (UI/UX). All available
specialist reviewers were exercised; no agents skipped or failed.

## Gate baseline (entering this cycle)

- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run lint:api-auth` clean.
- `npm run lint:action-origin` clean.
- `npm test` — 900 tests passed across 104 files.
- `git status` clean on master, in sync with origin.

## Cycle 1 RPF carry-forward verification

All cycle 1 RPF fixes verified in code:
- C1RPF-PHOTO-HIGH-01 (rate-limit `/api/checkout`) — verified.
- C1RPF-PHOTO-HIGH-02 (checkoutStatus toast on /p/{id}) — verified
  technically; workflow gap remains (see C2RPF-CR-MED-01).
- C1RPF-PHOTO-MED-01 (drop tokenHash from log line) — verified.
- C1RPF-PHOTO-MED-02 (tier allowlist at webhook ingest) — verified.
- C1RPF-PHOTO-LOW-01 (Intl.NumberFormat for Buy button price) — verified.
- C1RPF-PHOTO-LOW-02 (hide gratis Download on paid images) — verified.
- C1RPF-PHOTO-LOW-03 (locale-aware Stripe redirect URLs) — verified.
- N-CYCLE1-01/02/03 (defensive truncations) — verified.

## Cross-agent agreement (high-signal duplicates)

- **C2RPF-CR-MED-01 / CRIT-01 / C2RPF-ARCH-MED-01 / Tracer Trace 1 H1**
  — three reviewers + tracer independently flag the manual-distribution
  workflow vacuum (plaintext download token is generated then dropped).
  Highest signal of the cycle.

- **C2RPF-DSGN-MED-01 / CRIT-03** — two reviewers flag the missing
  refund confirm dialog.

- **C2RPF-CR-LOW-01 / C2RPF-DSGN-MED-03** — two reviewers flag the
  /admin/sales view's missing locale-aware currency formatting and
  responsive table treatment.

- **C2RPF-ARCH-LOW-03 / C2RPF-CR-LOW-07 / C2RPF-DOC-LOW-05** — three
  reviewers flag the LOCALES literal duplication in license-tiers.ts
  (also a cycle 1 deferred at AGG-C1-19).

## Findings (severity sorted)

### High-signal MEDIUMS

#### C2-RPF-01 — Plaintext download token never escapes webhook scope (workflow vacuum)
- Reviewers: code-reviewer (C2RPF-CR-MED-01), critic (CRIT-01),
  architect (C2RPF-ARCH-MED-01), tracer (Trace 1 H1)
- Severity: Medium (operational High in practice) | Confidence: High
- **What:** Webhook generates `{ token, hash }`, stores only `hash`,
  silently drops the plaintext token. The /admin/sales view does not
  expose the plaintext, so the photographer has no path to retrieve
  the URL the customer needs. The success toast tells the customer
  "your download link is being prepared" — a promise the system
  cannot fulfill without manual DB access or stdout grep.
- **Fix (this cycle):** Add a stdout `console.info` line in the webhook
  containing the plaintext token, gated behind an env flag
  `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true`. Document the operational
  requirement in apps/web/README.md. This is the minimum viable
  closure of the workflow loop.
- **Defer (next phase):** Either ship the email pipeline or stash the
  plaintext in a `pending_download_tokens` table with a 1h TTL and
  surface a "Copy download URL" button in /admin/sales.

#### C2-RPF-02 — Refund button has no confirmation dialog and no destructive variant
- Reviewers: critic (CRIT-03), designer (C2RPF-DSGN-MED-01, MED-02)
- Severity: Medium | Confidence: High
- **What:** Single click on Refund triggers a real Stripe refund
  (irreversible money movement). No AlertDialog. Variant is
  "outline", visually identical to non-destructive buttons. Cycle 39
  shipped a confirm-dialog convention for destructive admin actions
  that wasn't applied here.
- **Fix (this cycle):** Wrap the Refund button in `<AlertDialog>` with
  customer email + image title + amount in confirmation copy. Change
  variant to `destructive`.

#### C2-RPF-03 — `customerEmail` not validated before insert into entitlements
- Reviewer: security-reviewer (C2RPF-SEC-MED-01)
- Severity: Medium | Confidence: Medium
- **What:** Stripe normalizes emails but does not strictly RFC-validate
  Unicode-direction characters that could spoof renderings in
  downstream tools (CSV exports, copy-paste to email).
- **Fix (this cycle):** Add `^[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+$`
  validation at webhook ingest before insert.

### LOW

#### C2-RPF-04 — `sales-client.tsx` formats currency without locale
- Reviewers: code-reviewer (C2RPF-CR-LOW-01), designer (C2RPF-DSGN-MED-03)
- Severity: Low | Confidence: High
- Same bug pattern that cycle 1 RPF fixed in `photo-viewer.tsx`.
- **Fix (this cycle):** Use `Intl.NumberFormat(locale, …)` with
  `useLocale()` from next-intl.

#### C2-RPF-05 — `formatCents(nonRefundedRevenue || totalRevenueCents)` shows wrong total when all refunded
- Reviewer: code-reviewer (C2RPF-CR-LOW-02)
- Severity: Low | Confidence: Medium
- The `||` fallback fires when nonRefundedRevenue is 0, displaying
  the pre-refund total instead of $0.
- **Fix (this cycle):** Drop the fallback. Show nonRefundedRevenue
  computed from the loaded rows directly.

#### C2-RPF-06 — `verifyTokenAgainstHash` does not validate hex shape, hides DB corruption
- Reviewers: code-reviewer (C2RPF-CR-LOW-04), debugger (C2RPF-DBG-LOW-01)
- Severity: Low | Confidence: High
- **Fix (this cycle):** Add `^[0-9a-f]{64}$` shape check on storedHash
  with a `console.warn` when it fails.

#### C2-RPF-07 — Empty CardFooter on paid images leaves a visual gap
- Reviewer: designer (C2RPF-DSGN-LOW-04)
- Severity: Low | Confidence: High
- **Fix (this cycle):** Wrap CardFooter in the same condition as the
  inner button.

#### C2-RPF-08 — `lib/license-tiers.ts` SUPPORTED_LOCALES literal duplication / wrong-doc reference
- Reviewers: architect (C2RPF-ARCH-LOW-03), code-reviewer
  (C2RPF-CR-LOW-07), document-specialist (C2RPF-DOC-LOW-05)
- Severity: Low | Confidence: High
- **Fix (this cycle):** Import `LOCALES` from `lib/constants.ts` and
  drop the local literal. Update the comment to point to the right
  file.

#### C2-RPF-09 — Status column relies on color alone (WCAG 1.4.1)
- Reviewer: designer (C2RPF-DSGN-LOW-01)
- Severity: Low | Confidence: High
- **Fix (this cycle):** Add lucide icon next to status text.

#### C2-RPF-10 — `download-tokens.ts` `verifyTokenAgainstHash` runtime hex validation
- Reviewer: debugger (C2RPF-DBG-LOW-01) — duplicate of C2-RPF-06.

#### C2-RPF-11 — Add unit tests for `deriveLocaleFromReferer` and webhook tier rejection
- Reviewer: test-engineer (C2RPF-TEST-MED-02, C2RPF-TEST-LOW-02)
- Severity: Low | Confidence: High
- **Fix (this cycle):** Add vitest unit suite covering null/malformed
  referer, locale match, locale miss; and webhook rejection test for
  invalid tier metadata.

#### C2-RPF-12 — Add test for refund clearing downloadTokenHash
- Reviewer: test-engineer (C2RPF-TEST-MED-01)
- Severity: Low | Confidence: High
- **Fix (this cycle):** Add unit test that asserts a refunded entitlement
  cannot be downloaded with the same token.

#### C2-RPF-13 — Stripe error messages leaked verbatim to admin
- Reviewers: security-reviewer (C2RPF-SEC-LOW-05), debugger (C2RPF-DBG-LOW-02)
- Severity: Low | Confidence: High
- **Fix (planned for this cycle, low effort):** Map Stripe error codes
  to localized strings server-side, surface only the mapped string
  to client.

#### C2-RPF-14 — Stripe-truncated `image.title` lacks ellipsis indicator
- Reviewer: code-reviewer (C2RPF-CR-LOW-09)
- Severity: Low | Confidence: Medium
- **Fix (this cycle):** When truncating, append `…`.

### LOWS deferred (with exit criteria)

- **C2-RPF-D01 — Memoize `Intl.NumberFormat` in photo-viewer**
  (C2RPF-PERF-LOW-06). Defer: marginal perf, no correctness issue.
  Exit: when photo viewer profiling shows formatter cost > 1% of
  render time, or when the pattern is moved to a shared hook.

- **C2-RPF-D02 — `getTotalRevenueCents` server-side query is duplicate work**
  (C2RPF-PERF-LOW-02). Defer: tied to UI redesign of admin /sales
  total-display semantics (see C2-RPF-05 fix).
  Exit: when the C2-RPF-05 fix lands and the server-side fallback
  becomes provably unused.

- **C2-RPF-D03 — `entitlements` cascade-delete on image removal destroys audit**
  (C2RPF-ARCH-LOW-02). Defer: schema change requires migration 0014,
  cascading admin-action UI change.
  Exit: when first real refund-after-image-delete operational
  incident occurs, or when finance-grade audit retention becomes a
  product requirement.

- **C2-RPF-D04 — Webhook orphan-image race causes 500 + Stripe retry storm**
  (C2RPF-SEC-LOW-01). Defer: low probability (admin would have to
  delete an image during the ~2-second checkout-to-webhook gap), but
  worth scheduling.
  Exit: when a real orphan webhook event is observed, or when the
  email-pipeline phase ships and adds the auto-refund path naturally.

- **C2-RPF-D05 — Buy button does not show tier label**
  (C2RPF-DSGN-LOW-02 / CRIT-04). Defer: requires translation strings
  for tier names, product decision on whether tier should be visible
  to visitors.
  Exit: when product decision made on tier visibility, or when adding
  any new tier.

- **C2-RPF-D06 — Download token TTL not surfaced in customer copy**
  (CRIT-06). Defer: copy change tied to email pipeline phase.
  Exit: when email pipeline ships (sets the actual delivery latency).

- **C2-RPF-D07 — `Content-Disposition` filename safety**
  (C2RPF-SEC-LOW-02). Defer: low probability (uploads sanitize),
  bounded by the canonical `photo-{id}` pattern.
  Exit: when an upload-side filename allowlist is added, or when the
  filename surfaces a real customer issue.

- **C2-RPF-D08 — Refund persist `stripe_refund_id`**
  (C2RPF-CR-LOW-03). Defer: schema migration (0014) for a low-effort
  audit improvement.
  Exit: when first real "did the refund land?" support ticket comes
  in, or when migration 0014 happens for any other reason.

- **C2-RPF-D09 — Drizzle download UPDATE result-shape resilience**
  (C2RPF-CR-LOW-05 / C2RPF-DBG-MED-01). Defer: practical risk is
  bounded by the line-70 `verifyTokenAgainstHash` guard and the
  line-85 `downloadedAt !== null` guard. Both block a re-use even if
  the affectedRows fallback fires.
  Exit: when drizzle MySQL driver shape changes again, or when the
  guard layers above are restructured.

- **C2-RPF-D10 — Webhook `expiresAt` TZ semantics**
  (C2RPF-DBG-LOW-04). Defer: existing infra is UTC; verifier task to
  add a roundtrip test.
  Exit: when DB connection TZ is changed away from UTC, or when
  expiresAt drift is observed.

- **C2-RPF-D11 — /admin/sales pagination + search**
  (C2RPF-PERF-LOW-01). Defer: sales row cap of 500 is correct hardening;
  pagination is a UX improvement.
  Exit: when galleries with >500 sales surface the cap, or when older-
  sale lookups become a real support need.

- **C2-RPF-D12 — Empty-state polish for /admin/sales**
  (C2RPF-DSGN-LOW-05). Defer: pure polish.
  Exit: when product polish-pass is prioritized.

- **C2-RPF-D13 — Cancel toast copy is muted**
  (C2RPF-DSGN-LOW-03). Defer: pure copy.
  Exit: when product copy review is prioritized.

- **C2-RPF-D14 — README + CLAUDE.md Stripe operator section**
  (C2RPF-DOC-LOW-03, C2RPF-DOC-LOW-04). Defer to bundled docs work
  this cycle if time permits, otherwise defer.
  Exit: when first deployment by a new operator surfaces the gap, or
  when the email-pipeline phase ships and the docs need to be updated
  anyway.

## OUT-OF-SCOPE per cycle directive

Cycle directive (no edit / scoring / culling / proofing / selection /
retouch / develop / preset / export-recipe). No findings outside this
fence.

## AGENT FAILURES

None — all 11 specialist reviewer perspectives executed inline.

## Disposition

The plan-from-reviews step (PROMPT 2) will:
- Schedule C2-RPF-01 through C2-RPF-14 (all MEDIUMS plus actionable
  LOWS) for implementation this cycle.
- Defer C2-RPF-D01 through C2-RPF-D14 with exit criteria.
- Verify no finding from cycle 1 deferred carry-forward is silently
  dropped.
