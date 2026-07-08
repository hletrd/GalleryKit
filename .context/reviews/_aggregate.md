# Cycle 25 Aggregate Review

Date: 2026-07-08 KST
Review start HEAD: `f78c8437ae833d50aa85db8332257f59d923dc60`
Latest review HEAD observed: `8a2a0e76`

## Review Lanes

Completed:

- `code-reviewer` -> `.context/reviews/code-reviewer.md`
- `security-reviewer` -> `.context/reviews/security-reviewer.md`
- `perf-reviewer` / `debugger` / `tracer` -> `.context/reviews/perf-debugger-tracer.md`
- `architect` / `critic` -> `.context/reviews/architect-critic.md`
- `verifier` / `test-engineer` -> `.context/reviews/verifier-test-engineer.md`
- `designer` / `document-specialist` / local `product-marketer-reviewer` / local `ui-ux-designer-reviewer` -> `.context/reviews/designer-document-product.md`

Agent failures: none. The callable subagent surface exposed only generic agent types and the environment allowed fewer than all requested lanes at once, so the required perspectives were covered through six bounded lanes. The initial designer/document/product spawn hit the thread cap and succeeded on retry after another lane completed.

Notes:

- Several review lanes committed/pushed their own review-only artifacts during Prompt 1. Those commits are preserved as cycle provenance.
- The security lane found no confirmed exploitable code-level vulnerability.
- External documentation consulted by the designer/document lane: official Next.js JSON-LD guide, used only to avoid filing stale local dev warnings as a bug.

## Aggregate Findings

### AGG-C25-01 - Color re-encode write paths fail open to default settings when admin settings cannot be read

Severity: High
Confidence: High
Agreement: `code-reviewer`
Status: confirmed correctness/data-quality issue.

Citations: `apps/web/src/lib/gallery-config.ts:168-184`, `219-237`; `apps/web/src/lib/admin-backfill-runner.ts:615-629`, `701-714`; `apps/web/scripts/backfill-color-pipeline.ts:355-368`, `466-492`.

Problem: `_getGalleryConfig()` catches any settings-read error and returns defaults. `getGalleryConfigDetached()` uses that helper, and both in-app and sidecar color re-encode paths then encode derivatives and can advance `pipeline_version` with default quality/size/color settings.

Failure scenario: an admin or operator starts a color re-encode during a transient `admin_settings` read failure. Derivatives are rewritten with default photographer-intent settings and marked current, so normal pipeline-version backfill logic will not revisit them.

Suggested fix: add or use a strict detached config accessor for re-encode write paths. If settings cannot be read, fail the run before encoding or updating rows. Add tests that mock settings-read failure for in-app and sidecar paths.

### AGG-C25-02 - Restore temp-file cleanup ownership is transferred before `spawn()` is known to have succeeded

Severity: Low
Confidence: Medium
Agreement: `code-reviewer`
Status: confirmed edge-case cleanup leak.

Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:887-900`, `977-980`.

Problem: `runRestore()` sets `cleanupTransferredToRestoreProcess = true` immediately before constructing the `spawn('mysql', ...)` promise. If `spawn()` throws synchronously before handlers own cleanup, the outer `finally` skips temp-file unlinking.

Failure scenario: a malformed child-process runtime or option failure throws synchronously. The restore reports failure but leaves the uploaded SQL temp file behind.

Suggested fix: set the transfer flag only after `spawn()` returns and handlers are registered, or reset it in a local `try` around `spawn()`. Add a unit test for synchronous spawn failure.

### AGG-C25-03 - Large browser upload and DB restore Server Actions admit multipart bodies before app backpressure

Severity: High
Confidence: High
Agreement: `perf-reviewer`, `debugger`, `tracer`
Status: confirmed source-level failure mode; live RSS/OOM threshold needs tracing.

Citations: `apps/web/next.config.ts:111-119`; `apps/web/src/app/actions/images.ts:87-106`, `154-221`; `apps/web/src/app/[locale]/admin/db-actions.ts:421-427`, `745-767`; safer contrast in `apps/web/src/app/api/admin/lr/upload/route.ts:101-187`.

Problem: browser upload and restore Server Actions receive already-materialized `FormData` before app-level locks, quotas, disk checks, restore gates, or parse slots can reject or serialize the body.

Failure scenario: cross-tab/admin submissions or upload-plus-restore requests near configured body limits can create RSS spikes, GC stalls, or OOM before the intended safety gates run.

Suggested fix: move large browser upload and restore ingestion to route handlers with pre-parse `Content-Length`, chunked rejection, parse/body semaphore, quota preclaim, and streaming-to-temp/original storage.

### AGG-C25-04 - Background DB/CPU producers have independent budgets and can oversubscribe the shared host

Severity: High
Confidence: High for source shape, Medium-High for production impact
Agreement: `perf-reviewer`, `debugger`, `tracer`, `architect`, `critic`, `code-reviewer`
Status: confirmed architectural resource risk.

Citations: `apps/web/src/db/index.ts:31-42`; `apps/web/src/lib/image-queue.ts:120-153`, `447-456`; `apps/web/src/lib/admin-backfill-runner.ts:97-143`, `324-379`, `716-727`; `apps/web/src/lib/background-db-writes.ts:3-75`; `apps/web/src/lib/clip-model.ts:53-72`, `156-173`; `CLAUDE.md:269-284`.

Problem: image queue, admin backfill, analytics writes, CLIP/semantic work, and other background jobs each enforce local limits, but there is no process-wide DB/CPU admission budget preserving foreground capacity.

Failure scenario: upload processing plus admin re-encode and semantic/analytics work can consume most DB pool slots and CPU budget despite each subsystem staying under its own cap.

Suggested fix: introduce a shared background resource governor for DB-pinned, DB-transient, Sharp CPU, and CLIP work, with metrics and mixed-load stress coverage.

### AGG-C25-05 - Browser and Lightroom/PAT upload ingestion duplicate the same critical pipeline

Severity: High
Confidence: High
Agreement: `architect`, `critic`
Status: confirmed architecture/coupling issue.

Citations: `apps/web/src/app/actions/images.ts:87-221`, `325-516`; `apps/web/src/app/api/admin/lr/upload/route.ts:84-188`, `254-381`, `383-613`.

Problem: browser upload and PAT upload independently implement restore fencing, quota, upload-processing locks, topic checks, config snapshots, disk preflight, original save, HDR/GPS gates, DB insert, queue payload, audit, and revalidation.

Failure scenario: a future privacy/color/schema/processing field lands in one path only, causing GPS leaks, wrong metadata, ignored processing settings, or duplicate external publish retries.

Suggested fix: extract a shared ingest service with browser/LR transport adapters and parity tests over persisted columns plus queue payload.

### AGG-C25-06 - Single-writer topology is a correctness contract but enforcement is warn-only

Severity: Medium-High
Confidence: High
Agreement: `architect`, `critic`
Status: confirmed runtime-topology risk; repo currently documents warn-only behavior.

Citations: `CLAUDE.md:244-249`; `apps/web/src/lib/single-writer-guard.ts:7-16`, `218-235`; `apps/web/src/instrumentation.ts:22-31`.

Problem: the system depends on one live web writer for process-local restore, upload quota, queue, analytics, and rate-limit state. Persistent singleton contention logs loudly but startup continues.

Failure scenario: an operator or orchestrator runs two web processes. Both serve traffic while process-local coordination state splits.

Suggested fix: fail readiness/startup on persistent singleton-lock contention unless an explicit unsafe override is set, or move correctness state to durable/shared coordination.

### AGG-C25-07 - Storage abstraction is quarantined, not the live storage boundary

Severity: Medium
Confidence: High
Agreement: `architect`, `critic`
Status: confirmed boundary/design risk, not an immediate live defect.

Citations: `apps/web/src/lib/storage/index.ts:4-12`; `apps/web/src/lib/upload-paths.ts:12-47`, `59-88`; `apps/web/src/lib/serve-upload.ts:198-229`; `apps/web/src/__tests__/storage-quarantine.test.ts:1-27`, `111-132`.

Problem: `@/lib/storage` exists but live upload/process/serve/delete flows still use direct local filesystem helpers. The quarantine test prevents accidental production imports.

Failure scenario: future partial adoption creates two storage contracts with different path traversal, cleanup, ETag, GPS, and backup semantics.

Suggested fix: keep quarantine or delete the abstraction until a full migration is approved. If integrating, route originals, derivatives, serving, deletion, ETag/hash invalidation, and backup/restore semantics through one storage service.

### AGG-C25-08 - Semantic and similar search scan newest embeddings only

Severity: Medium
Confidence: High
Agreement: `perf-reviewer`, `debugger`, `tracer`, `architect`, `critic`
Status: confirmed scalability/recall limitation.

Citations: `apps/web/src/lib/clip-embeddings.ts:36-48`; `apps/web/src/app/api/search/semantic/route.ts:263-311`; `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`; `apps/web/src/db/schema.ts:314-326`.

Problem: semantic/similar routes rank only a recency-ordered scan window, default 2,000 embeddings and hard cap 25,000.

Failure scenario: relevant older images outside the scan window cannot be returned even if they are the best semantic match.

Suggested fix: expose recall boundaries and telemetry, then move to a vector index or bounded worker-backed normalized embedding matrix when corpus size exceeds the bounded-scan assumption.

### AGG-C25-09 - Public map can hydrate up to 10,000 markers plus a duplicate list

Severity: Medium
Confidence: High
Agreement: `perf-reviewer`, `debugger`, `tracer`, `architect`, `critic`
Status: confirmed scale risk.

Citations: `apps/web/src/lib/data.ts:1766-1816`; `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66`, `89-110`, `98-110`; `apps/web/src/components/map/map-client.tsx:77-95`, `120-141`.

Problem: `/map` can ship every marker to the client, compute bounds across every marker, render one Leaflet marker per item, and render a duplicate accessible list.

Failure scenario: a GPS-heavy gallery near the cap can cause slow mobile loads, hydration stalls, memory pressure, or tab crashes.

Suggested fix: use viewport/bounds queries, clustering/canvas/WebGL rendering, lower measured initial caps, and virtualize or paginate the accessible list.

### AGG-C25-10 - Public keyword search uses leading-wildcard scans across metadata and tags

Severity: Medium
Confidence: High
Agreement: `perf-reviewer`, `debugger`, `tracer`
Status: confirmed query-shape risk.

Citations: `apps/web/src/app/actions/public.ts:247-329`; `apps/web/src/lib/data.ts:1574-1584`, `1637-1655`, `1693-1701`, `1716-1738`; `apps/web/src/db/schema.ts:123-132`.

Problem: public keyword search uses `%term%` predicates across image/topic/tag fields without an indexed search document or full-text path.

Failure scenario: larger catalogs can burn DB CPU for valid rate-limited searches.

Suggested fix: add indexed search, such as MySQL full-text, a denormalized search table, or a local/external search engine.

### AGG-C25-11 - On-this-day query is non-sargable on `capture_date`

Severity: Low-Medium
Confidence: High
Agreement: `perf-reviewer`, `debugger`, `tracer`
Status: confirmed query-shape issue.

Citations: `apps/web/src/lib/data-timeline.ts:103-110`, `121-131`; `apps/web/src/db/schema.ts:123-132`.

Problem: `MONTH(capture_date)` and `DAY(capture_date)` predicates prevent direct use of date indexes.

Failure scenario: public homepage/timeline widgets scan many dated images to find a small anniversary set as catalogs grow.

Suggested fix: add indexed generated/stored month/day or month-day columns and query equality.

### AGG-C25-12 - Admin CSV export remains bounded but in-memory

Severity: Low-Medium
Confidence: High
Agreement: `perf-reviewer`, `debugger`, `tracer`
Status: bounded admin-only memory risk.

Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:71-76`, `94-109`, `111-145`.

Problem: CSV export queries up to 50,000 rows, builds `csvLines`, clears rows, and joins the full output string in the web process.

Failure scenario: a large admin export during other background work can create heap pressure and GC pauses.

Suggested fix: move CSV export to a streaming admin route with cursor pagination and backpressure.

### AGG-C25-13 - Service-worker HTML eviction scans and sorts cached responses

Severity: Low
Confidence: High
Agreement: `perf-reviewer`, `debugger`, `tracer`
Status: bounded client-side performance risk.

Citations: `apps/web/public/sw.template.js:31-39`, `147-164`, `446-480`, `555-563`.

Problem: HTML cache eviction reads every cached HTML response and sorts entries when the cap is exceeded.

Failure scenario: low-end mobile devices with many cached navigations may spend avoidable service-worker time on repeated Cache API reads and sort work.

Suggested fix: track HTML recency metadata separately and evict incrementally.

### AGG-C25-14 - Server-action barrel softens domain boundaries

Severity: Low-Medium
Confidence: Medium
Agreement: `architect`, `critic`
Status: confirmed layering smell.

Citation: `apps/web/src/app/actions.ts:1-34`.

Problem: one barrel re-exports auth, images, topics, tags, sharing, admin users, public actions, SEO, and settings.

Failure scenario: broad imports make ownership and dependency review harder and can accidentally pull a broader server-action surface into client components.

Suggested fix: keep the barrel for compatibility, require new code to import domain modules directly, and add an allowlist source-contract test before migrating existing callers.

### AGG-C25-15 - Migration/reconcile coverage can pass with structurally wrong schema

Severity: Medium
Confidence: High
Agreement: `verifier`, `test-engineer`, `architect`, `critic`
Status: confirmed test-infrastructure gap.

Citations: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `86-101`, `157-171`; `apps/web/scripts/migrate.js:877-897`.

Problem: reconcile coverage checks source mentions of table/column/index names, not actual MySQL types, defaults, collation, index order/uniqueness, FK actions, or live schema drift.

Failure scenario: fresh/rebaselined installs diverge from migrated installs while name-based tests pass.

Suggested fix: add a disposable-MySQL structural parity test comparing migration path versus reconcile/baseline path via `information_schema`.

### AGG-C25-16 - Mobile bottom-sheet dropdown containment is source-locked, not browser-proven

Severity: Medium
Confidence: High
Agreement: `verifier`, `test-engineer`
Status: confirmed test gap.

Citations: `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:14-26`; `apps/web/src/components/info-bottom-sheet.tsx:565-603`; `apps/web/e2e/test-fixes.spec.ts:56-65`; `apps/web/e2e/focus-restore.spec.ts:34-59`.

Problem: tests assert source strings for Radix dropdown portal containment but do not open the mobile info-sheet download menu in a browser.

Failure scenario: a Radix upgrade or ref/container change renders the menu outside the dialog/focus trap while source-string tests still pass.

Suggested fix: add a mobile Playwright test opening the info sheet and download menu, asserting visibility, containment, keyboard focus, close, and focus return.

### AGG-C25-17 - Browser matrix is Chromium desktop-only

Severity: Medium
Confidence: High
Agreement: `verifier`, `test-engineer`
Status: confirmed quality-gate gap.

Citations: `apps/web/playwright.config.ts:72-77`; `.github/workflows/quality.yml:75-80`; touch/mobile policy in `AGENTS.md` and `CLAUDE.md`.

Problem: Playwright config runs only Desktop Chrome/Chromium. Mobile viewports do not exercise WebKit/Safari or true mobile browser behavior.

Failure scenario: WebKit/Safari dialog, fixed-position, focus-trap, service-worker, color/profile, image, or touch behavior regresses while CI remains green.

Suggested fix: add a focused mobile WebKit public smoke project or path-triggered subset.

### AGG-C25-18 - Nav "visual" checks create screenshots but no visual oracle

Severity: Low
Confidence: High
Agreement: `verifier`, `test-engineer`
Status: confirmed test naming/evidence gap.

Citations: `apps/web/e2e/nav-visual-check.spec.ts:40-87`.

Problem: the spec saves screenshots but makes geometry assertions only; no `toHaveScreenshot` baseline or visual diff exists.

Failure scenario: spacing, color, wrap, z-index, density, or hierarchy regresses while 44 px and overlap checks pass.

Suggested fix: add screenshot baselines with masks or rename the spec as geometry-only.

### AGG-C25-19 - Real CLIP production coverage is non-blocking for ordinary changes

Severity: Low-Medium
Confidence: High
Agreement: `verifier`, `test-engineer`
Status: confirmed gated-test gap.

Citations: `apps/web/src/__tests__/clip-offline-load.test.ts:15-18`, `32-41`; `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10`, `30-31`; `.github/workflows/clip-preflight.yml:3-6`; `.github/workflows/quality.yml:54-83`.

Problem: real CLIP tests skip without model-weight/env flags, and the dedicated preflight workflow is scheduled/manual rather than part of ordinary quality gates.

Failure scenario: dependency/model-loader/revision/path changes break offline loading or semantic ranking while normal quality stays green.

Suggested fix: path-trigger the CLIP preflight for semantic/CLIP/dependency changes or add a lightweight offline-loader contract.

### AGG-C25-20 - Coverage volume is high but there is no coverage or changed-file ratchet

Severity: Low-Medium
Confidence: High
Agreement: `verifier`, `test-engineer`
Status: confirmed quality-gate gap.

Citations: root `package.json:17-29`; `apps/web/package.json:13-29`; `apps/web/vitest.config.ts:16-39`; `.github/workflows/quality.yml:54-83`.

Problem: unit tests run without coverage instrumentation or changed-file/module ratchets for high-risk paths.

Failure scenario: a new branch in a critical action/route/migration path ships with only source-contract coverage or no behavior coverage.

Suggested fix: introduce a changed-file coverage ratchet for high-risk modules or require behavior tests/waivers for changed branches.

### AGG-C25-21 - Category, tag, and SEO save failures rely on transient toasts instead of persistent form errors

Severity: Medium
Confidence: High
Agreement: `designer`, `document-specialist`
Status: confirmed UI/a11y recovery issue.

Citations: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:91-125`, `205-223`, `363-383`, `152-178`; `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:53-67`, `169-182`; `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42-70`, `98-162`; stronger pattern in `apps/web/src/app/[locale]/admin/login-form.tsx:31-45`, `65-129`.

Problem: rejected category/tag/SEO submissions use toast-only feedback without persistent inline error state, `aria-invalid`, field error IDs, alert region, or focus recovery.

Failure scenario: keyboard or screen-reader admins can miss duplicate slug/tag or invalid SEO URL/locale errors after the toast disappears.

Suggested fix: reuse the login/settings pattern with local form/field errors, persistent `role="alert"` messages, `aria-invalid`, `aria-describedby`, and focus to the first invalid field/alert.

### AGG-C25-22 - Committed Atik deployment config can pass as a fresh install's canonical brand

Severity: Medium
Confidence: High
Agreement: `designer`, `document-specialist`, `product-marketer-reviewer`
Status: confirmed product/documentation mismatch; current repo is also the configured Atik deployment.

Citations: `apps/web/src/site-config.json:2-10`; `apps/web/src/site-config.example.json:2-11`; `apps/web/scripts/ensure-site-config.mjs:11-42`; `README.md:60-77`, `118-122`, `171-172`, `198-200`; `apps/web/README.md:15-20`, `48-50`.

Problem: a fresh clone already contains real Atik site config, and production validation accepts it as a valid canonical URL when `BASE_URL` is unset.

Failure scenario: a self-hosting operator skips copying the example because `site-config.json` already exists, then ships Atik metadata, sitemap, footer, title, and OG defaults.

Suggested fix: track only the example config, replace tracked config with production-rejected placeholders, or add an explicit allow/deny gate so Atik config cannot pass accidentally outside this deployment.

### AGG-C25-23 - Production semantic search is hidden behind an icon-only mobile/tablet affordance

Severity: Low-Medium
Confidence: High
Agreement: `designer`, `document-specialist`, `product-marketer-reviewer`
Status: confirmed IA/affordance issue when semantic mode is production.

Citations: `README.md:50`; `apps/web/README.md:67-73`; `apps/web/src/components/nav-client.tsx:145-151`; `apps/web/src/components/search.tsx:380-401`, `536-570`.

Problem: semantic search is a differentiator, but the closed search trigger hides visible text below `lg`; semantic copy appears only after opening the dialog.

Failure scenario: mobile visitors see only a search icon beside utility controls and may miss the feature before guessing the icon.

Suggested fix: when production semantic search is active, show visible mobile/tablet `Search`/`Search photos` text or add a compact first-open hint such as "Keyword or semantic search."

### AGG-C25-24 - Restore scanner is hardened but regex-based

Severity: Medium
Confidence: Medium
Agreement: `security-reviewer`
Status: manual-validation/admin-trust-boundary risk; no bypass found.

Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:745-900`; `apps/web/src/lib/sql-restore-scan.ts:88-156`, `262-341`.

Problem: restore scans whole SQL files with hardened denylist/shape checks, but it is not a complete MySQL parser.

Failure scenario: a compromised admin/session uploads crafted SQL using an unmodeled MySQL grammar edge case, corrupting app data or executing privilege-impacting statements within DB user grants.

Suggested fix: prefer signed app-generated backups or restore into an isolated temp DB with strict verification before swap.

### AGG-C25-25 - Runtime secret provenance and rotation cannot be proven from source

Severity: Low-Medium
Confidence: High
Agreement: `security-reviewer`
Status: manual-validation risk.

Citations: `apps/web/.env.local.example:21-33`, `57-70`; `.env.deploy.example:1-16`; `scripts/deploy-remote.sh:55-80`; `apps/web/deploy.sh:15-43`; `apps/web/src/lib/session.ts:16-35`.

Problem: source and permission guards cannot prove production secrets were generated uniquely or rotated after any historical exposure.

Failure scenario: production reuses old/example secrets or leaked local env material while source checks remain green.

Suggested fix: operator verifies and rotates `SESSION_SECRET`, admin credentials, DB credentials, deploy keys, PATs, and historical bootstrap values.

### AGG-C25-26 - Database backups are plaintext at rest by design

Severity: Low-Medium
Confidence: High
Agreement: `security-reviewer`
Status: accepted-risk/manual-validation candidate.

Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:189-195`, `229-244`; `apps/web/src/app/api/admin/db/download/route.ts:21-31`, `45-67`.

Problem: DB dumps are mode-protected and authenticated through the app, but the SQL files are plaintext on the host.

Failure scenario: host-level access, backup-directory ACL mistakes, or off-host copy exposure reveals full SQL dumps.

Suggested fix: encrypt backup artifacts before final rename with key material outside the app container if the threat model requires at-rest protection beyond host permissions.

### AGG-C25-27 - Host nginx/real-IP limiter topology is not proven by app deploy

Severity: High if proxy topology is wrong; Low-Medium to Medium source confidence
Confidence: Medium
Agreement: `security-reviewer`, `architect`, `critic`, `perf-reviewer`
Status: manual live-host validation risk.

Citations: `apps/web/nginx/default.conf:1-29`, `20-29`, `52-72`, `246-311`; `apps/web/docker-compose.yml:15-23`; `apps/web/deploy.sh:51-77`; `scripts/deploy-remote.sh:31-53`, `87-93`; `apps/web/src/lib/rate-limit.ts:175-217`; `CLAUDE.md:447-449`.

Problem: committed nginx limiter and real-IP assumptions only protect production if the host config was applied and matches the actual proxy/LB topology. Normal deploys rebuild the app container and do not touch host nginx.

Failure scenario: all visitors share an LB IP for app/nginx buckets or public SSR routes lack the intended edge limiter.

Suggested fix: validate live `nginx -T`, real-IP/PROXY protocol, forwarding mode, `TRUSTED_PROXY_HOPS`, and controlled limiter probes after host-nginx changes.

### AGG-C25-28 - Build-time/runtime config split can diverge after restart-only changes

Severity: Medium
Confidence: Medium
Agreement: `architect`, `critic`
Status: operational validation risk.

Citations: `apps/web/next.config.ts:32-40`, `121-125`; `apps/web/Dockerfile:91-120`; `apps/web/docker-compose.yml:4-32`.

Problem: `IMAGE_BASE_URL`, Next image remote patterns, and imported `site-config.json` values are baked at build time while operators may expect restart-only env/file changes to apply.

Failure scenario: runtime env and baked config diverge, yielding stale image optimization, CSP, metadata, or URL behavior while containers remain healthy.

Suggested fix: add a post-deploy baked-vs-runtime config probe or warning.

### AGG-C25-29 - Restore recovery depends on process-local state plus operator restart after out-of-process clear

Severity: Medium
Confidence: High
Agreement: `perf-reviewer`, `debugger`, `tracer`
Status: documented operational risk.

Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:545-695`; `apps/web/src/lib/image-queue.ts:1285-1338`; `apps/web/scripts/restore-maintenance-recovery.mjs:55-85`; `apps/web/src/instrumentation.ts:1-10`.

Problem: the recovery script clears durable maintenance state only; live process-local maintenance/queue state may remain until restart.

Failure scenario: an operator clears the durable marker from a sidecar shell and does not restart the web process, leaving the running process in maintenance/paused state.

Suggested fix: expose both durable and live process maintenance/queue state in recovery/admin status output and keep restart guidance explicit.

### AGG-C25-30 - Fire-and-forget analytics are approximate by contract

Severity: Low now, Medium if promoted to product/audit state
Confidence: High
Agreement: `architect`, `critic`
Status: accepted design risk needing product validation if semantics change.

Citations: `apps/web/src/app/actions/public.ts:435-470`; `apps/web/src/lib/background-db-writes.ts:3-75`; `CLAUDE.md:249`.

Problem: view recording intentionally does not await inserts, uses an in-memory queue, and drops work when pending writes reach a cap.

Failure scenario: process kill, restore window, or DB outage undercounts delivered views if counts are later used for billing, audit, ranking guarantees, or creator reporting.

Suggested fix: keep UI/reporting copy approximate or move events to durable queue/storage before treating them as product-critical state.

## Agent Failures

None after retry. The designer/document/product lane's initial spawn failed due to active thread limits and succeeded on the retry.
