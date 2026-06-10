# Plan 274 — Run-4 Cycle 1 deferred findings ledger

**Source review:** `.context/reviews/run4-cycle1/_aggregate.md`
Every finding from the run-4 cycle-1 reviews is either scheduled in
`plan/plan-273-run4-cycle1-fixes.md` or recorded here. Severity/confidence preserved
from the original review (no downgrades). Deferred work remains bound by repo policy
(GPG-signed commits, Conventional Commits + gitmoji, no `--no-verify`, Node 24 / TS 6
toolchain) when picked up.

## Deferred items

### DEF-R4C1-01 — LR route whole-app revalidation per single-file publish
- **Original ID / severity / confidence:** ARCH-R4C1-11 — LOW / Medium
- **Citation:** `apps/web/src/app/api/admin/lr/upload/route.ts:396`
  (`revalidateAllAppData()`) vs browser parity `app/actions/images.ts:530`
  (`revalidateLocalizedPaths('/', '/admin/dashboard', topic)`).
- **Category check:** not security, not correctness, not data-loss — pure efficiency of
  cache invalidation breadth. Deferral permitted (no repo rule forbids deferring
  performance-class findings; CLAUDE.md "Public route freshness" documents that public
  pages currently run `revalidate = 0`).
- **Reason for deferral:** with `revalidate = 0` on all public routes there is no ISR
  cache for `revalidateAllAppData()` to bust, so the broader call is a near-no-op today.
  Narrowing it now adds divergence-risk churn (the LR route would need the localized-path
  helper + topic plumbing) for zero observable gain.
- **Exit criterion (re-opens this item):** reintroduction of ISR / non-zero `revalidate`
  on any public route (the explicit invalidation/freshness plan CLAUDE.md calls for), OR
  profiling showing measurable revalidation cost during bulk LR publishes. At that point,
  switch the LR route to targeted `revalidateLocalizedPaths('/', '/admin/dashboard',
  `/${topicSlug}`)` parity and add a parity test.

## Non-deferred confirmation
All other findings (TEST-R4C1-06, TEST/PERF-R4C1-07, SEC-R4C1-01, COR-R4C1-02,
COR-R4C1-03, COR-R4C1-04, COR-R4C1-05, DOC-R4C1-08, CHORE-R4C1-09) are scheduled in
plan-273 — nothing silently dropped. Security/correctness findings were NOT deferred.
