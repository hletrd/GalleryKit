# Test Engineer — Cycle 6 Provenance

Review target: `6e4c25c8`. Test inventory covered 370 unit-test files, 14 Playwright files, custom auth/origin/rate-limit scanners, typecheck/build configuration, seed/server helpers, and prior gate evidence.

## NEW Cycle 6 finding

### TEST-C6-01 — Responsive E2E never executes `HomeClient`'s new item-count policy

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed coverage gap; current live source-size behavior correct**
- Regions: `apps/web/e2e/responsive-masonry.spec.ts:4-85`; `apps/web/src/__tests__/responsive-masonry.test.ts:8-42`; `apps/web/src/__tests__/masonry-card-memo.test.ts:99-177`; changed integration at `home-client.tsx:231-234,323-334`

The E2E covers timeline and shared-group constants, not the home route. Unit tests validate the pure helper and a literal replica/source substring; they do not prove React passes the actual live `itemCount`, the class policy agrees, or the intrinsic estimator is capped.

Concrete failure: `const responsiveSizes = useMemo(() => getMainMasonrySizes(5), [])` still satisfies helper tests, archive/shared E2E, and the memo test's `responsiveSizes={responsiveSizes}` substring while reintroducing sparse-gallery softness. The current 196 px versus 496 px live intrinsic mismatch is another regression these tests cannot detect.

Fix: deterministic browser fixtures for 1/2/4/5 home items; assert computed columns, source `sizes`, selected candidate, card dimensions, and `contain-intrinsic-size`. Avoid another source replica. Candidate selection should be asserted only where the seeded ladder makes it deterministic.

## Results and revalidated carry-forward

All independently run gates listed in the verifier file passed. The strengthened priority E2E correctly separates eager and high states. The broad existing source-contract/behavior-harness backlog remains carry-forward; `TEST-C6-01` is the new concrete occurrence that provides its next actionable fixture.

## Final test sweep and coverage

I reviewed changed and sibling tests, fixture determinism, negative cases, route/action scanners, privacy/touch-target contracts, migrations, queue/restore concurrency coverage, browser matrix, PWA, admin, and CLIP preflight boundaries. No other new test defect survived.
