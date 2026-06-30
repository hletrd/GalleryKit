# Cycle 43 Performance / Architecture Review

Reviewer lane: perf-reviewer + architect
Date: 2026-07-01
HEAD reviewed: `82a21b82`
Scope: review only. Source code was not edited; this review artifact is the only write from this lane.

## Confirmed Issues

### PA-43-01 - Public action lint trusts limiter calls shadowed by exported action parameters

Severity: Medium
Confidence: High

`apps/web/scripts/check-action-origin.ts:392` defines the trusted public rate-limit helper names, including `isViewRecordRateLimited` and `checkViewRecordRateLimit`. The public-action verifier then calls `publicActionCallsRateLimitBeforeMutation(...)` at `apps/web/scripts/check-action-origin.ts:586`. Its shadow detector only walks the exported function body statements (`apps/web/scripts/check-action-origin.ts:627`) and only inspects parameters on nested function-like nodes when `current !== body` (`apps/web/scripts/check-action-origin.ts:617`). The exported action node itself is not passed into that check: function declarations are evaluated with only `statement.body` at `apps/web/scripts/check-action-origin.ts:1141`, and arrow/function-expression exports are evaluated with only `exportedBody` at `apps/web/scripts/check-action-origin.ts:1161`.

That leaves the action's own parameter list outside the shadow scan. A future public analytics action can therefore define a default parameter named like a trusted limiter helper, call it before a DB write, and pass `lint:action-origin` even though the real limiter in `apps/web/src/app/actions/public.ts:341` / `apps/web/src/app/actions/public.ts:366` is never called.

Concrete failure scenario:

```ts
/** @action-origin-exempt: public analytics endpoint */
export async function recordView(id, isViewRecordRateLimited = () => false) {
  if (isViewRecordRateLimited('ip', Date.now())) return;
  db.insert(imageViews).values({ imageId: id });
}
```

Server-action callers do not need to pass a function for this to fail; omitting the second argument uses the local default no-op. The scanner sees a call named `isViewRecordRateLimited`, treats the public analytics write as gated, and reports `OK (public rate-limited action)`. If copied into a future `recordPhotoView`/`recordTopicView`/`recordSharedGroupView`-style path (`apps/web/src/app/actions/public.ts:417`, `apps/web/src/app/actions/public.ts:445`, `apps/web/src/app/actions/public.ts:477`), a bot can flood `imageViews`, `topicViews`, or `sharedGroupViews` without the intended per-IP budget, increasing DB write load and analytics table growth.

Validation:

- `npm run lint:action-origin --workspace=apps/web` passes on current HEAD, including `OK (public rate-limited action)` for the three live analytics actions.
- Synthetic `checkActionSource` probes for both `export async function` and `export const ... = async (...) =>` shapes with trusted-helper default parameters both returned:

```json
{
  "passed": [
    "OK (public rate-limited action): src/app/actions/public.ts::recordView"
  ],
  "failed": [],
  "skipped": []
}
```

Current-source exposure check:

- `rg "(isViewRecordRateLimited|checkViewRecordRateLimit|preIncrementLoadMoreAttempt|checkLoadMoreRateLimit)\s*=" apps/web/src/app/actions apps/web/scripts apps/web/src/__tests__` found no live exported action using this shadowing shape.

Recommended fix:

Pass the exported function-like node or its parameter list into `publicActionCallsRateLimitBeforeMutation`, and fail closed when any exported action parameter binding collides with `PUBLIC_RATE_LIMIT_HELPER_NAMES`. Add regression tests for:

- `export async function recordView(id, isViewRecordRateLimited = () => false) { ... }`
- `export const recordView = async (id, checkViewRecordRateLimit = async () => ({ status: 'ok' })) => { ... }`

## Likely Issues

None new.

## Risks Requiring Manual Validation

None new.

## Deferred / Historical Items Not Re-Raised

- `PA-42-02`: production CLIP web-process bootstrap/catch-up lacks a semantic backfill advisory lock. Still present in the same risk envelope; no new severity evidence found.
- `TV-40-03`: JavaScript operational scripts need semantic checking.
- `PERF-C39-03`: feed/sitemap updated-time indexes.
- `PERF-C39-04`: backfill pipeline-version indexes.
- `AGG-C38-07`: broad imported-helper side-effect classification.
- `AGG-C38-08`: sidecar keyset pagination.

## Clean / Rechecked Surfaces

- Public listing/search/shared-group data paths in `apps/web/src/lib/data.ts`: listing limits, cursor pagination, public select guards, search result caps, shared-group view buffering, and map marker cap remain bounded or documented.
- Semantic search and similar-photo APIs in `apps/web/src/app/api/search/semantic/route.ts` and `apps/web/src/app/api/search/similar/[id]/route.ts`: same-origin checks, request/body caps, rate-limit admission, model-version filters, scan caps, abort checks, and no-store responses are in place.
- CLIP model queueing in `apps/web/src/lib/clip-model.ts`: inference concurrency, pending queue cap, timeout, abort cleanup, and lazy model loading are bounded.
- Image processing and queues in `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, and related sidecar scripts: reviewed for CPU/memory/concurrency regressions; no new non-deferred issue found.
- DB and operational topology in `apps/web/src/db/index.ts`, `apps/web/src/instrumentation.ts`, and `apps/web/src/lib/queue-shutdown.ts`: bounded pool, queue limit, init timeout cleanup, startup bootstrap, and shutdown drain behavior are consistent with the documented single-instance topology.
- Client responsiveness paths in `apps/web/src/components/search.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/histogram.tsx`, `apps/web/src/components/similar-photos.tsx`, and `apps/web/src/components/map/map-client.tsx`: debounce/abort/stale-response guards, observer cleanup, timer cleanup, sized image fallbacks, and deferred fetch patterns are present.
- Service worker and upload serving in `apps/web/public/sw.template.js` and `apps/web/src/lib/serve-upload.ts`: bounded cache behavior, dynamic-route bypass rules, HEAD checks, and stream cleanup were rechecked with no new finding.

## Validation Evidence

- Required context read: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/prompts/common_review_scope.md`, `.context/reviews/prompts/perf-reviewer.md`, `.context/reviews/prompts/architect.md`, latest `.context/reviews/_aggregate.md`, and cycle-42 plan/deferred artifacts.
- Inventory built with `rg --files`; 264 review-relevant app/lib/component/script files were included in the local review inventory.
- `git status --short` was clean at review start.
- `git rev-parse --short HEAD` returned `82a21b82`.
- `npm run lint:action-origin --workspace=apps/web` passed.
- Targeted `checkActionSource` probes reproduced `PA-43-01`.
- Full quality gates were not run because this was a review-only lane and no implementation files were changed.
