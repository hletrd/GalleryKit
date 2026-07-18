# Verifier Review — Cycle 8

Date: 2026-07-18 KST
Review HEAD: `ff8c5f48`

## Inventory and verification method

I verified Cycle 7 claims from `responsive-masonry.ts` through `HomeClient`,
the ref-bearing grid boundary, `MasonryCard`, public container/CSS, unit and
browser tests, commit signatures, remote state, current plan index, and prior
findings. I also sampled every maintained route/action/schema/script boundary
and checked the consolidated deferred register for reopened invariants.

Focused responsive tests passed 34/34. API-auth, action-origin/mutation-barrier,
and public-route-rate-limit lints passed. Production dependency audit found
zero vulnerabilities. All Cycle 7 commits are GPG-good and local/remote master
both resolve to `ff8c5f48`.

## Evidence-backed findings

### VER-C8-01 — Container-owned intrinsic geometry is fixed, but source-candidate alignment is not

- Severity / confidence / status: **Medium / High / Partially verified acceptance; confirmed residual defect**
- Regions: `apps/web/src/components/home-client.tsx:69-105,257-272,350-360`;
  `apps/web/src/lib/responsive-masonry.ts:24-35,42-57`;
  `apps/web/src/components/masonry-card.tsx:91-110`;
  `apps/web/e2e/responsive-masonry.spec.ts:11-55,57-95`
- Verified good: one `ResizeObserver` owns the grid width, schedules a
  quantized update, disconnects/cancels on unmount, and feeds item-capped card
  geometry. Unit cases cover invalid/unmeasured, 288 px mobile, and 1,488 px
  multi-column values; browser cases exercise 320, 1,536, and 2,560 px.
- Verified failure: `getMainMasonrySizes()` still emits `20vw`/`33vw` based on
  the uncapped viewport. At 2,560 px, the real five-column card is 288 px; DPR
  2 requires 576 source pixels, while `20vw` declares a 512 px slot and asks
  for about 1,024, selecting 1536w rather than sufficient 640w. The only
  ultrawide E2E uses two 744 px cards, for which 1536w is legitimately needed,
  so its passing result cannot verify normal-gallery candidate alignment.
- Suggested fix: emit a container-capped sizes expression and add an ultrawide
  full five-column candidate assertion.

### VER-C8-02 — Cycle 7 release-state claims are stale at least for signature/push

- Severity / confidence / status: **Low / High / Confirmed; deploy remains unverified**
- Regions: `.context/plans/cycle-7-2026-07-18-plan.md:5,48-50,73-82`;
  `.context/plans/README.md:34-40`
- Evidence: `git verify-commit` reports good signatures for `498e5122`,
  `90a3bc07`, and `ff8c5f48`; `master` and `origin/master` both resolve to
  `ff8c5f48`. The plan still records signed commits/push as pending. This
  review did not establish a production SHA or per-cycle deploy outcome.
- Suggested fix: mark signed publication complete from the evidence above,
  preserve deploy as pending unless terminal evidence exists, and advance the
  plan only under the repository's truthful release-ledger convention.

## Revalidated carry-forward and final sweep

The observer fix does not trigger existing topology, shared DB-budget,
restore-generation, large-map/vector, upload-RSS, environment, or browser-test
infrastructure exit criteria. The final sweep rechecked implementation claims
against source behavior rather than comments/tests alone, plus guard gates,
privacy, migrations, persistence races, caches, and release history. No third
distinct verifier finding survived validation.
