# Run-10 Cycle 35 Code Reviewer Report

Date: 2026-07-08 KST
Review HEAD: `7993fa467f8a71814f878aa59bcd80174daab1ed`
Role: cycle-35 code-reviewer subagent
Scope: whole-repository code-quality, logic, SOLID/maintainability, cross-file contract, state consistency, error-handling, and correctness review. Product code was not edited.

## Inventory / Scope Reviewed

Required authority and context read first: `AGENTS.md`, `CLAUDE.md`, and the code-review skill instructions. I also read the current rolling `.context/reviews/code-reviewer.md`, the latest aggregate review `.context/reviews/run10-cycle34/_aggregate.md`, rolling `.context/reviews/_aggregate.md`, and `.context/plans/run10-cycle34/deferred.md` so prior findings were not re-filed as new.

Review-relevant inventory built before retaining claims:

- 725 tracked implementation, operations, schema, config, test, and docs-contract files in the active review set: `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, app config files, nginx/Docker/deploy config, root scripts, and live planning/review context.
- 627 TypeScript/TSX/JS implementation and test files under `apps/web/src`.
- 29 app scripts and 34 migration/meta files under `apps/web/scripts` and `apps/web/drizzle`.
- High-risk paths examined in detail: admin API auth wrappers, mutating server-action guards, public route rate limits, upload/LR upload flows, restore-maintenance and admin mutation barriers, background queue/backfill runners, sidecar color backfill, pending cleanup queues, advisory locks, DB pool budgeting, public data privacy projections, search/timeline/map query paths, migrations, deployment/proxy config, and current source-contract tests.

Intentionally not treated as source: `node_modules`, `.next`/build output, runtime uploads/backups/test-results, `.claude/worktrees`, and historical `.context` artifacts except where they document current invariants or known deferred findings. No relevant tracked implementation/config path in the active inventory was intentionally skipped.

## Fresh Findings

No new confirmed or likely code-quality/correctness findings were retained in this cycle.

Evidence supporting that conclusion:

- The latest Cycle 34 scheduled fixes were rechecked in source:
  - LR/PAT upload now holds the admin mutation barrier before parsing/saving/inserting (`apps/web/src/app/api/admin/lr/upload/route.ts:95-105`).
  - In-app admin backfill now exposes a shutdown drain and is included in graceful shutdown (`apps/web/src/lib/admin-backfill-runner.ts:877-884`, `apps/web/src/instrumentation.ts:54-63`).
  - Browser upload topic verification now returns a structured error after settling the quota claim (`apps/web/src/app/actions/images.ts:265-275`).
  - E2E seed cleanup now allowlists expected seed filenames before unlinking DB-sourced paths (`apps/web/scripts/seed-e2e.ts:191-204`).
  - Sidecar color backfill now claims the per-image processing lock around reprocess/persistence (`apps/web/scripts/backfill-color-pipeline.ts:319-347`, `apps/web/scripts/backfill-color-pipeline.ts:560-603`).
- The previously scheduled December archive bug is fixed and behavior-tested (`apps/web/src/lib/data-timeline.ts:93-103`, `apps/web/src/__tests__/data-timeline-behavior.test.ts:59-90`).
- Custom architecture gates, lint, typecheck, production audit, focused regressions, and the full Vitest suite passed; command evidence is listed below.

## Known / Deferred Items Not Re-filed

These are real or plausible issues already documented in the current deferred register, so they are not fresh Cycle 35 findings.

### C34-07: Fragmented background DB connection budgets

Severity: Medium
Confidence: High
Classification: Confirmed architectural/resource risk, deferred
Regions: `apps/web/src/db/index.ts:31-42`, `apps/web/src/lib/image-queue.ts:121-153`, `apps/web/src/lib/admin-backfill-runner.ts:106-143`

Failure scenario: upload image processing and admin color backfill can overlap, each reserving live DB headroom independently. On the default 10-connection pool, combined background work can leave less live-request headroom than either formula claims.

Suggested fix: introduce a shared background DB resource budget/semaphore across image queue, admin backfill, sidecars, and maintenance, or make heavy backfills explicitly quiesce competing background processors.

### C34-09 / C34-10 / C34-11 / C34-12 / C34-13 / C34-14 / C34-15

Severity: Mixed High/Medium
Confidence: Mostly High
Classification: Deferred design, performance, UX, test-infra, product-distribution, and manual-validation risks
Regions: documented in `.context/plans/run10-cycle34/deferred.md`

These remain open by explicit deferral: semantic embedding ownership, large Server Action body admission after framework parsing, scan-heavy public query paths, test strategy gaps, UX field/responsive issues, checked-in deployment-specific site config, and live proxy/CLIP/ops validation. I did not re-file them as code-review findings because the current plan already preserves severity, citations, scenarios, and exit criteria.

## Final Sweep

Commonly missed issue classes checked:

- Guard coverage: admin API `withAdminAuth`, server-action same-origin/mutation barriers, and public-route rate-limit posture all passed their custom scanners.
- Privacy/data projection: reviewed `data.ts`/`data-timeline.ts`, semantic/similar search output shaping, and privacy guard tests through the full suite; no new public PII leak path was confirmed.
- Restore/queue races: rechecked LR upload, browser upload, admin backfill shutdown, sidecar per-image lock, image queue retry/claim paths, and pending cleanup behavior around current HEAD changes.
- Filesystem boundaries: rechecked upload original path handling, sidecar/e2e cleanup allowlists, derivative cleanup, and serve-upload containment patterns.
- Schema/migration contracts: migration journal and reconcile behavior remain covered by tests in the full suite; no new migration/journal drift was found.

Skipped validation: `npm run build --workspace=apps/web` and Playwright e2e were not run. Build was avoided because this is a read-only review and the `prebuild` hook can rewrite generated tracked assets (`public/sw.js`, icons). E2E was not necessary for any retained source-level finding.

## Verification

Commands run:

- `npm run lint:api-auth --workspace=apps/web` — passed.
- `npm run lint:action-origin --workspace=apps/web` — passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` — passed.
- `npm run lint --workspace=apps/web` — passed.
- `npm run typecheck --workspace=apps/web` — passed.
- Focused regression run for latest upload/backfill changes — 7 files / 101 tests passed.
- `npm test --workspace=apps/web` — 361 files passed, 2 skipped; 3394 tests passed, 4 skipped.
- `npm run audit:prod` — 0 production vulnerabilities.
- `npm run check:proxy-topology -- --help` — confirmed the helper is read-only and that effective client-IP bucket validation remains a live/operator check, not source-proven.

## Conclusion

No fresh Cycle 35 code-review defects were found beyond the already-documented deferred risks. The current HEAD passes the reviewed local gates, and the Cycle 34 correctness fixes I spot-checked are present with regression coverage.
