# Cycle 78/100 Aggregate Review

Start HEAD: `9286bef16f3401fb0d8c17f52de5c96804c04533`.
Date: 2026-07-01.

## Review Lanes

- `code-security.md`: no new confirmed security/correctness findings.
- `performance-concurrency.md`: no new confirmed concurrency/performance findings.
- `verifier-test-engineer.md`: three findings.
- `docs-deploy.md`: one finding.
- `architect-debugger-tracer.md`: no new confirmed architecture findings.
- `ui-accessibility.md`: no new confirmed UI/accessibility findings; browser lane not spawned due active-agent limit.

## Deduplicated Findings

### C78-01 - Cycle 77 verification ledger still reads active and undeployed

- Severity: Medium
- Confidence: High
- Source: `verifier-test-engineer.md`
- Citations: `AGENTS.md:17`, `.context/plans/README.md:5`, `.context/plans/README.md:7`, `.context/plans/cycle-77-2026-07-01-plan.md:49`, `.context/plans/cycle-77-2026-07-01-plan.md:50`, `.context/plans/cycle-77-2026-07-01-plan.md:54`
- Problem: Cycle 77's plan and plan index still describe the cycle as active and leave commit/push/deploy unchecked, even though `9286bef1` is the pushed `origin/master` HEAD.
- Failure scenario: future agents or operators treat Cycle 77 as unfinished or infer deploy state from stale checkboxes instead of explicit evidence.
- Suggested fix: update the Cycle 77 ledger to mark commit/push complete and record that no committed Cycle 77 deploy evidence was present; move Cycle 77 to recent/closed in the plans index.

### C78-02 - Public-route rate-limit scanner false-positives on marker text in strings/comments

- Severity: Low
- Confidence: High
- Source: `verifier-test-engineer.md`
- Citations: `apps/web/scripts/check-public-route-rate-limit.ts:60`, `apps/web/scripts/check-public-route-rate-limit.ts:621`, `apps/web/scripts/check-public-route-rate-limit.ts:623`, `apps/web/scripts/check-public-route-rate-limit.ts:901`
- Problem: `bodyContainsExpensiveGetWork()` checks raw source text for markers such as `ImageResponse`, `getImage`, and `sharp`, so comments and string literals can classify a cheap GET as expensive.
- Failure scenario: a cheap operational route with documentation text mentioning a marker fails CI or gains an unnecessary exemption.
- Suggested fix: make expensive-marker detection AST-aware and add string/comment fixtures.

### C78-03 - Sidecar timestamp regression lock is source-count brittle

- Severity: Low
- Confidence: High
- Source: `verifier-test-engineer.md`
- Citations: `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts:193`, `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts:206`, `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts:207`, `apps/web/scripts/backfill-color-pipeline.ts:467`, `apps/web/scripts/backfill-color-pipeline.ts:485`
- Problem: the sidecar freshness test counts `updated_at = CURRENT_TIMESTAMP` across the entire script instead of anchoring the assertion to both `flushBatch` UPDATE branches.
- Failure scenario: one update branch loses its timestamp assignment while another occurrence or comment preserves the count.
- Suggested fix: assert the full-success and derivative-only `flushBatch` SQL templates independently.

### C78-04 - Runtime Docker dependency stage does not carry the native optional-dependency workaround

- Severity: Medium
- Confidence: Medium
- Source: `docs-deploy.md`
- Citations: `apps/web/Dockerfile:32`, `apps/web/Dockerfile:49`, `apps/web/Dockerfile:63`, `apps/web/Dockerfile:119`, `apps/web/next.config.ts:45`, `apps/web/src/lib/process-image.ts:1`, `apps/web/src/lib/process-topic-image.ts:1`, `apps/web/src/app/api/og/photo/[id]/route.tsx:4`
- Problem: explicit Linux native optional dependency installs are applied to the build dependency stage, but the runtime image copies a separate `prod-deps` install that lacks the same `sharp` native workaround and has no runtime smoke check.
- Failure scenario: production build succeeds, but runtime upload/topic/OG paths fail because `sharp` cannot load native Linux binaries.
- Suggested fix: install the required `@img/sharp-*` native packages in `prod-deps` and smoke `require('sharp')` during image build.

## Deferred Not Re-Raised

- `C77-ARCH-01`: restore maintenance does not globally drain every already-started foreground non-upload admin mutation.
- `C76-04`: bottom-sheet dropdown portal coverage is source-shaped only.
- `C76-05`: `getImageProcessingState` tests would miss processed-predicate drift.
- `C75-08`: bulk-edit validation alert association remains behavior-test deferred.
- Historical performance, semantic-search, settings re-encode, shared-view, and browser-matrix deferred items remain covered by prior deferred artifacts unless their recorded exit criteria are hit.

## Scheduled For Cycle 78

Schedule all four deduplicated findings: `C78-01` through `C78-04`.
