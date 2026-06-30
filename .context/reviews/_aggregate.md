# Cycle 20 Aggregate Review

Date: 2026-06-30 KST  
Baseline HEAD at review start: `5c55b68c` (`docs(clip): clarify semantic search operations`)  
Current HEAD during aggregation: `24c82c71` (`docs(reviews): add cycle 20 perf review`)

## Review Fan-Out

Returned review lanes:

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
- `product-marketer-reviewer.md`

Agent retry notes:

- The first `test-engineer` spawn hit the native agent thread limit and was retried after a slot opened; the retry succeeded.
- No reviewer lane failed after retry.
- The `perf-reviewer` lane committed and pushed its review artifact as `24c82c71`; that signed commit is retained as cycle work.

## Aggregate Findings

### AGG-C20-01 - DB child-process SIGKILL fallback is inert after SIGTERM

Severity: High  
Confidence: High  
Sources: debugger, critic  
Status: Confirmed

Citations:

- `apps/web/src/app/[locale]/admin/db-actions.ts:36-57`
- `apps/web/src/app/[locale]/admin/db-actions.ts:217-224`
- `apps/web/src/app/[locale]/admin/db-actions.ts:629-631`
- `apps/web/src/app/[locale]/admin/db-actions.ts:720-724`

Problem: the backup/restore watchdog sends `SIGTERM`, then checks `child.killed` before sending `SIGKILL`. In Node, `child.killed` only means a signal was sent, not that the child exited, so a wedged `mysql`, `mysqldump`, or migration can survive the grace period.

Fix direction: track observed `exit`/`close` state and send `SIGKILL` unless the process actually settled. Add a regression proving timeout triggers `SIGTERM` and a later `SIGKILL` when no exit is observed.

### AGG-C20-02 - GA-disabled privacy copy omits first-party analytics disclosure

Severity: High  
Confidence: High  
Sources: product-marketer-reviewer, prior cycle/product context  
Status: Confirmed

Citations:

- `apps/web/src/app/[locale]/(public)/privacy/page.tsx:13-25`
- `apps/web/messages/en.json:783-791`
- `apps/web/messages/ko.json:783-791`
- `apps/web/src/app/actions/public.ts:351-389`
- `apps/web/src/app/actions/public.ts:397-420`
- `apps/web/src/app/actions/public.ts:428-455`
- `apps/web/src/db/schema.ts:220-263`

Problem: when Google Analytics is disabled, the privacy page only says GA is not configured even though GalleryKit still stores first-party photo/topic/share view analytics fields.

Fix direction: make both GA-enabled and GA-disabled privacy copy disclose first-party view analytics, including retained fields and no full-IP storage.

### AGG-C20-03 - Live keyword search fails for normal tag/person queries

Severity: High  
Confidence: High for user-visible failure; Medium for root cause  
Sources: designer  
Status: Confirmed on live target

Citations:

- `apps/web/src/components/search.tsx`
- `apps/web/src/app/actions/public.ts`
- Live route evidence in `designer.md`: `https://gallery.atik.kr/en`, search query `JIHOON`, one `POST /en` server-action request, no results list, generic error.

Problem: live keyword search failed for a normal text query while semantic search returned results for the same interaction surface.

Fix direction: reproduce with route/action logs or local seeded data, fix the keyword search action/UI error path, and add browser or action-level coverage for a normal tag/person query.

### AGG-C20-04 - Smart-collection load-more refunds rate limit after DB work

Severity: Medium  
Confidence: High  
Sources: security-reviewer, debugger, critic  
Status: Confirmed

Citations:

- `apps/web/src/app/actions/public.ts:197-211`
- `apps/web/src/lib/rate-limit.ts:24-57`

Problem: `loadMoreSmartCollectionImages` pre-increments the public load-more limiter, performs a DB-backed smart-collection lookup, then refunds missing/private slugs. This makes attacker-controlled lookup work cheaper than successful requests.

Fix direction: keep attempts charged after `getSmartCollectionBySlugCached()` runs. Add a regression proving missing/private smart-collection slugs do not call rollback after the lookup.

### AGG-C20-05 - Docker build-time configuration can diverge from runtime `.env.local`

Severity: Medium  
Confidence: High  
Sources: architect, critic, verifier  
Status: Confirmed

Citations:

- `apps/web/docker-compose.yml:4-21`
- `apps/web/deploy.sh:15-31`
- `apps/web/Dockerfile:64-70`
- `apps/web/next.config.ts:28-105`
- `apps/web/src/lib/upload-limits.ts:19-33`
- `apps/web/.env.local.example:12-47`

Problem: deploy validates `apps/web/.env.local` and gives it to the runtime container, but Compose build args come from shell interpolation. Build-time values such as `IMAGE_BASE_URL` and `NEXT_UPLOAD_BODY_MAX_BYTES` can differ from runtime values.

Fix direction: make one deploy env source authoritative, preferably by passing `--env-file apps/web/.env.local` to Compose and wiring all build-time keys through Compose/Docker. Add a contract test.

### AGG-C20-06 - Upload ingest has multiple implementation owners

Severity: Medium  
Confidence: High  
Sources: code-reviewer, architect, critic, verifier  
Status: Confirmed

Citations:

- `apps/web/src/app/actions/images.ts:114-190`
- `apps/web/src/app/actions/images.ts:340-531`
- `apps/web/src/app/actions/images.ts:1227-1280`
- `apps/web/src/app/api/admin/lr/upload/route.ts:15-18`
- `apps/web/src/app/api/admin/lr/upload/route.ts:225-275`
- `apps/web/src/app/api/admin/lr/upload/route.ts:307-516`
- `apps/web/src/lib/image-queue.ts:92-120`

Problem: browser upload, Lightroom/API upload, and retry processing manually construct one ingest lifecycle and queue job. Past parity tests show this contract has drifted before.

Fix direction: extract a server-only ingest service/builder that owns config snapshots, original-save gates, image insert DTOs, and queue jobs. Keep routes/actions as thin adapters.

### AGG-C20-07 - Image processing jobs can pin most of the shared MySQL pool during Sharp work

Severity: Medium  
Confidence: High  
Sources: perf-reviewer, critic  
Status: Confirmed operational/performance issue

Citations:

- `apps/web/src/db/index.ts:23-38`
- `apps/web/src/lib/image-queue.ts:87-90`
- `apps/web/src/lib/image-queue.ts:446-463`
- `apps/web/src/lib/image-queue.ts:513-637`
- `apps/web/src/lib/image-queue.ts:812-815`

Problem: queue jobs hold pooled advisory-lock connections across CPU/file-heavy Sharp processing. With `QUEUE_CONCURRENCY=8`, eight of ten shared pool connections can be pinned.

Fix direction: use a durable short DB claim, a dedicated lock pool, or a pool-budget-derived concurrency cap like admin backfill uses.

### AGG-C20-08 - CLIP production backfill docs over-promise one-command full corpus backfill

Severity: Medium  
Confidence: High  
Sources: document-specialist, critic, perf-reviewer  
Status: Confirmed

Citations:

- `apps/web/README.md:68-77`
- `CLAUDE.md:520-535`
- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:43-47`
- `apps/web/scripts/backfill-clip-embeddings.ts:116-120`

Problem: the activation runbooks imply one forced production backfill covers existing photos, but the script stops each run at `SEMANTIC_SCAN_LIMIT` and must be rerun for larger corpora.

Fix direction: document the per-run cap and repeat-until-empty stop condition, or add an all-batches mode.

### AGG-C20-09 - `SEMANTIC_TOP_K_MAX` default is stale in env reference docs

Severity: Low  
Confidence: High  
Sources: document-specialist, critic  
Status: Confirmed

Citations:

- `CLAUDE.md:115-116`
- `CLAUDE.md:545-548`
- `apps/web/.env.local.example:78-79`
- `apps/web/src/lib/clip-embeddings.ts:22-44`
- `apps/web/src/__tests__/clip-semantic-limits-env.test.ts:30-40`

Problem: docs/example say default top-K cap is 24 while code and tests use 50.

Fix direction: align docs/examples to 50 or intentionally change code/tests to 24.

### AGG-C20-10 - Semantic rollback comments contradict current charged route policy

Severity: Low-Medium  
Confidence: High  
Sources: verifier, test-engineer, tracer, critic  
Status: Confirmed documentation/contract drift

Citations:

- `apps/web/src/lib/rate-limit.ts:24-34`
- `apps/web/src/lib/rate-limit.ts:374-377`
- `apps/web/src/app/api/search/semantic/route.ts:12-17`
- `apps/web/src/__tests__/semantic-search-route.test.ts:232-267`
- `apps/web/src/__tests__/similar-route.test.ts:167-184`

Problem: route code/tests intentionally keep disabled mode and query-length rejections charged after route admission, while shared comments still describe refunds for short queries and disabled mode.

Fix direction: update shared comments to match tested route policy.

### AGG-C20-11 - Render-time analytics may count prefetches instead of committed views

Severity: Medium  
Confidence: Medium  
Sources: code-reviewer, architect, critic, verifier  
Status: Likely issue needing runtime validation

Citations:

- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:154-156`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:284-292`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-164`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:127-132`
- `apps/web/src/components/photo-viewer.tsx:238-264`
- `apps/web/src/components/photo-navigation.tsx:220-242`
- `apps/web/src/app/actions/public.ts:371-456`

Problem: photo/topic/share analytics writes happen during server render while the photo UI prefetches adjacent routes.

Fix direction: move analytics to a committed client-visible view boundary, or add a prefetch guard and a regression proving prefetch does not mutate analytics.

### AGG-C20-12 - Similar-photo route ignores request aborts during bounded vector work

Severity: Low-Medium  
Confidence: Medium-High  
Sources: tracer, critic, verifier  
Status: Likely resource-waste issue

Citations:

- `apps/web/src/app/api/search/semantic/route.ts:247-260`
- `apps/web/src/app/api/search/similar/[id]/route.ts:60-238`
- `apps/web/src/app/api/search/similar/[id]/route.ts:140-175`
- `apps/web/src/lib/clip-embeddings.ts:36-44`
- `apps/web/src/components/similar-photos.tsx:69-90`

Problem: semantic text search checks `request.signal` around expensive phases, but similar-photo search proceeds through lookup, scan, decode/score/sort, and enrichment even if the client disconnects.

Fix direction: mirror the semantic abort helper in the similar route and add route coverage for already-aborted requests.

### AGG-C20-13 - Behavior-critical route/UI/queue fixes rely too heavily on source-contract tests

Severity: Medium  
Confidence: High  
Sources: test-engineer, verifier, critic  
Status: Confirmed coverage gap

Citations:

- `apps/web/src/__tests__/clip-model-contract.test.ts:32-50`
- `apps/web/src/__tests__/cycle-19-source-contracts.test.ts:27-54`
- `apps/web/src/__tests__/og-photo-fallback.test.ts:40-87`
- `apps/web/e2e/public.spec.ts:61-83`
- `apps/web/e2e/test-fixes.spec.ts:49-75`

Problem: CLIP queue aborts, bulk-edit reset, swipe scoping, zoom accessible names, and OG route glue are mostly guarded by source text, not runtime behavior.

Fix direction: add behavior tests for queue saturation/abort, bulk-edit submit/reopen reset, mobile swipe scoping, zoom accessible names, and mocked OG route responses.

### AGG-C20-14 - Topic OG route splits unbounded `tags` query before limiting output

Severity: Low-Medium  
Confidence: Medium  
Sources: security-reviewer, debugger  
Status: Likely; depends on request-line limits

Citations:

- `apps/web/src/app/api/og/route.tsx:35-39`
- `apps/web/src/app/api/og/route.tsx:84-88`

Problem: output is capped to 20 rendered tags, but `tags.split(',')` allocates for the entire query value first.

Fix direction: reject excessive query length or parse only until 20 candidates.

### AGG-C20-15 - Forwarded client IP is spoofable under direct nginx exposure or preserved incoming XFF

Severity: Medium  
Confidence: Medium  
Sources: security-reviewer  
Status: Deploy-hardening risk

Citations:

- `apps/web/nginx/default.conf`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/request-ip.ts`

Problem: rate limits rely on forwarded client IP correctness. If nginx is directly exposed and preserves incoming `X-Forwarded-For`, callers may influence the apparent client IP.

Fix direction: configure edge/nginx to overwrite, not append/trust arbitrary inbound `X-Forwarded-For`, and document/test the expected header contract.

### AGG-C20-16 - Backup download validation is path-backed, not descriptor-backed

Severity: Low  
Confidence: Medium  
Sources: security-reviewer, debugger  
Status: Residual local-operator risk

Citations:

- `apps/web/src/app/api/admin/db/download/route.ts:50-84`

Problem: the route validates a backup path, then later opens a stream by path. Same-host replacement between validation and open could desync `Content-Length` and bytes.

Fix direction: validate and stream from one file descriptor with `open`/`fstat`.

### AGG-C20-17 - Single-image delete can report success after deleting zero rows

Severity: Low  
Confidence: Medium  
Sources: debugger  
Status: Confirmed race, low impact

Citations:

- `apps/web/src/app/actions/images.ts:645-720`

Problem: if two admins delete the same image concurrently, the second action can delete zero rows but still clean files/revalidate and return success.

Fix direction: return stale/not-found on `deletedRows === 0` and skip cleanup/revalidation.

### AGG-C20-18 - Audit retention purge is a single unbounded DELETE

Severity: Low  
Confidence: High  
Sources: debugger  
Status: Confirmed operational risk

Citations:

- `apps/web/src/lib/audit.ts:97-122`
- `apps/web/src/lib/view-retention.ts:31-83`

Problem: audit retention deletes all old rows in one statement, unlike the established chunked view-retention pattern.

Fix direction: chunk audit deletes with a per-run cap.

### AGG-C20-19 - Failed restore can leave maintenance active without an evident recovery path

Severity: Medium operational risk  
Confidence: Medium  
Sources: debugger, critic  
Status: Risk needing validation

Citations:

- `apps/web/src/app/[locale]/admin/db-actions.ts:440-462`
- `apps/web/src/app/[locale]/admin/db-actions.ts:618-628`
- `apps/web/src/app/[locale]/admin/db-actions.ts:650-679`
- `apps/web/src/lib/restore-maintenance.ts:44-56`

Problem: fail-closed restore maintenance is defensible, but no explicit in-app recovery path was evident.

Fix direction: validate UI/runbook recovery. If absent, add a strongly warned operator recovery action or document manual recovery.

### AGG-C20-20 - Public listing/smart-collection pages combine tag aggregation with `COUNT(*) OVER()`

Severity: Medium  
Confidence: High  
Sources: perf-reviewer  
Status: Confirmed scale issue

Citations:

- `apps/web/src/lib/data.ts:878-907`
- `apps/web/src/lib/data.ts:1417-1461`

Problem: initial listing paths return a small page but ask MySQL to join/group/sort/count the full matching set.

Fix direction: split ID page lookup from tag fetch, use lookahead instead of exact hot-path totals, or cache counts.

### AGG-C20-21 - Public keyword search uses leading-wildcard scans after admission

Severity: Medium  
Confidence: High  
Sources: perf-reviewer  
Status: Confirmed scale issue

Citations:

- `apps/web/src/lib/data.ts:1490-1563`
- `apps/web/src/lib/data.ts:1601-1621`

Problem: admitted public keyword searches use `%term%` patterns across several fields and may run tag/topic fallback scans.

Fix direction: move to indexed full-text/search table/search service, or tighten short-query/fallback rules.

### AGG-C20-22 - Semantic/similar search brute-force vector scoring runs on the request thread

Severity: Low-Medium  
Confidence: High  
Sources: perf-reviewer  
Status: Confirmed bounded performance issue

Citations:

- `apps/web/src/lib/clip-embeddings.ts:36-44`
- `apps/web/src/lib/clip-embeddings.ts:164-168`
- `apps/web/src/app/api/search/semantic/route.ts:263-307`
- `apps/web/src/app/api/search/similar/[id]/route.ts:140-175`

Problem: bounded scans still decode, score, and sort embeddings inside the Next.js request process.

Fix direction: keep limits conservative, use a fixed-size top-K heap, move work to a worker, or add ANN/vector indexing.

### AGG-C20-23 - GPS stripping can materialize large originals and scrubbed copies in memory

Severity: Low-Medium  
Confidence: High  
Sources: perf-reviewer  
Status: Confirmed bounded memory issue

Citations:

- `apps/web/src/lib/process-image.ts:1737-1792`
- `apps/web/src/app/actions/images.ts:382-395`
- `apps/web/src/app/api/admin/lr/upload/route.ts:367-385`

Problem: GPS stripping reads whole originals and may allocate a second scrubbed buffer plus Sharp native memory.

Fix direction: add a process-wide GPS-strip semaphore/size guard; longer term, stream/container-rewrite lossless stripping.

### AGG-C20-24 - Batch deletion repeats derivative-directory scans per image and format

Severity: Low-Medium  
Confidence: High  
Sources: perf-reviewer  
Status: Confirmed scale issue

Citations:

- `apps/web/src/lib/process-image.ts:575-627`
- `apps/web/src/app/actions/images.ts:818-842`

Problem: bulk delete can scan three derivative directories once per selected image.

Fix direction: add a batch cleanup helper that scans each derivative directory once for all selected basenames.

### AGG-C20-25 - High-cardinality map and masonry paths hydrate too much UI

Severity: Low-Medium  
Confidence: High for code path; Medium for production impact  
Sources: perf-reviewer, critic  
Status: Confirmed/likely scale issue

Citations:

- `apps/web/src/lib/data.ts:1649-1685`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:38-89`
- `apps/web/src/components/map/map-client.tsx:76-140`
- `apps/web/src/components/home-client.tsx:124-130`
- `apps/web/src/components/home-client.tsx:286-410`
- `apps/web/src/components/load-more.tsx:41-132`

Problem: `/map` can serialize and hydrate 10,000 markers/fallback links, and infinite masonry leaves every loaded card in state/DOM.

Fix direction: cluster/page map data and virtualize/cap masonry loaded history.

### AGG-C20-26 - Timeline/archive predicates use non-sargable date functions

Severity: Low-Medium  
Confidence: High  
Sources: perf-reviewer  
Status: Confirmed scale issue

Citations:

- `apps/web/src/lib/data-timeline.ts`
- Timeline/year query regions cited in `perf-reviewer.md`

Problem: date functions can prevent efficient index use on timeline/archive paths.

Fix direction: rewrite to range predicates where feasible.

### AGG-C20-27 - Service-worker cached image hits wait on synchronous HEAD revalidation

Severity: Low-Medium  
Confidence: High  
Sources: perf-reviewer  
Status: Confirmed bounded performance issue

Citations:

- `apps/web/public/sw.template.js`
- `apps/web/public/sw.js`

Problem: warm cached derivative hits still wait on a bounded synchronous HEAD probe.

Fix direction: use RUM/WebPageTest evidence before changing; consider background-only revalidation for slow links.

### AGG-C20-28 - Admin dashboard/analytics parallel fanout can consume much of the shared pool

Severity: Low-Medium  
Confidence: Medium  
Sources: perf-reviewer  
Status: Confirmed potential pool pressure

Citations:

- Admin dashboard/analytics regions cited in `perf-reviewer.md`

Problem: dashboard analytics fanout can occupy many of the ten shared MySQL pool connections.

Fix direction: profile production latency and sequence/cache low-priority panels if needed.

### AGG-C20-29 - CSV export materializes up to 50,000 rows and duplicates payload in browser

Severity: Low-Medium  
Confidence: High  
Sources: perf-reviewer  
Status: Confirmed scale issue

Citations:

- CSV export regions cited in `perf-reviewer.md`

Problem: large CSV exports build row arrays and browser blobs rather than streaming.

Fix direction: stream server-side or lower limits if production memory evidence warrants.

### AGG-C20-30 - Mobile collapsed nav clips topic links while hiding utility actions

Severity: Medium  
Confidence: High  
Sources: designer  
Status: Confirmed by live browser evidence

Citations:

- `apps/web/src/components/header.tsx`
- Live route evidence in `designer.md`: 390 x 844 collapsed nav metrics and screenshots.

Problem: on mobile, collapsed nav exposes clipped topic links while search/theme/language are hidden until expansion.

Fix direction: prioritize utility actions in collapsed mobile nav and avoid clipped horizontal topic scrollers.

### AGG-C20-31 - Home masonry auto-prefetches many visible photo detail routes

Severity: Medium  
Confidence: High  
Sources: designer  
Status: Confirmed by live network evidence

Citations:

- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/photo-card.tsx`
- `apps/web/src/components/load-more.tsx`
- Live evidence in `designer.md`: initial home render triggered many RSC prefetch requests for photo detail/topic routes.

Problem: initial home page render prefetches many visible photo detail routes before user intent, adding network/CPU pressure and interacting badly with render-time analytics risk.

Fix direction: disable detail prefetch on dense masonry cards; prefetch only on explicit hover/focus/near intent where useful.

### AGG-C20-32 - Desktop photo pages hide metadata, color details, similar photos, and downloads by default

Severity: Medium  
Confidence: High  
Sources: designer  
Status: Confirmed by live browser evidence

Citations:

- `apps/web/src/components/photo-viewer.tsx:750`
- Live evidence in `designer.md`: `https://gallery.atik.kr/en/p/348`, desktop accessibility/DOM probes.

Problem: desktop photo pages default to an immersive state where key photo context and download affordances are hidden behind the info panel.

Fix direction: default the desktop sidebar open for direct photo pages, or surface a compact persistent summary/download strip.

### AGG-C20-33 - Privacy copy claims a persisted client fingerprint that code does not store

Severity: Medium  
Confidence: High  
Sources: product-marketer-reviewer  
Status: Confirmed

Citations:

- `apps/web/messages/en.json:787-789`
- `apps/web/messages/ko.json:787-789`
- `apps/web/src/app/actions/public.ts:330-360`
- `apps/web/src/db/schema.ts:224-258`
- `apps/web/src/lib/analytics.ts:1-11`

Problem: GA-enabled privacy copy says GalleryKit stores a short client fingerprint, but persisted analytics rows do not include such a field.

Fix direction: remove or reword the fingerprint claim.

### AGG-C20-34 - Checked-in demo-domain config can become a fresh install canonical URL

Severity: Medium  
Confidence: High  
Sources: product-marketer-reviewer  
Status: Confirmed risk

Citations:

- `apps/web/src/site-config.json:2-10`
- `apps/web/scripts/ensure-site-config.mjs:11-42`
- `apps/web/src/app/[locale]/layout.tsx:17-58`
- `apps/web/src/app/sitemap.ts:14-91`
- `apps/web/src/app/robots.ts:1-23`

Problem: tracked runtime config uses `gallery.atik.kr`; fresh downstream installs that do not replace it can publish the demo domain as canonical.

Fix direction: add stronger fresh-install warnings/guards or make production require an explicitly customized config outside this deployment repo's target.

### AGG-C20-35 - Generic GalleryKit identity flows into public SEO/PWA/feed defaults

Severity: Medium  
Confidence: High  
Sources: product-marketer-reviewer  
Status: Confirmed risk

Citations:

- `apps/web/src/site-config.json:2-10`
- `apps/web/src/site-config.example.json:2-10`
- `apps/web/src/lib/data.ts:1729-1750`
- `apps/web/src/app/actions/seo.ts:26-46`
- `apps/web/messages/en.json:443-471`
- `apps/web/src/app/[locale]/layout.tsx:17-58`
- `apps/web/src/app/manifest.ts:6-52`
- `apps/web/src/components/footer.tsx:26-37`
- `apps/web/src/app/feed.xml/route.ts:76-123`

Problem: empty DB SEO settings fall back to generic product identity, while admin copy says fields can be left empty for defaults without showing what those defaults are.

Fix direction: surface actual defaults in admin copy or require install-specific branding before production.

### AGG-C20-36 - README proves engineering depth before product experience

Severity: Low  
Confidence: High  
Sources: product-marketer-reviewer  
Status: Confirmed

Citations:

- `README.md:1-208`

Problem: the README leads with implementation details rather than visitor/admin outcomes, screenshots, privacy checklist, or first-run experience.

Fix direction: add a concise product walkthrough, screenshots, and setup success criteria.

### AGG-C20-37 - Single-photo share pages bypass current analytics event recording

Severity: Low-Medium  
Confidence: Medium  
Sources: tracer  
Status: Likely analytics correctness gap; product intent should confirm

Citations:

- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:80-137`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:154-156`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:127-132`
- `apps/web/src/lib/analytics-data.ts:28-54`
- `apps/web/src/lib/analytics-data.ts:148-154`

Problem: canonical photo pages record `image_views`, shared groups record group views, but single-photo `/s/[key]` pages render without recording photo or share analytics.

Fix direction: decide whether `/s/[key]` should count as a photo view. If yes, record it after image resolution; if not, document and test the exclusion.

### AGG-C20-38 - CLIP script-local sidecar example is stale relative to the main runbook

Severity: Low  
Confidence: Medium  
Sources: document-specialist  
Status: Likely doc drift

Citations:

- `apps/web/scripts/backfill-clip-embeddings.ts:9-21`
- `CLAUDE.md:520-532`

Problem: the script-local comment has a sidecar example that drifts from the authoritative runbook.

Fix direction: replace the script comment with a pointer to `CLAUDE.md` or align the command.

### AGG-C20-39 - "Lightroom Classic publish plugin" wording survives in code comments/copy

Severity: Low  
Confidence: Medium  
Sources: document-specialist  
Status: Likely doc drift

Citations:

- `README.md:40`
- `CLAUDE.md:158`
- `CLAUDE.md:572`
- `apps/web/src/db/schema.ts:192-197`
- `apps/web/drizzle/0006_admin_tokens.sql:1-6`
- `apps/web/nginx/default.conf:123-131`
- `apps/web/messages/en.json:816`

Problem: some comments/copy still imply a bundled Lightroom Classic plugin, while current docs say the repo ships the server API only.

Fix direction: normalize wording to "Lightroom-compatible publish API / external publish clients."

### AGG-C20-40 - Plan index status may mislead future cycles

Severity: Low  
Confidence: Medium  
Sources: document-specialist, critic  
Status: Process/documentation risk

Citations:

- `.context/plans/README.md:3-57`

Problem: older deferred/TODO plan entries lack clear `active`, `superseded`, `closed-by`, or `needs-revalidation` status.

Fix direction: curate the plan index before using it as a backlog source.

### AGG-C20-41 - Nav visual checks create screenshots but do not compare them

Severity: Low  
Confidence: High  
Sources: test-engineer  
Status: Confirmed false-confidence risk

Citations:

- `apps/web/e2e/nav-visual-check.spec.ts:6-79`

Problem: the spec writes screenshots but does not compare them to baselines.

Fix direction: either add stable `toHaveScreenshot` assertions or rename/comment the spec as a layout smoke test.

## Counts

- Aggregate findings: 41
- High: 3
- Medium / Low-Medium: 26
- Low: 12
- Cross-agent agreement on highest-signal items: backup watchdog, privacy disclosure, smart-collection limiter, Docker env split, upload ingest duplication, render-time analytics, behavior-test gaps.
