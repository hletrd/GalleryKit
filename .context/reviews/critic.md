# Cycle 7/100 Critic Review

Role: critic lane
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `17124135999a3d7cb4f5262e8b2b5917503088ae`
Mode: read-only whole-repo critique; no implementation performed.

## Required Reads

- Read and followed `AGENTS.md`.
- Read and followed `CLAUDE.md`.
- Loaded the local `code-review` skill instructions and used finding-first review output.

## Review Inventory

I inventoried current HEAD before promoting findings. Review-relevant file families examined:

- Project rules/docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.context/plans/README.md`.
- App/package/runtime config: root and app `package.json`, `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/src/proxy.ts`.
- Public routes/pages: localized home/topic/photo/share/group/map/timeline/year/smart-collection/feed pages, upload serving routes, OG image routes.
- Admin routes/actions: auth, admin users, dashboard image actions, topics, tags, smart collections, settings, SEO, sharing, DB backup/restore, Lightroom upload.
- Data/privacy layer: `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, public enrichment selects, privacy-sensitive type guards, migration scripts and Drizzle journal guidance.
- Image/color/photographer-intent surface: upload path handling, `process-image.ts`, topic image processing, queue/bootstrap, color/HDR detection, CLIP model paths, service-worker image caching.
- Public API/trust boundaries: semantic search, similar-photo route, OG routes, same-origin helpers, rate-limit helpers, admin API wrapper.
- UI/client surfaces: masonry grids, viewer/lightbox, search, similar photos, map, admin image manager/settings.
- Tests and review history: relevant Vitest/e2e/lint contract tests and prior `.context/reviews` artifacts were used as clues, but current HEAD code/docs are the source of truth.

Excluded from code-level review: binary assets, generated/runtime upload files, and historical archive findings that no longer match HEAD.

## Findings

### CRIT-C7-01 - Masonry/share grids still break when AVIF/WebP sized sources 404

Severity: Medium
Confidence: High
Status: Confirmed
Perspective: product behavior / photographer presentation / cross-file UI correctness

Code regions:

- `apps/web/src/components/home-client.tsx:339-377`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:236-263`
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:194-217`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:199-233`
- Existing correct fallback contract in `apps/web/src/components/photo-viewer.tsx:421-549`
- Existing correct fallback contract in `apps/web/src/components/lightbox.tsx:402-519`

Problem:

The grid surfaces use `<source type="image/avif">` and `<source type="image/webp">` for sized derivatives, then set the `<img src>` to the base JPEG. The comments correctly say the base JPEG exists for legacy / mid-backfill rows, but that does not help modern browsers when the selected AVIF/WebP source 404s. The photo viewer and lightbox already document the actual browser behavior: a bare `img.src` fallback cannot win while matching `<source>` rows remain, so they use state to drop sources after `onError`.

Concrete failure scenario:

An `IMAGE_PIPELINE_VERSION` bump or image-size reconfigure leaves a processed legacy row with the base JPEG present while `_640.avif` / `_1536.avif` are missing during backfill. On the home, timeline, year, or shared-group grid, Chrome/Safari selects the AVIF `<source>` and receives a 404. Because those grid components never remove the `<source>` rows on error, the visitor sees a broken tile instead of the guaranteed base JPEG. This directly damages the photographer-facing browsing surface; the viewer/lightbox only recover after the user reaches the photo page.

Suggested fix:

Extract the viewer/lightbox fallback pattern into a reusable responsive image component for grid cards: track one error, re-render without AVIF/WebP sources, and point the `<img>` at the base JPEG. Add a regression test that a grid card renders a stateful `onError` fallback path, or a browser test with a missing AVIF/WebP derivative and present base JPEG.

### CRIT-C7-02 - Parallel derivative generation can clean up before sibling encoders stop writing

Severity: Medium
Confidence: Medium
Status: Likely issue
Perspective: reliability / operational fit / background processing

Code regions:

- `apps/web/src/lib/process-image.ts:1342-1348`
- `apps/web/src/lib/process-image.ts:1374-1389`
- Caller retry path in `apps/web/src/lib/image-queue.ts:432-460` and `apps/web/src/lib/image-queue.ts:592-603`
- Backfill caller in `apps/web/src/lib/admin-backfill-runner.ts:498-523`

Problem:

`processImageFormats()` starts WebP, AVIF, and JPEG generation with `Promise.all()`. If one format rejects, `Promise.all()` rejects immediately; JavaScript does not cancel the other format promises. The catch block then deletes paths currently recorded in `writtenSizedPaths`, but sibling encoders can still be running and can write or rename additional files after cleanup has completed. The queue catch can immediately retry the same job while the prior invocation is still finishing its sibling promises.

Concrete failure scenario:

AVIF encoding fails quickly due to a codec/bitdepth/disk error while JPEG and WebP are still writing their ladders. The catch block deletes the paths it has seen and rethrows. The queue schedules a retry. Meanwhile the original JPEG/WebP promises continue and atomically rename more derivatives for the failed invocation. The failed job can leave partial files behind, and a retry can race with old writers over the same filenames. Because processed remains false this is not usually a public-data leak, but it creates noisy retries, stale derivative state for operators/backfills, and hard-to-reproduce mixed outputs if the retry completes while old writers are still active.

Suggested fix:

Run the three format promises through `Promise.allSettled()`, wait for every encoder branch to finish, then clean up all paths recorded by all branches and throw an aggregate/first error. This preserves parallelism while making the failure boundary real. Add a unit test with one format rejecting and another resolving later after adding a path, asserting cleanup waits for the late writer.

### CRIT-C7-03 - Semantic/similar enrichment failures are returned as successful empty results

Severity: Medium
Confidence: High
Status: Confirmed
Perspective: product honesty / reliability / search UX

Code regions:

- `apps/web/src/app/api/search/semantic/route.ts:288-335`
- `apps/web/src/app/api/search/similar/[id]/route.ts:189-236`
- Client success handling in `apps/web/src/components/search.tsx:191-212`
- Similar empty-state rendering in `apps/web/src/components/similar-photos.tsx:134-156`

Problem:

Both search routes compute candidate IDs and scores, then run a second enrichment query for public image metadata. If that enrichment query fails, the routes log the error, set `enrichedResults = []`, and still return HTTP 200. The clients interpret HTTP 200 with an empty array as a legitimate “no matches” / “no similar photos” state.

Concrete failure scenario:

The CLIP scan succeeds and finds relevant matches, but the enrichment `images LEFT JOIN topics` query hits a transient MySQL connection error. The visitor sees an empty semantic result list or “no similar photos,” not a retryable error. This misrepresents infrastructure failure as photographic/search relevance failure and makes production incidents harder to detect from the client side.

Suggested fix:

Return `500` or `503` when enrichment fails after matches were found, with the existing `no-store` headers. Update `Search` and `SimilarPhotos` to show the existing error/hidden state for non-OK responses. If partial results without metadata are desired, return a distinct status field such as `{ status: "partial", results: [...] }` and render it explicitly instead of collapsing to empty success.

### CRIT-C7-04 - CLIP search silently searches only the newest capped embedding window

Severity: Low
Confidence: High
Status: Risk needing manual validation
Perspective: product assumptions / operational fit

Code regions:

- `apps/web/src/lib/clip-embeddings.ts:22-44`
- `apps/web/src/app/api/search/semantic/route.ts:242-251`
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-150`
- Operational note in `apps/web/README.md:53-62`
- Runtime-limit note in `CLAUDE.md:534-538`

Problem:

The semantic and similar routes order embeddings by `updatedAt DESC` and scan only `SEMANTIC_SCAN_LIMIT` rows, defaulting to 2000. This is documented as an operational cap, and the README notes that large galleries may not surface older photos. The product UI, however, presents the feature as semantic search/similar photos without indicating that results may be incomplete due to a newest-first scan window.

Concrete failure scenario:

A gallery grows to 6,000 processed photos. A client searches for a specific older event or opens similar photos on an old image. If the best matches are outside the newest 2,000 embedding rows, they are invisible even though they have valid production embeddings. The photographer may conclude CLIP relevance is poor or that old work was not embedded, while the route is behaving exactly as capped.

Suggested fix:

At minimum, surface the bounded-search assumption in the UI or admin settings when production semantic search is active, including the effective scan limit. Better fixes are to make the cap an explicit operator setting with observed corpus count warnings, scan all rows under a concurrency/latency budget, or move to an indexed/vector-search strategy when corpus size exceeds the cap.

## Final Missed-Issues Sweep

- Rechecked current HEAD after noticing earlier critic findings had already been fixed: production CSP now includes OpenStreetMap tile image origins, and topic image cleanup now records the replaced filename under the route lock.
- Re-scanned auth/session/admin API wrappers, same-origin helpers, upload path containment, Lightroom token auth, privacy field guards, backup download containment, restore scanner, and schema/migration conventions. No new higher-severity issue was confirmed there.
- Re-scanned photographer-intent constraints: no edit/culling/scoring features were introduced; originals are private by path; GPS stripping and color/HDR delivery guardrails remain explicit.
- No tests were run for this critic lane; this artifact is a review report only.
