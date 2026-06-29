# Cycle 9 Critic Review

Role: critic lane
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `23e96c34fb082a72108bdab69cd856b4c14fd6af`
Mode: read-only whole-repository critique; no source code or plan files edited.

## Required Reads

- Read `AGENTS.md` first and applied the repo rules for review scope, deployment constraints, schema conventions, and quality gates.
- Read `CLAUDE.md` before reviewing implementation details.
- Loaded the local `code-review` skill and used a finding-first review stance.

## Review Inventory

I built an inventory before promoting findings. Current repo inventory is roughly 6,450 files, with the review-relevant surface concentrated in these groups:

- Project docs and operations: `AGENTS.md`, `CLAUDE.md`, `apps/web/README.md`, deploy/nginx/Docker files, Drizzle migration journal, restore/backfill runbooks, prior `.context/reviews/**` and `.context/plans/**`.
- Runtime config: root `package.json`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/src/proxy.ts`.
- Public routes/pages: localized home/topic/photo/share/group/map/timeline/year/smart-collection pages, feed routes, upload-serving routes, OG image routes, semantic/similar search APIs.
- Admin/API/actions: auth/session, admin users, image CRUD/upload/delete/retry, topics/tags, settings/SEO, sharing, DB backup/restore/download, Lightroom token upload, public analytics actions.
- Core libraries: `data.ts`, schema/privacy guards, rate-limit/origin/auth helpers, image processing/queue/backfill, color/HDR/gain-map/ICC helpers, CLIP embeddings/inference, storage/upload paths, restore scanner, analytics.
- UI/client: viewer/lightbox, grid picture fallback, search, similar photos, wide-gamut/color details, histogram, map, admin managers, upload dropzone, shared routes.
- Tests and static gates: 190+ Vitest files plus custom auth/origin/rate-limit/touch-target/source-contract linters were inventoried as confidence evidence. I did not run the full suite because this lane is a review artifact only.

Excluded from line-by-line behavioral critique: generated `.next/**`, runtime upload/model files, binary assets, and historical review claims that no longer match current HEAD.

## Confirmed Issues

### CRIT-C9-01 - Docker native package install breaks on `linux/amd64`

Severity: Medium
Confidence: High
Perspective: portability / deploy reliability / operational runbook

Code regions:

- `apps/web/Dockerfile:38-51`
- `apps/web/README.md:48-49`
- `CLAUDE.md:17`, `CLAUDE.md:556-559`

Problem:

The Dockerfile installs native optional packages by interpolating Docker BuildKit's `TARGETARCH` directly into npm package names, for example `@next/swc-linux-${TARGETARCH:-arm64}-gnu`, `@img/sharp-linux-${TARGETARCH:-arm64}`, `@swc/core-linux-${TARGETARCH:-arm64}-gnu`, and `lightningcss-linux-${TARGETARCH:-arm64}-gnu`. Docker uses `TARGETARCH=amd64` for x86_64, but these npm packages use `x64`, not `amd64`.

Concrete failure scenario:

An operator follows the checked-in Compose/Docker deployment on a typical x86_64 Linux host or CI builder. The `prod-deps` stage tries to install packages such as `@next/swc-linux-amd64-gnu`, which do not exist, and the production image fails to build. This contradicts the docs' generic Linux/Docker posture and makes the deployment path architecture-dependent without warning.

Suggested fix:

Normalize Docker arch to npm arch before the `npm install --no-save` step, e.g. `case "$TARGETARCH" in amd64) NPM_ARCH=x64 ;; arm64|'') NPM_ARCH=arm64 ;; *) exit 1 ;; esac`, then use `${NPM_ARCH}` in package names. Add a source-contract test or Dockerfile grep test that rejects `${TARGETARCH}` in native npm package names.

### CRIT-C9-02 - New uploads can become permanently absent from production semantic search

Severity: Medium
Confidence: High
Perspective: product trust / reliability / semantic-search contract

Code regions:

- `apps/web/src/lib/image-queue.ts:556-560`
- `apps/web/src/lib/image-queue.ts:600-683`
- `apps/web/src/lib/image-queue.ts:823-859`
- `CLAUDE.md:151`
- `apps/web/README.md:53-61`, `apps/web/README.md:73`

Problem:

The queue marks an image `processed=true` before CLIP embedding is written. The embedding write is a tracked side effect and catches all failures with only a warning. Queue bootstrap only re-enqueues rows where `processed=false` and `processing_error IS NULL`, so a transient production embedding failure after successful derivative generation leaves a visible photo with no automatic retry path.

Concrete failure scenario:

Production semantic search is enabled and model weights are present. A new upload finishes Sharp processing, is marked `processed=true`, then `embedImageReal(originalPath)` or the `image_embeddings` upsert fails due to a temporary model-load, file, DB, or restore-maintenance problem. The photo is published and browseable, but natural-language search and similar-photo search never include it until an operator manually runs the sidecar backfill. The UI reports normal search behavior, so this looks like poor relevance rather than a failed ingestion contract.

Suggested fix:

Persist embedding state separately from image processing, such as `embedding_status`, `embedding_error`, `embedding_attempted_at`, or a durable embedding job table. Retry failed/missing embeddings independently when semantic mode is `production`. At minimum, add an admin health check and backfill warning for `processed=true` images missing the active `model_version` embedding.

### CRIT-C9-03 - Public analytics writes trust client-supplied internal IDs

Severity: Medium
Confidence: Medium
Perspective: UX trust / analytics integrity / security posture

Code regions:

- `apps/web/src/app/actions/public.ts:319-338`
- `apps/web/src/app/actions/public.ts:360-375`
- `apps/web/src/app/actions/public.ts:377-397`
- `apps/web/src/app/actions/public.ts:399-414`
- `apps/web/src/db/schema.ts:220-260`
- `apps/web/src/lib/analytics-data.ts:28-53`, `apps/web/src/lib/analytics-data.ts:161-185`

Problem:

The public view-recording actions validate only primitive syntax (`imageId > 0`, valid topic slug, `groupId > 0`) before inserting analytics events. They do not verify that a photo is currently public/processed, that a shared group is unexpired and visible through the presented key, or that the event corresponds to the route context that just rendered. The only abuse control here is a process-local per-IP limit of 120/minute.

Concrete failure scenario:

A script calls the public Server Action endpoint shape with sequential `imageId` or `groupId` values. Existing IDs generate durable analytics rows even if the caller did not load the corresponding page or possess the relevant share key; non-existing IDs create FK failures that are swallowed after warning logs. Admin analytics can be polluted with fake top photos/shared groups, and a rotating-IP flood can still create DB pressure within the documented single-writer topology.

Suggested fix:

Move analytics insertion behind context-derived identifiers rather than raw client arguments. For photos, insert via `INSERT ... SELECT` where `images.id = ? AND processed = true`; for shared groups, record from the share key or a signed per-page token and require `expires_at` validity plus at least one processed image. Consider DB-backed global rate limiting for these write paths, matching the persistent login/rate-limit posture used elsewhere.

### CRIT-C9-04 - Shared-group durable analytics and denormalized view counts disagree

Severity: Low
Confidence: High
Perspective: hidden coupling / analytics correctness / admin trust

Code regions:

- `apps/web/src/lib/data.ts:1312-1327`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:93-119`
- `apps/web/src/lib/data.ts:120-125`
- `apps/web/src/lib/analytics-data.ts:140-185`

Problem:

`getSharedGroup()` increments the denormalized `shared_groups.view_count` when there are visible images and the selected photo id is missing or invalid. The shared-group page records a durable `shared_group_views` row only when `!photoId`. For a numeric-but-invalid `?photoId=...`, the denormalized counter increments but the durable analytics event does not.

Concrete failure scenario:

A stale client link or crawler requests `/g/<key>?photoId=999999` for a valid shared group. The page falls back to the grid and `getSharedGroup()` buffers a `view_count` increment because the selected photo is not actually in the group. But the page skips `recordSharedGroupView(group.id)` because `photoId` is truthy. The admin can see the share's own view count grow while the analytics "top shared albums" event stream undercounts the same visits.

Suggested fix:

Centralize the "counts as a group view" decision in one helper that returns both `group` and `hasValidSelectedPhoto`, then use the same boolean for the buffer and durable event. Alternatively pass `incrementViewCount:false` to the data accessor and let the route own both counters after it resolves whether `selectedImage` exists.

## Likely Issues

### CRIT-C9-05 - AVIF bit-depth metadata can overstate the downloadable/base AVIF

Severity: Low
Confidence: Medium
Perspective: photographer intent / color-delivery honesty

Code regions:

- `apps/web/src/lib/process-image.ts:1018-1024`
- `apps/web/src/lib/process-image.ts:1224-1262`
- `apps/web/src/lib/process-image.ts:1409`
- `apps/web/src/lib/image-queue.ts:542-560`
- `apps/web/src/db/schema.ts:109-113`
- `apps/web/src/components/color-details-section.tsx:471-497`
- `apps/web/src/components/lightbox-color-pip.tsx:237-256`
- `apps/web/messages/en.json:323-326`

Problem:

`avif10bit` is a single image-level boolean set to `true` after any high-bitdepth AVIF encode succeeds. The AVIF ladder is encoded size-by-size in ascending order. If an early sized derivative succeeds at 10-bit but a later/larger derivative falls back to explicit 8-bit in the per-image catch path, `avif10bit` remains true. The base/download AVIF is the largest configured derivative, but the public/admin labels say "10-bit AVIF (P3)" based on the image-level flag.

Concrete failure scenario:

A wide-gamut photo encodes `_640.avif` with `bitdepth:10`, then a larger size hits a libheif/sharp bitdepth failure or resource edge and falls back to `bitdepth:8`. The queue verifies only that the base AVIF file exists and stores `avif_10bit=true`. Visitors and photographers see the delivered-bit-depth row claim 10-bit AVIF even if the downloadable/base AVIF is 8-bit.

Suggested fix:

Track AVIF bit depth for the base/largest output explicitly, or store a richer status such as `avif_base_bit_depth` and optionally `avif_any_10bit`. The UI should label the downloadable/base asset, not any successful derivative. Add a unit test that simulates first-size 10-bit success plus largest-size fallback and asserts the stored public flag is false for the base file.

## Risks Needing Manual Validation

### CRIT-C9-R1 - Process-local coordination remains a scale and incident boundary

Severity: Medium
Confidence: High
Perspective: architecture / operations / reliability contract

Evidence regions:

- `CLAUDE.md:227-228`
- `apps/web/src/lib/data.ts:17-33`, `apps/web/src/lib/data.ts:52-60`, `apps/web/src/lib/data.ts:120-125`
- `apps/web/src/app/actions/public.ts:319-338`
- `apps/web/src/lib/rate-limit.ts:81-89`, `apps/web/src/lib/rate-limit.ts:317-346`
- `apps/web/src/lib/admin-backfill-runner.ts:1-80`

Risk:

The docs correctly state that the shipped topology is single web instance / single writer, with process-local restore flags, upload quota tracking, image queue state, backfill status, some rate limits, and the shared-group view-count buffer. The risk is operational, not a code bug: any future move to multiple app processes, PM2 clustering, Kubernetes replicas, or blue/green overlap will weaken or duplicate these contracts unless the process-local state is moved to MySQL/Redis/advisory locks.

Manual validation needed:

Confirm production and deploy scripts never run overlapping web processes long enough for upload queues, analytics counters, or public rate limits to split. Add an ops checklist item: "no horizontal scaling until process-local states are externalized."

### CRIT-C9-R2 - Database-only restore can create file/DB drift unless operators treat it as non-atomic

Severity: Medium
Confidence: High
Perspective: operational runbook / data recovery / photographer trust

Evidence regions:

- `CLAUDE.md:209-210`
- `apps/web/messages/en.json:18-24`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:144-175`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:215-231`
- `apps/web/src/app/[locale]/admin/db-actions.ts:157-257`, `apps/web/src/app/[locale]/admin/db-actions.ts:514-583`

Risk:

The UI and docs honestly disclose that backup/restore is database rows only and file storage is unchanged. The remaining risk is recovery correctness: restoring SQL from before a file upload/delete can make DB rows reference missing derivatives/originals or leave orphaned files on disk. That can break photo pages or preserve files the admin expected a rollback to remove.

Manual validation needed:

Exercise a restore drill that includes file changes, not only DB rows. Consider adding a restore preflight/reconciliation report that counts DB rows missing expected files and filesystem files without DB rows.

## False Positives / Already Fixed

- FP-C9-01: Database-only backup wording is already honest. `apps/web/messages/en.json:19` says files require host-level backups, and `apps/web/messages/en.json:24` warns restore leaves file storage unchanged; the admin page renders those strings at `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:150-174` and `:217-220`.
- FP-C9-02: Public GPS and sensitive EXIF leakage is guarded. `apps/web/src/lib/data.ts:367-407` omits sensitive public fields, `_PrivacySensitiveKeys` guards future select drift at `apps/web/src/lib/data.ts:458-488`, and the public viewer gates GPS rendering behind `isAdmin` at `apps/web/src/components/photo-viewer.tsx:896-914` plus `apps/web/src/components/info-bottom-sheet.tsx:445-462`.
- FP-C9-03: The semantic stub mode is not silently marketed as real CLIP. The UI shows the stub disclaimer at `apps/web/src/components/search.tsx:462-469`, and production routes require active model-version rows rather than serving stub vectors under the production label per `apps/web/README.md:58-61`.
- FP-C9-04: Touch-target concerns are largely locked by tests and the shared button floor. `apps/web/src/components/ui/button.tsx:23-29` floors button sizes at 44 px or more, and the recursive audit covers components, admin routes, public routes, and app-level files in `apps/web/src/__tests__/touch-target-audit.test.ts:42-83`.
- FP-C9-05: HDR ingest honesty remains explicit. HDR/gain-map state is stored for future delivery, but public HDR output is not advertised as shipped; the schema comment at `apps/web/src/db/schema.ts:54-72` and color UI gating avoid claiming HDR derivative delivery.

## Final Missed-Issue Sweep

- Re-swept auth/session/admin API wrappers, origin checks, PAT scope enforcement, restore scanner, backup download containment, upload path containment, privacy select guards, public search privacy, and migration journal conventions. No additional high-confidence security issue was found.
- Re-swept photographer-intent paths: color/HDR detection, GPS stripping, private originals, wide-gamut hints, download labels, histogram placement, and "no edit/culling/scoring" posture. Only CRIT-C9-05 survived as a concrete residual concern.
- Re-swept product/UX trust: DB-only restore wording, semantic stub honesty, share route noindex/generic metadata, and map visibility guards. These are mostly already fixed or explicitly documented.
- Re-swept operational runbooks: deploy prune guarantees, disk-starvation incident guidance, CLIP seeding, single-instance warning, and restore locking. The main residuals are CRIT-C9-01 plus the manual-validation risks above.
- No tests were run; this is a read-only critic artifact. The only intended file change from this lane is `.context/reviews/critic.md`.
