# Verifier Review - Cycle 19/100

Date: 2026-06-30 KST
HEAD reviewed: `26f1a66d` (`fix(review): close cycle 18 findings`)
Scope: evidence-based correctness review of the cycle-18 closure as the baseline for cycle 19. Checked repo policy claims in `AGENTS.md` / `CLAUDE.md`, current plans/reviews, implementation, tests, and route/tooling interactions. No source files were modified.

## Inventory

Read first:

- `AGENTS.md` instructions provided in-session.
- `CLAUDE.md`.
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`.

Repo state and cycle surface:

- `git status --short --branch`: clean `master...origin/master`.
- `git log --oneline --max-count=40`: current HEAD is the cycle-18 closure commit.
- `git show --stat --name-status HEAD`: inventoried all changed files in `26f1a66d`.
- `.context/reviews/_aggregate.md`, `plan/plan-374-cycle18-fixes.md`, `plan/plan-375-cycle18-deferred.md`, `.context/plans/README.md`.

Implementation/test files examined with line numbers:

- Semantic/similar search and rate limiting: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/clip-model.ts`.
- Public route scanner: `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`.
- Restore/backup/serving: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/__tests__/db-restore.test.ts`, `apps/web/src/__tests__/resolved-stream-source.test.ts`.
- Bulk edit/upload/admin UI: `apps/web/src/app/actions/images.ts`, `apps/web/src/__tests__/bulk-update-images.test.ts`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`.
- CLIP and route tests: `apps/web/src/__tests__/clip-model-contract.test.ts`, `apps/web/src/__tests__/semantic-search-route.test.ts`, `apps/web/src/__tests__/similar-route.test.ts`.

Validation evidence:

- `npm test --workspace=apps/web -- --run src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts src/__tests__/clip-model-contract.test.ts src/__tests__/db-restore.test.ts src/__tests__/resolved-stream-source.test.ts src/__tests__/bulk-update-images.test.ts`: passed, 7 files / 115 tests.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; semantic POST reported as using a rate-limit helper, GET routes reported non-mutating.

Full lint/typecheck/build/all-tests were not rerun for this verifier-only report. The review below does not claim those gates are green at cycle-19 HEAD.

## Findings

### V19-01 - CLIP inference queue is bounded but still abort-insensitive

Severity: Medium
Confidence: High

Files and regions:

- `apps/web/src/lib/clip-model.ts:53-71`
- `apps/web/src/lib/clip-model.ts:94-127`
- `apps/web/src/lib/clip-model.ts:194-202`
- `apps/web/src/app/api/search/semantic/route.ts:246-264`
- `apps/web/src/__tests__/clip-model-contract.test.ts:32-39`
- `apps/web/src/__tests__/semantic-search-route.test.ts:264-279`

Issue:

Cycle 18 correctly added `CLIP_INFERENCE_MAX_PENDING`, `CLIP_INFERENCE_QUEUE_TIMEOUT_MS`, and full/timeout errors, so the queue is no longer unbounded. But the original finding included abort-insensitive pending callers, and that part remains open. `waitForInferenceSlot()` accepts no `AbortSignal` and stores waiters until timeout or slot release. `embedTextReal(query)` accepts only the query string, and the semantic route calls `await embedTextReal(query)` after a one-time pre-call abort check. If the request aborts while waiting or while the model call is pending, the waiter is not removed by abort and may still run ONNX inference; the route only notices the abort afterward, before the embedding scan.

Failure scenario:

Production semantic search runs with `CLIP_INFERENCE_CONCURRENCY=1`. A client sends many production-mode searches and disconnects after each request enters `embedTextReal()`. Up to `CLIP_INFERENCE_MAX_PENDING` waiters remain until timeout, and if the active inference drains before the timeout, disconnected requests still run the text encoder. The bound prevents unbounded memory growth, but it does not fully close the prior "disconnected request waiters eventually consume ONNX CPU" scenario.

Fix:

Thread `request.signal` into `embedTextReal(query, { signal })` / `withInferenceSlot(..., signal)`. Remove a queued waiter immediately on abort, reject with an abort-specific error, and re-check the signal after acquiring a slot but before calling the model. Add a behavior or source-contract test showing an in-queue waiter is removed/rejected on abort, not just on timeout.

### V19-02 - Semantic rate-limit documentation contradicts code and tests

Severity: Medium
Confidence: High

Files and regions:

- `apps/web/src/app/api/search/semantic/route.ts:12-16`
- `apps/web/src/app/api/search/semantic/route.ts:172-183`
- `apps/web/src/app/api/search/semantic/route.ts:237-244`
- `apps/web/src/lib/rate-limit.ts:24-34`
- `apps/web/src/__tests__/semantic-search-route.test.ts:230-262`

Issue:

The semantic route header still says disabled mode returns before rate-limit charging. The implementation now deliberately charges before `getGalleryConfig()` so disabled mode is charged, and the disabled-mode test asserts `preIncrementSemanticAttempt` was called with no rollback. The central `rate-limit.ts` convention header also says semantic text search refunds "pre-work short-query rejections", but the route imports only `preIncrementSemanticAttempt`, not `rollbackSemanticAttempt`, and short/long query validation returns 400 after the retained charge. The short/long query tests assert only status/body, so this specific budget behavior is not locked by tests.

Failure scenario:

A future change follows the route header and moves disabled-mode lookup before charging, reintroducing the cycle-18 DB-config-read pressure. Or a future maintainer follows the central header and adds rollbacks for short-query validation while the current route policy is "post-read malformed/invalid bodies stay charged." Either direction makes rate-limit behavior depend on stale prose instead of the implemented security posture.

Fix:

Choose and document one policy. If current behavior is intended, update the route header and `rate-limit.ts` Pattern 2b to say disabled/stub config checks and post-read query-length validation remain charged. Add assertions for short and long query cases: `preIncrementSemanticAttempt` called once and `rollbackSemanticAttempt` not called. If refunds are intended instead, wire the rollback explicitly and update the disabled-mode test.

### V19-03 - Cycle 18 plan status is stale after all scheduled items were checked off

Severity: Low
Confidence: High

Files and regions:

- `plan/plan-374-cycle18-fixes.md:1-8`
- `plan/plan-374-cycle18-fixes.md:12-59`
- `.context/plans/README.md:3-6`
- `git show --name-status HEAD`

Issue:

`plan/plan-374-cycle18-fixes.md` says `Status: TODO`, but every scheduled finding in that same file is marked `[x] Implemented`. `.context/plans/README.md` still lists the Cycle 18 implementation plan under Active Plans as TODO. The current HEAD commit is `fix(review): close cycle 18 findings`, and it added/modified the exact files named by the plan, so the plan index no longer matches the repo's own completion evidence.

Failure scenario:

Cycle 19+ planning treats Cycle 18 implementation as still active, reopens already-implemented work, or misses the true residual items in `plan/plan-375-cycle18-deferred.md` because the completed implementation plan is mixed with active work.

Fix:

Change `plan/plan-374-cycle18-fixes.md` to DONE, move or list it under completed plans in `.context/plans/README.md`, and leave `plan/plan-375-cycle18-deferred.md` active/deferred.

## Verified Closures

These cycle-18 scheduled fixes matched code and tests in the files inspected:

- Public route scanner fixed-point mutator detection exists in `apps/web/scripts/check-public-route-rate-limit.ts:269-297`, and the two-hop negative fixture exists at `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:383-401`.
- Semantic and similar routes now charge before DB-backed config lookup: semantic at `apps/web/src/app/api/search/semantic/route.ts:172-195`, similar at `apps/web/src/app/api/search/similar/[id]/route.ts:84-112`.
- Bulk tag mutations bump freshness even when scalar updates are also present: `apps/web/src/app/actions/images.ts:1152-1155`, locked by `apps/web/src/__tests__/bulk-update-images.test.ts:572-598`.
- Backup creation serializes on `LOCK_DB_RESTORE` and validates dump header before returning a filename: `apps/web/src/app/[locale]/admin/db-actions.ts:157-170`, `apps/web/src/app/[locale]/admin/db-actions.ts:233-260`, with source contracts in `apps/web/src/__tests__/db-restore.test.ts:52-77`.
- Resolved-path streaming comments were weakened to "not descriptor-backed" in both upload serving and backup download: `apps/web/src/lib/serve-upload.ts:263-268`, `apps/web/src/app/api/admin/db/download/route.ts:72-76`, locked by `apps/web/src/__tests__/resolved-stream-source.test.ts:8-21`.
- Token one-time secret flow now requires acknowledgement before normal dialog dismissal and guards duplicate creates: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:46-73`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:187-235`.
- Category empty state and delete pending states exist in `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:231-240`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:281-307`, and `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:388-412`.

## Final Missed-Issue Sweep

Final sweeps covered:

- All files changed by `26f1a66d` plus their tests and relevant docs.
- Current implementation vs cycle-18 aggregate claims and plan statuses.
- Stale semantic-rate-limit comments across route-local and central policy docs.
- CLIP queue bounds, timeout behavior, and abort-signal propagation.
- Backup/restore lock, temp-file cleanup ownership, and realpath streaming claims.
- Public route scanner import-origin checks, star re-export fail-closed behavior, and transitive mutator fixtures.

No critical or high-severity correctness issues were found. The remaining confirmed risk is concentrated in one incomplete abort/cancellation behavior, one security-policy documentation drift, and one plan-status provenance drift.
