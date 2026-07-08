# Run-10 Cycle 29/100 Document Specialist + Critic Review

Date: 2026-07-08 KST
Reviewed HEAD: `d985f549afa73b23cdccf5d8fea30f4bfc840847`
Role lane: document-specialist/critic reviewer

## Scope And Inventory

Fresh current-HEAD review only. I inspected the operator-facing docs and the adjacent source that can falsify them:

- Core guidance: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Deploy/runbook touchpoints: `package.json`, `apps/web/package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`.
- Plan/review ledgers: `.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`, `.context/plans/run10-cycle27/*`, `.context/plans/run10-cycle28/*`, `.context/reviews/run10-cycle28/*`.
- Product-honesty spot checks: CLIP/semantic-search settings and routes, PAT upload route, storage quarantine, auto-alt-text stub/backfill, GA/site-config import paths, HDR/color public/admin boundaries.

## Findings

### DOC-C29-01 - Cycle 28 implementation ledger still says terminal release work is pending after the signed push

Severity: Medium
Confidence: High

Regions:

- `.context/plans/run10-cycle28/plan.md:3`
- `.context/plans/run10-cycle28/plan.md:136-147`
- `.context/plans/run10-cycle28/plan.md:149-159`
- `.context/plans/README.md:34-37`
- `AGENTS.md:7-19`

Problem:

Current `origin/master` is `d985f549` (`fix(cycle28): 🐛 harden grid fallbacks and action gates`) with a good GPG signature, and the branch is clean/aligned with `origin/master`. The Cycle 28 plan, however, still says `SIGNED PUSH/DEPLOY PENDING`, leaves signed commit/push and per-cycle deploy/live smoke unchecked, and has no terminal-evidence section. The active-plan index also still describes Cycle 28 as the active ledger expected to include "full gates, signed push, and per-cycle deploy."

This is not the already-fixed Cycle 27 stale-ledger issue. Cycle 27 now records signed push and explicitly says deploy evidence was absent/superseded; Cycle 28 is the current stale ledger.

Concrete failure scenario:

A Cycle 29 planner sees a signed pushed Cycle 28 implementation at HEAD but a plan that still advertises pending release steps. They cannot tell whether production deploy/live smoke actually happened and was just not recorded, or whether the per-iteration deploy required by `AGENTS.md` still needs to run. That ambiguity can either skip a required deploy or waste the next cycle re-verifying already-completed terminal work.

Suggested fix:

Update `.context/plans/run10-cycle28/plan.md` with exact terminal evidence: signed commit hash, push state, `npm run deploy` result, and live-smoke result. If deploy was not run, keep that explicit and schedule/perform the per-cycle deploy before calling Cycle 28 production-closed. Move Cycle 28 from active to completed in `.context/plans/README.md` when Cycle 29 becomes the active ledger.

### DOC-C29-02 - Consolidated carry-forward register skipped Cycle 27 and Cycle 28 deferred items

Severity: Medium
Confidence: High

Regions:

- `.context/plans/deferred-carry-forward.md:3-7`
- `.context/plans/deferred-carry-forward.md:19-26`
- `.context/plans/deferred-carry-forward.md:118-119`
- `.context/plans/deferred-carry-forward.md:304-310`
- `.context/plans/run10-cycle27/deferred.md:13-17`
- `.context/plans/run10-cycle28/deferred.md:13-17`
- `.context/plans/README.md:28-37`

Problem:

The consolidated register says it must be updated every cycle, but its latest age-budget check is still run-10 Cycle 26, the table header is still `Age @ r10c24`, and the newest run-qualified rows stop at Cycle 26 plus loop-B Cycle 8. It has no entries for Cycle 27 deferred findings (`AGG-C27-02`, `AGG-C27-04`, `AGG-C27-05`) and no entries for Cycle 28 deferred findings (`AGG-C28-05`, `AGG-C28-08`), even though the plan index advertises the Cycle 28 deferred register as active.

Concrete failure scenario:

A reviewer enforcing the 8-cycle High / 16-cycle Medium checkpoint uses `.context/plans/deferred-carry-forward.md` as instructed and misses the newer deferred admin-e2e, restore-ordering, finalizer-test, UI-render, and proxy-real-IP validation items. Those items then age without mechanical tracking, defeating the register's stated purpose.

Suggested fix:

Refresh `.context/plans/deferred-carry-forward.md` to the current run-10 Cycle 29 basis: update the prose checkpoint, update the age header, bump existing ages consistently, add Cycle 27 and Cycle 28 deferred rows with preserved severity/confidence and short exit criteria, and note any rows that were scheduled/closed. Keep the per-cycle deferred files authoritative for full citations and rationale.

## Critical Challenge / Non-Findings

- Do not treat the bare `.context/plans/cycle-29-2026-06-30-*` files or `apps/web/src/__tests__/cycle-29-source-contracts.test.ts` as the current run-10 Cycle 29 ledger. They belong to an older lineage; `.context/plans/README.md:39-44` explicitly warns about bare historical cycle-name ambiguity.
- I did not refile Cycle 28 deferred items (`AGG-C28-05`, `AGG-C28-08`) as fresh product/test defects. They remain valid deferred records; the new defect is that the consolidated carry-forward register does not carry them.
- README/CLAUDE claims for semantic search being operator-enabled, storage being quarantined/local-only, Lightroom-compatible PAT upload being an API rather than a bundled plugin, GA being opt-in through `google_analytics_id`, and auto-alt-text being an EXIF/metadata stub rather than remote captioning matched current source.

## Verification

Read-only review plus this written artifact. I used static source/doc inspection and current git state; no app code was modified and no test suite was needed for this documentation-review artifact.
