# Cycle 75 Performance/Deploy Review

Scope: public route revalidation cost, OG rendering, feed/upload cache contracts, deploy docs, Docker/build scripts, service worker drift.

## Findings

### C75-01 - Per-photo OG generation lacks conditional caching

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/app/api/og/photo/[id]/route.tsx:67`, `apps/web/src/app/api/og/photo/[id]/route.tsx:130`, `apps/web/src/app/api/og/photo/[id]/route.tsx:237`, `apps/web/src/app/api/og/route.tsx:126`
- Problem: per-photo OG responses emit `Cache-Control` but no `ETag`, and the route never checks `If-None-Match`. Every revalidation pays DB/config reads, derivative fetch, Satori render, and Sharp JPEG post-processing. The topic OG route already has an ETag/304 branch.
- Failure scenario: social crawlers or preview clients repeatedly revalidate popular photo cards after TTL and burn CPU/internal fetch budget instead of receiving a cheap 304.
- Suggested fix: compute an ETag from photo freshness/render inputs before derivative fetch/render, honor `If-None-Match`, and include `ETag` on 200/304.

### C75-04 - Cycle 74 deployment/status docs are still open

- Severity: Medium
- Confidence: High
- Citations: `.context/plans/README.md:7`, `.context/plans/cycle-74-2026-07-01-plan.md:49`, `.context/reviews/_aggregate.md:3`
- Problem: `master` and `origin/master` are both signed commit `29f4176d`, and Cycle 75 starts from deployed HEAD `29f4176d`, but the Cycle 74 plan still marks commit/push and deploy as incomplete while the index marks Cycle 74 active.
- Failure scenario: operators and later review lanes cannot distinguish a deployed cycle from an active one and can reschedule stale ledger work.
- Suggested fix: close the Cycle 74 ledger with signed commit/push/deploy evidence and advance the current aggregate/index to Cycle 75.

### C75-07 - OG rate-limit rollback comment has stale count

- Severity: Low
- Confidence: High
- Citations: `apps/web/src/lib/rate-limit.ts:45`, `apps/web/src/__tests__/og-photo-fallback.test.ts:56`, `apps/web/src/app/api/og/photo/[id]/route.tsx:61`
- Problem: the rate-limit comment says the per-photo OG source contract expects exactly two pre-DB rollbacks, while the route and test now enforce one syntactic pre-DB rollback.
- Failure scenario: a future maintainer follows the comment and weakens the charged-after-validation contract.
- Suggested fix: update the comment to match the current single rollback invariant.

## Evidence

- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass.
- Service worker template/generated output was inspected for drift and matched.
