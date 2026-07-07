# Run-10 Cycle 5/100 Aggregate Review

Date: 2026-07-07
Start HEAD reviewed: `591b44bdaa7fb51c2c0ff8aa12d9274563147561`

## Agent Coverage

Callable native agent types in this session were `default`, `explorer`, and `worker`; the named reviewer roles were therefore executed as six bounded reviewer lanes using the `default` agent. The project child-agent concurrency cap allowed five initial lanes; the sixth architecture/docs/UI/custom lane was launched as soon as the code-reviewer lane completed. All lanes returned and wrote their artifacts.

Artifacts written:

- `.context/reviews/code-reviewer.md`
- `.context/reviews/perf-reviewer.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/critic.md`
- `.context/reviews/verifier.md`
- `.context/reviews/test-engineer.md`
- `.context/reviews/tracer.md`
- `.context/reviews/debugger.md`
- `.context/reviews/architect.md`
- `.context/reviews/document-specialist.md`
- `.context/reviews/designer.md`
- `.context/reviews/ui-ux-designer-reviewer.md`
- `.context/reviews/product-marketer-reviewer.md`

## AGENT FAILURES

None. One spawn attempt hit the native thread limit and was retried after a slot was closed; the lane completed successfully.

## Deduped Findings

### C5-01 - Maintenance scheduler is coupled to image-queue bootstrap

- Severity: Medium
- Confidence: High
- Sources: `code-reviewer` CQR5-01, `architect` ARCH-C5-01, `critic` RISK-C5-02, `verifier` RISK-VER-C5-02, `document-specialist` DOC-C5-03
- Files: `apps/web/src/lib/image-queue.ts:1117-1274`, `apps/web/src/instrumentation.ts:1-9`, `apps/web/src/lib/queue-shutdown.ts:7-30`
- Problem: session cleanup, rate-limit bucket cleanup, audit retention, and view retention start from image queue bootstrap instead of an independent instrumentation-owned lifecycle.
- Failure scenario: if image bootstrap is skipped, delayed, or repeatedly fails during restore maintenance/startup, unrelated retention jobs do not run.
- Suggested fix: extract `startMaintenanceScheduler()` / stop hook, start it from instrumentation, and leave queue-local retry pruning queue-owned.

### C5-02 - Embedding bootstrap can overshoot `SEMANTIC_SCAN_LIMIT`

- Severity: Medium
- Confidence: High
- Sources: `critic` CRIT-C5-01, `verifier` VER-C5-01
- Files: `apps/web/src/lib/image-queue.ts:569-595`, `apps/web/src/lib/clip-embeddings.ts:37-44`, `apps/web/src/__tests__/image-queue-embedding-bootstrap-cap.test.ts:161-179`
- Problem: the loop checks the scan cap before each fixed 50-row query, so non-multiple limits like 1, 75, or 101 can scan up to the next 50-row multiple.
- Failure scenario: an operator lowers `SEMANTIC_SCAN_LIMIT=75`, but startup still scans 100 rows and logs the exceeded value.
- Suggested fix: compute remaining scan budget before each query, limit the query to `min(50, remaining)`, and add a non-multiple cap regression test.

### C5-03 - Sidecar color backfill materializes the full candidate table

- Severity: Medium
- Confidence: Medium-High
- Sources: `tracer` TR-1, `debugger` DBG-1, `test-engineer` TE-3
- Files: `apps/web/scripts/backfill-color-pipeline.ts:379-400`, `apps/web/scripts/backfill-color-pipeline.ts:525-560`, `apps/web/src/lib/admin-backfill-runner.ts:401-431`
- Problem: the sidecar says batch size bounds DB reads and memory, but the candidate query has no keyset pagination or `LIMIT`.
- Failure scenario: a forced re-encode on a large gallery reads every candidate into memory before processing concurrency limits help.
- Suggested fix: use a keyset-paginated `LIMIT BATCH_SIZE` loop like the in-app runner and test that only one page is materialized at a time.

### C5-04 - Feed and sitemap freshness ordering lacks matching image indexes

- Severity: Medium
- Confidence: High
- Sources: `perf-reviewer` PERF-C1
- Files: `apps/web/src/lib/data.ts:533-546`, `apps/web/src/lib/data.ts:845-890`, `apps/web/src/lib/data.ts:1718-1729`, `apps/web/src/db/schema.ts:117-123`
- Problem: feed/sitemap queries order by `updated_at DESC, created_at DESC, id DESC` but current indexes are shaped around capture date or created date.
- Failure scenario: larger galleries can force MySQL filesort/temp work for public feed/sitemap and topic freshness queries, competing with foreground traffic.
- Suggested fix: add root and topic processed/updated/created/id indexes, mirror them in schema/migrations/reconcile, and validate with `EXPLAIN`.

### C5-05 - Background analytics writes have no global concurrency/backlog bound

- Severity: Medium
- Confidence: Medium-High
- Sources: `perf-reviewer` PERF-C2
- Files: `apps/web/src/lib/background-db-writes.ts:3-25`, `apps/web/src/app/actions/public.ts:341-529`, `apps/web/src/db/index.ts:23-34`
- Problem: per-IP limits exist, but admitted analytics writes are scheduled immediately into a global promise set with no process-wide queue, pending cap, worker concurrency, or drop/coalesce policy.
- Failure scenario: distributed traffic below per-IP budgets can saturate the MySQL pool/driver queue and compete with foreground reads.
- Suggested fix: add a bounded low-concurrency analytics write queue with explicit overflow/drop/coalesce metrics.

### C5-06 - Service-worker stale image revalidation is not lifetime-covered

- Severity: Medium-Low
- Confidence: Medium
- Sources: `perf-reviewer` PERF-L1
- Files: `apps/web/public/sw.template.js:290-302`, `apps/web/public/sw.template.js:427-430`, `apps/web/src/lib/sw-cache.ts`
- Problem: stale cached images start background revalidation without `event.waitUntil`.
- Failure scenario: the browser can terminate the service worker after returning cached bytes, dropping cache refresh and metadata writes.
- Suggested fix: call `extendLifetime(event, startRevalidate())` and lock it with the SW template/generated-worker contract tests.

### C5-07 - Timeline/on-this-day queries use non-sargable date functions

- Severity: Medium-Low
- Confidence: Medium
- Sources: `perf-reviewer` PERF-L2
- Files: `apps/web/src/lib/data-timeline.ts:88-116`, `apps/web/src/lib/data-timeline.ts:129-142`, `apps/web/src/lib/data-timeline.ts:178-207`, `apps/web/src/app/[locale]/(public)/page.tsx:232-235`
- Problem: `YEAR`, `MONTH`, and `DAY` predicates block efficient use of the existing processed/capture-date index beyond the prefix.
- Failure scenario: public home/timeline/year pages can scan more processed rows as the gallery grows.
- Suggested fix: rewrite year/month queries as ranges; for on-this-day, add generated month/day columns or cache daily results.

### C5-08 - Public LIKE search remains a multi-query leading-wildcard scan

- Severity: Low-Medium
- Confidence: Medium
- Sources: `perf-reviewer` PERF-V2
- Files: `apps/web/src/lib/data.ts:1573-1716`, `apps/web/src/app/actions/public.ts:247-329`
- Problem: `%term%` predicates across multiple fields and joins cannot use ordinary b-tree indexes.
- Failure scenario: one admitted search can scan a large processed image/tag corpus and run multiple fallback query shapes.
- Suggested fix: validate with production-like slow-query data; if hot, move to FULLTEXT/generated search rows or tokenized search.

### C5-09 - Warm-cache service-worker HEAD probes may delay image paint

- Severity: Low-Medium
- Confidence: Medium-Low
- Sources: `perf-reviewer` PERF-V1
- Files: `apps/web/public/sw.template.js:31-39`, `apps/web/public/sw.template.js:365-397`
- Problem: each cached derivative can synchronously attempt a 300 ms HEAD freshness probe before returning cached bytes.
- Failure scenario: warm masonry pages can issue dozens of HEAD probes on high-latency networks, delaying image completion and increasing server load.
- Suggested fix: measure under throttled latency; consider a probe cooldown/age gate/probabilistic strategy if material.

### C5-10 - Dev/build dependency audit remains blocked on vulnerable esbuild transitively via drizzle-kit

- Severity: Medium
- Confidence: High
- Sources: `security-reviewer` SR-C01
- Files: `apps/web/package.json:70-85`, `package-lock.json`, `apps/web/Dockerfile:67-84`, `apps/web/Dockerfile:163-169`
- Problem: current `drizzle-kit@0.31.10` still pulls `@esbuild-kit/* -> esbuild@0.18.20`, triggering GHSA-67mh-4wv8-2f99 in dev/build tooling.
- Failure scenario: affected dev tooling exposed beyond loopback can be read by a malicious browser-origin request. Production runtime risk is reduced by `npm ci --omit=dev`.
- Suggested fix: track upstream `drizzle-kit`; avoid `npm audit fix --force`; optionally test a safe override only if drizzle-kit remains functional.

### C5-11 - Production CSP allows inline styles

- Severity: Low
- Confidence: Medium
- Sources: `security-reviewer` SR-L01
- Files: `apps/web/src/lib/content-security-policy.ts:138-150`
- Problem: production CSP includes `style-src 'self' 'unsafe-inline'`.
- Failure scenario: a future style injection bug could support UI redress or limited data inference even with nonce-based scripts.
- Suggested fix: document the framework tradeoff or move toward style nonces/hashes/static classes where feasible.

### C5-12 - Lightroom upload route lacks executable behavior coverage

- Severity: Medium
- Confidence: High
- Sources: `test-engineer` TE-1, `tracer` TR-2, `debugger` DBG-3
- Files: `apps/web/src/app/api/admin/lr/upload/route.ts:84-609`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-335`, `apps/web/src/app/actions/images.ts:129-653`
- Problem: a large stateful route is covered mostly by source-contract tests rather than an executable route success/failure test.
- Failure scenario: source strings remain present while live `NextRequest.formData`, tracker settlement, lock release, cleanup, or insert-before-enqueue ordering regresses.
- Suggested fix: add behavioral tests for one success path and one late policy rejection, with mocks asserting cleanup, tracker, lock, insert, enqueue, and response shape.

### C5-13 - Restore child-process cleanup lacks failure-mode behavior tests

- Severity: Medium
- Confidence: Medium
- Sources: `test-engineer` TE-2, `tracer` TR-3, `debugger` DBG-2, `security-reviewer` SR-M01
- Files: `apps/web/src/app/[locale]/admin/db-actions.ts:42-80`, `apps/web/src/app/[locale]/admin/db-actions.ts:403-933`, `apps/web/src/__tests__/db-restore.test.ts:47-115`, `apps/web/src/lib/sql-restore-scan.ts:61-265`
- Problem: restore uses many locks, markers, child processes, timeouts, and cleanup paths, but current focused tests assert source shape more than child-process failure behavior.
- Failure scenario: timeout, stream error, nonzero close, or post-migration failure can leak temp files/locks/markers or resume queues incorrectly while source-contract tests pass.
- Suggested fix: extract or inject a child-process runner and test success, nonzero close, timeout kill, stream error, and post-migration failure with final lock/marker/queue assertions.

### C5-14 - CLIP production activation tests are intentionally outside default CI

- Severity: Medium manual-validation risk
- Confidence: High
- Sources: `test-engineer` TE-4, `debugger` DBG-5, `product-marketer-reviewer` PM-C5-03
- Files: `apps/web/src/__tests__/clip-offline-load.test.ts:1-65`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:1-80`, `README.md:42`, `CLAUDE.md:160`
- Problem: real model loading and semantic ranking only run with seeded weights and explicit env flags.
- Failure scenario: model path/provider/runtime drift breaks production activation while default CI remains green.
- Suggested fix: keep manual gate evidence before production activation or CLIP changes; add a CI-light manifest check only if it does not require weights.

### C5-15 - Authenticated admin browser coverage can be skipped in local loops

- Severity: Medium manual-validation risk
- Confidence: Medium
- Sources: `test-engineer` TE-5, `debugger` DBG-5, `ui-ux-designer-reviewer` UXR-C5-M01
- Files: `apps/web/e2e/admin.spec.ts:6-12`, `apps/web/e2e/origin-guard.spec.ts:28-30`, `apps/web/e2e/origin-guard.spec.ts:55-57`
- Problem: local review runs may skip authenticated admin/upload/delete/settings/origin-guard browser flows when credentials are absent.
- Failure scenario: local green gates miss admin browser regressions for changed admin flows.
- Suggested fix: require configured e2e evidence for admin/upload/delete/settings/restore/origin changes or add targeted behavior tests.

### C5-16 - Static derivative setting changes remain operationally stale until backfill

- Severity: Medium manual-validation risk
- Confidence: Medium
- Sources: `test-engineer` TE-6, `tracer` TR-4
- Files: `apps/web/src/app/actions/settings.ts:86-199`, `apps/web/src/lib/serve-upload.ts:240-265`, `CLAUDE.md` cache invalidation/backfill notes
- Problem: settings updates return a backfill warning, but existing static derivative bytes remain unchanged until a backfill runs.
- Failure scenario: an operator saves derivative settings and still serves old dimensions/metadata.
- Suggested fix: preserve/runbook-test the warning and backfill affordance together; do not treat save success as byte update.

### C5-17 - Delete flow clears queue state before DB/file deletion

- Severity: Low
- Confidence: Low
- Sources: `tracer` TR-5, `debugger` final sweep
- Files: `apps/web/src/app/actions/images.ts:707-756`, `apps/web/src/app/actions/images.ts:825-923`, `apps/web/src/lib/image-queue.ts:378-480`
- Problem: delete cancels queue state before subsequent DB/file deletion work completes.
- Failure scenario: if deletion fails after queue state clears, an image can remain in DB without the previous queued/processing state.
- Suggested fix: add logging or a focused regression test documenting that this partial state is intentional and recoverable.

### C5-18 - `ProcessingQueueState` remains too broad

- Severity: Low-Medium
- Confidence: Medium
- Sources: `architect` ARCH-C5-02
- Files: `apps/web/src/lib/image-queue.ts:317-433`
- Problem: queue work, retry maps, permanent failure diagnostics, bootstrap cursors/timers, shutdown, maintenance interval, embedding scan state, and retry timers share one global mutable object.
- Failure scenario: future state additions can miss hot-reload backfill, malformed-state replacement, shutdown, or retry paths.
- Suggested fix: incrementally split sub-objects with explicit initializer/backfill/reset owners, starting with maintenance and embedding scan state.

### C5-19 - Public PWA docs overstate visited-image caching for CDN deployments

- Severity: Medium docs/product issue
- Confidence: High
- Sources: `document-specialist` DOC-C5-01, `product-marketer-reviewer` PM-C5-01, `architect` ARCH-C5-M01
- Files: `README.md:43`, `README.md:146-163`, `apps/web/README.md:49-51`, `CLAUDE.md:427-434`, `apps/web/public/sw.template.js:323-334`
- Problem: README copy says visited image caching while `IMAGE_BASE_URL` can move derivatives to a cross-origin CDN that the SW intentionally does not cache.
- Failure scenario: an operator enables CDN derivatives and expects visited-photo offline resilience that does not exist.
- Suggested fix: update public docs to say visited-image caching applies to same-origin derivative responses; CDN-origin derivatives are network-only unless proxied same-origin.

### C5-20 - Smart collections are public/action-real but not admin-operable

- Severity: Medium product/UX issue
- Confidence: High
- Sources: `document-specialist` DOC-C5-02, `designer` DES-C5-M03, `ui-ux-designer-reviewer` UXR-C5-01, `product-marketer-reviewer` PM-C5-02
- Files: `CLAUDE.md:162`, `apps/web/src/app/actions/collections.ts:16-150`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84-164`, `apps/web/src/components/admin-nav.tsx:15-25`
- Problem: smart-collection actions and public rendering exist, but no admin UI or nav exposes safe authoring.
- Failure scenario: contributors/operators infer a shipped admin feature and resort to direct DB writes or product copy overclaims.
- Suggested fix: either ship an admin Collections workflow or keep authoring clearly internal and avoid marketing/admin-doc claims.

### C5-21 - Search shortcut copy may mislead non-Mac users

- Severity: Low
- Confidence: Medium
- Sources: `designer` DES-C5-01, `ui-ux-designer-reviewer` UXR-C5-02
- Files: `apps/web/src/components/search.tsx:138-142`, `apps/web/src/components/search.tsx:516-522`, `apps/web/e2e/public.spec.ts:21-59`
- Problem: shortcut hint defaults toward Mac when `navigator` is unavailable; tests do not assert non-Mac footer copy.
- Failure scenario: Windows/Linux users see `⌘K` instead of `Ctrl+K`.
- Suggested fix: use neutral `Ctrl/Command K` copy or mount-time platform detection with non-Mac e2e coverage.

### C5-22 - Live Core Web Vitals were not measured

- Severity: Medium manual-validation risk
- Confidence: Medium
- Sources: `designer` DES-C5-M01, `ui-ux-designer-reviewer` UXR-C5-M02, `product-marketer-reviewer` PM-C5-M01
- Files: public home/topic/photo/share flows and mobile admin routes
- Problem: source/tests cover many behavior invariants, but no LCP/CLS/INP capture was run in this review lane.
- Failure scenario: photo-heavy pages can regress perceived performance while unit/e2e behavior tests remain green.
- Suggested fix: run browser performance traces on representative data before external launch or after performance-sensitive changes.

### C5-23 - Future RTL locale support is structural but not product-ready

- Severity: Low manual-validation risk
- Confidence: Medium
- Sources: `designer` DES-C5-M02
- Files: `apps/web/src/app/[locale]/layout.tsx:103-109`, `apps/web/src/lib/locale-path.ts:37-40`
- Problem: `dir` support exists, but shipped locales are English/Korean and no RTL rendering tests exist.
- Failure scenario: adding an RTL locale can expose directional spacing, icon, focus, and layout issues.
- Suggested fix: run a targeted RTL design/test pass before adding an RTL locale.

### C5-24 - Proxy trust and edge limiter behavior require deployment validation

- Severity: Medium manual-validation risk
- Confidence: Medium
- Sources: `security-reviewer` SR-M02, `security-reviewer` SR-M03, `architect` ARCH-C5-M02
- Files: `apps/web/src/lib/request-origin.ts:45-107`, `apps/web/src/lib/rate-limit.ts:78-205`, `apps/web/docker-compose.yml:15-23`, `apps/web/nginx/default.conf`, `CLAUDE.md` deploy/nginx sections
- Problem: origin reconstruction, rate-limit attribution, and edge limiter claims depend on real proxy/header/nginx topology.
- Failure scenario: untrusted forwarded headers or horizontal scale can multiply/defeat per-IP budgets or origin assumptions.
- Suggested fix: keep single-instance/trusted-proxy assumptions explicit and capture spoofed-header plus nginx limiter smoke evidence when deployment topology changes.

### C5-25 - Plaintext DB backups rely on host/file permissions

- Severity: Medium manual-validation risk
- Confidence: Medium
- Sources: `security-reviewer` SR-M04
- Files: `apps/web/src/app/[locale]/admin/db-actions.ts:196-353`
- Problem: backups are mode-restricted but plaintext at rest.
- Failure scenario: host account, bind mount, disk, or off-host backup compromise exposes backup contents.
- Suggested fix: validate host volume permissions and encrypt/access-control off-host copies.

## New Findings Count

Deduped findings produced this cycle: 25.
