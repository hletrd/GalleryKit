# Cycle 14/100 Deferred Findings

Date: 2026-06-30
Source: `.context/reviews/_aggregate.md`
Status: TODO / deferred

Repo rules read before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, committed `.context` plan/review history, and `docs/superpowers/**`. No `.cursorrules` or `CONTRIBUTING.md` files exist in this repo.

Deferred work remains bound by repo policy when picked up: GPG-signed Conventional Commit + gitmoji commits, no `--no-verify`, no force-push, current toolchain requirements, and required gates. Security, correctness, and data-loss findings are not deferred here unless they are explicitly operational/manual-validation risks governed by the repo's documented topology or operator boundary.

## Deferred Items

### C14-D01 - Public map serializes/renders up to 10k markers and links

- Aggregate finding: AGG-C14-04.
- File+line: `apps/web/src/lib/data.ts:1649-1676`, `apps/web/src/app/[locale]/(public)/map/page.tsx:31-79`, `apps/web/src/components/map/map-client.tsx:76-143`, `apps/web/src/db/schema.ts:114-120`.
- Original severity/confidence: High / High.
- Reason for deferral: Performance/UX scale project requiring clustering or viewport data fetching, accessible list redesign, and query/index validation. It is not a security, correctness, or data-loss defect in the current personal-gallery scale.
- Exit criterion: Re-open when GPS-visible images approach thousands, map page traces show long tasks/memory pressure, or before a map redesign.

### C14-D02 - Public map accessible structure is pointer-first

- Aggregate finding: AGG-C14-05.
- File+line: `apps/web/src/app/[locale]/(public)/map/page.tsx:59-79`, `apps/web/src/components/map/map-client.tsx:107-144`.
- Original severity/confidence: Medium / Medium-high.
- Reason for deferral: Coupled to the map clustering/accessibility redesign in C14-D01. The current fallback link list prevents a complete accessibility dead end.
- Exit criterion: Re-open with C14-D01, or if a keyboard/screen-reader user reports map/list navigation difficulty.

### C14-D03 - Admin dashboard loads every permanently failed image

- Aggregate finding: AGG-C14-06.
- File+line: `apps/web/src/lib/data.ts:1000-1013`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:73-120`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Admin recovery performance improvement requiring pagination UX/data access work. Not a correctness or data-loss issue at current known scale.
- Exit criterion: Re-open if failed image counts grow, dashboard recovery becomes slow, or dashboard pagination work begins.

### C14-D04 - Sidecar backfill scripts enqueue full candidate sets

- Aggregate finding: AGG-C14-07.
- File+line: `apps/web/scripts/backfill-color-pipeline.ts:342-359`, `apps/web/scripts/backfill-color-pipeline.ts:474-511`, `apps/web/scripts/backfill-cicp-recheck.ts:57-93`, `apps/web/scripts/backfill-cicp-recheck.ts:144`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Performance/memory optimization for sidecar maintenance scripts. Requires careful rewrite of long-running backfill iteration and progress behavior; no current data-loss or security failure was shown.
- Exit criterion: Re-open before running large force-reencode/CICP jobs, or if sidecar memory pressure appears.

### C14-D05 - GPS stripping materializes whole originals after streaming save

- Aggregate finding: AGG-C14-08.
- File+line: `apps/web/src/app/actions/images.ts:381-388`, `apps/web/src/app/api/admin/lr/upload/route.ts:150-153`, `apps/web/src/app/api/admin/lr/upload/route.ts:365-377`, `apps/web/src/lib/process-image.ts:1738-1788`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Memory-pressure risk, not a confirmed GPS privacy leak. Streaming/container-aware scrubbing or multipart replacement is larger than the scheduled security/correctness fixes.
- Exit criterion: Re-open before raising upload limits, changing GPS stripping, or if large GPS-stripped uploads cause RSS/GC failures.

### C14-D06 - Image queue can pin shared DB pool connections

- Aggregate finding: AGG-C14-26.
- File+line: `apps/web/src/db/index.ts:23-33`, `apps/web/src/lib/image-queue.ts:87-90`, `apps/web/src/lib/image-queue.ts:446-657`, `apps/web/src/lib/image-queue.ts:812-815`.
- Original severity/confidence: Medium / High.
- Repo rule permitting deferral: `CLAUDE.md` documents the shipped runtime as a single web-instance / single-writer topology and warns not to scale or alter coordination state until shared stores exist.
- Reason for deferral: Requires queue/lock/pool architecture work. Current default concurrency is conservative and the shipped topology is single-instance.
- Exit criterion: Re-open before increasing `QUEUE_CONCURRENCY`, holding locks differently, or scaling the web process.

### C14-D07 - Dynamic first listing pages perform count-window work

- Aggregate finding: AGG-C14-27.
- File+line: `apps/web/src/lib/data.ts:878-907`, `apps/web/src/lib/data.ts:1438-1453`, `apps/web/src/app/[locale]/(public)/page.tsx:14-16`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:174-176`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`.
- Original severity/confidence: Medium / Medium.
- Reason for deferral: Performance optimization that needs production-like query-plan evidence and count UX decisions. Current functionality is correct.
- Exit criterion: Re-open if first-page SSR latency grows, crawler load increases, or exact count UX is revisited.

### C14-D08 - Feed ordering lacks matching indexes

- Aggregate finding: AGG-C14-28.
- File+line: `apps/web/src/lib/data.ts:828-853`, `apps/web/src/db/schema.ts:94-120`, feed routes.
- Original severity/confidence: Medium / Medium.
- Reason for deferral: Requires schema migration, `_journal.json` update, and `reconcileLegacySchema` mirroring. No current feed latency evidence was provided.
- Exit criterion: Re-open during a query-index migration cycle or if feed slow-query logs appear.

### C14-D09 - Pipeline-version backfill scans lack supporting index

- Aggregate finding: AGG-C14-29.
- File+line: `apps/web/src/lib/admin-backfill-runner.ts:370-408`, `apps/web/scripts/backfill-color-pipeline.ts:337-348`, `apps/web/src/db/schema.ts:76-120`.
- Original severity/confidence: Medium / Medium.
- Reason for deferral: Requires schema migration and plan validation. It affects maintenance discovery performance, not current correctness.
- Exit criterion: Re-open before a major pipeline-version bump/backfill, or when adding maintenance indexes.

### C14-D10 - Quarantined storage abstraction has resource keyspace mismatch

- Aggregate finding: AGG-C14-32.
- File+line: `apps/web/src/lib/storage/index.ts:4-12`, `apps/web/src/__tests__/storage-quarantine.test.ts:1-132`, `apps/web/src/lib/storage/local.ts:15-20`, `apps/web/src/lib/process-topic-image.ts:11-102`.
- Original severity/confidence: Medium / High.
- Reason for deferral: The abstraction is deliberately quarantined and not a live production path. Fix belongs to any future storage-integration project.
- Exit criterion: Re-open before importing `@/lib/storage` from runtime upload/resource/serve paths.

### C14-D11 - LocalStorageBackend write hardening is weaker than live pipeline

- Aggregate finding: AGG-C14-33.
- File+line: `apps/web/src/lib/storage/local.ts:40-98`, `apps/web/src/lib/storage/local.ts:118-127`, `apps/web/src/lib/upload-paths.ts:11-46`.
- Original severity/confidence: Medium / Medium.
- Reason for deferral: Same quarantine as C14-D10; no current runtime caller uses this write path.
- Exit criterion: Re-open before storage abstraction integration.

### C14-D12 - Root layout hard-codes LTR despite future-RTL comment

- Aggregate finding: AGG-C14-36.
- File+line: `apps/web/src/app/[locale]/layout.tsx:94-100`.
- Original severity/confidence: Low / High.
- Reason for deferral: Current supported locales are English and Korean, both LTR. This is a latent i18n readiness issue, not a current user-facing defect.
- Exit criterion: Re-open before adding any RTL locale or when editing layout locale metadata.

### C14-D13 - Photo-page swipe listeners may intercept gestures outside media

- Aggregate finding: AGG-C14-37.
- File+line: `apps/web/src/components/photo-navigation.tsx:47-60`, `apps/web/src/components/photo-navigation.tsx:131-133`.
- Original severity/confidence: Low-medium / Medium.
- Reason for deferral: Needs populated mobile browser validation; source risk was not confirmed. Current plan prioritizes confirmed accessibility/layout defects.
- Exit criterion: Re-open after seeded mobile photo-page testing or on user report of swipe interference.

### C14-D14 - Listing/search SQL needs production-scale evidence

- Aggregate finding: AGG-C14-R01.
- File+line: `apps/web/src/lib/data.ts:878-907`, `apps/web/src/lib/data.ts:1438-1453`, `apps/web/src/lib/data.ts:1482-1555`, `apps/web/src/db/schema.ts:115-117`.
- Original severity/confidence: Medium at large scale / Medium.
- Reason for deferral: Manual validation risk. Requires `EXPLAIN ANALYZE` on production-sized data before choosing indexes or full-text/search architecture.
- Exit criterion: Re-open with query-plan evidence or when gallery size/search traffic grows.

### C14-D15 - Admin/origin/browser E2E coverage is environment-gated

- Aggregate finding: AGG-C14-R02.
- File+line: `apps/web/e2e/admin.spec.ts:7-12`, `apps/web/e2e/origin-guard.spec.ts:29-77`.
- Original severity/confidence: Medium if CI lacks seeded lanes / High for gating.
- Reason for deferral: Manual validation infrastructure; local review was blocked by unavailable MySQL. Not a production code defect.
- Exit criterion: Re-open if CI lacks seeded admin/origin lanes, or before UI-heavy release validation.

### C14-D16 - Trusted-proxy/single-instance topology must be validated

- Aggregate finding: AGG-C14-R03.
- File+line: `CLAUDE.md:227-230`, `apps/web/docker-compose.yml:3-27`, `apps/web/src/lib/restore-maintenance.ts:1-55`, `apps/web/src/lib/image-queue.ts:76-325`, `apps/web/src/lib/rate-limit.ts:75-119`.
- Original severity/confidence: High if violated / High for repo assumption.
- Repo rule permitting deferral: `CLAUDE.md` explicitly defines a single web-instance / single-writer shipped topology and says not to horizontally scale until process-local state moves to shared storage.
- Reason for deferral: Operational validation risk, not a current code change. C14-02 schedules the concrete proxy-doc mismatch.
- Exit criterion: Re-open before any multi-process/blue-green/clustered deployment or proxy topology change.

### C14-D17 - SQL backups are plaintext and DB-only by design

- Aggregate finding: AGG-C14-R04.
- File+line: `CLAUDE.md:209-210`, `apps/web/src/app/[locale]/admin/db-actions.ts:140-178`, `apps/web/src/app/api/admin/db/download/route.ts:21-101`.
- Original severity/confidence: Low-Medium depending on host controls / High.
- Reason for deferral: Operator-boundary validation, not a code vulnerability. Repo docs already state plaintext-at-rest and DB-only backup scope.
- Exit criterion: Re-open if threat model requires encrypted app-managed backups or if full disaster recovery workflow changes.

### C14-D18 - Admin authorization is all-root by design

- Aggregate finding: AGG-C14-R05.
- File+line: `README.md:40`, `CLAUDE.md:229`, `apps/web/src/app/actions/admin-users.ts:75-82`, `apps/web/src/app/[locale]/admin/db-actions.ts:121-133`.
- Original severity/confidence: Medium if admins are not equally trusted / High.
- Reason for deferral: Product/security model choice documented by repo. No role/capability model is currently planned in this cycle.
- Exit criterion: Re-open if any admin account is lower-trust or role separation becomes a product requirement.

### C14-D19 - Historical secrets need operator rotation validation

- Aggregate finding: AGG-C14-R06.
- File+line: `apps/web/.env.local.example:19-30`, `CLAUDE.md:80-85`.
- Original severity/confidence: Medium if historical examples were reused / Unknown for production.
- Reason for deferral: Manual operator validation; current tracked examples are placeholders and docs warn to rotate.
- Exit criterion: Re-open if production secret provenance is unknown or a rotation audit fails.

### C14-D20 - Real CLIP production/offline suites are skipped by default

- Aggregate finding: AGG-C14-R07.
- File+line: `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`, `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `.github/workflows/quality.yml:66-80`, `apps/web/src/app/api/search/semantic/route.ts:248-283`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Requires model-weight cache/CI resources and possibly scheduled/manual workflow. C14-10 improves docs for operator controls.
- Exit criterion: Re-open before CLIP dependency/model upgrades or semantic production mode changes.

### C14-D21 - Semantic/similar brute force and inference waiter limits need load evidence

- Aggregate finding: AGG-C14-R08.
- File+line: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:261-305`, `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`, `apps/web/src/lib/clip-model.ts:53-70`.
- Original severity/confidence: Medium / Medium.
- Reason for deferral: Performance/load validation risk; current scan caps are intentional and bounded.
- Exit criterion: Re-open before raising scan limits or if semantic/similar route latency grows.

### C14-D22 - Infinite masonry retains every loaded card

- Aggregate finding: AGG-C14-R09.
- File+line: `apps/web/src/components/home-client.tsx:124-130`, `apps/web/src/components/load-more.tsx:41-96`, `apps/web/src/components/home-client.tsx:286-360`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Virtualized masonry is a larger UX/perf project needing visual regression coverage.
- Exit criterion: Re-open when sessions routinely load thousands of cards or browser traces show memory/jank.

### C14-D23 - Non-sargable timeline/search/smart predicates are scale-sensitive

- Aggregate finding: AGG-C14-R10.
- File+line: `apps/web/src/lib/data-timeline.ts:97-207`, `apps/web/src/lib/data.ts:1537-1613`, `apps/web/src/lib/smart-collections.ts:218-264`.
- Original severity/confidence: Low-Medium / High.
- Reason for deferral: Requires query-plan and timezone validation; no current failure was proven.
- Exit criterion: Re-open with slow-query evidence, timezone grouping bug, or before timeline/search schema redesign.

### C14-D24 - Service-worker image freshness can add HEAD RTTs

- Aggregate finding: AGG-C14-R11.
- File+line: `apps/web/public/sw.template.js:31-38`, `apps/web/public/sw.template.js:227-260`, `apps/web/src/lib/serve-upload.ts:20-80`.
- Original severity/confidence: Low / High.
- Reason for deferral: Deliberate freshness tradeoff. Needs network waterfall evidence before changing.
- Exit criterion: Re-open if warm-cache image HEAD probes become user-visible or costly.

### C14-D25 - Topic slug is mutable natural key with manual rename fan-out

- Aggregate finding: AGG-C14-R12.
- File+line: `apps/web/src/db/schema.ts:4-33`, `apps/web/src/db/schema.ts:239-249`, `apps/web/src/app/actions/topics.ts:255-339`, `apps/web/src/__tests__/topic-slug-fk-registry.test.ts:1-23`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Requires deliberate schema migration to immutable IDs or `ON UPDATE CASCADE`. Current registry tests guard known stores.
- Exit criterion: Re-open before adding topic-referencing stores or planning topic schema migration.

### C14-D26 - Migration runner cannot detect live schema drift after hashes are recorded

- Aggregate finding: AGG-C14-R13.
- File+line: `apps/web/drizzle/meta/_journal.json:47-64`, `apps/web/scripts/migrate.js:748-808`, `CLAUDE.md:421-427`.
- Original severity/confidence: Medium / Medium.
- Reason for deferral: Schema-shape verifier is an operational hardening project; no current drift was reported in this cycle.
- Exit criterion: Re-open if live schema drift is observed or before major migration-runner refactor.

### C14-D27 - Archived docs may contain stale recommendations

- Aggregate finding: AGG-C14-R14.
- File+line: `.context/**`, `plan/**`.
- Original severity/confidence: Low / Medium.
- Reason for deferral: Historical artifacts are not current authoritative docs unless linked. Current docs were reviewed separately.
- Exit criterion: Re-open if archived material is promoted or linked as live runbook guidance.

### C14-D28 - Advanced env knobs intentionally undocumented

- Aggregate finding: AGG-C14-R15.
- File+line: `apps/web/.env.local.example`, related scripts/libs.
- Original severity/confidence: Low / Medium.
- Reason for deferral: These knobs are advanced/test-only or unsupported operator controls. C14-10 schedules the production-relevant CLIP concurrency knob.
- Exit criterion: Re-open when any advanced knob becomes supported deployment configuration.

### C14-D29 - OG/social cards need deployed validator coverage

- Aggregate finding: AGG-C14-R16.
- File+line: `apps/web/src/app/[locale]/(public)/page.tsx:61-123`, `apps/web/src/app/api/og/route.tsx:33-224`, `apps/web/src/app/api/og/photo/[id]/route.tsx:38-299`.
- Original severity/confidence: Low / Medium.
- Reason for deferral: Manual external validation, not code change. Requires deployed URLs/social validators.
- Exit criterion: Re-open after deploy if validator output fails or before OG redesign.

### C14-D30 - PWA install/offline behavior needs browser smoke coverage

- Aggregate finding: AGG-C14-R17.
- File+line: `apps/web/src/app/manifest.ts:6-52`, `apps/web/public/sw.template.js:370-403`.
- Original severity/confidence: Low / Medium.
- Reason for deferral: Manual browser validation. C14-17 schedules README copy precision so the claim does not overpromise.
- Exit criterion: Re-open before PWA/offline changes or after failed install/offline smoke.
