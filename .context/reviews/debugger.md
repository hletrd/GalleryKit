# Cycle 32 Debugger Review

Scope: current HEAD `3d174c96` on `master`. I read `AGENTS.md` and `CLAUDE.md` first. Product code and other review files were not edited.

## Inventory

- Runtime topology and constraints reviewed: single web instance / single writer, process-local queue state, process-local fast-path rate limits, restore-maintenance marker, MySQL advisory locks, and graceful shutdown behavior documented in `CLAUDE.md`.
- High-risk source surfaces inspected: public pagination/search/view actions, semantic and similar-photo routes, OG/feed/metadata routes, admin upload/delete/share/settings actions, Lightroom upload API, image queue/shutdown, background DB writes, smart collection compiler/pagination, DB pool initialization, and restore/maintenance paths.
- Regression history checked: cycle-31 aggregate candidates, current review files, and source-contract tests. Several prior findings are now fixed in source, including CLIP inference slot handoff, search stale-response cancellation, public route rate-limit scanner coverage, and feed freshness fast paths.
- Tests and scanners run for this review:
  - `npm test --workspace=apps/web -- --run src/__tests__/load-more-source-contracts.test.ts src/__tests__/smart-collection-pagination.test.ts src/__tests__/semantic-scan-limit-source.test.ts` -> 3 files / 21 tests passed.
  - `npm run lint:public-route-rate-limit --workspace=apps/web` -> passed for all public API routes.

## Findings

### DBG-C32-01 - MEDIUM - Load-more sentinel can spin indefinitely on transient failures

- Location: `apps/web/src/components/load-more.tsx:41-50`, `apps/web/src/components/load-more.tsx:72-95`, `apps/web/src/components/load-more.tsx:122-132`, `apps/web/src/app/actions/public.ts:24-27`, `apps/web/src/app/actions/public.ts:121-168`, `apps/web/src/app/actions/public.ts:170-234`.
- Severity: Medium.
- Confidence: High.

Root cause: the client keeps `hasMore` true for every transient load-more failure because the server action contract returns `{ hasMore: true }` for `maintenance`, `rateLimited`, and `error` (`public.ts:24-27`, `123`, `148`, `166`, `176`, `205`, `232`). The component copies that value into state on non-ok responses (`load-more.tsx:72`), clears `loadingRef` in `finally` (`load-more.tsx:90-94`), and leaves the same visible sentinel observed (`load-more.tsx:122-132`). If the sentinel remains in view, the observer can immediately call `loadMoreRef.current()` again. The existing source-contract test only requires a maintenance toast cooldown (`apps/web/src/__tests__/load-more-source-contracts.test.ts:7-16`); it does not prevent repeated server-action calls.

Concrete failure scenario:

1. A visitor scrolls to the bottom of a page with more images available, so the sentinel is intersecting.
2. Restore maintenance starts, the IP is over the load-more limit, or the DB path throws.
3. `loadMoreImages` / `loadMoreSmartCollectionImages` returns a transient non-ok result with `hasMore: true`.
4. The component shows a toast, sets `loading` false, keeps the sentinel mounted, and the observer fires again.
5. Under rate limiting, this can create a tight loop of server actions that each perform the pre-increment / DB increment / rollback path before returning limited. Under maintenance, the rate-limit token is not consumed, but the server still receives repeated action calls until the user leaves the viewport.

Expected symptom: repeated load-more requests and rate-limit toasts while a user is parked at the bottom of a gallery during a transient failure. It is hard to reproduce manually unless the sentinel stays visible and the failure state persists.

Fix: introduce a retry gate for non-ok transient responses. The smallest fix is to add a `nextRetryAtRef` / status cooldown that makes `loadMore` return before calling the server while the sentinel is still intersecting; apply it to `rateLimited`, `maintenance`, and `error`, not only toast display. A stronger UX is to disable the observer after a transient failure and require an explicit button retry after the cooldown. Add a component test with a mocked `IntersectionObserver` proving one server-action call per cooldown window while the sentinel remains intersecting.

### DBG-C32-02 - MEDIUM - Semantic and similar search silently miss older relevant photos beyond the newest-first scan window

- Location: `apps/web/src/lib/clip-embeddings.ts:22-44`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`, `CLAUDE.md:117`, `CLAUDE.md:553-557`, `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:42-76`.
- Severity: Medium.
- Confidence: High.

Root cause: both semantic text search and similar-photo search use a bounded brute-force scan ordered by newest embedding update time. The default `SEMANTIC_SCAN_LIMIT` is 2000 (`clip-embeddings.ts:43-44`; `CLAUDE.md:117`), and the routes apply `.orderBy(desc(imageEmbeddings.updatedAt)).limit(SEMANTIC_SCAN_LIMIT)` before scoring (`semantic/route.ts:270-279`, `similar/[id]/route.ts:168-177`). `topK` only ranks the scanned subset (`semantic/route.ts:292-311`, `similar/[id]/route.ts:191-201`). The docs accurately describe this as a newest-first cap for CPU/DB protection (`CLAUDE.md:553-557`), and the source test locks the cap in place (`semantic-scan-limit-source.test.ts:42-76`), but there is no user-visible indication that the search corpus is incomplete once embeddings exceed the scan window.

Concrete failure scenario:

1. Production semantic search is enabled and the gallery has more embedded, processed images than `SEMANTIC_SCAN_LIMIT`.
2. A highly relevant older image has an embedding whose `updatedAt` is outside the newest `SEMANTIC_SCAN_LIMIT` rows.
3. The visitor searches for that image's concept, or opens a similar-photo panel from an image whose best matches are older.
4. The route never reads the older row, so it cannot appear in results regardless of score. Increasing `SEMANTIC_SCAN_LIMIT` only moves the cutoff while increasing public request DB/CPU cost.

Expected symptom: relevance misses that correlate with gallery age and embedding update order, not with visible photo quality. This will pass small test datasets and may only show after enough uploads/backfills accumulate.

Fix: replace the public request-time newest-window scan with a real vector index/search backend, or add a background-maintained approximate nearest-neighbor table/index that can query the full corpus under bounded request cost. Until then, surface an operator warning when `COUNT(image_embeddings)` exceeds `SEMANTIC_SCAN_LIMIT`, and add a behavioral test with a deliberately older high-score row proving the current cutoff or the new full-corpus behavior.

### DBG-C32-03 - LOW - Optional DB health probe is unauthenticated and unthrottled when enabled

- Location: `apps/web/src/app/api/health/route.ts:6-40`, `apps/web/src/__tests__/health-route.test.ts:42-60`, `apps/web/src/__tests__/health-route.test.ts:63-69`.
- Severity: Low.
- Confidence: Medium.

Root cause: `/api/health` is explicitly exempted from public route rate limiting (`health/route.ts:6`). In the default mode it returns liveness only and does no DB work (`health-route.test.ts:63-69`). When `HEALTH_CHECK_DB=true`, every unauthenticated request executes `SELECT 1` and returns generic `ok` / `unavailable` (`health/route.ts:24-40`, `health-route.test.ts:42-60`). That is fine for an internal load-balancer probe, but if the public route is reachable from the internet with the DB probe enabled, bots can turn a cheap GET into sustained database round trips.

Concrete failure scenario:

1. An operator enables `HEALTH_CHECK_DB=true` for readiness semantics.
2. The route remains publicly reachable.
3. A scanner or bot loops on `/api/health`.
4. The app performs one DB query per hit, consuming pool slots and adding noise during an outage precisely when readiness probes are most likely to fail.

Expected symptom: low-grade DB/pool pressure or misleading health-check volume during crawls/outages. It is unlikely to be noticed in unit tests because the test intentionally proves the DB probe behavior.

Fix: keep `HEALTH_CHECK_DB` disabled unless the endpoint is network-restricted, or add a tiny in-process TTL cache/throttle around the DB probe so repeated public hits within one or two seconds reuse the same result. If readiness must be public, add a dedicated rate-limit helper rather than relying on the current exemption.

## Non-Findings / Regressions Checked

- CLIP inference slot handoff from cycle 31 is fixed: `apps/web/src/lib/clip-model.ts:148-155` transfers a slot directly to a waiter and returns without decrementing the active count.
- Search mode stale-response handling from cycle 31 is fixed: `apps/web/src/components/search.tsx:151-158`, `apps/web/src/components/search.tsx:195-206`, and `apps/web/src/components/search.tsx:240-249` abort or discard stale responses by request id.
- Public route rate-limit lint blind spots from cycle 31 are fixed: `apps/web/scripts/check-public-route-rate-limit.ts:348-424` now traverses catch/finally and local helper calls, and the scanner passed in this review.
- Root and topic feed freshness fast paths are present: `apps/web/src/app/feed.xml/route.ts:29-44` and `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:50-72` check cheap freshness before heavier feed composition.
- Smart-collection missing/private quota behavior is intentionally locked, not a bug in current posture: `apps/web/src/__tests__/smart-collection-pagination.test.ts:183-201` asserts those lookups keep the rate-limit claim and do not decrement.

## Final Missed-Bug Sweep

- Upload/delete/retry paths: inspected browser upload, Lightroom upload, queue claim/retry/delete-mid-processing cleanup, failed-image retry, and admin delete cleanup. Existing advisory locks, maintenance re-checks, original cleanup, and queue-state cleanup covered the reviewed races.
- Restore/shutdown paths: inspected durable restore markers, upload-processing contract lock, queue quiesce/resume, background write draining, image queue shutdown, and shared-group view-count flushing. Existing `onIdle()` drains, timer cleanup, and in-flight flush awaiting covered the reviewed hard-stop cases.
- Public read/API paths: inspected semantic, similar, OG, feeds, sitemap, robots, manifest, health, load-more, search, analytics view recording, and rate-limit rollback conventions. Aside from the findings above, the current rollback/no-rollback choices match the documented patterns.
- Smart collections and cursor pagination: inspected parser/compiler and load-more integration. Existing cursor normalization, single lookahead, invalid-cursor handling, and source-contract tests covered the reviewed duplicate/terminal-page failures.
- Remaining risk: this was source-and-test inspection, not live production traffic replay. Browser-level reproduction of DBG-C32-01 and corpus-scale semantic relevance measurement for DBG-C32-02 should be part of the fix work.
