# Cycle 70 Review - Performance and Concurrency

## Files Reviewed

- `apps/web/public/sw.template.js`, `apps/web/public/sw.js`
- `apps/web/src/__tests__/sw-template-contract.test.ts`
- `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/scripts/backfill-color-pipeline.ts`
- Deploy/Docker/nginx and migration helper surfaces.

## Findings

### C70-02 - Same-ETag service-worker branch references `cachedSize` out of scope

- Severity/confidence: Medium / High.
- File/line: `apps/web/public/sw.template.js:315`, `apps/web/public/sw.template.js:334`; generated copy `apps/web/public/sw.js:315`, `apps/web/public/sw.js:334`; test gap `apps/web/src/__tests__/sw-template-contract.test.ts:236`.
- Evidence: Cycle 69 added a same-ETag `HEAD 200` fast path that calls `touchMeta(request.url, cachedSize)`, but `cachedSize` is declared only inside the preceding `head.status === 304` block.
- Failure scenario: a same-ETag `HEAD 200` throws `ReferenceError: cachedSize is not defined`, the broad catch swallows it, and the service worker falls through to stale-serve plus full background body revalidation.
- Suggested fix: hoist `cachedSize` into the shared HEAD-probe scope, regenerate `sw.js`, and pin lexical scope in the service-worker contract test.

## Final Sweep

No new queue/backfill/deploy race was confirmed. Existing advisory-lock, pool-budget, retry, and deploy-prune contracts remain aligned with the docs.
