# Cycle 10/100 Aggregate Review

Date: 2026-06-29
Repo: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD range: `ee8e08af` through reviewer artifact commits ending at `0f10f502`

## Reviewer Coverage

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

UI/UX review was in scope because GalleryKit is a Next.js web app. The designer lane used browser evidence for public flows, search, photo detail, lightbox, info sheet, admin login, and responsive checks. The custom `product-marketer-reviewer` and `ui-ux-designer-reviewer` profiles were BurstPick-specific, so they were adapted to GalleryKit and their profile mismatch is noted in their reports.

## Agent Failures

None. The native child-agent runtime capped active subagents, so the fan-out ran in waves rather than one truly simultaneous batch. Every required role and every discovered reviewer-style local agent returned a report.

## Merged Findings

### C10-01 - Public analytics rate limiting runs after unauthenticated DB lookups

Severity: High
Confidence: High
Status: Confirmed
Sources: critic, code-reviewer

Evidence: `apps/web/src/app/actions/public.ts:364-374`, `apps/web/src/app/actions/public.ts:387-402`, `apps/web/src/app/actions/public.ts:414-430`, `apps/web/src/__tests__/public-actions.test.ts:253-301`.

The public photo/topic/shared-group view recorders perform DB visibility lookups before applying the per-IP view-recording limiter. Over-limit or invalid-but-well-formed traffic can continue forcing indexed reads, including the heavier shared-group join.

Suggested fix: apply a cheap pre-lookup limiter after syntactic validation and before DB reads, then keep insert-side protection for visible targets. Add tests proving exhausted clients stop before DB validation.

### C10-02 - Failed re-encode can delete previously good public derivatives

Severity: High
Confidence: High
Status: Confirmed
Sources: critic

Evidence: `apps/web/src/lib/process-image.ts:1136-1145`, `apps/web/src/lib/process-image.ts:1298-1401`, `apps/web/scripts/backfill-color-pipeline.ts:200-236`, `apps/web/src/lib/admin-backfill-runner.ts:500-523`.

`processImageFormats` writes to final public derivative paths during re-encode and records those paths for cleanup. If one format fails after another format already replaced an existing good derivative, the catch block unlinks the recorded final paths, potentially deleting the prior working public files.

Suggested fix: stage derivatives under invocation-unique temp paths and promote only after all formats pass, or restore pre-existing files on failure. Add a regression with pre-existing derivatives and an injected late format failure.

### C10-03 - Image delete cleanup reports success when filesystem unlinks fail

Severity: High
Confidence: High
Status: Confirmed
Sources: debugger

Evidence: `apps/web/src/app/actions/images.ts:56-86`, `apps/web/src/app/actions/images.ts:681-699`, `apps/web/src/app/actions/images.ts:816-859`, `apps/web/src/lib/upload-paths.ts:75-79`, `apps/web/src/lib/process-image.ts:90-101`, `apps/web/src/lib/process-image.ts:573-620`.

The delete actions count cleanup failures only when cleanup operations reject, but original and derivative cleanup helpers swallow non-`ENOENT` unlink failures. Deleted images can leave public derivatives or private originals on disk while the UI reports `cleanupFailureCount: 0`.

Suggested fix: add strict cleanup helpers for deletion paths that treat `ENOENT` as success but return structured failures for other unlink/scan errors. Lock with mocked unlink-failure tests.

### C10-04 - Semantic bootstrap retries only one missing-embedding batch

Severity: Medium
Confidence: High
Status: Confirmed
Sources: verifier

Evidence: `apps/web/src/lib/image-queue.ts:370-410`, `apps/web/src/lib/image-queue.ts:935-954`, `apps/web/src/__tests__/image-queue-embed-wiring.test.ts:45-53`.

On bootstrap, missing active-model semantic embeddings are selected in one capped batch of 50. If more rows are missing and no pending image remains, `state.bootstrapped` becomes true and later bootstrap calls return early, leaving remaining processed photos absent from semantic/similar search.

Suggested fix: drain missing embeddings in bounded passes or schedule continuation whenever the batch is full. Add a test proving a full first batch cannot be terminal.

### C10-05 - Batch upload resolves the same tag set once per file

Severity: Medium
Confidence: High
Status: Confirmed
Sources: perf-reviewer

Evidence: `apps/web/src/app/actions/images.ts:154-164`, `apps/web/src/app/actions/images.ts:308-319`, `apps/web/src/app/actions/images.ts:436-469`, `apps/web/src/lib/tag-records.ts:66-69`.

The upload action parses one batch-level tag list but recomputes and ensures the same tag records inside the per-file loop. A 100-file upload with 10 tags can perform roughly 1000 redundant tag ensure operations.

Suggested fix: resolve unique tag records once before the file loop and reuse them for all image-tag inserts, preserving collision warnings.

### C10-06 - Admin actions authenticate before same-origin rejection

Severity: Low
Confidence: High
Status: Risk / maintainability issue
Sources: code-reviewer

Evidence: `apps/web/src/app/actions/settings.ts:40-47`, `apps/web/src/app/actions/seo.ts:54-61`, `apps/web/src/app/actions/collections.ts:15-118`, `apps/web/src/app/actions/topics.ts:85-189`, `apps/web/src/app/actions/tags.ts:42-106`, `apps/web/src/app/actions/sharing.ts:84-91`, `apps/web/src/app/actions/admin-users.ts:75-190`.

Many mutating admin server actions call `isAdmin()` or `getCurrentUser()` before `requireSameOriginAdmin()`. This is not a confirmed CSRF bypass, but it weakens the fail-fast provenance boundary and makes future side effects before origin rejection easier to miss.

Suggested fix: standardize action prologues as same-origin first, then authentication/current-user lookup, and strengthen the action-origin scanner to detect awaited side effects before the origin return path.

### C10-07 - Image queue jobs can starve the shared DB pool while holding advisory locks

Severity: Medium
Confidence: High
Status: Likely issue
Sources: perf-reviewer

Evidence: `apps/web/src/lib/image-queue.ts:86-89`, `apps/web/src/lib/image-queue.ts:430-447`, `apps/web/src/lib/image-queue.ts:503-621`, `apps/web/src/lib/image-queue.ts:797-799`, `apps/web/src/db/index.ts:23-33`, `apps/web/src/lib/data.ts:1107-1153`.

`QUEUE_CONCURRENCY` can be raised to 8 while each image job holds a pooled MySQL connection and advisory lock across Sharp work. The shared pool has 10 connections, so bulk processing can starve live request DB work.

Suggested fix: avoid holding shared-pool connections across CPU work, use a separate lock pool, or clamp queue concurrency against request-pool headroom.

### C10-08 - GPS stripping reintroduces whole-file heap pressure

Severity: Medium
Confidence: High
Status: Likely issue
Sources: perf-reviewer

Evidence: `apps/web/src/lib/upload-limits.ts:1-3`, `apps/web/src/lib/process-image.ts:862-879`, `apps/web/src/lib/process-image.ts:1673-1699`, `apps/web/src/app/actions/images.ts:350-356`, `apps/web/src/app/api/admin/lr/upload/route.ts:137-145`, `apps/web/src/app/api/admin/lr/upload/route.ts:344-358`.

Uploads stream originals to disk, but GPS stripping reads the entire saved original into memory and writes a scrubbed buffer. Near the 200 MiB file cap this can create large RSS spikes, especially on the Lightroom multipart path.

Suggested fix: use streaming/container-aware GPS scrubbing or add an explicit memory budget/serialization gate for large-file stripping.

### C10-09 - Stale semantic search requests are ignored client-side but not aborted server-side

Severity: Medium
Confidence: High
Status: Likely issue
Sources: perf-reviewer

Evidence: `apps/web/src/components/search.tsx:143-253`, `apps/web/src/app/api/search/semantic/route.ts:232-283`.

The search UI ignores stale responses with request IDs but does not abort in-flight semantic fetches. Old requests can still run CLIP inference, DB scans, and JS scoring after the user types a newer query or closes the dialog.

Suggested fix: use an `AbortController` for semantic fetches and check `request.signal.aborted` at route-side expensive boundaries.

### C10-10 - CLIP inference has a concurrency cap but no backlog cap or timeout

Severity: Medium
Confidence: Medium-High
Status: Risk
Sources: perf-reviewer

Evidence: `apps/web/src/lib/clip-model.ts:53-70`, `apps/web/src/app/api/search/semantic/route.ts:181-239`, `apps/web/src/app/actions/embeddings.ts:129-169`, `apps/web/src/lib/image-queue.ts:333-367`.

Active inference is capped, but pending work waits in an unbounded array. Public semantic bursts or stale requests can grow memory and latency without a clear rejection boundary.

Suggested fix: replace the waiter array with a bounded queue that has timeout, queue-size limits, `503`/`429` behavior, and queue-depth observability.

### C10-11 - Infinite masonry keeps every loaded card mounted

Severity: Low-Medium
Confidence: Medium-High
Status: Risk
Sources: perf-reviewer

Evidence: `apps/web/src/components/home-client.tsx:127-130`, `apps/web/src/components/home-client.tsx:195-360`, `apps/web/src/components/load-more.tsx:41-132`.

Long browse sessions append every loaded page into one React state array and keep all cards mounted. Large galleries can accumulate DOM, accessibility tree, layout, and memory pressure.

Suggested fix: virtualize/window the masonry list or switch infinite loading to a hybrid threshold model with placeholders for far-off pages.

### C10-12 - Archive and smart-collection predicates can become CPU scan paths

Severity: Low-Medium
Confidence: High
Status: Risk
Sources: perf-reviewer

Evidence: `apps/web/src/lib/data-timeline.ts:88-207`, `apps/web/src/lib/smart-collections.ts:217-266`, `apps/web/src/lib/data.ts:1437-1451`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:62-84`.

Timeline and broad smart-collection queries use function predicates or `%LIKE%` contains predicates. They are acceptable at personal-gallery scale but can create DB CPU pressure if public archives are crawled at larger scale.

Suggested fix: use range predicates/generated columns for timeline and indexable/materialized membership for public smart collections.

### C10-13 - Playwright visual checks generate screenshots without assertions

Severity: Medium
Confidence: High
Status: Confirmed quality-gate blind spot
Sources: test-engineer

Evidence: `.context/reviews/test-engineer.md` cites the Playwright visual nav checks as screenshot-producing without visual assertions.

The existing visual smoke checks can produce artifacts without failing on visual regressions. This reduces the value of browser visual coverage.

Suggested fix: add assertions or image/DOM comparisons for the visual checks, or relabel them as artifact capture only and add a real visual assertion path.

### C10-14 - No coverage reporting or threshold gate exists for critical test surfaces

Severity: Low
Confidence: High
Status: Confirmed quality-gate blind spot
Sources: test-engineer

Evidence: `.context/reviews/test-engineer.md` and package scripts.

The repo has broad Vitest coverage but no coverage-reporting or threshold gate, so critical surfaces can lose test reach without detection.

Suggested fix: add targeted coverage reporting/thresholds for critical contracts, or record a deliberate no-coverage-gate policy.

### C10-15 - Some critical behavior is source-contract tested rather than behavior-tested

Severity: Low
Confidence: Medium
Status: Likely TDD opportunity
Sources: test-engineer

Evidence: `.context/reviews/test-engineer.md` cites `backfillClipEmbeddings` action and Atom route behavior.

Some behaviors are protected mostly by source-contract/helper tests instead of route/action behavior tests, leaving refactors vulnerable to preserving strings while changing runtime behavior.

Suggested fix: add focused behavior tests for the backfill action and Atom route when those surfaces change.

### C10-16 - Short-form blocking-gate docs omit Playwright E2E

Severity: Medium
Confidence: High
Status: Confirmed documentation/process mismatch
Sources: document-specialist, test-engineer

Evidence: `AGENTS.md:29-37`, `package.json:18`, `apps/web/package.json:20`, `.github/workflows/quality.yml:72-77`, `CLAUDE.md:575-578`, `apps/web/README.md:23-37`.

`AGENTS.md` labels its quality gate list "all blocking" but omits `npm run test:e2e --workspace=apps/web`, which CI runs. Contributors can follow the short canonical checklist and still fail CI.

Suggested fix: add the E2E command to the short gate list and README scripts, or rename the heading if E2E is intentionally CI-only.

### C10-17 - Service-worker docs describe git-SHA stamping, but code uses template hash

Severity: Low
Confidence: High
Status: Confirmed documentation mismatch
Sources: verifier, document-specialist

Evidence: `CLAUDE.md:407`, `apps/web/scripts/build-sw.ts:4-12`, `apps/web/scripts/build-sw.ts:27-33`, `apps/web/public/sw.js:21-26`.

`CLAUDE.md` says `build-sw.ts` stamps `SW_VERSION` with the git short SHA plus pipeline version. The current generator uses a deterministic service-worker template hash plus pipeline version.

Suggested fix: update `CLAUDE.md` and optionally test the version derivation contract.

### C10-18 - Rate-limit convention docs describe stale semantic rollback semantics

Severity: Low
Confidence: High
Status: Confirmed documentation mismatch
Sources: document-specialist

Evidence: `apps/web/src/lib/rate-limit.ts:17-29`, `apps/web/src/app/api/search/semantic/route.ts:178-255`, `apps/web/src/__tests__/semantic-search-route.test.ts:182-187`, `apps/web/src/__tests__/semantic-search-route.test.ts:380-385`.

The rate-limit helper comments list semantic search under rollback-on-infrastructure-error, but the route intentionally does not roll back after body parsing, embedding, or DB scan work begins.

Suggested fix: rewrite the comments to distinguish cheap pre-work rollback from charged expensive-work failures.

### C10-19 - Playwright is Chromium-only and real CLIP tests are skipped by default

Severity: Low/Medium
Confidence: High
Status: Scheduled/manual validation risk
Sources: test-engineer

Evidence: `.context/reviews/test-engineer.md`.

Browser and real-model coverage depend on scheduled/manual validation rather than the default gate set. This leaves Safari/Firefox and production CLIP behavior dependent on follow-up runs.

Suggested fix: document scheduled validation expectations and add browser/model coverage where cost and credentials allow.

### C10-20 - Semantic scan caps can reduce recall for large galleries

Severity: Medium
Confidence: High
Status: Risk
Sources: tracer

Evidence: `.context/reviews/tracer.md`, semantic scan limit code in `apps/web/src/lib/clip-embeddings.ts` and semantic/similar routes.

Production semantic search scans a capped subset of embedding rows. At large gallery sizes, relevant older embeddings can be outside the scan window and therefore never rank.

Suggested fix: document the recall tradeoff, add health/ops visibility, or move to indexed vector search when gallery size exceeds the scan limit.

### C10-21 - In-app embedding backfill can report success after one capped candidate set

Severity: Low
Confidence: Medium
Status: Risk / likely issue
Sources: tracer

Evidence: `.context/reviews/tracer.md`, `apps/web/src/app/actions/embeddings.ts`.

The in-app embedding backfill path can process one capped candidate set and report success without guaranteeing all eligible rows were embedded.

Suggested fix: expose remaining work or continue in bounded passes.

### C10-22 - Process-local coordination depends on single-instance topology

Severity: Medium
Confidence: High
Status: Risk
Sources: tracer, architect

Evidence: `CLAUDE.md` documents single-instance/process-local assumptions; reports cite process-local queues, rate limits, and buffers.

Scale-out would weaken process-local coordination and public rate limits. This is not a current production mismatch because the repo documents a single web-instance topology.

Suggested fix: keep this as an operational invariant, or move coordination/rate limits to durable/shared storage before scale-out.

### C10-23 - SQL-only restore does not restore filesystem state

Severity: Medium
Confidence: High
Status: Risk
Sources: architect

Evidence: `CLAUDE.md` and DB restore docs.

DB restore intentionally does not snapshot uploaded originals, processed derivatives, or resources. Restoring SQL alone can create DB/filesystem divergence if operators expect a full-site restore.

Suggested fix: keep the UI/docs explicit, or add a full-site backup/restore workflow if product requirements change.

### C10-24 - Production semantic search has a manual rollout invariant

Severity: Low
Confidence: Medium
Status: Risk
Sources: architect

Evidence: `CLAUDE.md`, semantic-search env/config/DB mode docs.

Production semantic search depends on model weights, env opt-in, DB mode, and populated active embeddings. Missing one part can produce 503s or poor search coverage.

Suggested fix: add operator health checks or setup automation.

### C10-25 - Lightbox opens with focus left on `<body>`

Severity: Medium
Confidence: High
Status: Confirmed
Sources: designer

Evidence: `.context/reviews/designer.md`, browser/agent evidence, `apps/web/src/components/lightbox.tsx`.

Opening the lightbox leaves focus on `<body>` instead of moving to a meaningful control inside the modal. Keyboard and assistive-technology users can lose modal context.

Suggested fix: move initial focus into the lightbox modal on open, preserve restore focus on close, and add a focused test.

### C10-26 - Custom modal surfaces need real AT validation

Severity: Medium
Confidence: Medium
Status: Manual-validation risk
Sources: designer

Evidence: `apps/web/src/components/search.tsx`, `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`.

Keyboard focus trapping works in Chromium, but the custom modal surfaces still need VoiceOver/NVDA validation for virtual-cursor background isolation.

Suggested fix: run manual AT checks; if background is reachable, add inert/`aria-hidden` sibling handling or migrate to Radix Dialog.

### C10-27 - Authenticated admin browser coverage remains incomplete

Severity: Low
Confidence: High
Status: Coverage risk
Sources: designer

Evidence: `.context/reviews/designer.md`.

Admin login was browser-tested, but protected admin workflows were source-reviewed only because no reusable auth state/seeded local DB was available.

Suggested fix: provide seeded local DB/auth state for browser review and add smoke coverage for upload, bulk edit, settings, SEO, tags, categories, analytics, and users.

### C10-28 - Lightroom plugin is marketed in-product without artifact or setup path

Severity: Medium
Confidence: High
Status: Confirmed product/trust issue
Sources: product-marketer-reviewer

Evidence: `apps/web/messages/en.json:782-787`, `apps/web/src/app/[locale]/admin/(protected)/tokens/page.tsx:11-24`, `apps/web/src/app/api/admin/lr/upload/route.ts:1-16`, `CLAUDE.md:152`, `README.md:148`, `apps/web/README.md:46`.

The admin UI tells operators to generate tokens for a "GalleryKit Lightroom Classic publish plugin", but the repo does not contain an `.lrplugin`, Lua source, plugin package, setup guide, or download surface.

Suggested fix: ship/link the plugin and setup guide, or relabel the feature as server/API tokens until plugin distribution exists.

### C10-29 - Google Analytics can be enabled without a public privacy/disclosure surface

Severity: Medium
Confidence: Medium
Status: Likely trust/compliance issue
Sources: product-marketer-reviewer

Evidence: `README.md:46-58`, `apps/web/src/site-config.example.json:9-10`, `apps/web/src/app/[locale]/layout.tsx:147-155`, `apps/web/src/components/footer.tsx:42-54`.

When `google_analytics_id` is configured, public pages load Google Analytics, but the default public footer has no privacy/cookie/disclosure link or built-in disclosure page.

Suggested fix: add a minimal privacy/analytics disclosure path and link it when GA is configured, or clearly document operator responsibility.

### C10-30 - GPS stripping is locked after first upload but defaults to retaining GPS

Severity: Low
Confidence: Medium
Status: Product trust risk
Sources: product-marketer-reviewer

Evidence: `apps/web/src/lib/gallery-config-shared.ts:91-97`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:543-572`, `apps/web/src/app/actions/images.ts:347-357`, `apps/web/src/lib/data.ts:367-415`.

The public GPS boundary is guarded, but the first-run product choice defaults to retaining GPS and becomes locked once images exist. Operators can upload before noticing the privacy decision.

Suggested fix: make the GPS choice explicit before first upload, default to stripping for fresh installs, or add a strong upload-page warning until confirmed.

### C10-31 - Shared-group photo links lack action-oriented accessible labels

Severity: Medium
Confidence: High
Status: Confirmed
Sources: ui-ux-designer-reviewer

Evidence: `.context/reviews/ui-ux-designer-reviewer.md`, shared-group public page/link rendering.

Shared-group grid photo links do not use the action-oriented accessible labels used by other gallery grids, reducing clarity for screen-reader users.

Suggested fix: align shared-group photo link labels with main gallery labels and add a source/behavior test.

### C10-32 - Admin row actions use repeated generic accessible names

Severity: Medium
Confidence: High
Status: Confirmed
Sources: ui-ux-designer-reviewer

Evidence: `.context/reviews/ui-ux-designer-reviewer.md`, admin row action components.

Repeated "Edit" and "Delete" labels in admin tables/dialogs do not identify the row target for assistive-technology users.

Suggested fix: include row-specific object names in `aria-label`/accessible names while preserving concise visible text.

### C10-33 - Shared-group masonry lacks the main gallery dimension guard

Severity: Low
Confidence: Medium
Status: Risk
Sources: ui-ux-designer-reviewer

Evidence: `.context/reviews/ui-ux-designer-reviewer.md`, shared-group masonry rendering.

Shared-group masonry cards do not use the same dimension guard as the main gallery. Unexpected or missing dimensions can destabilize layout.

Suggested fix: reuse the main gallery dimension guard or equivalent fallback in shared-group masonry.

## No New Findings

- Security reviewer found no confirmed, likely, or actionable security findings in current HEAD after auth/authz, server action, upload, DB restore, public API, privacy, secrets, and dependency sweeps.
- Architect found no confirmed or likely architectural issues beyond the residual risks recorded above.
- Tracer found no confirmed or likely source defects beyond the residual risks recorded above.

## Deferred-Candidate Notes For Planning

Security, correctness, privacy, and data-loss findings should not be deferred unless a repo rule explicitly permits the deferral and the plan quotes that rule. Performance, coverage, and operational-scale risks may be deferred only with original severity/confidence, concrete reason, and reopen criteria.
