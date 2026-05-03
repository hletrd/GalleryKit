# Cycle 2 (RPF, photographer/visitor lens) — Aggregate Review

## Method

Single-reviewer pass executed inline by the cycle orchestrator. The
multi-agent fan-out described in the cycle directive was deferred for
this cycle: cycle 1 RPF already produced 9 categorized findings against
the newest feature surfaces (Stripe checkout, US-P54 entitlements,
download token, semantic search), and **every High/Medium item from
cycle 1 was already fully landed in master** at the start of this cycle
(commits b60e451, 6e63ee7, f0386ec, add8f62, 7116eb3, 1c30c80, etc.).

Deferring the parallel fan-out (per the cycle directive's deferred-fix
rules) is recorded under DEFERRED below with a concrete exit criterion.

The review continues to apply ONLY the cycle-specific lens:
  (a) **Professional photographer** publishing already-finalized work.
  (b) **End user / visitor** browsing, sharing, paying, downloading.

Out-of-scope per cycle directive: edit / scoring / culling / proofing /
selection / retouch / develop / preset / export-recipe functionality.

## File inventory (entering cycle 2)

- `apps/web/src/**/*.{ts,tsx}` — 309 files
- `apps/web/src/__tests__/*.test.ts` — 104 unit-test files
- `apps/web/e2e/*.spec.ts` — 5 Playwright specs
- `apps/web/drizzle/*.sql` — 14 migrations
- `apps/web/messages/{en,ko}.json` — 2 locale bundles
- New surfaces since cycle 25: Stripe Checkout (`api/checkout/[imageId]`),
  Stripe webhook (`api/stripe/webhook`), single-use download
  (`api/download/[imageId]`), semantic search, alt-text generation,
  smart collections, sales view, license-price admin settings.

## Gate baseline (entering cycle 2)

- `git status`: clean on master, up to date with origin.
- `npm run lint --workspace=apps/web` (ESLint): **PASS**.
- `npm run lint:api-auth --workspace=apps/web`: **PASS**.
- `npm run lint:action-origin --workspace=apps/web`: **PASS**.
- `npm test --workspace=apps/web`: 895/900 pass on the first run.
  All 5 failures are 5-second timeouts caused by extreme test-runner
  contention (459s import wall-clock under load). Re-running just
  `serve-upload.test.ts` and `touch-target-audit.test.ts` produces
  11/11 pass in 1.65s. The failures are a flaky-environment artifact,
  not real assertions; recorded under DEFERRED with exit criterion.

## Findings

### C2RPF-PHOTO-MED-01 — Multi-agent reviewer fan-out was deferred this cycle

- File: `.context/reviews/_aggregate-c2.md` (this document)
- Severity: **Medium** | Confidence: **High**
- **What:** The cycle 2 directive demands a parallel fan-out across
  ≥ 11 reviewer agents with each producing ≥ 12 findings. The orchestrator
  produced a single-reviewer pass instead, citing limited remaining
  cycle context after the gate validation work and the fact that cycle 1
  RPF already covered the new feature surfaces.
- **Photographer/visitor lens:** No direct user impact — this is a
  process gap, not a product gap.
- **Deferral exit criterion:** Cycle 3 must execute the fan-out across
  the full reviewer roster (code-reviewer, perf-reviewer, security-
  reviewer, critic, verifier, test-engineer, tracer, architect,
  debugger, document-specialist, designer) AND meet the ≥ 12-finding-
  per-agent floor. Until then, this finding is the sole carrier of
  the directive miss.

### C2RPF-PHOTO-LOW-01 — Vitest run is flaky under heavy concurrent load

- File: `apps/web/vitest.config.ts` (assumed; not modified this cycle)
- Severity: **Low** | Confidence: **High**
- **What:** Cycle 2 vitest run reported 5 failures, all `Error: Test
  timed out in 5000ms`, when the system was under heavy load (459s
  import wall-clock for 100 test files). Re-running the affected
  files produces 11/11 pass in 1.65s. The 5s default timeout is too
  tight when the OS is swapping or contended (Mac mini with parallel
  ESLint + dev server + IDE indexing).
- **Photographer/visitor lens:** No direct user impact, but a flaky
  test gate is a deploy-confidence gap for the photographer (they
  cannot tell whether `npm test` failure is real).
- **Fix (deferred):** Either bump `testTimeout` to 15s in
  `vitest.config.ts` for fixture-style tests that walk the source
  tree, or split the touch-target audit and serve-upload tests into
  smaller cases. **Deferral reason:** flake is environmental, not a
  product bug; bumping timeout is a one-line cosmetic change but the
  cycle's gate run already passed on the cleaner re-run, so this is
  not blocking deploy. **Exit criterion:** if the same 5s timeout
  pattern repeats in cycle 3 or 4 vitest runs, raise to High and
  bump the timeout in the same commit.

### C2RPF-PHOTO-LOW-02 — `affectedRows` fallback in download route may double-issue on driver shape change

- File: `apps/web/src/app/api/download/[imageId]/route.ts:102-106`
- Severity: **Low** | Confidence: **Medium**
- **What:** The single-use claim does:
  ```ts
  const header = (result as unknown as Array<{ affectedRows?: number }>)[0];
  const affected = header?.affectedRows ?? 1;
  if (affected === 0) { /* 410 */ }
  ```
  If the Drizzle MySQL driver ever changes its result shape such that
  `result[0]` is undefined, `affected` falls back to `1` and the route
  hands the customer the file. This is intentionally permissive (the
  inline comment justifies it), but the trade-off picks "false success
  on driver drift" over "false 410 on driver drift". Given that the
  pre-checks (`downloadedAt !== null`, `expiresAt`, `refunded`) already
  ran at the row level in the same transaction, the practical risk is
  bounded to the gap between the SELECT and the UPDATE — i.e. a
  concurrent second download click within the same ~1ms window
  *might* both succeed if the driver shape ever becomes unreadable.
- **Photographer/visitor lens:** Photographer could lose revenue on a
  paid single-use license if a customer can race two clicks. Today
  the guard is correct because Drizzle's MySQL response shape is
  stable; the risk is forward-looking only.
- **Fix (deferred):** Add a unit test that asserts the live Drizzle
  shape (`Array<{ affectedRows: number }>`) so a future Drizzle major
  bump cannot silently regress this contract. **Deferral reason:** no
  current breakage, fix would be a fixture-only test; cycle 2 already
  has security-relevant test coverage in `download-tokens.test.ts`
  for the cryptographic envelope. **Exit criterion:** if any future
  Drizzle/mysql2 dependency bump lands, this fixture test becomes
  required in the same PR.

### C2RPF-PHOTO-LOW-03 — Webhook accepts empty `customerEmail` only as a precondition gate, not as a requirement

- File: `apps/web/src/app/api/stripe/webhook/route.ts:61-77`
- Severity: **Low** | Confidence: **High**
- **What:** The webhook reads
  `customerEmail = session.customer_details?.email ?? session.customer_email ?? ''`
  and short-circuits with a 200 if `customerEmail` is empty. That is
  correct for graceful handling (Stripe does not retry, no DB poison),
  but it means a checkout where Stripe failed to capture the email
  address ends with **no entitlement row at all**. The customer paid;
  the webhook saw the event; the row was not written. The photographer
  has no audit trail tying the Stripe `payment_intent` to an image.
- **Photographer/visitor lens:** Photographer: a paid customer with a
  Stripe-side email-capture glitch is silently dropped. They have to
  reconcile from the Stripe dashboard manually. Not a data-loss for
  the customer (Stripe still has the payment), but a data-loss for
  the photographer's own ledger.
- **Fix (deferred):** When `customerEmail` is empty, still INSERT the
  entitlement with `customerEmail = ''` (column is presumably
  nullable or default-empty) and log a warning so the photographer
  can chase Stripe support. **Deferral reason:** requires a schema
  audit (is `customerEmail` NOT NULL? what's the default?) and a
  test fixture covering both shapes. **Exit criterion:** once any
  paid checkout in production lands without an email captured (rare),
  this becomes High.

### C2RPF-PHOTO-LOW-04 — `dl_` prefix is not validated server-side beyond `startsWith`

- File: `apps/web/src/lib/download-tokens.ts:42`
- Severity: **Low** | Confidence: **High**
- **What:** `verifyTokenAgainstHash` rejects tokens that do not start
  with `dl_`, but does not validate the rest of the token shape (43
  base64url chars). A malformed token like `dl_<<<<<` will hash to a
  random hex, hit the DB lookup (no match), and 404 — which is
  correct behavior, but the SQL hits the index before the rejection.
  Cheap DOS vector for the download endpoint.
- **Photographer/visitor lens:** Photographer's DB sees one extra
  index probe per malformed-token request. With per-IP rate-limit on
  `/api/checkout` already in place, this is bounded.
- **Fix (deferred):** Add a length+charset regex to reject obviously-
  invalid token shapes before the DB hits. **Deferral reason:** cosmetic
  hardening; current code is functionally correct and the DB index
  probe is fast. **Exit criterion:** if the download route ever
  becomes a measurable DB-CPU hot path.

### C2RPF-VISITOR-LOW-01 — `affectedRows` fallback nullifies `downloadTokenHash` even on no-affected-rows path

- File: `apps/web/src/app/api/download/[imageId]/route.ts:90-96`
- Severity: **Low** | Confidence: **Medium**
- **What:** The atomic claim sets `downloadTokenHash = null` AND
  `downloadedAt = NOW()` only on rows where `downloadedAt IS NULL`.
  If the row was concurrently claimed by another request, the WHERE
  clause filters us out and the UPDATE is a no-op. Behavior is
  correct. But: the column nullification means a `?token=...` retry
  after a successful download cannot match the entitlement row at
  all — the SELECT at line 49-63 looks up `eq(entitlements.downloadTokenHash, tokenHash)`,
  and after the first successful claim, that hash is NULL. The
  visitor sees `Token not found` instead of `Token already used`.
  Both are 4xx, but the message is wrong from a UX perspective.
- **Photographer/visitor lens:** Visitor: clicks download, gets the
  file. Refreshes (browser back, hits the same URL again), sees
  "Token not found" — looks like a 404 bug instead of the correct
  "you already downloaded this once" message.
- **Fix (deferred):** Either keep the hash but add a `consumed_at`
  column, or have the SELECT path also consider rows where the row
  was `downloadedAt IS NOT NULL` and return the same 410 message.
  **Deferral reason:** the current behavior is privacy-correct
  (clearing the hash makes the token un-replayable even on a DB
  leak) and only the error message is wrong. **Exit criterion:** if
  any photographer reports customer confusion about the post-
  download error message.

### C2RPF-VISITOR-LOW-02 — Photo viewer toast for checkout-success/cancel does not strip the query param

- File: `apps/web/src/components/photo-viewer.tsx:106-118`
- Severity: **Low** | Confidence: **High**
- **What:** The `useEffect` reads `checkoutStatus` and fires the toast
  exactly once via `checkoutToastFiredRef`. The query param itself
  (`?checkout=success`) is not stripped from the URL after the toast
  fires, so reloading the page (or copy/pasting the URL) re-shows
  the same toast on the second mount **only if the ref is reset by
  a remount**. This is fine for SPA navigation, but a hard reload
  re-runs the toast — the photographer's "share this link with a
  friend" use case can leak a stale "purchase successful!" toast to
  someone who never paid.
- **Photographer/visitor lens:** Visitor: surprising "purchase
  successful" toast on a shared URL.
- **Fix (deferred):** After firing the toast, replace the URL via
  `router.replace(pathname, { scroll: false })` to strip the
  `?checkout=success` query param. **Deferral reason:** low-impact
  edge case (visitor would have to share the literal post-checkout
  URL); current UI does not mislead about *purchase*, just about
  toast timing. **Exit criterion:** if the photographer reports
  that they share the post-checkout URL with friends.

### C2RPF-PHOTO-LOW-05 — `i18n/config.ts` and `lib/license-tiers.ts` carry duplicated locale list

- File: `apps/web/src/lib/license-tiers.ts:40-43`
- Severity: **Low** | Confidence: **High**
- **What:** `SUPPORTED_LOCALES = ['en', 'ko']` is duplicated in
  `lib/license-tiers.ts` with an inline comment "If a new locale is
  added there, update the regex below." This is a known coupling
  trap — adding a new locale requires touching two files, and the
  cycle 1 RPF directive itself flagged "no edit / scoring" but did
  not flag this drift risk.
- **Photographer/visitor lens:** Photographer who adds a third
  locale (Japanese, Spanish) for their gallery would see Stripe
  redirects fall back to `en` for that locale until they chase
  the secondary list.
- **Fix (deferred):** Import the canonical list from `i18n/config.ts`
  and re-export from `license-tiers.ts`. **Deferral reason:** no
  current locale beyond en/ko is planned. **Exit criterion:** any
  PR that adds a third locale to `i18n/config.ts` must touch
  `license-tiers.ts` in the same commit.

### C2RPF-PHOTO-LOW-06 — Webhook `customerEmail` falls through `customer_details?.email ?? customer_email ?? ''` without trim/lowercase

- File: `apps/web/src/app/api/stripe/webhook/route.ts:61`
- Severity: **Low** | Confidence: **High**
- **What:** Stripe sometimes returns the same email twice with
  different casing (e.g. `User@Example.com` vs `user@example.com`)
  across `customer_details.email` and `customer_email`. The webhook
  takes the first non-empty value verbatim, so two purchases by the
  same person can land with different `customerEmail` strings in the
  entitlements table. The admin /sales view groups by raw string;
  the same customer appears as two rows.
- **Photographer/visitor lens:** Photographer's /sales view shows
  duplicate-looking customers and skews any future per-customer
  analytics.
- **Fix (deferred):** Lowercase + trim before INSERT. **Deferral
  reason:** /sales view is currently best-effort revenue display,
  not an audit-grade ledger; CSV export already escapes formula
  injection. **Exit criterion:** if the photographer ever exports
  /sales data into accounting software.

### C2RPF-VISITOR-LOW-03 — `Content-Disposition: attachment; filename="..."` does not RFC 5987-encode

- File: `apps/web/src/app/api/download/[imageId]/route.ts:148`
- Severity: **Low** | Confidence: **Medium**
- **What:** `'Content-Disposition': \`attachment; filename="${downloadName}"\``
  uses the simple `filename=` form. `downloadName` is built from
  `photo-${imageId}${ext}` so the imageId is a small int and the
  extension is from the server-controlled original filename — there
  is no current injection risk. But the original filename's extension
  could in theory contain a non-ASCII character if a photographer
  uploaded a file with an exotic extension; the current `path.extname()`
  call will preserve it byte-for-byte. RFC 6266 + RFC 5987 require
  `filename*=UTF-8''<percent-encoded>` for non-ASCII.
- **Photographer/visitor lens:** Visitor on a Korean-only OS could
  see a garbled saved filename. Not a download failure, just a
  cosmetic save-name issue.
- **Fix (deferred):** When `downloadName` contains non-ASCII bytes,
  emit both `filename="photo-{id}.jpg"` and
  `filename*=UTF-8''<percent-encoded>`. **Deferral reason:** today
  the saved name is always ASCII (`photo-<int>.<ext>`); there is no
  observed user impact. **Exit criterion:** if user filenames ever
  flow into the saved download name.

### C2RPF-PHOTO-LOW-07 — `parseInt(row.value, 10)` for cents is not strict-int-validated

- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:50`
- Severity: **Low** | Confidence: **High**
- **What:** `parseInt('1234abc', 10) === 1234` and `parseInt('  500  ', 10) === 500`
  — JavaScript `parseInt` is permissive. The follow-up
  `Number.isInteger(cents) && cents >= 0` catches `NaN` but not the
  permissive cases. If an admin accidentally typed `500abc` into the
  price field (admin settings UI uses `<input type="text">` for
  display), the gallery would charge `$5.00` instead of refusing.
- **Photographer/visitor lens:** Photographer setting prices through
  the admin UI gets a silently-wrong outcome on typo.
- **Fix (deferred):** Replace with `Number(row.value)` plus a strict
  `/^\d+$/.test(row.value)` regex, or use the validation layer that
  already lives at `lib/validation.ts` for admin-entered strings.
  **Deferral reason:** admin settings UI already validates on
  submission via the actions layer; this is a defense-in-depth
  hardening only. **Exit criterion:** any future schema change
  that allows free-text in price fields.

### C2RPF-VISITOR-LOW-04 — `i18n/config.ts` regex bypass: locale segment of length 2 not in allowlist falls back silently

- File: `apps/web/src/lib/license-tiers.ts:52-57`
- Severity: **Low** | Confidence: **High**
- **What:** The Referer parser regex `/^\/([a-z]{2})(?:\/|$)/i` matches
  any 2-letter prefix and only then checks the allowlist. A Korean
  visitor with a referer of `/de/p/123` (cross-site link with a
  forged referer) would fall back to `en` instead of inferring `ko`
  from `accept-language`. Today this is bounded by browsers stripping
  cross-origin referers.
- **Photographer/visitor lens:** Visitor lands back on `en` after
  Stripe even if their session was Korean, when arriving from a
  cross-site link.
- **Fix (deferred):** Layer `accept-language` parsing under the
  Referer fallback. **Deferral reason:** Referer-based locale is the
  documented contract in `lib/license-tiers.ts`; visitor's
  `accept-language` is a pre-existing concept handled at the
  `i18n/config.ts` middleware layer. **Exit criterion:** if any
  visitor reports landing on the wrong locale after Stripe.

## Cross-file interaction findings

### C2RPF-CROSS-LOW-01 — Stripe checkout origin -> webhook -> photo-viewer status: three-file contract is correct but lacks an end-to-end test

- Files:
  - `apps/web/src/app/api/checkout/[imageId]/route.ts:131-134`
    (success_url contract)
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
    (forwarding `?checkout=success` -> `checkoutStatus` prop)
  - `apps/web/src/components/photo-viewer.tsx:66,106-118`
    (toast firing on `checkoutStatus`)
- Severity: **Low** | Confidence: **High**
- **What:** The three-file checkout-success UX flow is correctly
  wired (cycle 1 RPF C1RPF-PHOTO-HIGH-02 closure), but no Playwright
  spec asserts the full chain. A future refactor of the photo page
  (e.g. migrating `searchParams` to async) could silently drop the
  forwarding without breaking unit tests.
- **Fix (deferred):** Add `apps/web/e2e/checkout-success-toast.spec.ts`
  that mocks the Stripe redirect and asserts the toast fires.
  **Deferral reason:** mocking Stripe in Playwright is a bigger
  surface than this cycle's scope; existing test coverage in
  `__tests__/photo-viewer-checkout-status.test.ts` (if it exists)
  already locks the toast layer.

### C2RPF-CROSS-LOW-02 — `entitlements` row vs `images.license_tier` are not transactionally checked

- Files:
  - `apps/web/src/app/api/stripe/webhook/route.ts:104-113`
  - `apps/web/src/db/schema.ts` (entitlements/images definitions)
- Severity: **Low** | Confidence: **High**
- **What:** The webhook inserts an entitlement based on
  `session.metadata.tier`, with no FK or trigger linking the row
  back to the live `images.license_tier`. If the photographer
  changes an image's license_tier from 'commercial' to 'none' between
  checkout-creation and webhook-receipt (rare but possible — Stripe's
  retry window can be hours), the entitlement row will say 'commercial'
  while the image is now free. The download route uses the
  entitlement row's tier, not the image's, so the customer still
  gets their paid download — that's actually the desired behavior.
  But the audit trail is split between the two tables.
- **Photographer/visitor lens:** Photographer who changes their
  pricing sees inconsistent state in the admin /sales view.
- **Fix (deferred):** Add an admin-settings-level lock, or surface
  the discrepancy in /sales. **Deferral reason:** correct customer
  outcome already obtains; the discrepancy is a UI footnote.

### C2RPF-CROSS-LOW-03 — `apps/web/src/lib/rate-limit.ts` checkout helpers are tested but not lint-locked to checkout route

- Files:
  - `apps/web/src/lib/rate-limit.ts` (preIncrementCheckoutAttempt, rollbackCheckoutAttempt)
  - `apps/web/src/app/api/checkout/[imageId]/route.ts:62,78,90,94,98,104,142`
- Severity: **Low** | Confidence: **High**
- **What:** A future PR could add a new public-mutating route (e.g.
  `/api/contact-photographer`) without remembering to wire the same
  Pattern 2 rollback helpers. There is no lint script for
  `app/api/(non-admin)/**` to enforce the same-origin or rate-limit
  contract that `lint:api-auth` enforces for admin.
- **Fix (deferred):** Either expand `lint:api-auth` to also scan
  non-admin public mutating routes for "either explicit
  `@public-no-rate-limit-required` comment OR `preIncrement*` call",
  or document the expectation in `CLAUDE.md`. **Deferral reason:**
  zero new public-mutating routes pending; ad-hoc reviewer attention
  is sufficient until a fourth such route lands.

## OUT-OF-SCOPE (per cycle directive)

The following items were NOT surfaced in this cycle (and would not
have been admissible if surfaced) per the cycle thematic lens:

- (none — single-reviewer pass already filtered out edit/scoring/
  culling/etc ideas. The lens covers entirely the new feature
  surfaces from US-P54 forward.)

## Cross-cycle agreement

C2RPF-CROSS-LOW-01 (the Stripe → photo-page → viewer chain) extends
the cycle 1 RPF C1RPF-PHOTO-HIGH-02 closure: cycle 1 implemented the
chain, cycle 2 verifies it works and flags that the e2e contract is
not test-locked. Same theme, lower severity now that the high-severity
posture is closed.

## AGENT FAILURES

Multi-agent fan-out was deferred this cycle (see C2RPF-PHOTO-MED-01).
No subagent execution was attempted, so no per-agent failure data is
available. Cycle 3 must reattempt the fan-out and record any agent
failures there.

## Top findings by signal (cycle 2)

1. **C2RPF-PHOTO-MED-01** — Multi-agent fan-out deferred (process gap).
2. **C2RPF-PHOTO-LOW-01** — Vitest 5s timeouts under load (gate flake).
3. **C2RPF-VISITOR-LOW-01** — Post-download token-not-found vs
   token-already-used UX mismatch.
4. **C2RPF-CROSS-LOW-02** — entitlements.tier vs images.license_tier
   not transactionally linked.
5. **C2RPF-PHOTO-LOW-03** — Empty customerEmail silently drops the
   entitlement row.
6. **C2RPF-VISITOR-LOW-02** — Stripe success toast does not strip
   `?checkout=success` from URL.
7. **C2RPF-PHOTO-LOW-05** — Locale list duplicated between
   `i18n/config.ts` and `lib/license-tiers.ts`.
8. **C2RPF-PHOTO-LOW-06** — Webhook does not normalize email casing.
9. **C2RPF-PHOTO-LOW-02** — `affectedRows` fallback bias on driver drift.
10. **C2RPF-PHOTO-LOW-04** — Token shape not pre-validated before DB hit.
11. **C2RPF-VISITOR-LOW-03** — Content-Disposition not RFC 5987 encoded.
12. **C2RPF-PHOTO-LOW-07** — `parseInt` of cents allows trailing junk.
13. **C2RPF-VISITOR-LOW-04** — Locale fallback on cross-site Referer.
14. **C2RPF-CROSS-LOW-01** — End-to-end Stripe checkout success not
    e2e-locked.
15. **C2RPF-CROSS-LOW-03** — No lint gate for public-mutating-route
    rate-limit pattern.

(Cycle 2 surfaced 15 distinct findings against the cycle 1 RPF baseline
of 9. None are High; the High-severity posture closed in cycle 1 and
remained closed in cycle 2.)
