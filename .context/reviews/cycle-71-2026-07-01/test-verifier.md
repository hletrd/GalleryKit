# Cycle 71 Test / Verifier Review

Reviewer: default native subagent (`019f1c0b-ca07-79f2-9d2c-b43853269570`)
HEAD: `bf86f7c176ecb1ed542d851bfa0e76e2b9d73cd5`

## Findings

### C71-04 - Semantic embedding snapshot contract is stale and mostly source-string based

- Severity/confidence: Medium / High.
- File/line:
  - `apps/web/src/__tests__/image-queue-embed-wiring.test.ts:23-35`
  - `apps/web/src/__tests__/image-queue-embed-wiring.test.ts:57-61`
  - `apps/web/src/app/actions/images.ts:543-546`
  - Runtime behavior: `apps/web/src/lib/image-queue.ts:738-752`
- Evidence: the queue now resolves current `semanticSearchMode` at embedding-write time, but one upload enqueue comment still says the queue worker reuses the upload-time semantic snapshot to avoid a per-image settings read. The regression lock is mostly a source-string check.
- Failure scenario: a future refactor reintroduces stale snapshot use with a different expression than the current forbidden strings, and the current source test still passes.
- Suggested fix: update stale comments/test names to document `semanticSearchMode` as a legacy/backward-compatible processing snapshot field, and add a behavior check proving a job snapshot of `production` does not call the real encoder when the current runtime gate heals production to disabled.

## Evidence Reported By Reviewer

- `npm run lint --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run typecheck --workspace=apps/web` passed.
- `npm run build --workspace=apps/web` passed.
- `npm test --workspace=apps/web` passed: 2769 passed / 4 skipped.
