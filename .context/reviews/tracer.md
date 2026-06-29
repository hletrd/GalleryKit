# Cycle 17 Tracer Review

Reviewer: tracer
Scope: current HEAD `5e054f80f646cbcd16c7aae5412aa29424e05032`
Write scope: `.context/reviews/tracer.md` only

## Method

Read `AGENTS.md` and `CLAUDE.md` first, then traced current-HEAD causal flows with `rg`, line-anchored source reads, targeted gate scripts, and a final missed-flow sweep.

Repository inventory checked: `747` files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/nginx`, `apps/web/public`, and `apps/web/e2e`.

Flows traced:

- Upload -> quota/transaction -> queue -> processing -> upload serving/cache invalidation.
- Auth/session/token -> proxy fast guard -> `withAdminAuth` -> admin API route.
- Public actions/API -> same-origin/public validation -> rate limit -> DB mutation/rollback.
- Tag/topic/image mutations -> page/feed/sitemap freshness.
- DB restore/migrate -> maintenance flag/locks/queue quiesce -> journal/hash post-condition.
- Service worker caching -> admin/share/image/HTML routing.
- Semantic search -> same-origin/body gates -> mode gate -> rate limit -> embedding scan.
- Sharing -> share key/group creation/revoke -> shared routes -> view analytics.
- Analytics -> page render trigger -> public server action -> DB insert/buffered counters.

Validation evidence:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `apps/web/public/sw.template.js` and generated `sw.js` were compared behaviorally; only the generated version comment differs.

## Findings

### T17-01 Likely: tag rename/delete can change public feed titles without advancing feed/sitemap freshness clocks

Severity: Medium
Confidence: High
Status: Likely

Regions:

- `apps/web/src/app/actions/tags.ts:42-92`
- `apps/web/src/app/actions/tags.ts:99-130`
- `apps/web/src/app/actions/tags.ts:193-200`
- `apps/web/src/app/actions/tags.ts:256-263`
- `apps/web/src/app/feed.xml/route.ts:60-74`
- `apps/web/src/app/feed.xml/route.ts:127-154`
- `apps/web/src/app/sitemap.ts:57-80`
- `apps/web/src/app/sitemap.ts:90-108`

Causal chain:

`updateTag` validates/admin-checks, updates only the `tags` row, logs audit, then revalidates `/admin/tags`, `/admin/dashboard`, and `/` (`tags.ts:42-92`). `deleteTag` deletes `imageTags` and `tags`, then revalidates the same narrow paths (`tags.ts:99-130`). Neither action finds affected images nor bumps `images.updated_at`.

The contrasting image-tag actions do bump the image row freshness clock when the image/tag relationship changes: `addTagToImage` updates `images.updated_at` after an inserted link (`tags.ts:193-196`), and `removeTagFromImage` does the same after a deleted link (`tags.ts:256-259`). That makes the omission in rename/delete causally significant, not just stylistic.

Public feeds derive entry titles from current joined tag names (`getPhotoDisplayTitleFromTagNames`) but derive entry `<updated>` from `img.updated_at` (`feed.xml/route.ts:60-74`). The route also uses that same max entry timestamp for `Last-Modified` and returns `304` when `If-Modified-Since` is not older (`feed.xml/route.ts:127-154`). Sitemap homepage/topic/image/feed `<lastmod>` values likewise flow from image/topic `updated_at` data (`sitemap.ts:57-80`, `sitemap.ts:90-108`).

Concrete failure scenario:

An image has no explicit title, so the feed title falls back to tag names. Admin renames tag `wedding` to `ceremony` or deletes it. A freshly rendered feed body would now show a different title/tag-derived display name, but `images.updated_at`, feed `<updated>`, `Last-Modified`, and sitemap `<lastmod>` remain unchanged. RSS readers polling with `If-Modified-Since` can receive `304` and never fetch the changed title; crawlers also miss the freshness signal for affected photo/topic/feed URLs.

Competing hypotheses considered:

- Public pages are dynamic and re-query tags, so maybe no stale user-visible page. True for regular page rendering, but it does not cover Atom conditional requests or sitemap freshness.
- Feed route cache is short (`max-age=600`, `s-maxage=1800`), so maybe readers eventually refresh. Conditional `304` is driven by `feedUpdated`, not only cache age; a reader can keep getting not-modified after cache expiry when the freshness clock is stale.
- Foreign-key cascade on `imageTags` might be enough on delete. It removes relationships, but it does not update the parent `images.updated_at`.

Suggested fix:

For `updateTag`, within the mutation flow collect affected image IDs from `imageTags` for the tag ID, update the tag, and bump `images.updated_at = CURRENT_TIMESTAMP` for affected IDs only when the tag update actually changes a row. For `deleteTag`, collect affected image IDs before deleting `imageTags`, delete the tag, then bump those image rows when deletion succeeds. Revalidate affected photo/topic/share paths if cheaply available; otherwise use the existing broader app-data revalidation helper for tag rename/delete. Add a focused regression covering feed `Last-Modified`/entry `<updated>` after tag rename/delete.

### T17-02 Risk: restore/upload/queue/view-count coordination is process-local and depends on the documented single-web-instance topology

Severity: High if horizontally scaled; Low under current documented topology
Confidence: High
Status: Risk

Regions:

- `apps/web/src/lib/restore-maintenance.ts:1-56`
- `apps/web/src/lib/upload-tracker-state.ts:7-20`
- `apps/web/src/lib/upload-tracker-state.ts:70-78`
- `apps/web/src/lib/image-queue.ts:275-324`
- `apps/web/src/lib/data.ts:13-63`
- `apps/web/src/lib/data.ts:222-248`
- `apps/web/src/lib/rate-limit.ts:112-121`
- `apps/web/src/lib/rate-limit.ts:436-508`

Causal chain:

Restore maintenance is a `globalThis` boolean in one Node process (`restore-maintenance.ts:1-56`). Upload tracking is a `globalThis` `Map` used to detect active upload claims (`upload-tracker-state.ts:7-20`, `upload-tracker-state.ts:70-78`). The processing queue state is also stored on a process-global symbol and owns in-memory queue/enqueued/retry/side-effect state (`image-queue.ts:275-324`). Shared-group denormalized view counts buffer in process memory and flush later (`data.ts:13-63`, `data.ts:222-248`). Public rate-limit maps are explicitly process-local fast paths, with DB buckets used as the cross-process source for some public/admin attempts (`rate-limit.ts:112-121`, `rate-limit.ts:436-508`).

Under the documented single web instance, this is coherent: one process owns maintenance, upload claims, queue state, and buffered counters. Under two app processes against the same DB/uploads directory, a restore in process A can set maintenance only in A while process B continues accepting uploads or processing queue jobs. Process B also would not see A's active upload claims, and its buffered shared-group view counts would flush independently.

Concrete failure scenario:

An operator scales the web container to two replicas for availability. Admin starts DB restore through replica A. Replica B receives an upload or queued image job during the restore because its `isRestoreMaintenanceActive()` is false and its upload tracker is empty. The restore/import and concurrent upload/processing now race over DB rows and upload files, defeating the intended quiesce window.

Competing hypotheses considered:

- DB-backed rate-limit buckets might make all coordination cross-process. They cover selected rate-limit counters, but not restore maintenance, upload claim state, queue state, or buffered shared-group view-count state.
- File/DB locks might still serialize everything. The traced restore/upload paths do take named locks in some actions, but process B still has independent in-memory maintenance/queue/upload state; lock coverage would have to be audited before any scale-out claim.
- This may be acceptable because `CLAUDE.md` documents a single-web-instance topology. Yes; therefore this is a topology risk, not a current production defect.

Suggested fix:

If scale-out remains out of scope, encode the invariant as an operational guard: document one web replica, fail boot or health-check if a scale-out marker is detected, and keep deploy scripts single-instance. If scale-out is planned, move maintenance state, upload claims, queue claims, and view-count buffering to shared DB/Redis primitives, and add restore-vs-upload integration coverage across two processes.

### T17-03 Risk: analytics counters/events are intentionally best-effort and can undercount during render aborts, process exits, or DB outages

Severity: Low to Medium, depending on analytics accuracy requirements
Confidence: High
Status: Risk

Regions:

- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:163-165`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-165`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:132-137`
- `apps/web/src/app/actions/public.ts:363-395`
- `apps/web/src/app/actions/public.ts:397-426`
- `apps/web/src/app/actions/public.ts:428-461`
- `apps/web/src/lib/data.ts:49-63`
- `apps/web/src/lib/data.ts:75-145`
- `apps/web/src/lib/data.ts:222-248`

Causal chain:

Photo, topic, and shared-group pages call their analytics recorders with `void`, explicitly not awaiting the server action (`p/[id]/page.tsx:163-165`, `[topic]/page.tsx:163-165`, `g/[key]/page.tsx:132-137`). The recorders validate/rate-limit/visibility-check and then fire DB inserts without awaiting them, swallowing insert errors so analytics never blocks rendering (`public.ts:363-395`, `public.ts:397-426`, `public.ts:428-461`). Shared-group denormalized `view_count` increments are buffered in memory and flushed later; failed flushes are retried up to a cap and then dropped (`data.ts:49-63`, `data.ts:75-145`). Shutdown has a flush helper (`data.ts:222-248`), but normal crashes, hard kills, or platform termination before the helper runs can still lose buffered counts.

Concrete failure scenario:

A popular shared group receives traffic while the DB is briefly unavailable. The page renders because analytics is best-effort. Durable `shared_group_views` inserts fail and are swallowed. Buffered denormalized counters retry, but after repeated failures or process termination the increments are dropped. Later admin analytics undercounts the traffic even though users successfully viewed the pages.

Competing hypotheses considered:

- This is probably intentional. Confirmed: comments explicitly say fire-and-forget and analytics should not block rendering.
- Maybe shared-group views are double-counted. Not in the traced path: `getSharedGroup` buffers the denormalized `shared_groups.view_count`, while `recordSharedGroupView` inserts durable analytics rows; they are separate metrics, and `g/[key]` aligns selected-photo handling before recording.
- Maybe shutdown flush makes the buffer durable. It helps graceful shutdown only; it cannot cover hard exits or swallowed insert failures.

Suggested fix:

If current analytics are intended as approximate telemetry, document the approximate SLO in admin analytics/help text and keep this behavior. If exact or billing-grade counts are required, replace fire-and-forget inserts with a durable queue/outbox or awaited write with tight timeout/backpressure, and make shared-group counter updates idempotent from the durable event stream.

## Confirmed Negative Traces

These flows were traced end to end without a new confirmed defect.

### Upload -> process -> serve

Upload actions guard restore maintenance and same-origin/admin, claim quota before awaits, persist originals outside the public root, insert DB rows, enqueue processing, and roll back quota on failure (`apps/web/src/app/actions/images.ts:114-180`, `apps/web/src/app/actions/images.ts:238-293`, `apps/web/src/app/actions/images.ts:349-523`). The queue uses per-image advisory locking and skips work during restore/shutdown, verifies derivative outputs before marking rows processed, and cleans variants if an image disappears mid-processing (`apps/web/src/lib/image-queue.ts:446-473`, `apps/web/src/lib/image-queue.ts:489-675`). Serving is constrained to allowed upload directories with realpath containment and cache validators that include pipeline/settings state (`apps/web/src/lib/serve-upload.ts:127-258`).

### Auth/session/token -> admin route

Login applies same-origin, IP/account preincrement, Argon2 verification, transactional session insert/delete, and secure cookies (`apps/web/src/app/actions/auth.ts:70-258`). Session verification requires a real production `SESSION_SECRET`, validates HMAC/timing, and checks DB session expiry (`apps/web/src/lib/session.ts:16-35`, `apps/web/src/lib/session.ts:94-150`). The proxy is a fast cookie-shape guard for admin pages while API/server actions rely on full wrappers (`apps/web/src/proxy.ts:76-140`). `withAdminAuth` validates bearer token scopes or cookie admin state and sets no-store/nosniff headers (`apps/web/src/lib/api-auth.ts:58-144`). The static API-auth lint passed.

### Public actions -> rate limit -> DB mutation

Public load-more/search actions validate input before preincrementing rate limits, then roll back the consumed attempt on downstream data/search errors (`apps/web/src/app/actions/public.ts:120-167`, `apps/web/src/app/actions/public.ts:236-318`). The semantic search API charges before body materialization after cheap same-origin/header/config gates (`apps/web/src/app/api/search/semantic/route.ts:106-205`). DB-backed rate-limit increment/decrement helpers use atomic upsert/transactional decrement (`apps/web/src/lib/rate-limit.ts:436-508`). The public-route rate-limit lint passed.

### Topic/image mutations -> freshness

Image metadata, image tag add/remove, batch tag updates, and topic mutations have explicit revalidation or image `updated_at` advancement where the traced display data depends on those rows (`apps/web/src/app/actions/images.ts:872-948`, `apps/web/src/app/actions/tags.ts:193-200`, `apps/web/src/app/actions/tags.ts:256-263`, `apps/web/src/app/actions/topics.ts:85-180`, `apps/web/src/app/actions/topics.ts:182-407`). The one gap found in this family is T17-01 for tag rename/delete.

### DB restore/migrate

Restore enters process-local maintenance, takes DB restore/upload-processing/color-backfill locks, flushes shared-group counts, quiesces the processing queue, runs restore, then releases locks and resumes queue in `finally` paths (`apps/web/src/app/[locale]/admin/db-actions.ts:288-437`). Migration bootstrapping reconciles legacy/fresh schemas, baselines every journal hash individually, and fails loudly if any committed journal hash is missing after Drizzle migrate (`apps/web/scripts/migrate.js:731-808`).

### Service worker caching

The service worker bypasses admin routes, applies stale-while-revalidate only to image derivatives, bypasses revocable share HTML, and uses network-first HTML fallback for other pages (`apps/web/public/sw.template.js:366-399`). The image derivative cache path probes ETag with a bounded HEAD request and removes cached 404s (`apps/web/public/sw.template.js:183-290`). No generated-template behavioral drift was found.

### Semantic search

Semantic search enforces same-origin, restore-maintenance, JSON content-type, non-chunked transfer, content-length/body-size caps, production-mode gating, pre-body rate limiting, query length, model-version-scoped scans, and public-safe enrichment (`apps/web/src/app/api/search/semantic/route.ts:106-230`, `apps/web/src/lib/gallery-config.ts:123-142`, `apps/web/src/lib/clip-embeddings.ts:22-44`). Similar-image search follows the same same-origin/maintenance/rate-limit/model-version shape (`apps/web/src/app/api/search/similar/[id]/route.ts:60-242`).

### Sharing

Photo share creation validates the image before charging quota, no-ops existing keys before rate limit, conditionally writes `share_key`, and rolls back rate-limit claims on races/errors. Group sharing validates all IDs/processed images, inserts group rows transactionally, and rolls back on failures. Revoke/delete paths revalidate relevant public/admin surfaces (`apps/web/src/app/actions/sharing.ts:91-192`, `apps/web/src/app/actions/sharing.ts:194-315`, `apps/web/src/app/actions/sharing.ts:317-398`). Shared public routes validate base56 keys and rate-limit before resolving data (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:80-137`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:85-137`).

## Final Missed-Flow Sweep

Searched and traced the requested surfaces for hidden competing paths:

- Upload endpoints/actions, queue enqueue/claim/process/delete cleanup, upload serving, Next static upload cache headers.
- Admin login/session/token wrappers, proxy behavior, PAT upload route, admin DB download route.
- Public server actions and public API route rate-limit gates.
- Tag/topic/image mutations and their revalidation/freshness paths into sitemap and Atom feeds.
- Restore and migrate scripts, including maintenance/lock/quiesce and migration hash assertions.
- Service worker route classification, image cache strategy, share/admin bypasses, and generated SW drift.
- Semantic text/similar APIs, CLIP config/model loading, scan caps, and public result shaping.
- Share key/group creation/revocation, public share pages, shared data privacy selection, view analytics.

No additional confirmed suspicious flows were found beyond T17-01 and the two documented risks above.
