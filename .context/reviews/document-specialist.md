# Document Specialist — Cycle 3 provenance

Target: `afa11cf4`, 2026-07-18 KST. Review only.

## Relevant-file inventory

I read the current `AGENTS.md`, `CLAUDE.md`, root `README.md`,
`apps/web/README.md`, package scripts, env examples, site-config examples,
deployment/Compose/nginx/CI files, migration/CLIP/operator runbooks, Cycle-2
aggregate/plan/index, and the source/tests behind every operational claim. The
broader inventory comprised 3,645 tracked files and 764 current code/config/doc
files outside historical review/plan trees. Claims were checked against code,
build artifacts, git state, and live browser output.

## Genuinely new Cycle-3 findings

### DOC-C3-01 — Cycle-2 claims browser coverage that was never committed

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed new documentation/evidence defect**
- Regions: `.context/plans/cycle-2-2026-07-18-plan.md:29-32,64-78`;
  `apps/web/src/__tests__/masonry-card-memo.test.ts:115-123`;
  `apps/web/e2e/public.spec.ts:21-50`

The checked plan promises mobile/desktop browser request-timeline coverage for
the responsive preload change. The completion evidence reports the full E2E run,
but no Playwright spec covers image requests or preload links; only source
strings were added for this work item.

Concrete failure: later maintainers rely on the plan as proof that the browser
contract is locked, skip a needed regression, and ship a renewed mobile
bandwidth regression while all tests pass.

Suggested fix: either add the stated test, or change the plan to distinguish
one-off manual Chromium evidence from committed automated coverage. Record exact
viewport/request assertions rather than the aggregate E2E pass count alone.

### DOC-C3-02 — Cycle-2 remains documented as active and unreleased after release

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed new ledger drift**
- Regions: `.context/plans/cycle-2-2026-07-18-plan.md:5,45-48,79-80`;
  `.context/plans/README.md:34-38`

The plan says signed push and deploy remain pending and leaves the release item
unchecked. In fact, `master` equals `origin/master`, all five Cycle-2 commits are
GPG-valid, and the live site contains the responsive preload and combobox fixes.
The index still lists Cycle 2 as active instead of completed/archived.

Concrete failure: an interrupted run resumes from a false frontier, repeats
terminal work, or misattributes later production state.

Suggested fix: update the terminal status/evidence, check the release item, move
the plan to the archive/completed index, and make Cycle 3 the sole current plan.

## Correctly aligned documentation

The new semantic-search wording now matches the newest-first bounded DB scan and
backfill selection: repeated runs finish missing active-model embeddings but do
not rotate already-current older rows (`README.md:50`; `apps/web/README.md:72-76`;
`apps/web/src/app/api/search/semantic/route.ts:263-279`;
`apps/web/scripts/backfill-clip-embeddings.ts:165-228`). The checkout-owner trust
wording also accurately states the existing script-ownership boundary
(`README.md:139-150`; `CLAUDE.md:755-770`; `scripts/deploy-remote.sh:61-96`).

## Final documentation-code sweep

I rechecked command names, versions, env defaults/caps, routes, upload limits,
proxy/body limits, backup scope, runtime/build-time configuration, semantic
activation, migration rules, cache freshness, privacy promises, and deploy
behavior. Aside from the two Cycle-2 evidence/frontier contradictions above and
already-registered operator/architecture limitations, no additional material
documentation mismatch survived the final sweep.
