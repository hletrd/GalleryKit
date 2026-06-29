# Cycle 7/100 Aggregate Review

Date: 2026-06-29
Repo: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `17124135999a3d7cb4f5262e8b2b5917503088ae`

## Agent Coverage

Completed review artifacts:

- `.context/reviews/code-reviewer.md`
- `.context/reviews/perf-reviewer.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/critic.md`
- `.context/reviews/verifier.md`
- `.context/reviews/test-engineer.md`
- `.context/reviews/tracer.md`
- `.context/reviews/architect.md`
- `.context/reviews/debugger.md`
- `.context/reviews/document-specialist.md`
- `.context/reviews/designer.md`
- `.context/reviews/product-marketer-reviewer.md`
- `.context/reviews/ui-ux-designer-reviewer.md`

UI/UX browser review was in scope because this is a Next.js web app. Local DB-backed rendering was blocked by local MySQL `ECONNREFUSED`, so UI lanes used source evidence plus the live `https://gallery.atik.kr` deployment for public DOM/accessibility checks.

## AGENT FAILURES

None. Every required and discovered reviewer lane returned a report.

## Merged Findings

### C7-01 - Upload write paths use fail-open gallery config defaults for privacy and processing settings

Severity: High
Confidence: High
Status: Confirmed
Sources: architect

Evidence: `apps/web/src/lib/gallery-config.ts:103-212`, `apps/web/src/lib/gallery-config-shared.ts:91-109`, `apps/web/src/app/actions/images.ts:175-177`, `apps/web/src/app/actions/images.ts:309-342`, `apps/web/src/app/api/admin/lr/upload/route.ts:234-340`.

`getGalleryConfig()` catches any `admin_settings` read failure and returns fresh-install defaults. That fallback is used by browser and Lightroom upload write paths. If an operator enabled `strip_gps_on_upload=true` and the settings read fails while later upload DB work succeeds, the upload can skip original-file GPS stripping and accept the image as successful. Split strict ingest config from render config or fail uploads closed when settings cannot be read.

### C7-02 - Color backfill can generate undersized derivatives from stale database width

Severity: High
Confidence: High
Status: Confirmed
Sources: verifier, debugger

Evidence: `apps/web/src/lib/process-image.ts:1050-1064`, `apps/web/src/lib/process-image.ts:1145-1148`, `apps/web/src/lib/admin-backfill-runner.ts:502-517`, `apps/web/scripts/backfill-color-pipeline.ts:206-221`.

`processImageFormats()` reads fresh Sharp metadata and comments that caller `baseWidth` is ignored, but `processingBaseWidth` still initializes from the caller/DB value unless the wide-gamut downscale branch runs. Backfill callers pass `images.width`. A stale small DB width can collapse all configured derivative sizes to that stale width while still advancing `pipeline_version`. Use the fresh metadata width for normal processing and add a stale-width regression test.

### C7-03 - Tag filter state and next URLs diverge from canonical server-filtered tags

Severity: Medium
Confidence: High
Status: Confirmed
Sources: code-reviewer, test-engineer, tracer, debugger, designer, ui-ux-designer-reviewer

Evidence: `apps/web/src/app/[locale]/(public)/page.tsx:161-166`, `apps/web/src/app/[locale]/(public)/page.tsx:221-223`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:172-177`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:214`, `apps/web/src/components/home-client.tsx:259-270`, `apps/web/src/components/home-client.tsx:438-447`, `apps/web/src/components/tag-filter.tsx:13-39`, `apps/web/src/components/tag-filter.tsx:61-92`.

Server pages canonicalize `tags` through existing-tag filtering and pass that canonical list to `HomeClient`, but `TagFilter` ignores it and rebuilds active state and next URLs from raw `useSearchParams()`. URLs such as `/en?tags=not-a-real-tag` render unfiltered results while no chip, including `All`, is pressed; valid toggles can preserve invalid slugs. Pass canonical `currentTags` into `TagFilter`, use it for `aria-pressed`/variants/toggle math, and add behavioral coverage.

### C7-04 - Initial public listing queries aggregate tags and count across the full matched set

Severity: Medium
Confidence: High
Status: Confirmed
Sources: perf-reviewer

Evidence: `apps/web/src/lib/data.ts:872-900`, `apps/web/src/lib/data.ts:1403-1447`, `apps/web/src/app/[locale]/(public)/page.tsx:149-166`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-176`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`.

First-page home/topic/smart-collection listing queries select tag aggregation and `COUNT(*) OVER()` in the grouped listing query. MySQL must group/count the full matched set before returning the first page. Split first-page card fetch into bounded ID selection plus tag enrichment, and keep exact counts separate only where the UI truly needs them.

### C7-05 - Analytics top tables lack bot/time/entity indexes

Severity: Medium
Confidence: High
Status: Likely issue confirmed by query/index mismatch
Sources: perf-reviewer

Evidence: `apps/web/src/lib/analytics-data.ts:28-46`, `apps/web/src/lib/analytics-data.ts:62-79`, `apps/web/src/lib/analytics-data.ts:161-180`, `apps/web/src/db/schema.ts:221-254`.

Admin top photo/topic/shared-group queries filter `bot=false` and optional `viewed_at >= since`, then group by image/topic/group. Current indexes do not cover those access patterns for all three tables. Add matching composite indexes after `EXPLAIN` sizing, with migration/reconcile coverage.

### C7-06 - View-event retention deletes lack viewed_at-leading indexes on topic/share tables

Severity: Medium
Confidence: Medium
Status: Confirmed
Sources: architect

Evidence: `apps/web/src/lib/view-retention.ts:64-81`, `apps/web/src/db/schema.ts:228-253`.

Retention purges use `WHERE viewed_at < cutoff`, but `topic_views` and `shared_group_views` indexes begin with `topic` / `group_id`. The hourly retention safety valve can degrade into broad scans as anonymous event tables grow. Add `viewed_at`-leading retention indexes or change purge shape deliberately.

### C7-07 - Real CLIP inference has no process-wide concurrency governor

Severity: Medium
Confidence: Medium
Status: Likely issue
Sources: perf-reviewer

Evidence: `apps/web/src/lib/clip-model.ts:76-108`, `apps/web/src/lib/clip-model.ts:118-140`, `apps/web/src/lib/clip-model.ts:151-199`, `apps/web/src/app/api/search/semantic/route.ts:178-240`, `apps/web/src/lib/image-queue.ts:530-589`.

Model loading is deduped, but CPU-heavy `model(...)` inference calls are unbounded across public semantic search and background image embedding. Add a small process-wide limiter around text and image inference, defaulting to concurrency 1 and configurable for operators.

### C7-08 - Upload preview renders every selected full-size file at once

Severity: Medium
Confidence: High
Status: Confirmed
Sources: perf-reviewer

Evidence: `apps/web/src/components/upload-dropzone.tsx:45-49`, `apps/web/src/components/upload-dropzone.tsx:95-123`, `apps/web/src/components/upload-dropzone.tsx:451-489`.

The admin uploader permits up to 100 files / 2 GiB, creates object URLs for every selected file, and renders all previews as raw `<img>` nodes without lazy/async decode or a visible-window cap. Add immediate `loading="lazy"` and `decoding="async"` and consider capping/virtualizing preview count later.

### C7-09 - Masonry/share grids can break when AVIF/WebP sized sources 404

Severity: Medium
Confidence: High
Status: Confirmed
Sources: critic

Evidence: `apps/web/src/components/home-client.tsx:339-377`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:236-263`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:194-217`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:199-233`, fallback patterns in `apps/web/src/components/photo-viewer.tsx:421-549` and `apps/web/src/components/lightbox.tsx:402-519`.

Grid surfaces rely on `<picture>` fallback to base JPEG, but modern browsers do not fall back to `img.src` when a matching AVIF/WebP `<source>` 404s. Viewer/lightbox already drop failed sources. Reuse that stateful source fallback for grid cards.

### C7-10 - Parallel derivative generation can clean up before sibling encoders stop writing

Severity: Medium
Confidence: Medium
Status: Likely issue
Sources: critic

Evidence: `apps/web/src/lib/process-image.ts:1342-1348`, `apps/web/src/lib/process-image.ts:1374-1389`, retry callers in `apps/web/src/lib/image-queue.ts` and backfill callers.

`processImageFormats()` runs WebP/AVIF/JPEG branches with `Promise.all()`. If one branch rejects, cleanup starts while sibling promises may still write/rename files. Use `Promise.allSettled()` so cleanup waits for all branches and then throws the first/aggregate error.

### C7-11 - Semantic/similar enrichment failures return successful empty results

Severity: Medium
Confidence: High
Status: Confirmed
Sources: critic

Evidence: `apps/web/src/app/api/search/semantic/route.ts:288-335`, `apps/web/src/app/api/search/similar/[id]/route.ts:189-236`, clients in `apps/web/src/components/search.tsx` and `apps/web/src/components/similar-photos.tsx`.

When CLIP scoring finds candidates but the metadata enrichment query fails, both routes log the error and return HTTP 200 with empty results. Clients render that as "no matches" rather than an infrastructure failure. Return 500/503 when enrichment fails after matches exist.

### C7-12 - CLIP search silently searches only the newest capped embedding window

Severity: Low
Confidence: High
Status: Risk needing manual validation
Sources: critic

Evidence: `apps/web/src/lib/clip-embeddings.ts:22-44`, `apps/web/src/app/api/search/semantic/route.ts:242-251`, `apps/web/src/app/api/search/similar/[id]/route.ts:141-150`, `apps/web/README.md:53-62`, `CLAUDE.md:534-538`.

Semantic/similar routes scan only the newest `SEMANTIC_SCAN_LIMIT` rows. Docs mention bounded scan, but the UI does not indicate that old photos may be invisible once the corpus exceeds the cap. Surface the limitation in UI/admin settings or move toward a vector index strategy.

### C7-13 - Upload-time processing settings are not durably owned after restart

Severity: Medium
Confidence: High
Status: Confirmed
Sources: architect

Evidence: `apps/web/src/app/actions/images.ts:467-502`, `apps/web/src/app/api/admin/lr/upload/route.ts:436-477`, `apps/web/src/lib/image-queue.ts:385-428`, `apps/web/src/lib/image-queue.ts:744-784`.

Upload actions pass a processing settings snapshot to the in-memory queue, but pending DB rows survive restarts while queue snapshots do not. Bootstrap reconstructs jobs from row fields and current config, so accepted-but-unprocessed images can be encoded under later settings after deploy/crash. Persist a processing settings snapshot or job table for pending rows.

### C7-14 - Permanent failed-image suppression is process-local after restart

Severity: Medium
Confidence: High
Status: Confirmed
Sources: architect

Evidence: `apps/web/src/lib/image-queue.ts:163-169`, `apps/web/src/lib/image-queue.ts:605-641`, `apps/web/src/lib/image-queue.ts:732-740`, `apps/web/src/app/actions/images.ts:1147-1185`.

Permanent suppression is stored in `permanentlyFailedIds`, while durable DB fields `processing_error` / `failed_at` power the admin retry UI. After a deploy, bootstrap can re-enqueue failed rows without admin retry intent. Exclude failed rows during bootstrap until `retryFailedImage()` clears their failure fields.

### C7-15 - Lightroom token docs point to Settings while token management is an unlinked Tokens page

Severity: Medium
Confidence: High
Status: Confirmed
Sources: document-specialist

Evidence: `CLAUDE.md:152`, `apps/web/src/app/[locale]/admin/(protected)/tokens/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`, `apps/web/src/components/admin-nav.tsx:15-25`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`.

Docs say Lightroom tokens can be rotated/revoked from Settings, but the UI is a dedicated `/admin/tokens` page and the admin nav does not link to it. Add a Tokens nav item with localized labels and update docs.

### C7-16 - Semantic search route header describes stale stub-only/random behavior

Severity: Low
Confidence: High
Status: Confirmed
Sources: document-specialist

Evidence: `apps/web/src/app/api/search/semantic/route.ts:8-20`, `apps/web/src/app/api/search/semantic/route.ts:232-251`, `apps/web/src/lib/clip-inference.ts:6-13`, `apps/web/src/lib/clip-inference.ts:63-72`.

The route header still says queries embed via the stub encoder and describes stub output as random. Current code supports production `embedTextReal`, model-version separation, production threshold, and deterministic stub embeddings. Update the comment to match current behavior.

### C7-17 - Fresh-install docs say to upload before creating the required category

Severity: High
Confidence: High
Status: Confirmed product-onboarding defect
Sources: product-marketer-reviewer

Evidence: `README.md:91-104`, `apps/web/README.md:11-21`, `apps/web/scripts/init-db.ts`, `apps/web/scripts/migrate.js`, `apps/web/src/components/upload-dropzone.tsx:191-196`, `apps/web/src/components/upload-dropzone.tsx:347-357`, `apps/web/messages/en.json:146-148`.

The quick-start flow seeds admin but not topics/categories, then instructs the operator to upload a photo. The uploader is intentionally disabled until a category exists. Update both READMEs to create a category first, then upload.

### C7-18 - Mobile nav toggle claims it controls visible topic links while collapsed

Severity: Low
Confidence: High
Status: Confirmed
Sources: designer

Evidence: `apps/web/src/components/nav-client.tsx:99-107`, `apps/web/src/components/nav-client.tsx:117-123`, `apps/web/src/components/nav-client.tsx:155-159`.

The mobile toggle uses `aria-controls="primary-nav-topics primary-nav-controls"` while the topic list remains visible and operable in collapsed mobile mode. Remove `primary-nav-topics` from the controlled region and name the toggle for the tools/controls it actually reveals, or hide/inert the topic list when collapsed.

### C7-19 - Search result accessible names repeat generic thumbnail text

Severity: Low
Confidence: High
Status: Confirmed
Sources: designer

Evidence: `apps/web/src/components/search.tsx:71-85`, `apps/web/src/components/search.tsx:99-103`.

Search result rows include an image `alt` such as "Photo" plus adjacent visible fallback text such as "Photo 348", producing names like "Photo Photo 348 ...". Make thumbnails decorative in result rows or derive a single non-duplicated accessible label.

### C7-20 - TLS/HSTS deployment assumptions require live validation

Severity if misdeployed: High
Confidence: Medium
Status: Manual-validation risk
Sources: security-reviewer

Evidence: `apps/web/nginx/default.conf:21-28`, `apps/web/nginx/default.conf:47-53`.

The checked-in nginx config listens on cleartext port 80 and assumes an external TLS edge while also emitting HSTS. Validate production HTTPS termination and port-80 redirect/blocking, or add deploy-time probes/edge config docs.

### C7-21 - Client-IP trust depends on exact proxy-chain topology

Severity if misconfigured: Medium
Confidence: Medium
Status: Manual-validation risk
Sources: security-reviewer

Evidence: `apps/web/docker-compose.yml:14-21`, `apps/web/nginx/default.conf`, `apps/web/src/lib/rate-limit.ts:152-180`.

`TRUST_PROXY=true` and forwarded headers require the live proxy chain to overwrite/normalize client IP headers correctly. Validate real-IP handling and `TRUSTED_PROXY_HOPS` with representative headers.

### C7-22 - Process-local security/coordination controls would weaken under scale-out

Severity if scaled out: Medium
Confidence: High
Status: Topology risk
Sources: security-reviewer, architect

Evidence: `apps/web/docker-compose.yml:11-21`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/restore-maintenance.ts`.

The repo documents a single web-instance topology. Restore flags, upload accounting, and several limiter buckets are process-local. Keep single-instance deployment as an invariant or move coordination state to a shared store before horizontal scale-out.

## Cross-Agent Agreement

Highest-signal findings:

- C7-03 Tag filter canonical-state drift: independently reported by six lanes and browser-confirmed on production.
- C7-02 Backfill stale-width derivative bug: independently reported by verifier and debugger.
- C7-01 Upload config fail-open behavior: high-severity architecture/privacy finding with direct source evidence.

## Deferred/Planning Notes

Prompt 2 must either schedule every finding above for implementation or explicitly record deferral with original severity/confidence, citation, concrete reason, and exit criterion. Security, correctness, and data-loss findings are not deferrable unless a repo rule explicitly permits deferral.
