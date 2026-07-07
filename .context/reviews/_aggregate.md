# Cycle 20 Aggregate Review

Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Cycle: review-plan-fix 20/100
Review HEAD: `bd0cc170412b0f70ae231cec27ca54ee50e638fd`
Implemented source HEAD: `d8e604ef1033584fe09046a921e3d0de9d39b767`

## Agent Coverage

Reports ingested:

- `.context/reviews/architect.md`
- `.context/reviews/code-reviewer.md`
- `.context/reviews/critic.md`
- `.context/reviews/debugger.md`
- `.context/reviews/designer.md`
- `.context/reviews/document-specialist.md`
- `.context/reviews/perf-reviewer.md`
- `.context/reviews/product-marketer-reviewer.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/test-engineer.md`
- `.context/reviews/tracer.md`
- `.context/reviews/verifier.md`

Agent failures: the first cycle-20 subagent stalled before a usable report; a replacement subagent produced review artifacts and one pushed test-risk commit, then stalled. The orchestrator recovered the cycle directly, preserved all per-agent reports, finished aggregation/planning, implemented the bounded high-confidence fixes, and deployed the source commit.

Raw findings before dedupe: 62.
Unique deduped findings: 37.
Strongest cross-agent agreement: restore drain ordering, mutation-barrier lint false-greens, revocable photo-page offline caching, duplicated upload ingest contracts, multipart materialization, queue/backfill/shared-pool pressure, request-local public discovery scans, map payload scale, process-local topology limits, source-contract test debt, browser/e2e coverage gaps, and stale cycle ledgers.

## Findings

### AGG-C20-01 - Restore can hang before the bounded drain checklist runs

- Severity: High
- Confidence: High
- Status: fixed in `d8e604ef`
- Source findings: `TRC20-01`, `VER-C20-01`
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:560-611`, `apps/web/src/lib/data.ts:75-155`, `apps/web/src/lib/restore-drain-checklist.ts:20-50`, `apps/web/src/__tests__/restore-drain-checklist.test.ts:74-115`
- Problem: restore entered durable maintenance and then directly awaited `flushBufferedSharedGroupViewCounts()` before the timeout-aware drain checklist.
- Failure scenario: a stuck shared-group flush can hold the site in restore maintenance indefinitely before restore reaches the bounded abort path.
- Fix: move shared-group view-count flushing into `runRestoreDrainChecklist()` through a bounded `drainSharedGroupViewCountsForRestore()` stage and update tests to reject the pre-checklist flush shape.

### AGG-C20-02 - Mutation-barrier lint gate accepts spoofed or non-disposable barrier calls

- Severity: High
- Confidence: High
- Status: fixed in `d8e604ef`
- Source findings: `TRC20-02`, `VER-C20-02`, `DBG-C20-01`
- Citations: `apps/web/scripts/check-action-origin.ts:148-164`, `apps/web/scripts/check-action-origin.ts:1371-1397`, `apps/web/src/__tests__/check-action-origin.test.ts:618-630`, `apps/web/src/lib/admin-mutation-barrier.ts:67-80`
- Problem: the scanner counted any call expression named `acquireAdminMutationSlot` without proving the approved import, `using` disposable lifetime, or `slot.acquired` early return.
- Failure scenario: a future admin mutation can pass `lint:action-origin` while not actually holding the restore write fence, reopening the restore-window write race.
- Fix: resolve import provenance from `@/lib/admin-mutation-barrier`, require a `using` slot declaration, require an acquired-state gate before mutation, and add negative fixtures for spoofed, wrong-module, bare-call, non-using, and missing-acquired cases.

### AGG-C20-03 - Offline HTML cache can resurrect deleted photo pages

- Severity: Medium
- Confidence: High
- Status: fixed in `d8e604ef`
- Source findings: `VER-C20-03`, `DBG-C20-02`, `CRIT20-03`
- Citations: `apps/web/public/sw.template.js:31-34`, `apps/web/public/sw.template.js:59-63`, `apps/web/public/sw.template.js:445-499`, `apps/web/public/sw.template.js:554-562`, `apps/web/src/app/actions/images.ts:655-756`
- Problem: normal `/p/:id` photo pages were eligible for 24-hour offline HTML fallback even though delete/unpublish state must be fresh.
- Failure scenario: a browser that cached a photo page before deletion could go offline and see the stale page shell and metadata after the photo was removed.
- Fix: treat localized and unlocalized `/p/:id` photo pages as revocable HTML, bypass offline fallback, regenerate `sw.js`, and expand the service-worker route classifier tests.

### AGG-C20-04 - Browser and PAT uploads duplicate one ingest transaction contract

- Severity: High
- Confidence: High
- Source findings: `ARCH20-01`, `CRIT20-01`
- Citations: `apps/web/src/app/actions/images.ts:129-653`, `apps/web/src/app/api/admin/lr/upload/route.ts:84-634`
- Problem: browser uploads and Lightroom/PAT uploads independently own config snapshots, quota settlement, topic validation, original save, metadata normalization, DB insert, queue payloads, audit, cleanup, and revalidation.
- Failure scenario: a future privacy, color/HDR, metadata, queue, or cleanup invariant is added to one adapter and missed in the other.
- Suggested fix: extract a shared authenticated ingest service with parity tests; keep only auth, request parsing, and response shaping in the two adapters.

### AGG-C20-05 - Large binary ingress still depends on framework multipart materialization

- Severity: High
- Confidence: High
- Source findings: `ARCH20-02`, `DBG-C20-04`
- Citations: `apps/web/src/app/actions/images.ts:129-263`, `apps/web/src/app/api/admin/lr/upload/route.ts:101-181`, `apps/web/src/app/[locale]/admin/db-actions.ts:400-407`, `apps/web/src/app/[locale]/admin/db-actions.ts:693-714`, `apps/web/next.config.ts:111-119`, `apps/web/src/lib/upload-limits.ts:1-33`
- Problem: large upload and restore requests reach application code as framework-parsed `FormData`/`File` objects before most domain checks or disk streaming.
- Failure scenario: valid near-limit requests can spike RSS/temp pressure in the same single web process that serves public pages and runs Sharp/CLIP work.
- Suggested fix: move large binary ingress to streaming Route Handlers with pre-parse length checks, per-part limits, a shared large-body semaphore, temp-file handoff, and shared upload/restore services.

### AGG-C20-06 - Upload queue and admin backfill budget independently against the same DB/CPU pool

- Severity: High
- Confidence: High
- Source findings: `ARCH20-04`, `C20-PERF-01`, `CRIT20-MV-01`
- Citations: `apps/web/src/db/index.ts:31-45`, `apps/web/src/lib/image-queue.ts:121-153`, `apps/web/src/lib/image-queue.ts:868-883`, `apps/web/src/lib/admin-backfill-runner.ts:106-143`, `apps/web/src/lib/admin-backfill-runner.ts:716-727`, `apps/web/src/lib/process-image.ts:1205-1418`
- Problem: foreground image processing and admin backfill each compute safe-looking concurrency from the same pool without accounting for the other lane.
- Failure scenario: fresh uploads plus in-app color/format backfill can oversubscribe DB connections, libvips CPU, and public request latency.
- Suggested fix: introduce a process-wide background-work budget shared by queue, backfills, semantic/bootstrap work, and heavy side effects; acquire DB/CPU tokens before locks and Sharp work.

### AGG-C20-07 - Public keyword search still uses leading-wildcard multi-query scans

- Severity: Medium
- Confidence: High
- Source findings: `ARCH20-05`, `CRIT20-06`, `C20-PERF-03`
- Citations: `apps/web/src/app/actions/public.ts:247-329`, `apps/web/src/lib/data.ts:1574-1749`, `apps/web/src/lib/sql-like.ts:9-10`
- Problem: accepted public searches can run `%term%` scans across image, topic, tag, alias, camera, and lens fields.
- Failure scenario: varied short queries within rate limits burn MySQL CPU and pool slots in the same process as dynamic pages.
- Suggested fix: use MySQL full-text/ngram or a maintained search-document table, add query plan fixtures, and consider a higher minimum length or short TTL cache while migrating.

### AGG-C20-08 - Public smart collections can run expensive dynamic predicates on every hit

- Severity: Medium
- Confidence: Medium
- Source findings: `ARCH20-05`, `C20-PERF-04`
- Citations: `apps/web/src/lib/smart-collections.ts:142-352`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:96-112`, `apps/web/src/lib/data.ts:1488-1551`
- Problem: public smart collections parse, compile, count, and execute dynamic predicates, including text/tag `contains`, on uncached requests.
- Failure scenario: a broad public collection can force repeated unindexed scans while only a small first page is rendered.
- Suggested fix: cost-classify predicates at save time, restrict or warn on non-sargable public predicates, and materialize expensive public collections.

### AGG-C20-09 - Semantic and similar-photo routes perform request-local vector scans in Node

- Severity: Medium
- Confidence: High
- Source findings: `ARCH20-05`, `CRIT20-05`, `C20-PERF-05`
- Citations: `apps/web/src/db/schema.ts:292-304`, `apps/web/src/lib/clip-embeddings.ts:22-48`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`
- Problem: every admitted semantic/similar request can load embedding blobs from MySQL, decode vectors, and score them in the Next request process.
- Failure scenario: production semantic traffic competes with page rendering, image processing, and backfills for heap, CPU, and DB bandwidth.
- Suggested fix: move vector search to an ANN/vector index, sidecar, or process-owned preloaded matrix with generation invalidation and explicit concurrency/backpressure.

### AGG-C20-10 - Public map ships one large exact-coordinate SSR/client payload

- Severity: Medium
- Confidence: High
- Source findings: `ARCH20-06`, `CRIT20-04`
- Citations: `apps/web/src/app/[locale]/(public)/map/page.tsx:13-14`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-110`, `apps/web/src/lib/data.ts:1766-1816`, `apps/web/src/components/map/map-client.tsx:77-139`, `apps/web/src/db/schema.ts:123-131`
- Problem: `/map` can serialize up to 10,000 exact coordinates and hydrate one Leaflet marker plus a fallback list entry per photo.
- Failure scenario: large location-rich galleries can stall mobile browsers and disclose the full opted-in coordinate set to every visitor.
- Suggested fix: use viewport/bbox APIs, clustering, lower initial payloads, a spatial/geohash index, and paginated/virtualized accessible list output.

### AGG-C20-11 - Map markers have generic accessible names

- Severity: Low-Medium
- Confidence: High
- Source findings: `DES-C20-02`
- Citations: `apps/web/src/components/map/map-client.tsx:120-137`, `apps/web/src/app/[locale]/(public)/map/page.tsx:80-110`
- Problem: Leaflet marker controls are exposed as repeated `button "Marker"` entries before their popups open.
- Failure scenario: keyboard and screen-reader users cannot distinguish multiple geotagged photo markers without opening each popup or skipping to the fallback list.
- Suggested fix: pass `title`/`alt` marker options or synchronize accessible attributes after render while keeping the fallback list.

### AGG-C20-12 - Gallery listing indexes omit the final `id` ordering and cursor key

- Severity: Medium
- Confidence: Medium
- Source findings: `C20-PERF-02`
- Citations: `apps/web/src/db/schema.ts:123-131`, `apps/web/src/lib/data.ts:761-783`, `apps/web/src/lib/data.ts:806-828`, `apps/web/src/lib/data.ts:918-939`, `apps/web/src/lib/data.ts:1498-1544`
- Problem: listing and smart-collection queries order/page by `capture_date`, `created_at`, and `id`, but the main indexes stop at `created_at`.
- Failure scenario: large tie groups can require extra sorting/temp-table work in dynamic public pages.
- Suggested fix: add full-order composite indexes, validate with production-sized `EXPLAIN ANALYZE`, and retire overlapping indexes only after measured proof.

### AGG-C20-13 - Single-instance topology is warn-only despite process-local correctness state

- Severity: Medium
- Confidence: High
- Source findings: `ARCH20-03`, `CRIT20-08`, `SEC-20-02`
- Citations: `apps/web/src/lib/upload-tracker-state.ts:7-78`, `apps/web/src/lib/rate-limit.ts:78-109`, `apps/web/src/lib/rate-limit.ts:404-427`, `apps/web/src/lib/data.ts:13-63`, `apps/web/src/lib/single-writer-guard.ts:6-16`, `apps/web/src/lib/single-writer-guard.ts:218-235`, `apps/web/src/instrumentation.ts:22-31`
- Problem: the supported deploy is single web-instance, but singleton contention logs and serving continues.
- Failure scenario: an accidental second process splits upload quotas, fast-path limiters, restore state, queue process state, and view buffers.
- Suggested fix: fail closed in production on persistent singleton contention unless an explicit unsafe override is set, or move the listed controls to shared durable state before scale-out.

### AGG-C20-14 - Public SSR flood protection depends on manually applied host nginx state

- Severity: Medium
- Confidence: High for repo/deploy mismatch; Medium for live exposure
- Source findings: `ARCH20-MV01`, `CRIT20-09`, `SEC-20-01`
- Citations: `CLAUDE.md:247`, `CLAUDE.md:510-522`, `apps/web/nginx/default.conf:1-29`, `apps/web/nginx/default.conf:274-306`, `apps/web/deploy.sh:51-107`, `scripts/deploy-remote.sh:31-93`
- Problem: `npm run deploy` rebuilds the app container but does not apply or verify host nginx rate-limit/body-cap templates.
- Failure scenario: operators believe committed edge protections are live while dynamic public SSR pages reach Next/MySQL without the intended page limiter.
- Suggested fix: add live nginx config hash/version verification to deploy or a required release step, and consider a cheap app-layer fallback limiter around public page data loaders.

### AGG-C20-15 - Cached shared-group data access owns a view-count side effect

- Severity: Medium
- Confidence: Medium
- Source findings: `ARCH20-07`, `TRC20-03`, `VER-C20-L01`, `DBG-C20-03`
- Citations: `apps/web/src/lib/data.ts:49-63`, `apps/web/src/lib/data.ts:1392-1407`, `apps/web/src/lib/data.ts:1830-1834`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-142`, `apps/web/src/app/actions/public.ts:518-559`
- Problem: `getSharedGroupCached = cache(getSharedGroup)` wraps a reader that can buffer denormalized view-count side effects.
- Failure scenario: metadata/preload/layout reads with different options can make React cache call order decide whether denormalized and durable counters agree.
- Suggested fix: split pure cached group reads from explicit view-recording orchestration and test repeated reads as side-effect-free.

### AGG-C20-16 - Topic slug remains a mutable natural key with manual fan-out

- Severity: Medium
- Confidence: Medium-High
- Source findings: `ARCH20-08`, `CRIT20-07`
- Citations: `apps/web/src/db/schema.ts:10-40`, `apps/web/src/db/schema.ts:251-260`, `apps/web/src/app/actions/topics.ts:287-372`, `apps/web/src/__tests__/topic-slug-fk-registry.test.ts:1-79`
- Problem: topic rename recreates the primary-key slug and manually repoints known children and JSON sites.
- Failure scenario: a future slug-bearing store outside the registry can keep pointing at the deleted slug after rename.
- Suggested fix: migrate to immutable topic IDs with mutable route/display slugs, or require every slug persistence site to declare tested rename behavior.

### AGG-C20-17 - Claim-exhaustion permanent failures bypass the bounded-set eviction contract

- Severity: Medium
- Confidence: High
- Source findings: `CR20-01`
- Citations: `apps/web/src/lib/image-queue.ts:112-113`, `apps/web/src/lib/image-queue.ts:320-324`, `apps/web/src/lib/image-queue.ts:767`, `apps/web/src/lib/image-queue.ts:1029-1041`, `apps/web/src/lib/image-queue.ts:1155-1156`, `apps/web/src/__tests__/image-queue-permanent-failure.test.ts:56-63`
- Problem: the normal permanent-failure branch enforces FIFO eviction, but claim-exhausted jobs add to `permanentlyFailedIds` without the cap helper.
- Failure scenario: sustained claim-lock anomalies can grow the process-local set and `NOT IN (...)` bootstrap predicate beyond the documented cap.
- Suggested fix: route all permanent-failure add sites through one helper that caps the set and cleans stale retry/error maps; test the claim-exhaustion path past the cap.

### AGG-C20-18 - Upload quota settlement depends on local discipline after synchronous preclaim

- Severity: Medium
- Confidence: Medium-High
- Source findings: `CRIT20-02`
- Citations: `apps/web/src/app/actions/images.ts:259-269`, `apps/web/src/app/actions/images.ts:563-578`, `apps/web/src/app/api/admin/lr/upload/route.ts:160-188`, `apps/web/src/lib/upload-tracker.ts:19-33`, `apps/web/src/lib/upload-tracker-state.ts:70-78`
- Problem: quota settlement is an ad hoc closure pattern repeated across upload paths.
- Failure scenario: a future throwing cleanup or inserted awaited branch can leak process-local count/bytes until the window resets.
- Suggested fix: introduce a `withUploadQuotaClaim(...)` helper or claim object with exactly-once settlement in `finally` and tests for thrown cleanup/mid-claim failures.

### AGG-C20-19 - Multiple root admins remain a deliberate single-factor authz model

- Severity: Low
- Confidence: High
- Source findings: `SEC-20-03`
- Citations: `CLAUDE.md:248`, `CLAUDE.md:649-650`, `apps/web/src/app/actions/admin-users.ts:79-92`, `apps/web/src/app/actions/admin-users.ts:194-218`, `apps/web/src/app/actions/auth.ts:216-253`
- Problem: one compromised admin password/session grants full root privileges, including DB backup/restore and PAT/admin management.
- Failure scenario: existing password hashing, rate limits, sessions, and audit logs reduce likelihood but no second factor or role boundary exists for destructive operations.
- Suggested fix: add optional WebAuthn/TOTP and step-up auth for DB restore, backup download, token creation, and admin-user management, or introduce capability roles.

### AGG-C20-20 - Production CSP still allows inline styles

- Severity: Low
- Confidence: High
- Source findings: `SEC-20-04`
- Citations: `apps/web/src/lib/content-security-policy.ts:182-190`, `apps/web/src/lib/safe-json-ld.ts:14-19`
- Problem: production `style-src` includes `'unsafe-inline'`.
- Failure scenario: a future HTML/style injection sink could support UI redress or deceptive overlays even though script nonce policy blocks JavaScript.
- Suggested fix: test framework-supported style nonces/hashes or extracted styles before removing the allowance.

### AGG-C20-21 - Historical review logs contain redacted secret-like lines

- Severity: Low
- Confidence: High
- Source findings: `SEC-20-05`
- Citations: `.context/reviews/logs-cycle4/security-reviewer.log:158-159`, `.context/reviews/logs-cycle4/security-reviewer.log:19495-19496`, `README.md:152-153`, `CLAUDE.md:81-82`, `apps/web/.env.local.example:27-33`
- Problem: tracked historical logs contain redacted secret-shaped assignments.
- Failure scenario: alert fatigue normalizes committing raw transcripts; a future failed redaction could expose live secrets.
- Suggested fix: summarize review logs instead of committing raw terminal transcripts, or add a tracked-secret guard for `.context/reviews/logs-*` with strict redaction allowlists.

### AGG-C20-22 - `.env.local.example` underspecified `DB_SSL_CA` runtime impact

- Severity: Low-Medium
- Confidence: High
- Status: fixed in this docs pass
- Source findings: `DOC-C20-01`
- Citations: `apps/web/.env.local.example:1-10`, `apps/web/src/db/index.ts:7-18`, `apps/web/scripts/mysql-connection-options.js:13-29`, `apps/web/drizzle.config.ts:5-17`, `CLAUDE.md:94`, `README.md:173`, `apps/web/README.md:52`
- Problem: the sample env file said `DB_SSL_CA` was required for CLI TLS, but runtime and Drizzle Kit also fail closed for non-local verified TLS without it.
- Failure scenario: an operator omits the CA for remote MySQL and the app or migration tooling fails before serving.
- Fix: update the example comment to name runtime, Drizzle Kit, and backup/restore CLI TLS.

### AGG-C20-23 - Plan index and carry-forward ledgers were stale for the current cycle

- Severity: Medium for agent/process safety
- Confidence: High
- Status: fixed by this aggregate and cycle-20 plan/deferred pair
- Source findings: `DOC-C20-02`, `DOC-C20-L01`, `CRIT20-MV-03`
- Citations: `.context/plans/README.md:34-57`, `.context/reviews/_aggregate.md:1-7`, `.context/plans/cycle-20-plan.md:1-5`, `.context/plans/cycle-21-plan.md:1-5`, `.context/plans/cycle-22-plan.md:1-5`, `.context/plans/deferred-carry-forward.md:19-24`
- Problem: the plan index still pointed at run-10 cycle 19 and loop-B cycle 9 as active, the aggregate was still cycle 19, and bare cycle-20/21/22 files remained ambiguous.
- Failure scenario: future agents can read stale plans as active, skip cycle-20 findings, or cite the wrong aggregate.
- Fix: replace `_aggregate.md`, add dated cycle-20 plan/deferred files, refresh the active-plan index, disambiguate bare names, and update the carry-forward check.

### AGG-C20-24 - ESLint warnings are allowed to pass the blocking lint gate

- Severity: Medium
- Confidence: High
- Source findings: `C20-TE-01`
- Citations: `apps/web/eslint.config.mjs:18-29`, `apps/web/package.json:13-15`, `.github/workflows/quality.yml:54-55`
- Problem: `@typescript-eslint/no-unused-vars` is warning-level and `npm run lint` does not use `--max-warnings=0`.
- Failure scenario: unused/dead code can satisfy source-string assertions while CI remains green.
- Suggested fix: make warnings blocking or restore unused-vars to error while keeping underscore ignore patterns.

### AGG-C20-25 - Touch-target audit warning budgets can hide primitive regressions

- Severity: Medium
- Confidence: High
- Source findings: `C20-TE-02`
- Citations: `apps/web/src/__tests__/touch-target-audit.test.ts:97-117`, `apps/web/src/__tests__/touch-target-audit.test.ts:188-243`, `apps/web/src/__tests__/touch-target-audit.test.ts:769-803`, `apps/web/src/components/ui/button.tsx:23-30`
- Problem: nonzero per-file warning budgets can still pass if a button primitive regresses below 44 px.
- Failure scenario: existing controls become real touch-target violations while the audit only catches new uses beyond the budget.
- Suggested fix: assert every button size variant carries a >=44 px class and retire budgets that are only historical primitive allowances.

### AGG-C20-26 - i18n parity checks do not compare placeholder sets

- Severity: Medium
- Confidence: High
- Source findings: `C20-TE-04`
- Citations: `apps/web/src/__tests__/i18n-key-parity.test.ts:13-20`, `apps/web/src/__tests__/i18n-key-parity.test.ts:135-168`, `apps/web/messages/en.json:156-177`, `apps/web/messages/ko.json:156-177`
- Problem: locale tests compare leaf keys and duplicate keys, but not placeholder-name parity.
- Failure scenario: a translation can keep the same key while dropping or renaming `{current}`, `{total}`, `{failed}`, or another runtime argument.
- Suggested fix: extract placeholders from every leaf value and compare placeholder-name sets across locales, with ICU support.

### AGG-C20-27 - Source contracts over-represent high-risk behavior coverage

- Severity: Medium
- Confidence: High
- Source findings: `CRIT20-11`, `C20-TE-05`
- Citations: `apps/web/src/__tests__/cycle-20-source-contracts.test.ts:8-82`, `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:42-77`, `apps/web/src/__tests__/load-more-source-contracts.test.ts:7-30`, `apps/web/src/components/search.tsx:163-281`, `apps/web/src/components/load-more.tsx:43-111`
- Problem: some safety-critical branch/order/cleanup claims are protected by strings instead of executed behavior.
- Failure scenario: a refactor leaves expected strings in a dead branch while active behavior regresses.
- Suggested fix: keep source contracts for mechanical boundaries only and add behavior tests or pure state-machine tests for client search/load-more, rate-limit charging, cleanup, and query-limit flows.

### AGG-C20-28 - Migration reconcile coverage is not a structural schema proof

- Severity: High
- Confidence: High
- Source findings: `C20-TE-06`
- Citations: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-103`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:175-180`, `apps/web/scripts/migrate.js:348-493`
- Problem: tests mostly prove names appear in `migrate.js`; they cannot prove column types, defaults, nullability, index order, charsets, collations, or FK actions.
- Failure scenario: a reconcile-baselined database can diverge structurally from migrated schema while name-presence tests pass.
- Suggested fix: add disposable MySQL integration that runs reconcile/baseline and diffs `information_schema` against the schema/migration contract.

### AGG-C20-29 - Backup/restore child-process paths rely heavily on source pins

- Severity: High
- Confidence: Medium
- Source findings: `C20-TE-07`
- Citations: `apps/web/src/__tests__/db-restore.test.ts:47-136`, `apps/web/src/app/[locale]/admin/db-actions.ts:137-260`
- Problem: important child-process success/failure/timeout/trailer/cleanup guarantees are asserted through source substrings and ordering.
- Failure scenario: executable behavior around `mysqldump`/`mysql` exits, timeouts, stream flushing, tmp-file handoff, or lock release can break while source pins still pass.
- Suggested fix: add a test harness with stub binaries injected through `PATH` and temp backup dirs covering success, nonzero exits, timeout, truncated trailer, bad header, write errors, migration failure, and lock-release failure.

### AGG-C20-30 - Browser, admin, SW/PWA, CLIP, and visual coverage gaps remain

- Severity: Medium
- Confidence: High
- Source findings: `C20-TE-03`, `C20-TE-08`, `C20-TE-09`, `C20-TE-10`, `C20-TE-11`, `VER-C20-T01`, `CRIT20-10`
- Citations: `apps/web/playwright.config.ts:72-77`, `.github/workflows/quality.yml:69-83`, `apps/web/e2e/admin.spec.ts:20-165`, `apps/web/e2e/nav-visual-check.spec.ts:40-86`, `apps/web/src/components/register-service-worker.tsx:13-23`, `apps/web/src/__tests__/sw-template-contract.test.ts:1-16`, `apps/web/scripts/build-sw.ts:27-43`
- Problem: standard browser checks are desktop Chromium only, many admin workflows are credential-gated or shallow, SW behavior is not installed/offline-tested in a browser, CLIP real-weight tests are scheduled/manual, and nav screenshots are saved but not compared.
- Failure scenario: mobile WebKit/touch, hydrated admin flows, production SW registration/offline behavior, real CLIP model layout, or visual regressions can ship despite green local gates.
- Suggested fix: add mobile WebKit/mobile Chromium smoke projects, workflow-tagged admin e2e, production Playwright PWA coverage, CLIP path-filtered preflight, and screenshot baselines or clearer artifact-only naming.

### AGG-C20-31 - Closed mobile tag filter still paints its chip controls

- Severity: Medium
- Confidence: High
- Source findings: `DES-C20-01`
- Citations: `apps/web/src/components/tag-filter.tsx:145-156`
- Problem: the closed mobile `<details>` contains a direct child with author `display:flex`, overriding native closed-details hiding.
- Failure scenario: sighted mobile users see visible chip controls while the accessibility tree reports the disclosure collapsed and keyboard tab order skips the chips.
- Suggested fix: use `hidden group-open:flex` or a controlled disclosure with `hidden`, `aria-expanded`, and a managed region.

### AGG-C20-32 - Tag filter hydrates duplicate chip trees

- Severity: Low
- Confidence: Medium
- Source findings: `DES-C20-03`
- Citations: `apps/web/src/components/tag-filter.tsx:11-19`, `apps/web/src/components/tag-filter.tsx:70-160`
- Problem: one memoized chip fragment is mounted in both mobile and desktop wrappers.
- Failure scenario: large tag vocabularies pay avoidable DOM/hydration work on public gallery pages.
- Suggested fix: render one chip list with responsive wrapper behavior, or branch to one mounted tree after hydration.

### AGG-C20-33 - Admin image management remains a wide table on narrow screens

- Severity: Medium
- Confidence: High
- Source findings: `CRIT20-12`
- Citations: `apps/web/src/components/image-manager.tsx:427-452`, `apps/web/src/components/image-manager.tsx:474-621`
- Problem: phone/tablet admins must horizontally scroll a dense table where identity, tags, and destructive actions are separated.
- Failure scenario: at event speed, an admin can edit or delete the wrong row.
- Suggested fix: add a responsive card/list management mode below a breakpoint while keeping the dense desktop table.

### AGG-C20-34 - Desktop photo information can remain hidden by hydration/session state

- Severity: Low-Medium
- Confidence: Medium
- Source findings: `CRIT20-13`
- Citations: `apps/web/src/components/photo-viewer.tsx:111-135`, `apps/web/src/components/photo-viewer.tsx:757-811`, `apps/web/src/components/photo-viewer.tsx:975-1020`
- Problem: desktop photo context intentionally starts hidden for hydration safety and can restore a prior hidden state.
- Failure scenario: visitors miss color disclosure, similar photos, and download controls if the sidebar remains hidden or hydration is slow.
- Suggested fix: surface compact download/color metadata outside the collapsible sidebar or keep a persistent visible affordance.

### AGG-C20-35 - Fresh-install/product identity is coupled to tracked production site config

- Severity: Low-Medium
- Confidence: Medium
- Source findings: `CRIT20-14`
- Citations: `apps/web/src/site-config.json:1-12`, `apps/web/src/site-config.example.json:1-12`, `apps/web/scripts/ensure-site-config.mjs:12-40`, `README.md:60-72`
- Problem: the checked-in production `site-config.json` is necessary for this deployment but can mislead forks/fresh installs.
- Failure scenario: a copied worktree builds with `gallery.atik.kr` metadata/canonical URLs until the operator replaces config.
- Suggested fix: before template/package distribution, require explicit non-demo site config or an external `BASE_URL`/config source outside the production checkout.

### AGG-C20-36 - Production CLIP/search/nginx capacity and host state need live proof

- Severity: Medium
- Confidence: High for validation gap; Low/Medium for current live impact
- Source findings: `ARCH20-MV02`, `CRIT20-MV-01`, `CRIT20-MV-02`, `MVR20-02`, `SEC-20-01`
- Citations: `README.md:50`, `CLAUDE.md:169`, `CLAUDE.md:375-381`, `CLAUDE.md:505-523`, `apps/web/src/app/api/search/semantic/route.ts:186-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:115-214`, `apps/web/src/lib/admin-backfill-runner.ts:106-143`
- Problem: source proves bounds and runbooks, but not live CLIP weights/coverage, production DB query plans, CPU/RSS headroom, or host nginx application.
- Failure scenario: operators can overstate semantic readiness or capacity, or rely on edge protections that are not applied on the host.
- Suggested fix: record live preflight evidence for CLIP env/weights/embedding coverage, `EXPLAIN`/latency/RSS under representative load, and host `nginx -T`/reload/burst checks.

### AGG-C20-37 - Product-facing docs emphasize engineering depth before the experience

- Severity: Low
- Confidence: High
- Source findings: product-marketer sweep of public docs found no blocker, critic noted README/product positioning risk
- Citations: `README.md:1-208`, `apps/web/src/site-config.json:1-12`
- Problem: public docs spend substantial first-screen attention on implementation depth and production wiring before the gallery/operator experience.
- Failure scenario: prospective operators or contributors can miss the product's core value and install expectations.
- Suggested fix: on the next README/product-docs pass, lead with the gallery experience, deployment target, and operator workflow, then keep engineering details as supporting material.
