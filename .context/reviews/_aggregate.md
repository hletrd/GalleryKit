# Cycle 28 Aggregate Review

Date: 2026-06-30 KST
Cycle: 28/100
Reviewed HEAD range: current `master` after cycle 27 plus cycle-28 review artifacts

## Agent Coverage

Completed reviewer artifacts:

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

No reviewer failed after retry/slot scheduling. The environment exposed only generic native subagent types, so the required personas were run through explicit role prompts plus the two discovered local reviewer prompts. Several reviewers could not commit their artifacts because a local hook required an OMX co-author trailer, which conflicts with this repo's explicit no-`Co-Authored-By` rule; the reports were still written and are included here.

## High-Signal Findings

### AGG-C28-01 - Public analytics insert promises can cross the restore boundary

- Severity/confidence: Medium / High
- Cross-agent agreement: code-reviewer, architect, tracer.
- Citations: `apps/web/src/app/actions/public.ts:408-505`, `apps/web/src/app/[locale]/admin/db-actions.ts:491-499`, `apps/web/src/lib/image-queue.ts:1060-1087`, `apps/web/src/__tests__/public-actions.test.ts:241-254`.
- Problem: public photo/topic/shared-group view recorders launch untracked fire-and-forget DB inserts. Restore preparation drains shared-group count buffering and the image queue, but cannot wait for already-scheduled normalized analytics inserts.
- Failure scenario: a public view recorder schedules an insert just before an admin restore imports a backup. The stale insert can resolve after the restored snapshot is loaded, polluting analytics or attaching to changed IDs.
- Suggested fix: add a restore-aware analytics side-effect registry with pause/drain semantics, call it before `runRestore()`, and add a delayed-insert regression test.

### AGG-C28-02 - Fire-and-forget audit writes are not restore-quiesced

- Severity/confidence: Medium / Medium
- Cross-agent agreement: tracer.
- Citations: `apps/web/src/lib/audit.ts:39-92`, `apps/web/src/app/[locale]/admin/db-actions.ts:157-158`, `apps/web/src/app/[locale]/admin/db-actions.ts:733-740`, `apps/web/src/app/actions/images.ts:604-610`, `apps/web/src/app/actions/images.ts:703-705`.
- Problem: audit log writes are normal DB writes but are scheduled as untracked background promises. Restore import can run while pre-restore audit rows are still pending, and the restore success audit is also not awaited.
- Failure scenario: an admin mutation schedules an audit insert, another tab starts restore, and the old audit row lands in the restored DB. Conversely, a restore-success audit insert can fail silently.
- Suggested fix: track audit writes in the same restore-aware side-effect drain or await security/destructive audit writes, especially DB restore events.

### AGG-C28-03 - Public SSR pages can query the DB during restore import

- Severity/confidence: Low / Medium
- Cross-agent agreement: tracer, designer.
- Citations: `apps/web/src/app/api/health/route.ts:7-16`, `apps/web/src/app/api/live/route.ts:1-9`, `apps/web/src/proxy.ts:65-121`, `apps/web/src/app/[locale]/(public)/page.tsx:149-167`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:133-156`.
- Problem: restore maintenance blocks many mutations and APIs, but initial public HTML renders still run DB loaders while MySQL import may be transient.
- Failure scenario: visitors request public pages during restore and see 500s, false `notFound()`, or partially restored data.
- Suggested fix: add a public maintenance shell or helper that short-circuits DB-backed public pages with a `503` no-store response while restore maintenance is active.

### AGG-C28-04 - Browser upload audit metadata undercounts RAW rejects

- Severity/confidence: Low / High
- Cross-agent agreement: code-reviewer.
- Citations: `apps/web/src/app/actions/images.ts:558-626`, `apps/web/src/__tests__/images-actions.test.ts:299-306`.
- Problem: `uploadImages()` returns RAW rejection counts but audit metadata records only `failedFiles.length`, excluding RAW rejects.
- Failure scenario: a mixed JPEG+RAW multi-file server-action call returns a RAW warning, but the `image_upload` audit row says zero failures.
- Suggested fix: include RAW rejects in audit metadata and add a mixed success-plus-RAW regression test.

### AGG-C28-05 - Standalone build output over-traces mutable/runtime-irrelevant trees

- Severity/confidence: Medium / High for local output, Medium for production risk.
- Cross-agent agreement: verifier.
- Citations: `apps/web/src/instrumentation.ts:1-4`, `apps/web/src/lib/restore-maintenance-durable.ts:24-38`, `apps/web/Dockerfile:117-125`, `.dockerignore:16-20`.
- Problem: Next standalone output locally traced `data/uploads/original`, `public/uploads`, source, tests, and E2E files after a build warning about whole-project tracing.
- Failure scenario: a non-Docker standalone artifact or future context-ignore drift includes private originals, derivatives, tests, and source in a deployed/archive artifact.
- Suggested fix: make marker-path resolution statically scoped for tracing and add a post-build contract rejecting `data/`, `public/uploads/`, `public/resources/`, `src/__tests__/`, and `e2e/` in `.next/standalone/apps/web`.

### AGG-C28-06 - Semantic/similar search scores large vectors synchronously on the request thread

- Severity/confidence: Medium / High
- Cross-agent agreement: perf-reviewer.
- Citations: `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`, `apps/web/src/lib/clip-embeddings.ts:36-44`.
- Problem: model inference is queued, but embedding row decode, dot-product/cosine scoring, and sorting can scan up to 25,000 rows synchronously in the Node request handler.
- Failure scenario: concurrent semantic/similar requests monopolize the event loop and delay SSR, server actions, and queue callbacks.
- Suggested fix: bound scan/scoring concurrency, chunk/yield, move scoring to workers, or replace brute-force scanning with an index.

### AGG-C28-07 - Public map serializes and mounts up to 10,000 markers/list rows

- Severity/confidence: Medium / High
- Cross-agent agreement: perf-reviewer.
- Citations: `apps/web/src/lib/data.ts:1649-1685`, `apps/web/src/app/[locale]/(public)/map/page.tsx:27-89`, `apps/web/src/components/map/map-client.tsx:76-140`.
- Problem: `/map` can send and hydrate 10,000 markers plus a full fallback list.
- Failure scenario: a map-visible topic with thousands of GPS photos freezes mobile browsers or creates a huge RSC/client render.
- Suggested fix: lower initial cap, cluster/canvas markers, add viewport loading, and paginate/limit the fallback list.

### AGG-C28-08 - Rate-limit bucket GC deletes by an unindexed suffix

- Severity/confidence: Medium / High
- Cross-agent agreement: perf-reviewer.
- Citations: `apps/web/src/db/schema.ts:212-219`, `apps/web/src/lib/rate-limit.ts:515-517`, `apps/web/src/lib/image-queue.ts:1019-1047`.
- Problem: `DELETE ... WHERE bucket_start < cutoff` has no leading `bucket_start` index and deletes all matches in one statement.
- Failure scenario: high-IP-cardinality traffic grows the table; hourly GC scans/locks the shared DB table and spikes latency.
- Suggested fix: add a migration for a `bucket_start`-leading index and chunk the purge.

### AGG-C28-09 - Public keyword search uses leading-wildcard LIKE across several branches

- Severity/confidence: Medium / High
- Cross-agent agreement: perf-reviewer.
- Citations: `apps/web/src/lib/sql-like.ts:9-10`, `apps/web/src/lib/data.ts:1545-1621`, `apps/web/src/app/actions/public.ts:235-317`.
- Problem: `%term%` searches over image fields plus tag/topic-alias joins are not B-tree sargable.
- Failure scenario: common short queries on a large gallery force scans and filesorts under public traffic.
- Suggested fix: add a real search index/ngram table, raise minimum length, cache common searches, or reserve contains search for a secondary path.

### AGG-C28-10 - Timeline/year/On This Day use non-sargable date functions

- Severity/confidence: Medium / High
- Cross-agent agreement: perf-reviewer.
- Citations: `apps/web/src/lib/data-timeline.ts:88-116`, `apps/web/src/lib/data-timeline.ts:129-142`, `apps/web/src/lib/data-timeline.ts:178-207`, `apps/web/src/db/schema.ts:116-118`.
- Problem: `MONTH()`, `DAY()`, and `YEAR()` wrap `capture_date`, preventing efficient range use beyond `processed`.
- Failure scenario: public timeline/year widgets scan large processed slices as the gallery grows.
- Suggested fix: use range predicates for year/month pages and generated/indexed month/day columns for On This Day.

### AGG-C28-11 - Feed/sitemap freshness ordering lacks an image index

- Severity/confidence: Low / High
- Cross-agent agreement: perf-reviewer.
- Citations: `apps/web/src/lib/data.ts:828-853`, `apps/web/src/lib/data.ts:1635-1647`, `apps/web/src/db/schema.ts:116-121`.
- Problem: feed and sitemap order by `updated_at DESC, created_at DESC, id DESC` without a matching `(processed, updated_at, created_at, id)` index.
- Failure scenario: crawlers/feed readers trigger expensive sorts on large galleries.
- Suggested fix: add a freshness composite index and consider an equivalent topic index for topic feeds.

### AGG-C28-12 - First-page gallery loads compute exact grouped totals

- Severity/confidence: Medium / High
- Cross-agent agreement: perf-reviewer.
- Citations: `apps/web/src/lib/data.ts:878-907`, `apps/web/src/app/[locale]/(public)/page.tsx:149-168`, `apps/web/src/components/home-client.tsx:267-269`.
- Problem: `COUNT(*) OVER()` on the grouped listing query forces all-match work for a first page that otherwise only needs `LIMIT pageSize + 1`.
- Failure scenario: high-traffic gallery/tag pages pay an exact-count DB tax for a display count.
- Suggested fix: remove exact count from the hot listing query, cache counts separately, or use approximate/loaded-count copy.

### AGG-C28-13 - Upload and bulk tag paths resolve tags serially

- Severity/confidence: Low / High
- Cross-agent agreement: perf-reviewer.
- Citations: `apps/web/src/app/actions/images.ts:301-329`, `apps/web/src/lib/tag-records.ts:29-68`, `apps/web/src/app/actions/images.ts:1131-1144`.
- Problem: tag resolution loops through tags and performs multiple DB round trips per tag, including inside a bulk transaction.
- Failure scenario: uploads or bulk edits with many tags hold locks/transactions longer than needed.
- Suggested fix: batch fetch/insert/reselect tag records and resolve bulk-edit tags outside the mutation transaction where possible.

### AGG-C28-14 - Service worker waits on per-image HEAD probes before cached derivatives

- Severity/confidence: Low / Medium
- Cross-agent agreement: perf-reviewer.
- Citations: `apps/web/public/sw.template.js:31-38`, `apps/web/public/sw.template.js:184-286`, `apps/web/src/lib/serve-upload.ts:245-260`.
- Problem: cached images with ETags wait up to 300 ms for a HEAD probe before stale serve.
- Failure scenario: a returning mobile visitor on a weak network sees delayed cached tiles and many concurrent HEAD requests.
- Suggested fix: validate with throttled traces; if confirmed, serve cached bytes immediately and revalidate in the background.

### AGG-C28-15 - Dormant storage backend still models originals under public uploads

- Severity/confidence: Low now, Medium if integrated / High
- Cross-agent agreement: critic.
- Citations: `CLAUDE.md:149`, `apps/web/src/lib/upload-paths.ts:12-41`, `apps/web/src/lib/storage/local.ts:15-53`, `apps/web/src/lib/storage/types.ts:11-14`, `apps/web/src/__tests__/storage-quarantine.test.ts:111-132`.
- Problem: quarantined storage maps `original/*` to `UPLOAD_ROOT/original`, conflicting with the current private-original invariant.
- Failure scenario: a future storage integration relaxes quarantine and writes originals back under `public/uploads/original`.
- Suggested fix: route `original/*` through the private original root or remove original-key support until a full storage design lands.

### AGG-C28-16 - Private original-upload directory mode is not enforced on normal creation paths

- Severity/confidence: Low / High
- Cross-agent agreement: architect.
- Citations: `apps/web/src/lib/upload-paths.ts:49-55`, `apps/web/src/lib/process-image.ts:443-450`, `apps/web/Dockerfile:132-135`, `apps/web/scripts/entrypoint.sh:16-24`, `apps/web/scripts/migrate.js:77-82`.
- Problem: fresh runtime/deploy paths create the private original directory with default umask behavior instead of consistently forcing `0700`.
- Failure scenario: same-host users or sidecars can enumerate private-original filenames/timestamps even though files are `0600`.
- Suggested fix: centralize directory creation with `mode: 0o700` plus chmod fallback and tighten entrypoint/Dockerfile paths.

### AGG-C28-17 - Semantic search ranking invariant is source-locked, not behavior-locked

- Severity/confidence: Medium / High
- Cross-agent agreement: test-engineer.
- Citations: `apps/web/src/app/api/search/semantic/route.ts:296-301`, `apps/web/src/__tests__/semantic-search-route.test.ts:326-397`, `apps/web/src/__tests__/semantic-similarity-selector-contract.test.ts:17-63`.
- Problem: tests pin regex source shape for stub cosine vs production dot-product selection but do not prove ranking behavior when the metrics disagree.
- Failure scenario: a refactor preserves source text but ranks stub embeddings by magnitude instead of angle.
- Suggested fix: add a behavior test with non-normalized candidates where cosine and dot-product rank opposite ways.

### AGG-C28-18 - Default CI skips real CLIP offline load and semantic-ranking proof

- Severity/confidence: Medium / High
- Cross-agent agreement: test-engineer.
- Citations: `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`.
- Problem: default CI skips the only tests that exercise real offline model loading and multilingual ranking.
- Failure scenario: dependency/path/runtime changes break production semantic search but normal gates stay green.
- Suggested fix: add a scheduled/manual CI job with cached model weights for `CLIP_OFFLINE_LOAD=1 CLIP_INTEGRATION=1`.

### AGG-C28-19 - Public route rate-limit gate ignores expensive GET endpoints

- Severity/confidence: Medium / High
- Cross-agent agreement: test-engineer.
- Citations: `apps/web/scripts/check-public-route-rate-limit.ts:36`, `apps/web/scripts/check-public-route-rate-limit.ts:344-346`, `apps/web/src/__tests__/og-route-rate-limit-behavior.test.ts:47-74`, `apps/web/src/__tests__/similar-route.test.ts:236-244`.
- Problem: the blocking gate scans mutating public API routes only, so future expensive public GET routes can ship without limiter or explicit exemption.
- Failure scenario: a new DB/Sharp/ImageResponse GET route passes CI as "no mutating handlers" despite unbounded public cost.
- Suggested fix: add a second GET audit or extend the gate for public GET handlers importing expensive helpers.

### AGG-C28-20 - E2E coverage runs only one desktop Chromium project

- Severity/confidence: Medium / High
- Cross-agent agreement: test-engineer.
- Citations: `apps/web/playwright.config.ts:48-77`.
- Problem: the e2e gate lacks WebKit/mobile-browser coverage for photographer-critical Safari/P3/HDR/focus/service-worker surfaces.
- Failure scenario: photo viewer/color/search behavior fails in Safari while Chromium-only CI passes.
- Suggested fix: add a small serialized WebKit public smoke project.

### AGG-C28-21 - Nav visual tests save screenshots but do not assert baselines

- Severity/confidence: Low / High
- Cross-agent agreement: test-engineer.
- Citations: `apps/web/e2e/nav-visual-check.spec.ts:40-79`.
- Problem: nav "visual" tests produce artifacts but assert only geometry.
- Failure scenario: color/spacing/icon regressions pass unless screenshots are manually inspected.
- Suggested fix: use `toHaveScreenshot()` with stable masks/thresholds, or rename/document them as artifact-only smoke tests.

### AGG-C28-22 - CLIP production backfill sidecar example omits the originals mount

- Severity/confidence: Medium / High
- Cross-agent agreement: document-specialist.
- Citations: `apps/web/scripts/backfill-clip-embeddings.ts:9-20`, `apps/web/scripts/backfill-clip-embeddings.ts:173-178`, `apps/web/src/lib/upload-paths.ts:27-69`, `CLAUDE.md:523-535`.
- Problem: the script header mounts model weights but not `/app/data/uploads/original`, contradicting the current CLAUDE runbook and production-mode code.
- Failure scenario: an operator follows the script header and every selected row fails because originals are missing from the sidecar.
- Suggested fix: mirror the CLAUDE sidecar command in the script header and note production backfill needs originals, not just model weights.

### AGG-C28-23 - Pixel-cap comments/test title misstate `256e6`

- Severity/confidence: Low / High
- Cross-agent agreement: document-specialist.
- Citations: `apps/web/src/lib/process-image.ts:345-357`, `apps/web/src/__tests__/process-image-max-input-pixels-env.test.ts:65-70`, `CLAUDE.md:102`, `apps/web/.env.local.example:35`.
- Problem: comments/test title imply `Number('256e6') === 268435456`; the assertion correctly proves it is `256000000`.
- Failure scenario: a maintainer sets `IMAGE_MAX_INPUT_PIXELS=256e6` expecting the documented 256 MiB default and gets a lower threshold.
- Suggested fix: correct the comment and test title.

### AGG-C28-24 - CLAUDE.md names a concrete deploy host despite config-driven deploy policy

- Severity/confidence: Low / Medium
- Cross-agent agreement: document-specialist.
- Citations: `AGENTS.md:17-18`, `scripts/deploy-remote.sh:31-52`, `.env.deploy.example:6-14`, `CLAUDE.md:465-467`.
- Problem: detailed runbook names `gallery.atik.kr` while repo policy says deploy host/SSH details are config-driven and not hardcoded.
- Failure scenario: future operators target stale prose instead of `.env.deploy`, or the committed doc leaks target identity contrary to policy.
- Suggested fix: rephrase to "configured deploy host from `.env.deploy`" unless the policy explicitly allows status prose.

### AGG-C28-25 - Sidecar CLIP backfill bypasses the runtime production env gate

- Severity/confidence: Medium / High
- Cross-agent agreement: debugger.
- Citations: `apps/web/scripts/backfill-clip-embeddings.ts:80-119`, `apps/web/src/lib/gallery-config.ts:123-141`, `apps/web/src/app/actions/embeddings.ts:72-88`.
- Problem: runtime heals stored `production` to `disabled` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, but the sidecar reads the raw DB setting and can run production backfill without the env gate.
- Failure scenario: a restored/manual DB row says production while the app considers semantic search disabled; sidecar still runs real CLIP and writes embeddings.
- Suggested fix: require the same effective config gate in the sidecar or explicitly require `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` for `--production`.

### AGG-C28-26 - CLIP sidecar skips failed rows until a new process run

- Severity/confidence: Low / High
- Cross-agent agreement: debugger.
- Citations: `apps/web/scripts/backfill-clip-embeddings.ts:132-167`, `apps/web/scripts/backfill-clip-embeddings.ts:171-215`.
- Problem: cursor advances to the last selected row before processing; per-image failures remain behind the cursor.
- Failure scenario: transient failures leave missing embeddings until an operator notices the non-zero exit and reruns.
- Suggested fix: retry failed IDs at the end with bounded attempts or log failed IDs explicitly.

### AGG-C28-27 - `OptimisticImage` fallback retry path is stale-source fragile

- Severity/confidence: Low / Medium
- Cross-agent agreement: debugger.
- Citations: `apps/web/src/components/optimistic-image.tsx:18-54`, `apps/web/src/components/home-client.tsx:365-380`, `apps/web/src/components/image-manager.tsx:467-475`, `apps/web/src/components/on-this-day-widget.tsx:65-74`.
- Problem: after activating `fallbackSrc`, retry URLs are still computed from the original `src`, and retry limit checks mix state/ref counters.
- Failure scenario: future fallback-enabled thumbnails retry the failed primary instead of the fallback and show unavailable despite recoverable fallback bytes.
- Suggested fix: base retry on current active source, use the ref for limits, clear existing timers, and add a fallback retry component test.

### AGG-C28-28 - Admin image table lacks a contained responsive width contract

- Severity/confidence: Medium / High
- Cross-agent agreement: designer, ui-ux-designer-reviewer.
- Citations: `apps/web/src/components/image-manager.tsx:424-595`, `apps/web/src/components/admin-user-manager.tsx:135-136`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:218-219`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:96-97`.
- Problem: the dense image-management table has no explicit minimum width/responsive card fallback, unlike other admin tables.
- Failure scenario: narrow admin viewports compress/wrap cells unpredictably and push controls outside comfortable keyboard/touch reach.
- Suggested fix: give the table a deliberate `min-w-*` inside the existing overflow container or add a card layout below a breakpoint.

### AGG-C28-29 - Slideshow interval validation is not surfaced at field level

- Severity/confidence: Medium / High
- Cross-agent agreement: designer, ui-ux-designer-reviewer.
- Citations: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:154-173`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:229-270`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:695-707`, `apps/web/src/app/actions/settings.ts:60-65`, `apps/web/src/lib/gallery-config-shared.ts:88-90`.
- Problem: server/shared validation rejects out-of-range slideshow intervals, but client validation omits the field and shows only a generic toast.
- Failure scenario: screen-reader or keyboard users are not told which field failed or how to correct it.
- Suggested fix: add the interval to range validation, render a field-level error with `aria-invalid`/`aria-describedby`, and test it.

### AGG-C28-30 - Public data failures collapse into a stripped generic error shell

- Severity/confidence: Medium / High
- Cross-agent agreement: designer.
- Citations: `apps/web/src/app/[locale]/error.tsx:22-57`, `apps/web/src/app/[locale]/(public)/layout.tsx:7-17`, `apps/web/src/app/[locale]/(public)/page.tsx:151-167`, `apps/web/src/components/nav-client.tsx:160-184`.
- Problem: DB-backed public route errors remove normal public IA: search, theme, locale, topics, footer/admin links.
- Failure scenario: first-run setup or DB outage gives visitors a generic shell with weak recovery affordances.
- Suggested fix: preserve the public shell for expected DB-unavailable states or catch public data failures inside a localized public maintenance/error state.

### AGG-C28-31 - First-run docs push upload before the GPS/privacy choice

- Severity/confidence: High / High
- Cross-agent agreement: product-marketer-reviewer.
- Citations: `README.md:29-32`, `README.md:118`, `apps/web/README.md:24`, `apps/web/src/lib/gallery-config-shared.ts:97`, `apps/web/src/components/upload-dropzone.tsx:77`, `apps/web/src/components/upload-dropzone.tsx:387-390`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:660-680`, `apps/web/messages/en.json:172`.
- Problem: setup docs send new operators to upload before deciding GPS stripping, while GPS stripping defaults off and the setting locks once images exist.
- Failure scenario: a photographer uploads a real geotagged photo, then learns too late that retained originals kept GPS and the setting is locked.
- Suggested fix: change first-run docs to configure privacy before real uploads; consider defaulting GPS stripping on or adding a first-run decision interstitial.

### AGG-C28-32 - "Show on Map" under-discloses public GPS publication

- Severity/confidence: High / High
- Cross-agent agreement: product-marketer-reviewer.
- Citations: `apps/web/messages/en.json:107-109`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:226`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:260-264`, `apps/web/src/lib/data.ts:410-416`, `apps/web/src/lib/data.ts:1660-1685`, `apps/web/messages/en.json:808`.
- Problem: the admin toggle sounds like display preference, but it publishes GPS coordinates on an unauthenticated map.
- Failure scenario: admins expose home/client/private-location coordinates without realizing the consequence at the decision point.
- Suggested fix: rename the label/aria label to consequence-first copy and add first-enable confirmation/help text.

### AGG-C28-33 - Checked-in live site defaults keep generic GalleryKit SEO/branding

- Severity/confidence: Medium / High
- Cross-agent agreement: product-marketer-reviewer.
- Citations: `README.md:22`, `apps/web/src/site-config.json:2-9`, `apps/web/src/lib/data.ts:1714-1749`, `apps/web/src/app/[locale]/layout.tsx:22-49`, `apps/web/src/app/[locale]/(public)/page.tsx:38-53`.
- Problem: `site-config.json` points at the live URL but keeps generic package branding.
- Failure scenario: DB SEO rows are missing/unreadable and public/social metadata reads like a software demo, not a photographer site.
- Suggested fix: use demo/photographer-specific defaults for the live config or add an admin warning while SEO values remain stock.

### AGG-C28-34 - README color-positioning overstates delivery fidelity

- Severity/confidence: Medium / High
- Cross-agent agreement: product-marketer-reviewer.
- Citations: `README.md:31`, `README.md:38`, `apps/web/messages/en.json:377`, `apps/web/messages/en.json:384-389`, `apps/web/messages/en.json:396`, `apps/web/messages/en.json:756-759`.
- Problem: "color-faithful" and "Photographer-grade" overstate a pipeline that can clip wide gamuts, deliver HDR as SDR, omit gain maps, and depend on browser/display behavior.
- Failure scenario: photographers expect full edit fidelity and later discover documented limitations only inside admin audit copy.
- Suggested fix: reframe README copy as color-aware delivery with explicit audit trails and browser/gamut/HDR limits.

### AGG-C28-35 - Semantic-search Settings copy makes Stub mode look like a public feature

- Severity/confidence: Medium / Medium
- Cross-agent agreement: product-marketer-reviewer.
- Citations: `apps/web/messages/en.json:748-755`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:758-788`, `apps/web/src/components/search.tsx:491-520`, `apps/web/README.md:73-79`.
- Problem: the settings card says "Enable CLIP-based semantic image search" while the UI only exposes Disabled/Stub and stub can show a public semantic toggle with non-meaningful results.
- Failure scenario: operators enable Stub expecting production AI search, then visitors see irrelevant public results.
- Suggested fix: split production status from Stub test mode and hide/rename public stub search for unauthenticated visitors.

## Manual-Validation / Operational Risks

### AGG-C28-R01 - Proxy/header trust and TLS edge assumptions must match production

- Severity/confidence: Medium / Medium
- Source reviewer: security-reviewer.
- Citations: `apps/web/src/lib/request-origin.ts:5-107`, `apps/web/nginx/default.conf:25-197`.
- Deferral reason: deployment topology validation, not a tracked source defect.
- Exit criterion: reopen if `TRUST_PROXY=true` is used without proven `X-Forwarded-*` overwrite at the public edge or if TLS termination topology changes.

### AGG-C28-R02 - DB restore blast radius depends on MySQL account least privilege

- Severity/confidence: Medium / Medium
- Source reviewer: security-reviewer.
- Citations: `apps/web/src/lib/sql-restore-scan.ts:12-59`, `apps/web/src/lib/sql-restore-scan.ts:210-251`, `apps/web/src/app/[locale]/admin/db-actions.ts:618-678`.
- Deferral reason: operational DB grant validation. No cycle-28 scanner bypass was confirmed.
- Exit criterion: reopen if the production DB user has sibling-schema/global/routine/file/user grants or restore grammar changes.

### AGG-C28-R03 - Gitignored runtime secret files were intentionally not inspected

- Severity/confidence: Low / High
- Source reviewer: security-reviewer.
- Citations: `apps/web/src/lib/session.ts:19-35`, `README.md:134-143`, `CLAUDE.md:79-86`, `apps/web/deploy.sh:18`, `.env.deploy.example:1-14`.
- Deferral reason: secret-store inspection is operational and should not read/commit gitignored secrets during review.
- Exit criterion: reopen if secrets were copied from historical examples, shared in logs/tickets, or rotated policy changes.

## Non-Findings / Not Re-Filed

- Security-reviewer found no confirmed or likely code vulnerabilities in tracked source.
- 2FA/WebAuthn and Stripe/paid-download work remain explicit product non-goals in `CLAUDE.md`.
- Cycle-27 restore-scanner, restore-recovery, legacy-original migration, desktop nav clipping, and create-user password hint findings were rechecked as fixed and not re-filed.
- Browser/runtime UI inspection was partially blocked by local MySQL unavailability; UI reviewers backed findings with source/accessibility evidence and focused tests.
