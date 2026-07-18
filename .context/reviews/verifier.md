# Verifier — Cycle 3 provenance

Target: `afa11cf4`, 2026-07-18 KST. Review only.

## Relevant-file inventory

Verification covered 368 Vitest files, 9 Playwright specs (48 discovered tests),
all scanner and proof scripts, package/CI/typecheck/build configs, generated PWA
contracts, migrations/reconcile tests, deploy tests, every Cycle-2-changed source
file and its claimed tests, and the governing/readme/plan documents. The wider
inventory was 3,645 tracked files, with 764 current repository files outside the
historical review/plan trees.

## Executed evidence

- PASS: ESLint; app + scripts typecheck; API-auth, action-origin/barrier, and
  public-route-rate-limit scanners.
- PASS: Vitest — 361 files passed, 2 skipped; 3,410 tests passed, 4 skipped.
- PASS: production build (Next 16.2.10); `/sitemap.xml` is dynamic and absent
  from `.next/prerender-manifest.json`.
- PASS: production dependency audit — zero vulnerabilities; `git diff --check`.
- PASS: Playwright discovery — 48 Chromium tests in 9 specs.
- Manual browser proof: live Chromium at 320 px and 1600 px emitted all four
  intended media-qualified image preloads; false mobile predicates did not
  activate the desktop-only hint, while desktop did. The changed search state is
  also present live.
- Limitation: this pass did not rerun credentialed local admin E2E, real CLIP
  inference, or proxy-topology probing; those remain separate environment proofs.

## Genuinely new Cycle-3 findings

### VER-C3-01 — No repeatable browser proof backs the responsive-preload pass claim

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed test/evidence gap; manual behavior currently passes**
- Regions: `.context/plans/cycle-2-2026-07-18-plan.md:29-32,66-78`;
  `apps/web/src/__tests__/masonry-card-memo.test.ts:115-123`;
  `apps/web/e2e/public.spec.ts:21-50`

The plan checks off browser request-timeline coverage, but the repository has
only literal source assertions for the preload implementation. Playwright's
Cycle-2 addition covers the combobox, not network scheduling.

Concrete failure: a wrong media-to-card mapping or framework serialization
regression can pass every committed gate. A reviewer sees green E2E plus the
checked ledger and incorrectly treats the mobile bandwidth regression as closed.

Suggested fix: commit deterministic mobile/desktop network-timeline coverage and
make it fail on wrong activated hints, not merely on missing source strings.

### VER-C3-02 — Cycle-2 release evidence is internally stale

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed new provenance mismatch**
- Regions: `.context/plans/cycle-2-2026-07-18-plan.md:5,45-48,79-80`;
  `.context/plans/README.md:34-38`

The ledger records push/deploy as pending although the signed commits are on
`origin/master` and the live application exhibits the shipped behavior. Update
and archive the plan so recovery can identify the actual release frontier.

## Revalidated carry-forward verification limit

### VER-C3-R1 — Deploy tests still prove ordering, not service recovery

- Severity: **Medium**
- Confidence: **High**
- Status: **Revalidated carry-forward; not new**
- Regions: `apps/web/deploy.sh:63-89`;
  `apps/web/src/__tests__/deploy-script-contract.test.ts:27-56`

The contract test requires health checking before prune, but no test or code
requires rollback/candidate cleanup/continued availability after a failed
candidate. Add a fake-Docker state-machine proof for recovery or blue/green
promotion semantics.

## Final sweep

I reconciled every executed command with CI scripts, skipped/env-gated suites,
built artifacts, changed-source tests, source-only assertions, deployment
contracts, and current documentation. No further contradicted pass claim or
new correctness failure survived the closing sweep.
