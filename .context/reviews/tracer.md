# Tracer Review - Cycle 20

Review lane: `tracer`
Scope: current `HEAD` (`24c82c71`)
Mode: review-only. Implementation files were not modified. No commit or push was performed.

## Inventory

I read the workspace instructions (`AGENTS.md`) and the detailed project contract (`CLAUDE.md`) before tracing. I then inventoried the repo with `rg`/targeted source reads and followed data/control handoffs across upload admission, queueing, processing, delete cleanup, admin backfill, settings locks, auth/rate-limit, analytics, semantic/similar search, deploy/runtime, public serving/cache, and UI async state.

Primary files and regions inspected:

- Upload/queue/settings: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/app/actions/settings.ts`.
- Backfill/runtime/deploy: `apps/web/src/app/actions/admin-backfill.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/instrumentation.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/scripts/entrypoint.sh`.
- Auth/rate-limit: `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/proxy.ts`.
- Analytics/public data: `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/analytics.ts`, `apps/web/src/lib/analytics-data.ts`, `apps/web/src/lib/view-retention.ts`, public `p`, `s`, `g`, and topic route pages, `apps/web/src/lib/data.ts`.
- Search/UI: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/components/search.tsx`, `apps/web/src/components/similar-photos.tsx`, `apps/web/src/components/load-more.tsx`.
- Serving/cache/config/tests: `apps/web/src/lib/serve-upload.ts`, upload file route handlers, `apps/web/public/sw.template.js`, `apps/web/next.config.ts`, and relevant tests including semantic route, public actions, shared route rate-limit, source-contract, restore/upload lock, privacy, and retention tests.

No test suite was run; this was a static causal trace. Evidence below is from exact source regions.

## Findings

### TRC-C20-01 - Shared semantic limiter comments still contradict the charged route policy

Severity: Low
Confidence: High
Status: Confirmed documentation/contract drift

Files/regions:

- `apps/web/src/app/api/search/semantic/route.ts:12-17` states the route policy: after DB-backed semantic-mode lookup, disabled mode and invalid query lengths stay charged.
- `apps/web/src/app/api/search/semantic/route.ts:173-184` pre-increments before the config lookup.
- `apps/web/src/app/api/search/semantic/route.ts:196-200` returns disabled/not-configured after the charge.
- `apps/web/src/app/api/search/semantic/route.ts:240-244` returns short/long query validation errors after the charge and without rollback.
- `apps/web/src/__tests__/semantic-search-route.test.ts:232-248` asserts short/long queries pre-increment once and do not rollback.
- `apps/web/src/__tests__/semantic-search-route.test.ts:250-268` asserts disabled mode pre-increments once and does not rollback.
- `apps/web/src/lib/rate-limit.ts:24-34` says semantic text search refunds "pre-work short-query rejections".
- `apps/web/src/lib/rate-limit.ts:374-377` says rollback applies before the guarded resource is consumed and gives "disabled mode" as an example.

Causal chain: the semantic route and tests encode a no-refund policy once the semantic route admits DB-backed mode/body work. The shared limiter comments encode an older refund policy. A future maintainer following the library-level guidance could move checks or add rollbacks that make disabled-mode/config/body probes cheaper than the current route intends.

Competing hypotheses: there is no current runtime limiter bypass because route code and tests are aligned. The issue is contract drift in a shared security helper, not a live exploit.

Concrete failure scenario: a cleanup aligns route code with `rate-limit.ts`, refunds short semantic queries, or treats disabled mode as pre-work. A client can then repeatedly trigger config reads/body parsing/validation with lower effective limiter cost.

Suggested fix: update `apps/web/src/lib/rate-limit.ts` comments to match the current route/test policy, or intentionally change the product policy and update route/tests together. Add a source-contract assertion for the comment-sensitive rollback posture if this policy should remain locked.

### TRC-C20-02 - Similar-photo requests do not observe aborts during the bounded embedding scan

Severity: Low-Medium
Confidence: Medium-High
Status: Likely performance/resource issue

Files/regions:

- `apps/web/src/app/api/search/semantic/route.ts:250-257`, `apps/web/src/app/api/search/semantic/route.ts:267-269`, and `apps/web/src/app/api/search/semantic/route.ts:314-316` check `request.signal` before expensive semantic phases.
- `apps/web/src/app/api/search/similar/[id]/route.ts:60-238` never reads `request.signal`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:140-175` scans up to `SEMANTIC_SCAN_LIMIT`, decodes every production embedding, scores, filters, and sorts.
- `apps/web/src/lib/clip-embeddings.ts:36-44` allows `SEMANTIC_SCAN_LIMIT` to be tuned up to 25,000.
- `apps/web/src/components/similar-photos.tsx:69-90` starts the fetch on first disclosure expand without an `AbortController` or mounted/request guard.

Causal chain: semantic text search now has abort-aware boundaries around production embedding, DB scan, CPU scoring, and enrichment. The sibling similar-photo route uses the same bounded vector-scan budget but does not check whether the browser request is already gone. MySQL work is not trivially cancellable through this route shape, but the handler can still avoid admitted CPU scoring/enrichment and avoid charging already-aborted requests before the limiter.

Competing hypotheses: same-origin gating, per-IP semantic rate limits, production-only mode, and the scan cap bound the blast radius. The route also does not enter the CLIP encoder queue, so this is lower severity than an encoder-queue leak.

Concrete failure scenario: a visitor expands similar photos on one image and quickly navigates away or through multiple photos. The client-side fetch continues unless the browser tears it down, and the server route proceeds through target lookup, scan, decode/score/sort, and enrichment even if the request has been aborted.

Suggested fix: mirror the semantic route's small abort helper in the similar route. Check before charging, before target lookup, before/after the scan, before CPU scoring, and before enrichment. Add a route test that an already-aborted similar request returns 499 before `preIncrementSemanticAttempt()`. Consider adding an `AbortController` plus mounted/request guard in `SimilarPhotos`.

### TRC-C20-03 - Single-photo share pages bypass current analytics event recording

Severity: Low-Medium
Confidence: Medium
Status: Likely analytics correctness gap; product intent should confirm

Files/regions:

- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:154-156` records canonical photo views with `recordPhotoView(image.id)`.
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:127-132` records initial shared-group views with `recordSharedGroupView(group.id, key)`.
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:80-137` validates, rate-limits, loads `getImageByShareKeyCached(key)`, and renders `PhotoViewer`, but never calls `recordPhotoView` or a shared-photo equivalent.
- `apps/web/src/lib/data.ts:1177-1185` documents `getImageByShareKey` as the unauthenticated `/s/[key]` data path and keeps it read-only.
- `apps/web/src/app/actions/public.ts:371-395` provides a fire-and-forget, rate-limited, processed-image guarded `recordPhotoView` path.
- `apps/web/src/lib/analytics-data.ts:28-54` derives top-photo analytics only from `image_views`.
- `apps/web/src/lib/analytics-data.ts:148-154` explicitly documents the shared-group undercount caveat, but there is no equivalent documented exclusion for single-photo share links.
- `.context/plans/done/16-code-quality-r5.md:83-98` previously identified missing shared-photo view tracking as intended work in the older counter model.

Causal chain: direct public photo pages insert `image_views`; shared group pages insert `shared_group_views`; single shared-photo pages only perform share-key lookup throttling and render the viewer. Admin top-photo/referrer/country analytics read from `image_views`, so traffic arriving through `/s/[key]` is invisible to those photo analytics unless the same visitor also opens the canonical `/p/[id]` page.

Competing hypotheses: the product may intentionally count only canonical public photo views and shared album opens, treating single share links as private delivery traffic. However, current docs/tests do not state that exclusion, and prior plan history treated missing shared-photo tracking as a gap.

Concrete failure scenario: a photographer sends a single-photo share link to a client. The client views it repeatedly through `/s/<key>`. The share lookup is rate-limited and the image renders, but admin "top photos", country, and referrer analytics do not reflect those views.

Suggested fix: decide whether `/s/[key]` should count as a photo view. If yes, import and call `recordPhotoView(image.id)` after `image` is resolved in the page body, preserving the existing metadata no-lookup/no-double-rate-limit contract. If the exclusion is intentional, document it beside the shared-group analytics caveat and add a source-contract test so future reviewers do not re-open it.

## Confirmed Negative Traces

- Upload admission paths maintain the intended browser/LR parity: origin/admin or scoped-token gate, maintenance gate, upload tracker claim, contract lock, disk precheck, metadata validation, GPS/HDR handling, restore recheck, DB insert, full queue snapshot, and lock/tracker settlement.
- Queue/delete tracing did not show a promoted data-loss race: per-image advisory locks fence processing, jobs conditionally update pending rows, deleted-mid-processing variants are cleaned, and queue state is released in `finally`.
- Settings mutations correctly gate upload-processing contract changes on active claims plus advisory locks, and keep immutable `image_sizes`/GPS-strip changes blocked once existing images make those settings unsafe to alter.
- Admin backfill is fenced by restore maintenance checks, a process status guard, a DB advisory lock, per-image processing claims, and pool-budget clamping. Status remains process-local by documented single-instance design.
- Auth/session tracing did not show a same-origin or limiter bypass: admin cookie paths require trusted same-origin, token paths use scoped PAT context and auth limiter, login/password flows have DB-backed limiter persistence, and sessions use signed opaque tokens.
- Public serving still validates upload roots/extensions, rejects symlinks and path escapes via `realpath` containment, emits cache/ETag headers keyed by settings hash, and tears streams down on abort.
- Service worker caching excludes admin-rendered HTML and revocable share pages; public upload derivatives use stale-while-revalidate without caching originals.
- Search UI has robust abort/request-id guards for text semantic search and load-more state. The promoted UI gap is limited to the similar-photo disclosure fetch.
- Deploy/runtime config still matches the documented single web-instance/single-writer topology, with Docker prune-after-up preserving bind-mounted data and no `volume prune -a`.

## Missed-Issue Sweep

Final sweep rechecked the main competing hypotheses: upload/restore writer races, delete-mid-processing orphan variants, mutable settings during in-flight uploads, unmetered public mutating routes, auth/session origin bypasses, backup traversal, upload serving traversal/cache leaks, semantic limiter drift, CLIP queue aborts, analytics undercount paths, service-worker cache leakage, deployment prune safety, and UI stale-response races. No high or critical finding was promoted.

Finding count: 1 confirmed issue, 2 likely issues, 0 high/critical findings.
