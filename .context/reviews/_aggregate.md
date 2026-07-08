# Cycle 24 Aggregate Review

Date: 2026-07-08 KST
Review start HEAD: `0f3e48e044bf0e6a8019f8910dd649d706a9e91b`
Latest review HEAD observed: `4b43fad7ab471287b82fe5c8dac85c05c511220a`

## Review Lanes

Completed: `code-reviewer`, `perf-reviewer`, `security-reviewer`, `critic`, `verifier`, `test-engineer`, `tracer`, `architect`, `debugger`, `document-specialist`, `designer`, `product-marketer-reviewer`.

Agent failures: none.

Notes:

- The native subagent tool exposed only `worker`/`explorer`/`default`; requested specialist lanes were run as worker subagents with explicit lane prompts.
- The live thread cap required capped waves rather than all lanes running at once.
- `perf-reviewer` committed/pushed its review artifact as `4b43fad7`; the rest of the review lanes left review-file edits in the shared worktree.

## Aggregate Findings

### AGG-C24-01 - Large browser upload and DB restore Server Actions parse multipart bodies before app backpressure

Severity: High
Confidence: High
Agreement: `perf-reviewer`, `debugger`, `tracer`
Status: confirmed source shape; live RSS impact needs measurement.

Citations: `apps/web/next.config.ts:111-119`; `apps/web/src/app/actions/images.ts:87-106`, `154-159`, `197-221`; `apps/web/src/app/[locale]/admin/db-actions.ts:421-427`, `745-767`; safer contrast in `apps/web/src/app/api/admin/lr/upload/route.ts:101-187`.

Problem: the browser upload and restore Server Actions receive already-materialized `FormData` before app-level restore locks, upload contract locks, quota checks, and disk admission can reject or serialize the body.

Failure scenario: near-limit browser uploads and a restore upload arrive concurrently. Next/Node accepts/parses large multipart bodies before the application can reject for lock contention or quota, producing RSS/GC pressure or OOM on the single container.

Suggested fix: move large browser upload and DB restore ingress to Node route handlers with pre-parse `Content-Length`, admission slots, and streaming-to-temp-file behavior; keep Server Actions as thin shims if needed. Short-term, run an on-host RSS trace.

### AGG-C24-02 - Background DB/CPU producers have independent budgets and can oversubscribe the shared host

Severity: High
Confidence: High for source design, Medium for production threshold
Agreement: `perf-reviewer`, `debugger`, `tracer`, `architect`, `critic`, `code-reviewer`
Status: confirmed architecture/performance issue.

Citations: `apps/web/src/db/index.ts:31-41`; `apps/web/src/lib/image-queue.ts:121-153`, `447-456`; `apps/web/src/lib/admin-backfill-runner.ts:97-143`, `716-727`; `apps/web/src/lib/background-db-writes.ts:3-10`, `42-64`; `apps/web/src/lib/clip-model.ts:53-72`, `156-173`.

Problem: image processing, in-app backfill, analytics writes, semantic/CLIP work, and maintenance each enforce local limits, but no shared process-wide DB/CPU admission budget reserves foreground capacity.

Failure scenario: uploads process while an admin backfill and semantic/analytics work run. Each subsystem stays under its own cap, yet the combined load fills the 10-connection pool and CPU budget, causing foreground route latency or transient failures.

Suggested fix: introduce a shared background resource governor for DB-pinning and CPU-heavy work, with diagnostics for active counts, waits, and queue depth. Add mixed-load stress coverage.

### AGG-C24-03 - Browser and Lightroom/PAT upload ingestion duplicate the same critical pipeline

Severity: High
Confidence: High
Agreement: `architect`, `critic`, `code-reviewer`
Status: confirmed maintainability/architecture issue.

Citations: `apps/web/src/app/actions/images.ts:87-610`; `apps/web/src/app/api/admin/lr/upload/route.ts:84-633`.

Problem: the browser action and PAT upload route independently implement restore fencing, quota, topic checks, disk preflight, original save, HDR/GPS gates, EXIF/color metadata, DB insert, queue payload, audit, and revalidation.

Failure scenario: a future privacy/color/processing field lands in the browser insert/enqueue path but not the PAT route, producing inconsistent rows or derivative settings.

Suggested fix: extract a shared ingest service after transport-specific auth/parsing. Add parity tests for representative browser and PAT uploads.

### AGG-C24-04 - Auth rollback source test inspects the wrong `catch` block

Severity: High
Confidence: High
Agreement: `test-engineer`
Status: confirmed test false-confidence defect.

Citations: `apps/web/src/__tests__/auth-rate-limit-rollback.test.ts:24-44`, `61-120`; `apps/web/src/app/actions/auth.ts:261-271`, `483-498`.

Problem: `extractOuterCatchBody()` starts at a function header but scans to end-of-file, so the `login` test checks the later `updatePassword` catch block instead of `login`'s outer catch.

Failure scenario: `rollbackLoginRateLimit(...)` is accidentally reintroduced in `login()`'s verification catch while `updatePassword` remains unchanged; the test still passes.

Suggested fix: replace the source parser with a behavior test around `login()`, or brace-match the named function body and add a self-test proving `login` resolves to the intended catch region.

### AGG-C24-05 - Cycle 24/23 plan provenance is stale

Severity: Medium
Confidence: High
Agreement: `document-specialist`, `critic`, `code-reviewer`
Status: confirmed docs/provenance issue.

Citations: `.context/plans/README.md:34-38`; `.context/plans/cycle-23-2026-07-08-plan.md:1-7`, `190`, `206`.

Problem: the plan index still lists Cycle 23 as active and the Cycle 23 plan says push/deploy are pending while Cycle 23 is already in current history and Cycle 24 review work has begun.

Failure scenario: a later planner follows the active index, reopens Cycle 23, and misses or duplicates Cycle 24 work.

Suggested fix: create/list the Cycle 24 plan/deferred pair, move Cycle 23 to recently completed with terminal commit/deploy evidence or supersession, and update Cycle 23 status.

### AGG-C24-06 - Deferred carry-forward age register is stale

Severity: Medium
Confidence: High
Agreement: `critic`
Status: confirmed provenance/process issue.

Citations: `.context/plans/deferred-carry-forward.md:3-7`, `19-27`, `87-90`, `185-220`, `249-260`.

Problem: the carry-forward file still has an `Age @ r10c21` table basis while containing newer rows and Cycle 23 prose, so age-budget enforcement can undercount long-deferred findings.

Failure scenario: a High finding crosses the 8-cycle threshold but appears younger, letting it be re-listed without schedule/reclassify action.

Suggested fix: refresh the register to `Age @ r10c24`, update row ages, and prefer mechanically derived ages.

### AGG-C24-07 - `admin-backfill-runner.ts` comment contradicts warning behavior

Severity: Low
Confidence: High
Agreement: `document-specialist`
Status: confirmed stale code comment.

Citations: `apps/web/src/lib/admin-backfill-runner.ts:126-128`; warning code at `apps/web/src/lib/admin-backfill-runner.ts:721-724`; `CLAUDE.md:375`.

Problem: the comment says over-cap `ADMIN_BACKFILL_CONCURRENCY` is silently clamped, while code and docs say a warning is logged.

Failure scenario: a maintainer removes or ignores the warning because the local arithmetic comment says silence is intentional.

Suggested fix: change the comment to "clamped down with a warning".

### AGG-C24-08 - `lib/data.ts` mixes unrelated responsibilities in one large module

Severity: Low
Confidence: High
Agreement: `code-reviewer`
Status: confirmed maintainability issue.

Citations: `apps/web/src/lib/data.ts:13-249`, `251-506`, `514-1820`.

Problem: one module owns shared-group analytics buffering, privacy select-field contracts, listing/search/feed/map queries, SEO helpers, and cached exports.

Failure scenario: a field/query change intended for one surface accidentally affects another, or a public projection sibling is missed during a long-file review.

Suggested fix: split by responsibility while preserving exported APIs and move tests with the contracts they protect.

### AGG-C24-09 - Storage abstraction is not the live storage boundary

Severity: Medium
Confidence: High
Agreement: `architect`
Status: confirmed design issue.

Citations: `apps/web/src/lib/storage/index.ts:4-12`; `apps/web/src/lib/storage/types.ts:4-9`, `51-76`; `apps/web/src/lib/storage/local.ts:38-61`, `159-167`; `apps/web/src/lib/upload-paths.ts:12-23`, `28-41`, `59-88`; `apps/web/src/lib/serve-upload.ts:198-229`; `apps/web/src/app/actions/images.ts:336-373`.

Problem: a named storage abstraction exists, but production upload/process/serve flows still use direct local filesystem paths.

Failure scenario: a future storage backend passes storage-module tests while uploads and serving continue writing/reading local disk, splitting state.

Suggested fix: retire the unused abstraction until a real migration, or route original writes, derivative writes, reads, deletion queueing, and URL generation through one storage service.

### AGG-C24-10 - Single-writer guard warns but does not enforce the single-instance correctness contract

Severity: High
Confidence: High
Agreement: `architect`
Status: confirmed design issue; repo currently documents warn-only topology.

Citations: `apps/web/src/lib/single-writer-guard.ts:7-16`, `218-235`; `apps/web/src/instrumentation.ts:22-31`; process-local state at `apps/web/src/lib/image-queue.ts:313-372`, `apps/web/src/lib/background-db-writes.ts:3-10`.

Problem: multiple live web processes are unsafe for process-local queue, rate-limit, mutation-barrier, and background-write state, but the guard only logs and startup continues.

Failure scenario: an operator scales replicas or overlaps containers; both serve traffic, split local state, and double-run queue/background work.

Suggested fix: fail startup/readiness on contention unless an explicit unsafe override is set, or move coordination to durable shared leases before supporting multiple writers.

### AGG-C24-11 - Smart collections are public/mutable but lack an operable admin lifecycle

Severity: Medium
Confidence: Medium
Agreement: `architect`
Status: likely issue.

Citations: `apps/web/src/db/schema.ts:328-342`; `apps/web/src/app/actions/collections.ts:16-68`, `71-123`, `125-158`; `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84-111`; `apps/web/src/components/admin-nav.tsx:15-26`; `apps/web/messages/en.json:507-508`.

Problem: schema, public rendering, and mutating actions exist, but administrators cannot manage collections through the UI.

Failure scenario: a topic deletion is blocked by a smart collection reference, and the admin must edit DB rows directly, bypassing validation.

Suggested fix: either complete the admin lifecycle or feature-flag/hide the context until it is operable.

### AGG-C24-12 - Large client components concentrate unrelated UI state and side effects

Severity: Medium
Confidence: High for source shape, Medium for defect likelihood
Agreement: `architect`
Status: likely issue.

Citations: `apps/web/src/components/photo-viewer.tsx:47-71`; `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:55-75`, `91-149`, `160-253`; `apps/web/src/components/image-manager.tsx:72-120`, `427-620`; `apps/web/src/components/search.tsx:131-260`.

Problem: several large client components combine state machines, fetch/mutation side effects, accessibility, and presentation.

Failure scenario: a visual change accidentally leaves stale async results, breaks focus, double-triggers a backfill, or bypasses a disabled state.

Suggested fix: extract focused hooks/reducers and presentational children around behavior boundaries, with interaction tests for each state machine.

### AGG-C24-13 - Public keyword search uses leading-wildcard scans

Severity: Medium
Confidence: High
Agreement: `perf-reviewer`
Status: confirmed query-shape issue.

Citations: `apps/web/src/app/actions/public.ts:247-329`; `apps/web/src/lib/data.ts:1574-1583`, `1637-1655`, `1693-1701`, `1716-1738`; `apps/web/src/db/schema.ts:123-132`.

Problem: public search uses `%term%` predicates across image/topic/tag fields without a full-text/search index.

Failure scenario: with a larger corpus, valid rate-limited searches still scan large portions of metadata and tags before returning small result sets.

Suggested fix: add a proper indexed search path such as MySQL full-text, a denormalized search document table, or a local search engine.

### AGG-C24-14 - On-this-day query is non-sargable on `capture_date`

Severity: Low-Medium
Confidence: High
Agreement: `perf-reviewer`
Status: confirmed query-shape issue.

Citations: `apps/web/src/lib/data-timeline.ts:103-110`, `121-131`; `apps/web/src/db/schema.ts:123-132`.

Problem: filtering with `MONTH(capture_date)` and `DAY(capture_date)` prevents efficient use of date indexes.

Failure scenario: daily public/home rendering scans many images to find a small anniversary set as the catalog grows.

Suggested fix: add generated/stored month/day columns or a derived indexed table.

### AGG-C24-15 - Public map can serialize/hydrate up to 10,000 markers plus a duplicate list

Severity: Medium
Confidence: High
Agreement: `perf-reviewer`, `debugger`, `designer`
Status: likely user-visible scale issue.

Citations: `apps/web/src/lib/data.ts:1766-1816`; `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66`, `89-110`; `apps/web/src/components/map/map-client.tsx:77-94`, `120-141`.

Problem: the cap bounds DB rows but still permits a very heavy RSC/client payload, duplicate DOM list, bounds computation, and one Leaflet marker/popup per photo.

Failure scenario: a GPS-heavy gallery opens `/map` on mobile and hits long main-thread stalls, jank, or tab termination.

Suggested fix: use viewport fetching, clustering, lower initial limits, and virtualized/paginated accessible lists.

### AGG-C24-16 - Semantic and similar search are bounded brute-force recency scans

Severity: Medium
Confidence: High
Agreement: `perf-reviewer`, `tracer`
Status: likely scalability/recall issue.

Citations: `apps/web/src/lib/clip-embeddings.ts:36-48`; `apps/web/src/app/api/search/semantic/route.ts:263-311`; `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`; `apps/web/src/db/schema.ts:314-326`.

Problem: request cost is proportional to `SEMANTIC_SCAN_LIMIT`, and recall is biased to recently updated embeddings.

Failure scenario: a relevant old image outside the scan window cannot be returned, while raising the cap increases BLOB reads and JS scoring CPU.

Suggested fix: add scan/latency/age metrics and move toward ANN/vector indexing or a resident normalized matrix service.

### AGG-C24-17 - Service worker HTML cache eviction scans response metadata and sorts on over-cap writes

Severity: Low
Confidence: High
Agreement: `perf-reviewer`, `tracer`
Status: bounded performance issue.

Citations: `apps/web/public/sw.template.js:31-39`, `147-164`, `446-480`, `555-563`; tests at `apps/web/src/__tests__/sw-template-contract.test.ts:59-112`, `400-461`.

Problem: after the 50-entry cap, HTML cache writes scan keys, read each response, sort all entries, and delete overflow.

Failure scenario: low-end devices browsing many public pages spend service-worker time on synchronous cache maintenance after navigations.

Suggested fix: track HTML recency metadata separately, similar to image-cache LRU metadata.

### AGG-C24-18 - Admin CSV export materializes up to 50k rows and one full CSV string in memory

Severity: Low-Medium
Confidence: High
Agreement: `perf-reviewer`
Status: bounded admin-only performance risk.

Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:71-76`, `109`, `116-144`.

Problem: the export concentrates DB result memory, row transformation memory, and final CSV string allocation in the web process.

Failure scenario: an admin exports near the cap during upload processing or semantic work, causing GC pauses or transient memory pressure.

Suggested fix: convert export to a streaming admin route with cursor pagination and backpressure.

### AGG-C24-19 - Critical runtime contracts still rely heavily on source tripwires

Severity: Medium
Confidence: High
Agreement: `test-engineer`
Status: likely test strategy issue, with AGG-C24-04 as confirmed exemplar.

Citations: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `95-101`; `apps/web/src/__tests__/db-restore.test.ts:47-74`; `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:1-17`; `apps/web/src/__tests__/search-stale-response.test.ts:8-10`; `apps/web/src/app/api/search/semantic/route.ts:270-279`; `apps/web/src/app/api/search/similar/[id]/route.ts:181-190`.

Problem: several high-risk guarantees are protected by string/source-order checks rather than behavior harnesses.

Failure scenario: a refactor preserves searched strings while changing runtime sequencing, child-process settlement, or DB chain behavior.

Suggested fix: keep cheap source tripwires but add behavior harnesses for migration reconcile, restore child failures, and semantic/similar `.limit(SEMANTIC_SCAN_LIMIT)` execution.

### AGG-C24-20 - Browser/visual coverage is narrow and partly artifact-only

Severity: Medium
Confidence: High
Agreement: `test-engineer`
Status: manual-validation/test strategy gap.

Citations: `apps/web/playwright.config.ts:48-77`; `.github/workflows/quality.yml:75-80`; `apps/web/e2e/nav-visual-check.spec.ts:40-86`; `apps/web/e2e/hydration-photo-page.spec.ts:36-49`.

Problem: Playwright runs only Desktop Chrome by default; some screenshots are saved but not compared; hydration uses `networkidle`.

Failure scenario: WebKit/mobile/PWA/visual regressions or late hydration warnings ship green.

Suggested fix: add small mobile WebKit/Chromium smokes, use `toHaveScreenshot()` for stable visual checks, and replace `networkidle` with app-ready markers plus bounded console collection.

### AGG-C24-21 - Main quality workflow does not run production CLIP preflight on CLIP-touching changes

Severity: Low-Medium
Confidence: High
Agreement: `test-engineer`
Status: scheduled/manual validation risk.

Citations: `apps/web/src/__tests__/clip-offline-load.test.ts:15-18`, `32-41`; `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10`, `30-31`; `.github/workflows/quality.yml:54-83`; `.github/workflows/clip-preflight.yml:3-45`.

Problem: real CLIP loading/ranking tests are env/weight gated and not part of the main PR/push workflow.

Failure scenario: production semantic search breaks after CLIP model/download/routing changes but passes the main quality workflow until weekly/manual preflight runs.

Suggested fix: trigger CLIP preflight on PRs/pushes touching CLIP/semantic production files, or require a CLIP preflight label/check for such changes.

### AGG-C24-22 - No coverage report or threshold exists for regression visibility

Severity: Low-Medium
Confidence: High
Agreement: `test-engineer`
Status: test strategy gap.

Citations: `package.json:17-29`; `apps/web/package.json:13-29`; `apps/web/vitest.config.ts:16-39`; `.github/workflows/quality.yml:54-83`.

Problem: the repo runs many tests but has no coverage command, changed-file coverage signal, or thresholds.

Failure scenario: new high-risk branches land with source pins or no behavior tests, and CI gives no objective coverage regression signal.

Suggested fix: start with non-blocking coverage output, then ratchet changed-file or high-risk-directory thresholds.

### AGG-C24-23 - Default E2E pass can hide skipped authenticated admin coverage

Severity: Low-Medium
Confidence: High
Agreement: `critic`
Status: likely test-evidence issue.

Citations: `apps/web/e2e/admin.spec.ts:6-13`; `apps/web/e2e/origin-guard.spec.ts:27-31`, `55-73`; `apps/web/package.json:21-23`.

Problem: default `test:e2e` can pass while admin workflows skip unless `E2E_ADMIN_ENABLED=true`.

Failure scenario: cycle reports say e2e passed while admin login/navigation/origin-guard paths were skipped.

Suggested fix: distinguish default public E2E from `test:e2e:admin` in release evidence, and fail or artifact skips in release-designated environments.

### AGG-C24-24 - Admin image management remains table-first inside nested scroll containers

Severity: Medium
Confidence: High
Agreement: `designer`
Status: confirmed UI/UX issue.

Citations: `apps/web/src/components/image-manager.tsx:427-450`, `472-488`, `500-552`, `571-607`; browser evidence in `.context/reviews/designer.md`.

Problem: row identity and destructive actions are separated by horizontal/nested scrolling, especially on tablet/narrow layouts.

Failure scenario: an admin scrolls right to delete/edit and loses visual association with the thumbnail/title identifying the row.

Suggested fix: keep dense desktop table but add responsive card/list workbench below large desktop widths.

### AGG-C24-25 - Admin information architecture is one flat wrapping strip

Severity: Low-Medium
Confidence: High
Agreement: `designer`
Status: confirmed UI/UX issue.

Citations: `apps/web/src/components/admin-nav.tsx:15-49`; `apps/web/src/components/admin-header.tsx:13-26`; browser evidence in `.context/reviews/designer.md`.

Problem: routine publishing, access/security, operations, and analytics destinations are visual peers and wrap into several rows on mobile.

Failure scenario: an admin in a narrow viewport scans a multi-row strip where Tokens, Password, Users, Database, and routine pages have equal weight.

Suggested fix: group admin IA into stable sections and use a sectioned mobile menu/drawer rather than wrapping peer links.

### AGG-C24-26 - Mobile masonry cards permanently overlay metadata on finished photos

Severity: Low
Confidence: High
Agreement: `designer`
Status: confirmed UI issue.

Citations: `apps/web/src/components/masonry-card.tsx:149-154`; browser evidence in `.context/reviews/designer.md`.

Problem: mobile cards render a permanent top gradient/title/topic overlay over image pixels.

Failure scenario: important crop detail near the top of a finished photo is covered in the mobile gallery.

Suggested fix: move metadata below the image, reserve a compact caption band, or reveal metadata on focus/open.

### AGG-C24-27 - SEO settings validation is toast-only instead of field-associated

Severity: Medium
Confidence: High
Agreement: `designer`
Status: confirmed UI/a11y issue.

Citations: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42-72`, `98-184`; server errors at `apps/web/src/app/actions/seo.ts:85-96`, `111-139`.

Problem: the server can identify invalid fields, but the client collapses failures into transient toasts without `aria-invalid`, inline errors, or focus movement.

Failure scenario: an admin enters an invalid OG URL or locale, sees/hears a toast, and must infer which field failed after focus remains on Save.

Suggested fix: track field-level errors, render persistent inline alerts, set `aria-invalid`, extend `aria-describedby`, and focus the first invalid field.

### AGG-C24-28 - Topic create/edit validation is also toast-only

Severity: Low-Medium
Confidence: High
Agreement: `designer`
Status: likely UI/a11y issue.

Citations: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:91-126`, `205-223`, `363-383`.

Problem: server-side slug collisions and Unicode/normalization errors surface only through global toasts.

Failure scenario: a rejected topic slug leaves the dialog open without marking or focusing the field that needs correction.

Suggested fix: mirror the SEO field-error pattern for topic dialogs.

### AGG-C24-29 - Zoomed photos are keyboard-toggleable but not visibly keyboard-pannable

Severity: Medium
Confidence: Medium
Agreement: `designer`
Status: manual assistive-tech validation risk.

Citations: `apps/web/src/components/image-zoom.tsx:206-214`; carry-forward entries in `.context/plans/deferred-carry-forward.md`.

Problem: keyboard users can toggle zoom but have no clear way to pan off-center detail.

Failure scenario: a keyboard-only visitor inspects only the center crop while pointer/touch users can drag.

Suggested fix: define a keyboard zoom mode with arrow-key pan and Escape exit, or provide focusable pan/reset controls.

### AGG-C24-30 - Checked-in Atik site config can become a fresh deploy's public brand/canonical

Severity: Medium
Confidence: High
Agreement: `product-marketer-reviewer`
Status: confirmed product/docs risk.

Citations: `apps/web/src/site-config.json:2-10`; `README.md:60-77`, `121-122`, `171-172`, `198-200`; `apps/web/README.md:19-20`, `49-50`, `57`; `apps/web/scripts/ensure-site-config.mjs:6-42`; `apps/web/src/app/sitemap.ts:14-18`, `70-113`; `apps/web/src/app/[locale]/layout.tsx:15-26`; `apps/web/src/components/footer.tsx:33-37`; `apps/web/src/lib/data.ts:1866-1890`.

Problem: the committed config contains the real `Atik Gallery` / `https://gallery.atik.kr` fallback. The docs tell self-hosters to copy/edit the example, but the destination already exists and production validation accepts it.

Failure scenario: a fresh self-hosted install builds without `BASE_URL` and publishes Atik canonical URLs, sitemap entries, footer/nav text, and OG defaults.

Suggested fix: track only the example config, or add validation/requirements so the Atik fallback cannot pass as an accidental fresh-install default.

### AGG-C24-31 - Proxy topology, real-client-IP behavior, and host nginx limiters remain operator-owned assumptions

Severity: Medium
Confidence: Medium
Agreement: `security-reviewer`, `perf-reviewer`, `critic`, `architect`, `debugger`, `tracer`
Status: risk needing manual validation.

Citations: `apps/web/nginx/default.conf:1-29`, `52-71`, `115-120`, `246-311`; `apps/web/deploy.sh:51-58`; `apps/web/src/lib/rate-limit.ts:175-216`; `scripts/check-proxy-topology.mjs:7-17`, `131-134`; `CLAUDE.md` host-nginx runbook.

Problem: public SSR/Next-image edge limits, DB restore caps, and client-IP behavior depend on manually applied host nginx and proxy topology. App deploy does not prove those controls are live.

Failure scenario: production runs stale nginx or wrong real-IP config, causing missing public flood caps, false shared-IP 429s, or spoofable client-IP assumptions.

Suggested fix: add a deployment validation artifact that captures live `nginx -T`, confirms limiter zones/location, and proves app-observed client IPs match topology expectations.

### AGG-C24-32 - Gitignored runtime secret provenance and historical rotation cannot be proven from source

Severity: Medium
Confidence: Medium
Agreement: `security-reviewer`
Status: manual validation risk.

Citations: `.env.deploy.example`, `apps/web/.env.local.example`, deploy helpers, secret-handling docs in `CLAUDE.md`/`README.md`.

Problem: source review can prove examples and scanners, but not that live gitignored secrets were rotated from historical values or protected with correct permissions.

Failure scenario: an operator accidentally reuses historical/example secrets in the deploy env; source gates stay green.

Suggested fix: keep runtime secret validation in deploy/runbooks and rotate anything ever seeded from historical checked-in examples.

### AGG-C24-33 - Plaintext SQL backups rely on host/storage encryption boundary

Severity: Low
Confidence: High
Agreement: `security-reviewer`
Status: documented operator risk.

Citations: `apps/web/src/app/[locale]/admin/db-actions.ts` backup regions; `apps/web/src/app/api/admin/db/download/route.ts`; docs in `CLAUDE.md` and admin copy.

Problem: database backups are plaintext SQL at rest in the data volume, protected by host/storage permissions rather than app-level encryption.

Failure scenario: host/storage compromise exposes backup contents.

Suggested fix: add encrypted-backup support only if product/operator requirements change; otherwise keep the documented boundary explicit.

### AGG-C24-34 - Build-time vs runtime environment split can cause stale image/site behavior after restart-only changes

Severity: Medium
Confidence: Medium
Agreement: `architect`
Status: manual validation/operator risk.

Citations: `apps/web/next.config.ts:32-38`, `121-125`; `apps/web/Dockerfile:91-99`, `117-120`; `apps/web/docker-compose.yml:18-32`; `scripts/deploy-remote.sh:22-29`, `55-93`.

Problem: some values are compiled into Next output while others are runtime env/config; restart-only changes may not update remote image patterns or static site config.

Failure scenario: an operator restarts after changing `IMAGE_BASE_URL` or site config and sees runtime URLs/CSP diverge from baked Next image patterns or metadata.

Suggested fix: keep rebuild-required notes visible and add a post-deploy probe for baked-vs-runtime URL/config agreement.

### AGG-C24-35 - Restore recovery cleared out of process still requires a web restart for process-local state

Severity: Medium
Confidence: High
Agreement: `tracer`
Status: documented operational risk.

Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:646-695`; `apps/web/src/lib/image-queue.ts:1285-1345`; `apps/web/scripts/restore-maintenance-recovery.mjs:76-85`; `CLAUDE.md` restore recovery runbook.

Problem: clearing the durable restore marker from a separate process does not reset process-local maintenance/queue state in the live web process.

Failure scenario: an operator clears a marker from a sidecar, sees status recovered, but uploads/processing remain paused until redeploy/restart.

Suggested fix: strengthen post-clear warnings and expose both durable and process-local maintenance/queue state in diagnostics.

## Cross-Agent Summary

Highest-signal repeated findings:

1. Large multipart Server Actions pre-materialize before app backpressure (`AGG-C24-01`).
2. Independent background DB/CPU budgets (`AGG-C24-02`).
3. Duplicate browser/PAT upload ingestion (`AGG-C24-03`).
4. Plan/carry-forward provenance drift (`AGG-C24-05`, `AGG-C24-06`).
5. Operator-owned nginx/proxy topology validation (`AGG-C24-31`).

Contained fixes suitable for this cycle:

- `AGG-C24-04` auth rollback source-test false confidence.
- `AGG-C24-05` current-cycle/Cycle 23 plan provenance.
- `AGG-C24-06` carry-forward age-basis refresh.
- `AGG-C24-07` stale backfill clamp comment.

Broad or operator/product-gated items require explicit scheduling/deferred records rather than silent drops.
