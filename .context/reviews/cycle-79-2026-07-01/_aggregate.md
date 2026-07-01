# Cycle 79/100 Aggregate Review

Start HEAD: `9cc143d06f3b4f9fe1862316c0f449f745926829`.
Review-time branch advanced during fan-out by review-artifact commits through local HEAD `15e7a4ba`.
Date: 2026-07-01.

## Review Lanes

- `code-performance-reviewer.md`: one confirmed scanner coverage finding.
- `test-verifier-reviewer.md`: one confirmed ledger/deploy-evidence finding.
- `security-privacy-reviewer.md`: no confirmed security/privacy finding.
- `architect-debugger-tracer.md`: no confirmed architecture/runtime finding.
- `document-deploy-reviewer.md`: two confirmed documentation/deploy-drift findings.
- `designer-accessibility-reviewer.md`: no confirmed UI/accessibility finding; browser checks were limited by local MySQL refusing `127.0.0.1:3306`.

## Deduplicated Findings

### C79-01 - Public-route expensive-read scanner misses namespace and import-alias expensive work

- Severity: Medium
- Confidence: High
- Sources: `code-performance-reviewer.md`; main-agent manual probe
- Citations: `apps/web/scripts/check-public-route-rate-limit.ts:60`, `apps/web/scripts/check-public-route-rate-limit.ts:78`, `apps/web/scripts/check-public-route-rate-limit.ts:310`, `apps/web/scripts/check-public-route-rate-limit.ts:320`, `apps/web/scripts/check-public-route-rate-limit.ts:629`, `apps/web/scripts/check-public-route-rate-limit.ts:633`, `apps/web/scripts/check-public-route-rate-limit.ts:672`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:421`
- Problem: Cycle 78 made expensive-marker detection AST-aware, but the scanner still misses common expensive import shapes. Property-access marker calls such as `new og.ImageResponse(...)` do not compare the final property name to non-dotted markers, and expensive modules such as `sharp` and `node:fs/promises` are not treated as expensive-read modules when imported under default, named-alias, or namespace bindings.
- Evidence: direct `checkPublicRouteSource()` probes reported both `import imageProcessor from 'sharp'; imageProcessor(...)` and `import * as fs from 'node:fs/promises'; fs.readFile(...)` as `OK: ... no mutating or expensive GET handlers`.
- Failure scenario: a future public OG, filesystem, or image-processing GET/HEAD route imports CPU/IO-heavy work through a namespace or alias, forgets a rate-limit pre-increment, and passes `npm run lint:public-route-rate-limit`, leaving a public availability-sensitive endpoint unmetered.
- Suggested fix: expand expensive-read module detection to cover `sharp`, `fs`, `node:fs`, `fs/promises`, and `node:fs/promises`; extend property-access marker detection to compare final property names; add regression fixtures for namespace `ImageResponse`, aliased `sharp`, namespace `fs.readFile`, and named-aliased filesystem reads.

### C79-02 - Cycle 78 release ledger still reads active and undeployed

- Severity: Medium
- Confidence: High
- Sources: `test-verifier-reviewer.md`, `document-deploy-reviewer.md`
- Citations: `AGENTS.md:17`, `CLAUDE.md:469`, `.context/plans/README.md:5`, `.context/plans/README.md:7`, `.context/plans/cycle-78-2026-07-01-plan.md:48`, `.context/plans/cycle-78-2026-07-01-plan.md:50`, `.context/plans/cycle-78-2026-07-01-plan.md:51`, `.context/reviews/_aggregate.md:3`, `.context/reviews/_aggregate.md:12`
- Problem: Cycle 78 shipped the Docker runtime Sharp fix in commit `9cc143d0`, but the committed Cycle 78 plan still leaves commit/push/deploy unchecked and the plan index still lists Cycle 78 as active.
- Failure scenario: future agents or operators infer Cycle 78 is unfinished, or assume deploy/Docker-build evidence exists without a terminal ledger note.
- Suggested fix: update the Cycle 78 plan/index with terminal commit/push/deploy evidence from the Cycle 79 starting context (`9cc143d0` was the deployed `master` HEAD) and move Cycle 78 into recent/closed state.

### C79-03 - Dockerfile runner-stage prod-deps comment is stale after runtime Sharp externalization fix

- Severity: Low
- Confidence: High
- Source: `document-deploy-reviewer.md`
- Citations: `apps/web/Dockerfile:68`, `apps/web/Dockerfile:69`, `apps/web/Dockerfile:70`, `apps/web/Dockerfile:77`, `apps/web/Dockerfile:80`, `apps/web/Dockerfile:141`, `apps/web/Dockerfile:142`, `apps/web/Dockerfile:143`, `apps/web/next.config.ts:45`, `apps/web/next.config.ts:50`
- Problem: The `prod-deps` stage now intentionally carries runtime externalized native dependencies, especially `sharp`, but the runner-stage comment above the `prod-deps` copy still says production dependencies are only for `migrate.js`.
- Failure scenario: a future Docker cleanup trusts the stale comment and removes or narrows the copied `/app/node_modules` tree as migration-only, breaking runtime uploads, topic covers, CLIP image embedding, or OG generation.
- Suggested fix: rewrite the comment to state that the copied prod-deps tree supports both migration scripts and runtime external packages.

## Deferred Not Re-Raised

- `C77-ARCH-01`: restore maintenance does not globally drain every already-started foreground non-upload admin mutation.
- `C76-04`: bottom-sheet dropdown portal coverage remains source-shaped.
- `C76-05`: `getImageProcessingState` tests would miss processed-predicate drift.
- `C75-08`: bulk-edit validation alert association remains behavior-test deferred.
- Historical performance, semantic-search, settings re-encode, shared-view, and browser-matrix deferred items remain covered by prior deferred artifacts unless their recorded exit criteria are hit.

## Scheduled For Cycle 79

Schedule all three deduplicated findings: `C79-01`, `C79-02`, and `C79-03`.
