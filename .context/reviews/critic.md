# Critic — Cycle 3 provenance

Target: `afa11cf4`, 2026-07-18 KST. Review only.

## Relevant-file inventory and method

The challenge pass inventoried all 3,645 tracked files and systematically
examined the 764 current code/config/doc files outside historical review/plan
trees. It challenged the Cycle-2 fixes against emitted browser behavior, built
artifacts, source tests, deployment semantics, auth/privacy invariants, restore
and migration behavior, semantic-search claims, CI, and operator ledgers rather
than accepting checked boxes or comments as evidence.

## Genuinely new Cycle-3 findings

### CRIT-C3-01 — The responsive preload fix has claimed browser coverage that does not exist

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed new assurance/provenance defect; current product behavior manually passes**
- Regions: `.context/plans/cycle-2-2026-07-18-plan.md:29-32,64-78`;
  `apps/web/src/__tests__/masonry-card-memo.test.ts:115-123`;
  `apps/web/e2e/public.spec.ts:21-50` and the remaining `apps/web/e2e/*.spec.ts`

The checked work package requires 320 px and desktop request-timeline coverage,
but the only preload regression is a source-string test. The sole Cycle-2 E2E
addition tests search combobox state; none of the 48 discovered Playwright tests
observes preload links or image request timing.

Concrete failure: a future refactor can preserve the strings `media:` and the
breakpoint literals while emitting unusable link attributes, mapping a card to
the wrong breakpoint, or reintroducing early mobile requests. Vitest and E2E
remain green, and the plan tells the next reviewer that the exact browser
contract was already proved.

Live Chromium challenge evidence at 320 px and 1600 px showed the current four
`<link rel="preload" as="image">` elements do carry the intended media predicates
and desktop activates them, so this is not being mislabeled as a current product
failure.

Suggested fix: add a committed Playwright/CDP request-timeline test over a
deterministic tall-card fixture at mobile and desktop breakpoints, asserting the
emitted `media`/`imagesrcset` contract and which pre-hydration requests each
viewport activates. Correct the plan evidence until that test exists.

### CRIT-C3-02 — The terminal Cycle-2 ledger contradicts repository and deployed state

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed new documentation/provenance drift**
- Regions: `.context/plans/cycle-2-2026-07-18-plan.md:5,45-48,79-80`;
  `.context/plans/README.md:34-38`

The plan still says signed push and deploy are pending and leaves the release
step unchecked, while `master` equals `origin/master`, all five Cycle-2 commits
are signed, and the live site emits the responsive preload/search behavior. The
index still lists Cycle 2 under active plans.

Concrete failure: recovery automation or a later reviewer can repeat a deploy,
misidentify the release frontier, or treat completed work as unfinished.

Suggested fix: record the terminal commit/deploy evidence, check the release
step, mark Cycle 2 complete, and archive/move its index entry when Cycle 3 opens.

## Revalidated carry-forward challenge

### CRIT-C3-R1 — Health detection still replaces the only instance before proof

- Severity: **Medium**
- Confidence: **High**
- Status: **Revalidated carry-forward; not new**
- Region: `apps/web/deploy.sh:63-89`; `apps/web/docker-compose.yml:12-17`

`docker compose up -d --build` replaces the sole container before health is
known. Failure exits with the bad release still active/restarting; there is no
prior-image rollback or candidate promotion. Fix with a verified candidate slot
plus promotion, or automatic rollback whose restored instance is health-checked.

## Final missed-issue sweep

I tried to falsify the dynamic sitemap ownership, combobox state, semantic
documentation, checkout trust explanation, auth limiters, privacy projections,
migration postconditions, and restore drains. Build artifacts and live browser
evidence support the current code changes. No other new issue survived the final
counterargument and file-coverage sweep.
