# Cycle 50 Review - Verifier / Test Engineer / Debugger / Tracer

Date: 2026-07-01
HEAD: `3a02f7ee`
Scope: read-only review of tests and latent bug flows; only this artifact was written.

## Inventory

Instructions and carry-forward context reviewed:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`
- `.context/reviews/cycle-46-2026-07-01/_aggregate.md`
- `.context/reviews/cycle-47-2026-07-01/_aggregate.md`
- `.context/reviews/cycle-48-2026-07-01/_aggregate.md`
- `.context/reviews/cycle-49-2026-07-01/_aggregate.md`
- `.context/reviews/cycle-49-2026-07-01/verifier-test-debugger.md`
- `.context/plans/cycle-49-2026-07-01-plan.md`
- `.context/plans/cycle-49-2026-07-01-deferred.md`

Files and patterns inspected:

- Service worker offline/cache flow: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/__tests__/sw-template-contract.test.ts`
- Topic-route locking flow: `apps/web/src/app/actions/topics.ts`, `apps/web/src/__tests__/topics-actions.test.ts`, `apps/web/src/lib/advisory-locks.ts`
- Retry/backfill latent race fixes: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/lib/admin-backfill-runner.ts`
- Regression tests: `failed-image-retry.test.ts`, `cycle-47-source-contracts.test.ts`, `backfill-color-pipeline-deleted-mid-reencode-encode-failure.test.ts`, `admin-backfill-runner-deleted-mid-reencode-encode-failure.test.ts`
- Skip/flaky pattern scan: `describe.skip`, `it.skip`, `test.skip` across `apps/web/src/__tests__` and `apps/web/e2e`

## Validation

- `npm test --workspace=apps/web -- sw-template-contract.test.ts topics-actions.test.ts failed-image-retry.test.ts cycle-47-source-contracts.test.ts backfill-color-pipeline-deleted-mid-reencode-encode-failure.test.ts admin-backfill-runner-deleted-mid-reencode-encode-failure.test.ts` - pass, 6 files / 67 tests.
- `npm run lint:api-auth --workspace=apps/web` - pass, both admin API routes OK.
- `npm run lint:action-origin --workspace=apps/web` - pass, all mutating server actions enforce same-origin provenance.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass, all scanned public routes OK.

Skip inventory found only expected gated suites: CLIP model-weight unit suites and credential/baseURL-gated Playwright admin/origin tests.

## Findings

### C50-VTD-01 - Service-worker photo-page fallback regression test does not exercise behavior or generated-worker parity

- Severity: Medium
- Confidence: High
- File/line: `apps/web/src/__tests__/sw-template-contract.test.ts:82`

Why it matters: Cycle 49 fixed the live service-worker matcher: `/p/<id>` is no longer in `isRevocableShareHtmlRoute` in both the template and generated worker (`apps/web/public/sw.template.js:59`, `apps/web/public/sw.js:59`). That restores the documented offline HTML fallback eligibility for normal photo pages. The regression test added for this bug, however, only slices the template source and checks that the literal string `p\/\d+` is absent (`sw-template-contract.test.ts:82-90`). It does not evaluate concrete route examples, and it does not assert the generated `public/sw.js` classifier carries the same photo-page behavior. Existing generated-worker assertions cover unrelated HEAD/stale-expiry details (`sw-template-contract.test.ts:223`, `sw-template-contract.test.ts:249`), not this classifier.

Failure scenario: a future edit reintroduces a semantically equivalent bypass with a different source shape, for example `pathname.includes('/p/')`, or updates `sw.template.js` but forgets to regenerate `sw.js`. The current test can stay green while `/p/123` and `/ko/p/123` are again bypassed from `networkFirstHtml()`, recreating the Cycle 49 offline photo-page regression in the shipped worker.

Suggested fix: add a behavioral helper in the test that evaluates `isRevocableShareHtmlRoute` from both `sw.template.js` and generated `sw.js` against concrete cases. Assert `/p/123` and `/ko/p/123` are false, while `/s/key`, `/g/key`, `/c/slug`, `/map`, and localized variants remain true. Keep the existing fetch-handler ordering assertion.

## Non-Findings

- `deleteTopic` now runs the delete transaction under `withTopicRouteMutationLock` (`apps/web/src/app/actions/topics.ts:433`), and the regression test asserts GET_LOCK precedes the delete and RELEASE_LOCK follows it (`apps/web/src/__tests__/topics-actions.test.ts:552-571`). I found no new route-segment race in this path.
- The Cycle 49 photo-page SW runtime fix is present in both `sw.template.js` and generated `sw.js`; this review finding is about regression coverage strength, not a live behavior failure.
- The Cycle 47/46 retry and deleted-mid-reencode checks remain wired and the targeted tests pass. I did not re-raise carry-forward deferred items `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, or `AGG-C38-08`; no new evidence changed their severity or made them scheduled now.

## Disposition

New actionable findings: 1
Recommended next action: add the behavioral/generated-worker SW classifier regression test described in `C50-VTD-01`.
