# Verifier Review - Cycle 19 Prompt 1

Role: verifier
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `6efd737b3ad5791c662fded4801701992684e54d` (`origin/master` matches)
Scope note: read-only correctness review except for this report file. I did not edit source, commit, push, deploy, or touch the unrelated untracked `.context/reviews/cycle-9-2026-07-08/` directory.

## Process Evidence

- Read repo rules and runbooks: `AGENTS.md`, `CLAUDE.md`, `README.md`, root `package.json`, `apps/web/package.json`, `.context/plans/README.md`, active Cycle 18 plan/deferred files, consolidated carry-forward register, and existing review conventions.
- Inventory reviewed: package scripts and quality gates; custom auth/origin/rate-limit linter implementations and their tests; migration journal/reconcile checks; privacy guard tests and `data.ts` public/admin field projections; deploy helper scripts and deploy-script contract tests; Playwright config and admin e2e gating; CLIP/backfill/proof-script runbooks and source-contract tests.
- Fresh lightweight gates run:
  - `npm run lint:api-auth --workspace=apps/web` - passed.
  - `npm run lint:action-origin --workspace=apps/web` - passed.
  - `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- Not run: full lint, typecheck, build, unit suite, e2e, or deploy. The current Cycle 18 plan records those local gates as green, but this verifier lane did not repeat the expensive gates and did not perform external deployment.

## Findings

### VER-C19-01 - Cycle 18 release finalization is not proven after the pushed commit

- Severity: Medium
- Confidence: High for stale ledger; Medium for actual production deploy state
- Classification: Confirmed verification/provenance gap; deployment status remains manual-validation risk
- Location: `.context/plans/README.md:34-43`, `.context/plans/cycle-18-2026-07-08-plan.md:3-6`, `.context/plans/cycle-18-2026-07-08-plan.md:114-131`, `.context/plans/cycle-18-2026-07-08-plan.md:133-157`, `package.json:17-30`
- Evidence: `git rev-parse HEAD origin/master` returns `6efd737b3ad5791c662fded4801701992684e54d` for both, and `git log -1` shows the Cycle 18 fix commit on `master`. The active plan still says `Status: IMPLEMENTED + LOCAL GATES GREEN; COMMIT/PUSH/DEPLOY FINALIZATION IN PROGRESS`, lists start HEAD `a1863405`, and leaves `[ ] WP5 signed commit/push and per-cycle deploy finalization` unchecked. A focused search for `6efd737`, `fix(cycle18)`, or `Deployment Complete` in the active plan/deferred/index and `.context/gate-logs` returned no terminal entry. The root `deploy` script is `./scripts/deploy-remote.sh`, and the plan requires `npm run deploy` once after pushed green gates.
- Why this matters: The repo's runtime contract is not just "tests passed"; it is pushed source plus per-cycle deploy evidence or an explicit recorded deploy gap. Current committed artifacts prove local gates for Cycle 18 but do not prove whether the pushed `6efd737b` ever reached the deploy target.
- Failure scenario: A later agent or operator reads the active ledger and cannot distinguish "Cycle 18 source is pushed but production is stale" from "Cycle 18 deployed successfully." That can lead to skipped deployment, duplicate work, or false claims that production carries the Cycle 18 fixes.
- Suggested fix: Close Cycle 18 in the plan/index with terminal evidence for `6efd737b`: signed commit/push status, deploy command, exit status, smoke result, and any host/container proof normally recorded for this repo. If deploy intentionally did not run, record an explicit deploy gap/supersession instead of leaving finalization pending.

### VER-C19-02 - Carry-forward age register still has stale cycle-4 age labels despite Cycle 18 acceptance

- Severity: Medium
- Confidence: High
- Classification: Confirmed ledger invariant failure
- Location: `.context/plans/cycle-18-2026-07-08-plan.md:27-37`, `.context/plans/deferred-carry-forward.md:3-7`, `.context/plans/deferred-carry-forward.md:19-27`, `.context/plans/deferred-carry-forward.md:36-80`
- Evidence: Cycle 18 WP1 acceptance explicitly says carry-forward age text should no longer claim the current check is `run-10 c4`, and the register says it must be updated every cycle. The register prose now mentions `run-10 c18`, but the table header remains `Age @ r10c4`, old rows such as `C1-31` still show age `3`, and line 12 still describes old-run items by their age at `run-10 cycle-4`.
- Why this matters: `.context/plans/README.md:14-26` defines mechanical review obligations for High findings crossing 8 cycles and Medium findings crossing 16 cycles. A table still keyed to r10c4 cannot reliably prove which items have crossed those thresholds in Cycle 18/19.
- Failure scenario: An old Medium item that should require a 16-cycle re-justification can remain listed with a stale low age, so a planner preserves it without the required reclassification, scheduling, or product-decision note.
- Suggested fix: Recompute the carry-forward age column for the current cycle, update all stale r10c4 text, and add a small invariant check or source-contract test that fails when the active cycle label in the header/prose disagrees with the latest active plan.

### VER-C19-03 - Migration reconcile coverage still does not prove structural schema equivalence

- Severity: Medium
- Confidence: High
- Classification: Manual-validation risk in a critical migration path
- Location: `CLAUDE.md:479-485`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-102`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:117-122`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:175-180`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:292-297`, `apps/web/scripts/migrate.js:277-284`, `apps/web/package.json:13-29`
- Evidence: The runbook requires every migration to update `reconcileLegacySchema` so fresh/legacy DBs baseline cleanly. The main coverage test explicitly says it is a source tripwire and cannot verify types or defaults; the column assertion only checks that every Drizzle column name appears in comment-stripped `migrate.js`, and the index assertion checks only index name presence. There are targeted pins for `image_embeddings` storage/index shape and `images.processed` default drift, but no general DB-backed information_schema diff appears in the normal `test`, `typecheck`, or build scripts.
- Why this matters: The migration path has a history of silent skip/baseline failures, so "name appears in migrate.js" is weaker than the repo contract "mirror the new schema state." A wrong column type, nullability, default, charset, FK action, or index column order can satisfy the current source tripwires while fresh/legacy DBs diverge from the Drizzle schema.
- Failure scenario: A future migration changes a column from nullable to not-null, changes a default, or alters an index column order. The author updates `schema.ts` and includes the name in `reconcileLegacySchema`, so tests pass, but a fresh/legacy DB bootstrapped through reconcile has structurally different behavior from a DB that actually ran the SQL migration.
- Suggested fix: Add a DB-backed migration contract gate that initializes an empty disposable schema through the reconcile/baseline path, introspects `information_schema` for columns/indexes/FKs/defaults/nullability, and compares it to the expected schema/migration declarations. If a full DB gate is too expensive for every unit run, make it an explicit CI/nightly or schema-change required command and document it in the migration checklist.

## Clean / Refuted Areas

- Custom lint gates are not merely declared; their scanners and tests cover direct exports, alias imports, star re-exports, local helper spoofing, guard ordering, public mutation rate limits, expensive GET handlers, exemptions, and discovery failures. The three custom gates passed fresh at reviewed HEAD.
- Privacy projection coverage is materially guarded: `data.ts` public/admin projections, `_PrivacySensitiveKeys`, `SENSITIVE_KEYS`, public-safe fixtures, alias scans, map-visible filtering, and behavior-level map query tests were inspected. I found no current privacy-field finding.
- Deploy helper safety contracts are covered at source level: contract tests assert config-driven remote deploy, strict env-file permissions, build args, immutable asset behavior, health-before-prune ordering, and no `volume prune -a`. I found no deploy-script source-contract regression.
- Browser/e2e/admin runtime coverage remains intentionally environment-gated. Existing proof-script and Playwright helpers document that admin and CLIP preflight proofs are explicit/operator-gated surfaces, so I am not reporting those as new defects here.

## Final Sweep

Examined categories: repo policy docs, plan/review ledgers, package scripts, custom lint scripts and tests, migration scripts/tests, privacy/data projections/tests, deploy scripts/tests, e2e config/helpers, public/admin route/action gate surfaces, CLIP/backfill/proof-script docs and tests.

Skipped categories: full source-file line-by-line review outside the verification-contract surfaces, full expensive quality gate rerun, live deployment, production smoke tests, DB-backed migration bootstrap, and external CLIP/admin operator preflight.
