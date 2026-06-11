# Plan 307 — Run-4 Cycle 18 fixes

**Source review:** `.context/reviews/run4-cycle18/_aggregate.md`
**Status:** PENDING
**Gates per repo policy:** eslint, typecheck, vitest, api-auth lint,
action-origin lint, public-route-rate-limit lint, production build,
playwright e2e — all 8 must be green before deploy. GPG-signed
conventional commits + gitmoji; commit+push per task; per-cycle deploy.

## Task 1 — COR-R4C18-01 (+TEST-R4C18-01): validate the locale param on the topic feed route
**Severity:** MED-LOW/High (correctness; 4/6 cross-angle).
**Files:**
- `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts` —
  import `isSupportedLocale` from `@/lib/locale-path`; immediately
  after `await params`, `if (!isSupportedLocale(locale)) return new
  NextResponse(null, { status: 404 });` BEFORE any DB work. Add a
  comment citing COR-R4C18-01: route handlers bypass both the dotted
  -path middleware matcher (proxy.ts:140) and the layout `notFound()`
  locale gate, so any dotted route under `[locale]` must self-validate
  its locale param.
- `apps/web/src/__tests__/feed-sized-derivative.test.ts` — extend the
  existing source-reading suite with topic-route locale-lock
  assertions: source calls `isSupportedLocale(` before
  `getImagesForFeed(` in source order, and the rejection branch
  returns 404. Prove failing pre-fix (assertions first), green
  post-fix.
**Acceptance:** `GET /{junk}/{topic}/feed.xml` is a 404; valid locales
unchanged; vitest green incl. the new lock; no change to the root
feed route.

## Task 2 — COR-R4C18-02 (+TEST-R4C18-02): stop the webhook 500-retry loop on paid-session-for-deleted-image
**Severity:** MED/Medium-High (correctness/ops; 4/6 cross-angle).
**Files:**
- `apps/web/src/app/api/stripe/webhook/route.ts` —
  1. At the existing `currentImage` SELECT (:257): add
     `if (!currentImage)` →
     `console.error('Stripe webhook: paid session for deleted image — manual refund required', { sessionId, imageId, tier, amountTotalCents })`
     → `return NextResponse.json({ received: true }, { headers: NO_STORE })`.
     Permanent condition: the entitlement INSERT is impossible (FK
     NOT NULL → ER_NO_REFERENCED_ROW_2) and even a successful row
     would be cascade-deleted; Stripe must not retry.
  2. In the INSERT catch (:363): import `hasMySQLErrorCode` from
     `@/lib/validation`; on
     `hasMySQLErrorCode(err, 'ER_NO_REFERENCED_ROW_2')` emit the same
     manual-refund error log and return 200 — covers the
     SELECT→INSERT race window. ALL other errors keep the existing
     500-so-Stripe-retries behavior.
- `apps/web/src/__tests__/stripe-webhook-source.test.ts` — extend the
  source-contract suite: (a) a `!currentImage` branch returning
  `received: true` exists between the currentImage SELECT and the
  entitlements INSERT; (b) the catch references
  `ER_NO_REFERENCED_ROW_2` and returns 200 for it; (c) the existing
  transient-DB-error → 500 assertion stays intact. Prove failing
  pre-fix.
**Acceptance:** vitest green incl. extended lock; deleted-image
sessions produce exactly one error log + 200; transient DB errors
still 500.

## Task 3 — DOC-R4C18-03 (records SEC-R4C18-04): add the charged-post-validation pattern to the rate-limit registry header
**Severity:** LOW/High (doc-code mismatch with demonstrated
propagation risk; 3/6 cross-angle).
**Files:**
- `apps/web/src/lib/rate-limit.ts` — rewrite the :1-31 header from
  "Three rollback patterns" to four:
  - Pattern 4 — **charged post-validation** (OG buckets): rollback
    ONLY for syntactic pre-DB rejections; nonexistent resources,
    missing derivatives, render errors, and infra errors all stay
    charged (enumeration-oracle / unmetered-DB-CPU rationale,
    AGG8F-01 / SEC-R4C17-01); point at the two OG source-contract
    tests.
  - In the same block, one sentence recording WHY checkout and
    semantic deliberately remain Pattern 2 (SEC-R4C18-04): their
    limiters guard the Stripe API budget / embedding CPU, and every
    refunded branch is one that never consumed the guarded resource;
    image existence/tier are public on /p/{id}.
  Comment-only change — no behavior, no test churn.
**Acceptance:** eslint/typecheck green; no functional diff
(`git diff` shows comment lines only in rate-limit.ts).

## Progress

- [ ] Task 1 — COR-R4C18-01 + TEST-R4C18-01
- [ ] Task 2 — COR-R4C18-02 + TEST-R4C18-02
- [ ] Task 3 — DOC-R4C18-03 / SEC-R4C18-04

## Gate run + deploy record (cycle close)

To be filled during PROMPT 3 after all tasks land: 8-gate results,
GATE_FIXES count, and the per-cycle deploy record with live probes.
