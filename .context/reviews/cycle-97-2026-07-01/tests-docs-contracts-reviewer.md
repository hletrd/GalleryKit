# Cycle 97 Tests / Docs / Contracts Review

Scope: deployed `master` at `061c1c81af234469641f75a53e5bbc61fa63114a`.

## Findings

### C97-01 - Cycle 96 terminal ledger still says commit/push/deploy/smoke are pending

- Severity/confidence: Medium / High.
- Evidence: `.context/plans/cycle-96-2026-07-01-plan.md:41`-`46` recorded all implementation gates but still ended with `Pending: signed commit, pull/rebase, push, deploy, and smoke checks`; `.context/plans/README.md:5`-`8` still listed Cycle 96 as active/current. The cycle-97 invocation states the current deployed `master` is `061c1c81af234469641f75a53e5bbc61fa63114a`.
- Failure scenario: later agents treat Cycle 96 as unfinished or deploy-unknown, duplicate release-ledger work, or misread the deployed baseline for this no-staging repo.
- Suggested fix: update Cycle 96 terminal evidence and the plan/review indexes while recording Cycle 97 as the current aggregate.

### C97-02 - Upload accept regression test hardcodes only a few extensions

- Severity/confidence: Medium / High.
- Evidence: `apps/web/src/lib/process-image.ts:399` defines `ALLOWED_EXTENSIONS`; `apps/web/src/components/upload-dropzone.tsx:201` has a separate dropzone accept list; `apps/web/src/__tests__/client-source-contracts.test.ts:101` and `:218` checked fixed literals rather than backend/dropzone set equality.
- Failure scenario: a future backend-supported extension is added without updating the browser picker; tests still pass unless the fixture is manually expanded.
- Suggested fix: parse both source arrays in the test and assert exact set equality.

## Residual Risks

No other confirmed tests/docs/source-contract findings in this cycle. Broad historical test gaps remain in the carry-forward deferred register.
