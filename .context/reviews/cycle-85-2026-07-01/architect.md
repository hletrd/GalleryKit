# Cycle 85/100 Architect Review

Reviewed HEAD: `1d29b98861098a68a8107746997a5d81d70f03f1`.
Date: 2026-07-01.
Role: architect lane.

## Inventory

- Required workspace contracts read: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/reviews/_aggregate.md`, Cycle 84 aggregate/review/plan/deferred artifacts, git `HEAD`/`origin/master` evidence.
- Latest aggregate: `.context/reviews/_aggregate.md:1` through `.context/reviews/_aggregate.md:8` points to Cycle 84 and lists its two scheduled findings.
- Cycle 84 implementation delta: signed pushed `HEAD` `1d29b98861098a68a8107746997a5d81d70f03f1` changes review/plan ledgers, `.gitignore`, and `apps/web/src/__tests__/failed-image-retry.test.ts`; no runtime product source changed.
- Git evidence: `HEAD`, `origin/master`, and `origin/HEAD` all resolve to `1d29b98861098a68a8107746997a5d81d70f03f1`; `git show -s --format='%G? %GS' HEAD` reports `G Jiyong Youn <01@0101010101.com>`.
- Focus areas inspected: deploy/docs drift, plan/review state consistency, restore maintenance and restore import locks, backfill candidate/update invariants, image/color/HDR pipeline honesty, public privacy field boundaries, and photographer-facing color delivery risks.

## Result

Confirmed findings: 1 Medium.

This review did not edit source or plans. It wrote only this review artifact.

## Finding

### C85-ARCH-01 - Cycle 84 release ledger remains active and deploy-unclosed after its pushed signed HEAD

- Severity: Medium.
- Confidence: High.
- Citations:
  - `.context/plans/README.md:5` opens the active plan section, and `.context/plans/README.md:7` still lists the Cycle 84 implementation plan as active.
  - `.context/plans/cycle-84-2026-07-01-plan.md:8` makes commit/push and `npm run deploy` part of the Cycle 84 goal.
  - `.context/plans/cycle-84-2026-07-01-plan.md:39` requires signed commit, pull-rebase, push, and deploy after local gates.
  - `.context/plans/cycle-84-2026-07-01-plan.md:43` through `.context/plans/cycle-84-2026-07-01-plan.md:47` mark review, implementation, and gates complete, but `.context/plans/cycle-84-2026-07-01-plan.md:48` and `.context/plans/cycle-84-2026-07-01-plan.md:49` still leave commit/push and deploy unchecked.
  - `.context/plans/cycle-84-2026-07-01-plan.md:53` through `.context/plans/cycle-84-2026-07-01-plan.md:61` record local gate evidence only; there is no terminal signed-commit/origin/deploy evidence for Cycle 84.
  - `AGENTS.md:17` and `CLAUDE.md:467` through `CLAUDE.md:469` define the per-iteration deploy contract after every pushed `master` commit.
- Evidence: current `HEAD == origin/master == origin/HEAD` is signed commit `1d29b98861098a68a8107746997a5d81d70f03f1`, whose subject is `test(review): ✅ close cycle 84 release contracts`. The commit trailer records full local gates and `Not-tested: npm run test:e2e --workspace=apps/web`, but the committed Cycle 84 plan remains active with commit/push/deploy unchecked and no `npm run deploy` result or explicit deploy-evidence gap.
- Failure scenario: Cycle 85+ reviewers and operators cannot tell from committed ledgers whether Cycle 84 was pushed and deployed, pushed but not deployed, or only locally validated. This repeats the release-ledger ambiguity Cycle 84 closed for Cycle 83.
- Suggested fix: update `.context/plans/cycle-84-2026-07-01-plan.md` to mark commit/pull-rebase/push complete with signed `1d29b988` / `origin/master` evidence, record the `npm run deploy` result or an explicit deploy-evidence gap/supersession note, and move Cycle 84 from active to recent in `.context/plans/README.md`.

## Verified Clean Surfaces

- Cycle 83 ledger closure is now recorded: `.context/plans/cycle-83-2026-07-01-plan.md:49` and `.context/plans/cycle-83-2026-07-01-plan.md:50` mark commit/push plus terminal release state complete, with signed commit evidence and the deploy-evidence gap recorded at `.context/plans/cycle-83-2026-07-01-plan.md:63` and `.context/plans/cycle-83-2026-07-01-plan.md:64`.
- Deploy storage safety remains aligned: `apps/web/docker-compose.yml:24` through `apps/web/docker-compose.yml:28` bind-mount mutable stores and `site-config.json`; `apps/web/deploy.sh:55` runs compose before pruning, and `apps/web/deploy.sh:99` through `apps/web/deploy.sh:104` prune only after the health check. This matches the bind-mount/no-`volume prune -a` contract in `AGENTS.md:19` and `CLAUDE.md:475` through `CLAUDE.md:477`.
- Restore/backfill locking remains architecturally consistent: restore acquires `LOCK_DB_RESTORE`, the upload-processing contract lock, color backfill lock, and semantic backfill lock before durable maintenance/import at `apps/web/src/app/[locale]/admin/db-actions.ts:390` through `apps/web/src/app/[locale]/admin/db-actions.ts:447`, then starts durable maintenance at `apps/web/src/app/[locale]/admin/db-actions.ts:449` through `apps/web/src/app/[locale]/admin/db-actions.ts:456` and quiesces/drains background work at `apps/web/src/app/[locale]/admin/db-actions.ts:492` through `apps/web/src/app/[locale]/admin/db-actions.ts:503`.
- Durable restore maintenance has a host marker and fail-closed read path: `apps/web/src/lib/restore-maintenance-durable.ts:24` through `apps/web/src/lib/restore-maintenance-durable.ts:29` choose the marker location, `apps/web/src/lib/restore-maintenance-durable.ts:36` through `apps/web/src/lib/restore-maintenance-durable.ts:50` fail closed on marker read errors, and `apps/web/src/lib/restore-maintenance-durable.ts:96` through `apps/web/src/lib/restore-maintenance-durable.ts:115` bracket process state with marker write/clear.
- Backfill invariants remain anchored in both paths: the in-app runner candidates are `pipeline_version < IMAGE_PIPELINE_VERSION` at `apps/web/src/lib/admin-backfill-runner.ts:390` through `apps/web/src/lib/admin-backfill-runner.ts:395`; it does not bump `pipeline_version` on detection failure and persists only derivative flags at `apps/web/src/lib/admin-backfill-runner.ts:636` through `apps/web/src/lib/admin-backfill-runner.ts:664`. The sidecar mirrors that derivative-only branch at `apps/web/scripts/backfill-color-pipeline.ts:440` through `apps/web/scripts/backfill-color-pipeline.ts:443` and `apps/web/scripts/backfill-color-pipeline.ts:484` through `apps/web/scripts/backfill-color-pipeline.ts:492`.
- Delete-mid-reencode cleanup remains covered: in-app cleanup probes zero-row updates before unlinking at `apps/web/src/lib/admin-backfill-runner.ts:468` through `apps/web/src/lib/admin-backfill-runner.ts:484`; sidecar flush confirms update results and cleans deleted-row variants at `apps/web/scripts/backfill-color-pipeline.ts:495` through `apps/web/scripts/backfill-color-pipeline.ts:519`. The source-contract test pins the sidecar calls at `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts:198` through `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts:230`.
- Image/color delivery honesty still matches the product premise: wide-gamut encoding decisions happen before Sharp fan-out at `apps/web/src/lib/process-image.ts:1074` through `apps/web/src/lib/process-image.ts:1096`; oversized wide-gamut sources keep ICC on the downscaled intermediate at `apps/web/src/lib/process-image.ts:1117` through `apps/web/src/lib/process-image.ts:1135`; all formats use settled parallel generation plus rollback on failure at `apps/web/src/lib/process-image.ts:1433` through `apps/web/src/lib/process-image.ts:1475`.
- Public/admin privacy boundaries remain guarded: `publicSelectFields` omits location, original filenames, HDR/internal color audit fields, processing error fields, and pipeline version at `apps/web/src/lib/data.ts:375` through `apps/web/src/lib/data.ts:404`; the canonical sensitive-key type guard is at `apps/web/src/lib/data.ts:459` through `apps/web/src/lib/data.ts:476`; the symmetric privacy fixture is at `apps/web/src/__tests__/privacy-fields.test.ts:86` through `apps/web/src/__tests__/privacy-fields.test.ts:93`.

## Deferred Not Re-Raised

- `C80-06`: site-config runtime/build-time contract remains deferred. The current delta did not make an operator-contract decision, so the exit criterion in `.context/plans/cycle-84-2026-07-01-deferred.md:12` is not met.
- `C77-ARCH-01`: restore maintenance foreground admin mutation barrier remains deferred. The current restore locks/quiesce work are intact, but no shared foreground mutation barrier for every table writer is present, so `.context/plans/cycle-84-2026-07-01-deferred.md:13` remains the governing exit criterion rather than a new finding.
- `C76-04`, `C76-05`, `C75-08`, and historical performance, semantic-search, settings re-encode, shared-view, browser-matrix, and broad e2e items remain carry-forward deferred per `.context/plans/cycle-84-2026-07-01-deferred.md:14` through `.context/plans/cycle-84-2026-07-01-deferred.md:17`.

## Validation

- Read-only commands run: `git status --short --branch`, `git rev-parse HEAD`, `git rev-parse origin/master`, `git show -s HEAD`, `git diff --name-only HEAD~1..HEAD`, and targeted `nl`/`rg` inspections of the cited docs/source/tests.
- Not run: lint, typecheck, build, full tests, e2e, or deploy. This was a read-only architecture/release-ledger review lane; Cycle 84's commit trailer records local gates but no e2e or deploy.
