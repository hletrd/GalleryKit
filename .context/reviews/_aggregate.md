# Cycle 19 Aggregate Review

Date: 2026-06-30 KST
Baseline HEAD at review start: `26f1a66d` (`fix(review): close cycle 18 findings`)
Current HEAD after review-artifact commits: `392f41be` (`docs(reviews): record cycle 19 tracer findings`)

## Review Fan-Out

All requested and discovered reviewer lanes returned and wrote their own files:

- `code-reviewer.md`
- `perf-reviewer.md`
- `security-reviewer.md`
- `critic.md`
- `verifier.md`
- `test-engineer.md`
- `tracer.md`
- `architect.md`
- `debugger.md`
- `document-specialist.md`
- `designer.md`
- `ui-ux-designer-reviewer.md`
- `product-marketer-reviewer.md`

No agent failed after retry. Two reviewer lanes committed and pushed their review artifacts during Prompt 1: `d4aea50f` (`security-reviewer.md`) and `392f41be` (`tracer.md`). Those commits are retained as cycle work.

## Aggregate Findings

### AGG-C19-01 - Backup/restore child processes can hang indefinitely while holding maintenance and advisory locks

Severity: High
Confidence: High
Sources: debugger.

Citations:

- `apps/web/src/app/[locale]/admin/db-actions.ts:157-183`
- `apps/web/src/app/[locale]/admin/db-actions.ts:205-290`
- `apps/web/src/app/[locale]/admin/db-actions.ts:372-438`
- `apps/web/src/app/[locale]/admin/db-actions.ts:560-642`
- `apps/web/src/app/[locale]/admin/db-actions.ts:667-693`

Problem: backup, restore, and post-restore migration child processes have no timeout/watchdog path. A wedged `mysqldump`, `mysql`, or migration process can leave restore maintenance, upload-processing lock, queue quiesce, and DB advisory locks stuck until manual intervention.

Fix direction: wrap child processes in a bounded watchdog, kill/destroy streams on timeout, and settle promises exactly once. Restore may keep maintenance on when DB state is uncertain, but locks must unwind.

### AGG-C19-02 - Browser upload and Lightroom upload duplicate the same ingest transaction contract

Severity: High
Confidence: High
Sources: architect, critic, tracer cross-checks.

Citations:

- `apps/web/src/app/actions/images.ts:114-190`
- `apps/web/src/app/actions/images.ts:350-531`
- `apps/web/src/app/api/admin/lr/upload/route.ts:225-275`
- `apps/web/src/app/api/admin/lr/upload/route.ts:307-516`

Problem: browser upload and Lightroom upload independently own the same ingest transition: settings snapshot, HDR/GPS gates, EXIF/color fields, row insert shape, processing settings, queue job shape, audit, and cleanup. Prior comments show repeated parity repairs.

Fix direction: extract a shared server-only ingest service or, if deferred, record the broad-refactor reason and reopen before any upload-time field/settings/privacy invariant changes.

### AGG-C19-03 - Privacy page omits first-party view analytics disclosure

Severity: High
Confidence: High
Sources: product-marketer-reviewer.

Citations:

- `apps/web/messages/en.json:783-790`
- `apps/web/messages/ko.json:783-790`
- `apps/web/src/app/actions/public.ts:351-360`
- `apps/web/src/app/actions/public.ts:384-389`
- `apps/web/src/app/actions/public.ts:415-420`
- `apps/web/src/app/actions/public.ts:450-455`
- `apps/web/src/db/schema.ts:224-258`

Problem: `/privacy` discloses Google Analytics and photo metadata but not built-in first-party photo/topic/shared-group view analytics, which store timestamps, referrer host, derived country code, and bot flag.

Fix direction: add first-party analytics disclosure in English and Korean, including no full IP storage and retention default.

### AGG-C19-04 - Primary photo focus target hides photo identity behind a generic zoom action

Severity: High
Confidence: High
Sources: ui-ux-designer-reviewer, designer.

Citations:

- `apps/web/src/components/image-zoom.tsx:343-362`
- `apps/web/src/components/photo-viewer.tsx:467-483`
- `apps/web/src/components/photo-viewer.tsx:508-548`
- `apps/web/src/lib/photo-title.ts:85-122`

Problem: the primary photo is wrapped in `role="button"` with an accessible name of only "Zoom in/out". Live DOM also showed an underlying image with generic `"Photo"` alt for at least one route. Keyboard/screen-reader users may not hear the photo identity on the main object.

Fix direction: include the computed photo alt/title in the zoom control accessible name or separate zoom into its own named button. Add a source/render regression for the accessible-name contract.

### AGG-C19-05 - Public route rate-limit scanner accepts aliased non-limiter imports

Severity: Medium
Confidence: High
Sources: code-reviewer, tracer.

Citations:

- `apps/web/scripts/check-public-route-rate-limit.ts:38-42`
- `apps/web/scripts/check-public-route-rate-limit.ts:96-122`
- `apps/web/scripts/check-public-route-rate-limit.ts:188-207`
- `apps/web/scripts/check-public-route-rate-limit.ts:366-370`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:270-281`
- `apps/web/src/lib/rate-limit.ts:378-385`

Problem: the scanner approves named imports from approved modules by local alias prefix, so `rollbackSemanticAttempt as preIncrementSemanticAttempt` can satisfy the lint gate while not enforcing a limit.

Fix direction: classify approved imports by exported symbol name and record the local binding only after the exported helper is approved. Add an alias regression test.

### AGG-C19-06 - CLIP semantic-search inference queue is bounded but abort-insensitive

Severity: Medium
Confidence: High
Sources: verifier, test-engineer, tracer.

Citations:

- `apps/web/src/lib/clip-model.ts:53-71`
- `apps/web/src/lib/clip-model.ts:94-127`
- `apps/web/src/lib/clip-model.ts:194-202`
- `apps/web/src/app/api/search/semantic/route.ts:246-264`
- `apps/web/src/__tests__/clip-model-contract.test.ts:32-39`
- `apps/web/src/__tests__/semantic-search-route.test.ts:264-279`

Problem: disconnected requests waiting in the CLIP inference queue are removed only by timeout or slot release. If a slot opens first, abandoned requests can still run ONNX inference.

Fix direction: thread `request.signal` into `embedTextReal` / slot acquisition, remove queued waiters on abort, reject with an abort-specific error, and re-check after acquiring the slot.

### AGG-C19-07 - Semantic-search rate-limit comments and tests drift from current charged behavior

Severity: Medium
Confidence: High
Sources: verifier, test-engineer, tracer, critic.

Citations:

- `apps/web/src/app/api/search/semantic/route.ts:12-16`
- `apps/web/src/app/api/search/semantic/route.ts:172-183`
- `apps/web/src/app/api/search/semantic/route.ts:237-244`
- `apps/web/src/lib/rate-limit.ts:24-34`
- `apps/web/src/lib/rate-limit.ts:374-377`
- `apps/web/src/__tests__/semantic-search-route.test.ts:230-262`

Problem: route and rate-limit comments describe disabled/short-query refunds, but implementation now deliberately charges disabled-mode config lookup and invalid query lengths. Tests lock disabled charging but not short/long query charge/no-rollback semantics.

Fix direction: document the current charged policy and add assertions for short/long query cases.

### AGG-C19-08 - Bulk edit dialog state can survive a successful parent-driven close

Severity: Medium
Confidence: High
Sources: test-engineer.

Citations:

- `apps/web/src/components/bulk-edit-dialog.tsx:81-109`
- `apps/web/src/components/bulk-edit-dialog.tsx:155-160`
- `apps/web/src/components/image-manager.tsx:225-232`
- `apps/web/src/components/image-manager.tsx:594-600`

Problem: `resetState()` runs only when the dialog's own `onOpenChange(false)` path fires. A successful submit closes from the parent, so prior destructive modes/tag edits can persist on reopen.

Fix direction: reset state when `open` transitions to `false` or immediately after successful submit. Add focused component/source regression.

### AGG-C19-09 - Topic deletion can report failure after committed DB delete if image cleanup fails

Severity: Medium
Confidence: High
Sources: debugger.

Citations:

- `apps/web/src/app/actions/topics.ts:429-469`

Problem: topic DB deletion commits before `deleteTopicImage()`. If file cleanup throws, the action catches and returns failure, skips audit/revalidation, while DB state has already changed.

Fix direction: after committed DB delete, always audit and revalidate; treat file cleanup failure as logged best-effort cleanup warning rather than DB delete failure.

### AGG-C19-10 - Docker build-time env can diverge from runtime `.env.local`

Severity: Medium
Confidence: High
Sources: architect.

Citations:

- `apps/web/docker-compose.yml:7-21`
- `apps/web/deploy.sh:15-31`
- `apps/web/Dockerfile:65-70`
- `apps/web/next.config.ts:28`
- `apps/web/next.config.ts:92-105`
- `apps/web/src/lib/upload-limits.ts:19-33`
- `apps/web/.env.local.example:9-16`
- `apps/web/.env.local.example:41-47`
- `README.md:148-149`

Problem: `.env.local` is runtime-only for compose, while Next build config reads build args/shell env. Operators can set CDN/body-limit values in `.env.local` and still build with empty/default values.

Fix direction: unify env source for build/runtime or add explicit build-arg forwarding/tests/docs.

### AGG-C19-11 - Single-process coordination is documented but not runtime-enforced

Severity: Medium if scaled; Low under current deployment
Confidence: High
Sources: architect, critic, prior deferred carry-forward.

Citations:

- `CLAUDE.md:227-230`
- `apps/web/src/lib/restore-maintenance.ts:1-22`
- `apps/web/src/lib/upload-tracker-state.ts:7-78`
- `apps/web/src/app/actions/settings.ts:68-79`
- `apps/web/src/lib/image-queue.ts:76-90`
- `apps/web/src/lib/admin-backfill-runner.ts:144-250`
- `apps/web/src/lib/rate-limit.ts:77-121`
- `apps/web/src/lib/data.ts:1-38`

Problem: several safety and quota invariants depend on process-local state. Compose currently deploys one process, but the app does not fail loudly if a second process starts against the same DB.

Fix direction: add a startup DB lease/instance guard or move correctness state to shared storage before multi-process deployment.

### AGG-C19-12 - Image queue can starve the shared MySQL pool while holding advisory-lock connections

Severity: Medium
Confidence: High
Sources: perf-reviewer.

Citations:

- `apps/web/src/db/index.ts:23-38`
- `apps/web/src/lib/image-queue.ts:76-90`
- `apps/web/src/lib/image-queue.ts:446-472`
- `apps/web/src/lib/image-queue.ts:513-630`
- `apps/web/src/lib/image-queue.ts:812-815`

Problem: image jobs can hold advisory-lock pool connections while Sharp work runs. Raising queue concurrency can pin most of the 10-connection pool.

Fix direction: replace long advisory locks with durable short claims or use a separate lock pool/cap concurrency from pool budget.

### AGG-C19-13 - Initial listing and smart-collection pages combine tag aggregation with `COUNT(*) OVER()`

Severity: Medium
Confidence: High
Sources: perf-reviewer, critic watchlist.

Citations:

- `apps/web/src/lib/data.ts:878-914`
- `apps/web/src/lib/data.ts:1409-1453`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-103`

Problem: first-page public/admin listing queries group tags and compute exact counts over full match sets before returning a small page.

Fix direction: fetch page IDs first with keyset/limit+1, then fetch tags only for visible IDs; avoid exact totals on hot paths.

### AGG-C19-14 - Public keyword search uses leading-wildcard scans after admission

Severity: Medium
Confidence: High
Sources: perf-reviewer.

Citations:

- `apps/web/src/app/actions/public.ts:236-318`
- `apps/web/src/lib/data.ts:1482-1624`

Problem: admitted public keyword searches use `%term%` matches across several fields/branches, which cannot use normal B-tree indexes selectively.

Fix direction: move to indexed search or tighten broad-query behavior until then.

### AGG-C19-15 - `CLIP_MODELS_ROOT` default docs conflict with resolver/tests

Severity: Medium
Confidence: High
Sources: document-specialist.

Citations:

- `CLAUDE.md:110-112`
- `CLAUDE.md:152`
- `CLAUDE.md:492-510`
- `apps/web/src/lib/clip-paths.ts:48-65`
- `apps/web/src/__tests__/clip-paths.test.ts:75-87`
- `apps/web/.env.local.example:70-75`

Problem: docs table says default `/app/data/models/clip`, but code default is cwd-relative `data/models/clip`. Other docs correctly say production must set an absolute env.

Fix direction: update docs/env example to make production `CLIP_MODELS_ROOT=/app/data/models/clip` explicit and clarify the unset default.

### AGG-C19-16 - `robots.txt` blocks the same `/api/og*` endpoints used as OG images

Severity: Medium
Confidence: Medium
Sources: product-marketer-reviewer.

Citations:

- `apps/web/src/app/[locale]/(public)/page.tsx:116-122`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:84-91`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:120-125`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:79-91`
- `apps/web/src/app/robots.ts:9-24`

Problem: public metadata points to `/api/og...` images, while robots disallows `/api/`. Robots-aware preview systems may skip the primary social image.

Fix direction: allow `/api/og` and `/api/og/photo/` before disallowing the rest of `/api`, or move OG endpoints off `/api`.

### AGG-C19-17 - Fresh installs can publish generic GalleryKit identity into SEO/social surfaces

Severity: Medium
Confidence: High
Sources: product-marketer-reviewer.

Citations:

- `apps/web/src/site-config.json:2-9`
- `apps/web/src/site-config.example.json:2-9`
- `apps/web/src/lib/data.ts:1721-1741`
- `apps/web/src/app/[locale]/layout.tsx:22-58`
- `apps/web/src/app/actions/seo.ts:37-46`
- `apps/web/messages/en.json:453-464`

Problem: if admin SEO settings are left blank, public metadata/nav/footer/feed can ship product-generic identity.

Fix direction: add first-run/admin warning or launch checklist for public identity customization.

### AGG-C19-18 - Public empty gallery state exposes operator instructions to visitors

Severity: Medium
Confidence: High
Sources: product-marketer-reviewer.

Citations:

- `apps/web/src/components/home-client.tsx:424-439`
- `apps/web/messages/en.json:247-248`
- `apps/web/messages/ko.json:247-248`

Problem: public visitors see "Upload photos from the admin dashboard..." when the gallery is empty.

Fix direction: use public-safe copy by default and only show admin CTA when authenticated admin state is available.

### AGG-C19-19 - Similar photos silently disappears on setup/backfill failures

Severity: Medium
Confidence: High
Sources: product-marketer-reviewer.

Citations:

- `apps/web/src/components/similar-photos.tsx:77-104`
- `apps/web/src/app/api/search/similar/[id]/route.ts:96-136`
- `apps/web/src/app/api/search/similar/[id]/route.ts:228-233`
- `apps/web/src/components/search.tsx:196-209`

Problem: similar-photos errors collapse the panel instead of explaining setup/backfill/rate-limit failures.

Fix direction: keep the panel visible and show a concise localized failure/setup state.

### AGG-C19-20 - Mobile photo swipe navigation is registered on `window`

Severity: Medium
Confidence: High
Sources: ui-ux-designer-reviewer, designer.

Citations:

- `apps/web/src/components/photo-navigation.tsx:47-60`
- `apps/web/src/components/photo-navigation.tsx:96-133`
- `apps/web/src/components/photo-viewer.tsx:687-694`

Problem: horizontal gestures that start outside the photo surface can navigate photos and call `preventDefault()`.

Fix direction: scope listeners to the media container or ignore starts outside the image/navigation region.

### AGG-C19-21 - Desktop photo metadata/download/color disclosure is hidden by default

Severity: Medium
Confidence: High
Sources: ui-ux-designer-reviewer, designer.

Citations:

- `apps/web/src/components/photo-viewer.tsx:103-108`
- `apps/web/src/components/photo-viewer.tsx:174-175`
- `apps/web/src/components/photo-viewer.tsx:736-999`

Problem: direct desktop photo links hide download, EXIF, color/HDR notes, histogram, and similar photos behind a generic Info toggle unless the visitor previously pinned info.

Fix direction: default desktop sidebar open, add a persistent summary/download strip, or improve first-run affordance.

### AGG-C19-22 - Admin image management remains a 9-column desktop table on narrow screens

Severity: Medium
Confidence: High
Sources: ui-ux-designer-reviewer, designer.

Citations:

- `apps/web/src/components/image-manager.tsx:421-591`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123-132`

Problem: mobile/tablet admin image management requires horizontal panning across dense columns, separating preview, metadata, tags, and actions.

Fix direction: add a below-`lg` card/list layout and sticky narrow-screen bulk actions.

### AGG-C19-23 - Token revoke dialog can be hidden mid-request via Cancel

Severity: Medium
Confidence: Medium
Sources: designer.

Citations:

- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:75-85`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:240-258`

Problem: `onOpenChange` blocks backdrop/Esc close while pending, but the visible Cancel button can still clear the dialog during an in-flight revoke.

Fix direction: disable Cancel while pending or keep the dialog open with a revoking state until the request settles.

### AGG-C19-24 - Topic slug remains a mutable natural key with manual fan-out

Severity: Medium
Confidence: High
Sources: critic.

Citations:

- `apps/web/src/db/schema.ts:4-33`
- `apps/web/src/db/schema.ts:239-250`
- `apps/web/src/app/actions/topics.ts:255-339`

Problem: renames rely on manual updates to every slug-bearing child store and known JSON remappers. Future tables can be missed.

Fix direction: migrate to stable topic ids or add schema/registry tests for every `topics.slug` FK/remapper.

### AGG-C19-25 - Upload quota settlement remains comment-enforced control flow

Severity: Medium
Confidence: Medium-High
Sources: critic.

Citations:

- `apps/web/src/app/actions/images.ts:238-293`
- `apps/web/src/app/actions/images.ts:536-596`
- `apps/web/src/lib/upload-tracker.ts:19-33`
- `apps/web/src/__tests__/images-action-toctou-claim.test.ts:34-57`

Problem: post-claim upload settlement relies on hand-placed rollbacks and comments around every await. Future edits can leak or mis-settle quota.

Fix direction: centralize in one `try/finally` with claim identity/window tracking and behavior tests.

### AGG-C19-26 - EXIF metadata is visually grouped but semantically flat

Severity: Medium for a11y semantics; Low for sighted behavior
Confidence: High
Sources: critic.

Citations:

- `apps/web/src/components/photo-viewer.tsx:790-825`
- `apps/web/src/components/info-bottom-sheet.tsx:335-375`

Problem: EXIF label/value pairs are rendered as paragraphs instead of definition lists.

Fix direction: render EXIF grids as `<dl>` with `dt`/`dd`.

### AGG-C19-27 - IPv6 clients can rotate public rate-limit buckets

Severity: Low
Confidence: High for gap, Medium for impact
Sources: critic.

Citations:

- `apps/web/src/lib/rate-limit.ts:123-194`
- `apps/web/src/app/api/search/semantic/route.ts:172-183`
- `apps/web/src/app/api/search/similar/[id]/route.ts:84-94`

Problem: exact IPv6 address keys let clients with delegated prefixes rotate source addresses for fresh buckets.

Fix direction: normalize IPv6 public rate-limit keys to a configured prefix such as `/64`.

### AGG-C19-28 - Semantic/similar search decode and score every scanned embedding in process

Severity: Low-Medium
Confidence: High
Sources: perf-reviewer.

Citations:

- `apps/web/src/lib/clip-embeddings.ts:36-44`
- `apps/web/src/lib/clip-embeddings.ts:164-168`
- `apps/web/src/app/api/search/semantic/route.ts:259-303`
- `apps/web/src/app/api/search/similar/[id]/route.ts:142-175`

Problem: semantic/similar scan up to `SEMANTIC_SCAN_LIMIT`, decode vectors, score, sort, and slice on the request thread.

Fix direction: vector index/worker thread/bounded top-K heap and conservative caps.

### AGG-C19-29 - GPS stripping materializes large retained originals in memory

Severity: Low-Medium
Confidence: High
Sources: perf-reviewer.

Citations:

- `apps/web/src/lib/process-image.ts:1737-1818`
- `apps/web/src/lib/gps-exif-strip.ts:222-575`
- `apps/web/src/app/actions/images.ts:383-395`
- `apps/web/src/app/api/admin/lr/upload/route.ts:367-385`

Problem: GPS stripping reads the whole retained original and may copy whole buffers/re-encode.

Fix direction: add a semaphore/stricter guard now; longer term streaming/container segment rewrite.

### AGG-C19-30 - Batch image deletion repeats derivative-directory scans per image and format

Severity: Low-Medium
Confidence: High
Sources: perf-reviewer.

Citations:

- `apps/web/src/app/actions/images.ts:818-842`
- `apps/web/src/lib/process-image.ts:575-664`

Problem: deleting many images can scan derivative directories repeatedly.

Fix direction: scan each derivative directory once for all selected basenames or move historical orphan cleanup to maintenance.

### AGG-C19-31 - Public map can serialize and hydrate up to 10,000 markers and fallback links

Severity: Low-Medium
Confidence: Medium-High
Sources: perf-reviewer.

Citations:

- `apps/web/src/lib/data.ts:1641-1677`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:27-89`
- `apps/web/src/components/map/map-client.tsx:76-143`

Problem: large GPS galleries can ship/hydrate many markers and fallback links.

Fix direction: bbox/paged API, clustering, virtualized fallback list.

### AGG-C19-32 - Timeline/archive predicates use non-sargable date functions

Severity: Low-Medium
Confidence: High
Sources: perf-reviewer.

Citations:

- `apps/web/src/lib/data-timeline.ts:88-207`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:62-84`
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:80-91`

Problem: `MONTH()`, `DAY()`, and `YEAR()` predicates/order expressions scan processed slices.

Fix direction: range predicates for year/month; generated month/day columns for on-this-day.

### AGG-C19-33 - Service-worker cached image hits wait on synchronous HEAD revalidation

Severity: Low-Medium
Confidence: High
Sources: perf-reviewer.

Citations:

- `apps/web/public/sw.template.js:31-38`
- `apps/web/public/sw.template.js:224-286`

Problem: cached image display waits up to 300 ms on HEAD freshness checks.

Fix direction: serve cached bytes immediately and revalidate in background, or coalesce/TTL HEAD probes.

### AGG-C19-34 - Infinite masonry keeps all loaded cards in state and DOM

Severity: Low-Medium
Confidence: High
Sources: perf-reviewer.

Citations:

- `apps/web/src/components/home-client.tsx:124-130`
- `apps/web/src/components/home-client.tsx:286-409`
- `apps/web/src/components/load-more.tsx:41-133`

Problem: long browsing sessions retain all loaded images/cards.

Fix direction: virtualization/windowing or explicit pagination after a cap.

### AGG-C19-35 - Admin dashboard/analytics fanout can consume most of the shared DB pool

Severity: Low-Medium
Confidence: Medium
Sources: perf-reviewer.

Citations:

- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27`
- `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:26-36`
- `apps/web/src/lib/analytics-data.ts:28-208`

Problem: admin pages issue many aggregate queries in parallel against the small shared pool.

Fix direction: cap/sequence low-priority admin aggregate queries or split pool budgets.

### AGG-C19-36 - Admin failed-image list is unbounded

Severity: Low
Confidence: High
Sources: perf-reviewer.

Citations:

- `apps/web/src/lib/data.ts:1000-1013`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27`

Problem: dashboard fetches every permanently failed image row.

Fix direction: limit/paginate, show count + most recent N, and consider an index.

### AGG-C19-37 - Topic image processing writes scratch originals inside public resources tree

Severity: Low
Confidence: Medium
Sources: security-reviewer.

Citations:

- `apps/web/src/lib/process-topic-image.ts:11-26`
- `apps/web/src/lib/process-topic-image.ts:72-90`
- `apps/web/src/lib/process-topic-image.ts:105-119`
- `apps/web/next.config.ts:29-34`
- `apps/web/next.config.ts:102-105`

Problem: crash-orphaned `tmp-*` topic image originals can remain under `public/resources`.

Fix direction: write scratch files to private temp storage, move only final sanitized `.webp` into public resources, and retain legacy cleanup.

### AGG-C19-38 - Nginx config relies on external TLS while listening on cleartext port 80

Severity: Low
Confidence: Medium
Sources: security-reviewer.

Citations:

- `apps/web/nginx/default.conf:21-29`
- `apps/web/nginx/default.conf:48-71`
- `apps/web/docker-compose.yml:14-22`

Problem: if the internal nginx listener is accidentally public, credentials/request bodies can traverse HTTP.

Fix direction: bind to loopback/private interface, firewall public port 80, redirect HTTP at public edge, or terminate TLS if nginx is edge.

### AGG-C19-39 - Repo-local deploy secret file is default path

Severity: Low
Confidence: High
Sources: security-reviewer.

Citations:

- `.env.deploy.example:1-4`
- `.gitignore:18-21`
- `scripts/deploy-remote.sh:22-29`
- `scripts/deploy-remote.sh:61-72`
- `apps/web/src/__tests__/tracked-secrets.test.ts:28-58`

Problem: default deploy docs prefer an ignored repo-local secret file over the supported external secrets directory.

Fix direction: prefer `$HOME/.gallerykit-secrets/gallery-deploy.env` by default or warn on repo-local use.

### AGG-C19-40 - Deploy env can override shell commands without a separate guard

Severity: Low
Confidence: Medium
Sources: security-reviewer.

Citations:

- `.env.deploy.example:11-14`
- `scripts/deploy-remote.sh:31-72`

Problem: deploy env is executable configuration via `DEPLOY_REMOTE_SCRIPT` and `DEPLOY_CMD` without a second acknowledgement.

Fix direction: require an explicit guard before honoring custom command overrides.

### AGG-C19-41 - Upload-serving route handlers lack explicit Node runtime pin

Severity: Low
Confidence: High
Sources: debugger.

Citations:

- `apps/web/src/app/uploads/[...path]/route.ts:1-27`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:1-22`
- `apps/web/src/lib/serve-upload.ts:1-5`
- `apps/web/src/lib/serve-upload.ts:127-296`
- `apps/web/src/app/api/admin/db/download/route.ts:17-20`

Problem: upload serving imports Node-only file/stream modules but route files do not explicitly pin `runtime = 'nodejs'`.

Fix direction: add runtime pins and a lightweight source guard.

### AGG-C19-42 - Public numeric route params accept huge unsafe integers

Severity: Low
Confidence: Medium
Sources: debugger.

Citations:

- `apps/web/src/app/api/search/similar/[id]/route.ts:73-82`
- `apps/web/src/app/api/og/photo/[id]/route.tsx:51-59`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:40-52`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:132-140`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:98-103`
- `apps/web/src/lib/validation.ts:166-191`

Problem: regex + `parseInt()` accepts arbitrarily large digit strings that round beyond `Number.MAX_SAFE_INTEGER`.

Fix direction: centralize safe public ID parsing and add huge-ID regressions.

### AGG-C19-43 - Semantic/CLIP operational env inventory is incomplete

Severity: Low
Confidence: High
Sources: document-specialist.

Citations:

- `CLAUDE.md:88-112`
- `CLAUDE.md:540-544`
- `apps/web/README.md:62-64`
- `apps/web/.env.local.example:70-75`
- `apps/web/src/lib/clip-model.ts:53-64`
- `apps/web/src/lib/clip-embeddings.ts:22-44`

Problem: env docs omit `CLIP_INFERENCE_MAX_PENDING`, `CLIP_INFERENCE_QUEUE_TIMEOUT_MS`, and table entries/examples for semantic scan/top-K caps.

Fix direction: document defaults/caps in CLAUDE env table and `.env.local.example`.

### AGG-C19-44 - Sidecar runbook pins stale `tsx@4.21.0`

Severity: Low
Confidence: High
Sources: document-specialist.

Citations:

- `CLAUDE.md:340-353`
- `CLAUDE.md:503-527`
- `apps/web/package.json:80-84`

Problem: runbook sidecar commands use `tsx@4.21.0`; package.json and npm latest are `4.22.4`.

Fix direction: update runbook commands or document use of package.json version.

### AGG-C19-45 - Generated service worker comment becomes false after stamping

Severity: Low
Confidence: High
Sources: document-specialist.

Citations:

- `apps/web/public/sw.template.js:21-26`
- `apps/web/public/sw.js:21-26`
- `apps/web/scripts/build-sw.ts:36-43`
- `apps/web/src/__tests__/sw-template-contract.test.ts:28-35`

Problem: template comment says `__SW_VERSION__ is replaced...`; generated `sw.js` then says the concrete version string is replaced.

Fix direction: change template wording so generated comment remains true, then regenerate `sw.js`.

### AGG-C19-46 - On-this-day date behavior lacks clock-injected behavior tests

Severity: Low-Medium
Confidence: High
Sources: test-engineer.

Citations:

- `apps/web/src/components/on-this-day-widget.tsx:14-23`
- `apps/web/src/__tests__/data-timeline.test.ts:49-200`

Problem: widget month/day comes from `new Date()` but tests source-check query shapes and inline copies rather than a clock-controlled component/helper.

Fix direction: extract a date resolver or inject clock and add boundary tests.

### AGG-C19-47 - Nav "visual" Playwright checks save screenshots but do not compare them

Severity: Low
Confidence: High
Sources: test-engineer.

Citations:

- `apps/web/e2e/nav-visual-check.spec.ts:6-79`

Problem: tests named visual checks only save screenshots and assert metrics, giving false visual-regression confidence.

Fix direction: add `toHaveScreenshot` baselines or rename/comment as layout smoke tests.

### AGG-C19-48 - Timeline sticky month headings can slide under sticky nav

Severity: Low-Medium
Confidence: Medium
Sources: designer.

Citations:

- `apps/web/src/components/nav-client.tsx:84-88`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:204-208`

Problem: both global nav and timeline month headings use `top-0`; the month heading has lower z-index.

Fix direction: offset month headings by nav height or a CSS variable.

### AGG-C19-49 - Touch-target governance still carries admin compact-control budgets

Severity: Low
Confidence: High
Sources: designer.

Citations:

- `apps/web/src/components/ui/button.tsx:23-30`
- `apps/web/src/__tests__/touch-target-audit.test.ts:151-245`
- `apps/web/src/components/image-manager.tsx:335-338`

Problem: current runtime is safe, but documented compact-control budgets remain a future regression surface.

Fix direction: retire budgets or replace with measured layout target-size tests.

### AGG-C19-50 - README sells technical power before showing the product experience

Severity: Low
Confidence: High
Sources: product-marketer-reviewer.

Citations:

- `README.md:7-40`
- `README.md:106`

Problem: README leads with dense technical features and lacks screenshots/first-run checklist.

Fix direction: add product proof screenshots and first-10-minutes launch checklist near the top.

### AGG-C19-51 - Cycle 18 plan status/index is stale

Severity: Low
Confidence: High
Sources: verifier.

Citations:

- `plan/plan-374-cycle18-fixes.md:1-8`
- `plan/plan-374-cycle18-fixes.md:12-59`
- `.context/plans/README.md:3-6`

Problem: cycle 18 implementation plan is still marked TODO even though all scheduled items are implemented and current HEAD contains those changes.

Fix direction: mark the plan done/archive it and update `.context/plans/README.md`; keep cycle 18 deferred ledger active.

## Cross-Agent Agreement

Highest-signal items due to repeated independent reports:

- AGG-C19-06 CLIP abort-insensitive queue: verifier, test-engineer, tracer.
- AGG-C19-07 semantic rate-limit docs/tests drift: verifier, test-engineer, tracer, critic.
- AGG-C19-05 scanner alias bypass: code-reviewer and tracer.
- AGG-C19-04 photo accessible naming: designer and ui-ux-designer-reviewer.
- AGG-C19-20/21/22 UI workflow issues: designer and ui-ux-designer-reviewer.
- AGG-C19-02 duplicate upload ingest: architect, critic, and tracer negative-trace context.

## Agent Failures

None. The native thread limit required staggered spawning, but every requested/discovered reviewer returned a report.

## Final Sweep

The aggregate preserves every finding from the per-agent reports. Prompt 2 must either schedule each finding for implementation or explicitly record it as deferred with original severity/confidence, reason, and exit criterion. Security, correctness, and data-loss findings are not deferrable unless a repo rule explicitly permits deferral.
