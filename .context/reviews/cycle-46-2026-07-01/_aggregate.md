# Cycle 46 Aggregate Review

Start HEAD: `3aa470dd`.
Date: 2026-07-01.

## Scheduled Findings

### C46-F1 - Backfill encode-failure rollback can resurrect deleted derivatives

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/lib/process-image.ts:1199`, `apps/web/src/lib/process-image.ts:1463`, `apps/web/src/lib/admin-backfill-runner.ts:533`, `apps/web/scripts/backfill-color-pipeline.ts:232`, `apps/web/src/app/actions/images.ts:722`
- Problem: `processImageFormats()` backs up existing derivative files before re-encoding and restores them when an encode or verification step throws. If an admin deletes the image during that backfill window, `deleteImage()` removes the DB row and derivative files, but an encode failure can restore the `.bak` files. The in-app runner and sidecar currently return `encode-failed` / `error` immediately, so they never reach the existing `affectedRows === 0` deleted-mid-reencode cleanup path.
- Failure scenario: a row is deleted mid-backfill while old derivatives are backed up; encode verification fails; rollback restores public derivative files for a deleted DB row.
- Plan: on encode failure, re-check row existence; if missing, run the existing full-variant cleanup helper and classify as `deleted-mid-reencode` instead of encode failure.

### C46-F2 - Service worker image cache serves stale deleted derivatives offline indefinitely

- Severity: Medium
- Confidence: High
- Citations: `apps/web/public/sw.template.js:247`, `apps/web/public/sw.template.js:300`, `apps/web/public/sw.template.js:304`, `apps/web/public/sw.template.js:108`, `apps/web/src/__tests__/sw-template-contract.test.ts:218`
- Problem: the SW image cache records only LRU metadata and returns a cached derivative when the HEAD probe fails. HTML fallback has a 24 h `sw-cached-at` expiry, but image derivatives have no failed-probe/offline freshness cap despite the app serving derivatives with `Cache-Control: public, max-age=3600, must-revalidate`.
- Failure scenario: a visitor caches a derivative, the image/share is deleted or revoked, then a later offline or unreachable-server request can still receive the old derivative until LRU eviction or SW version churn.
- Plan: stamp image cache entries with a cached-at timestamp, enforce a bounded offline/failed-probe max age, evict expired entries, and regenerate `public/sw.js`.

## Non-Findings

- Cycle 45 deploy-documentation ambiguity: one lane noted committed plan text only named deployment of `c7afafa1`, but the Cycle 46 invocation explicitly states current deployed `master` HEAD was `3aa470dd` at start. Treated as non-actionable for this cycle.
- Security/auth/API route review: no new findings; `lint:api-auth`, `lint:action-origin`, and `lint:public-route-rate-limit` passed at current HEAD.
- Migration/deploy/privacy review: no new code findings; historical journal non-monotonicity remains handled by hash postconditions and reconcile mirrors.

## Deferred Findings

No new Cycle 46 findings are deferred. Prior deferred items remain carried forward:

- `PA-42-02` - production CLIP web-process catch-up advisory locking and caps.
- `TV-40-03` - JavaScript operational scripts need semantic checking.
- `PERF-C39-03` - feed and sitemap updated-time indexes.
- `PERF-C39-04` - backfill pipeline-version indexes.
- `AGG-C38-07` - broad imported-helper side-effect classification.
- `AGG-C38-08` - sidecar keyset pagination.
