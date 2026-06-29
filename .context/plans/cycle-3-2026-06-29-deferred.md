# Cycle 3/100 Deferred Findings

Date: 2026-06-29
Review aggregate: `.context/reviews/_aggregate.md`
Status: TODO / deferred

Repo rules read before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, current `.context/reviews/**`, and current `.context/plans/**`. No `.cursorrules` or `CONTRIBUTING.md` exists. No active docs/policy files were found under `docs/`. Deferred work remains bound by repo policy: GPG-signed conventional commits with gitmoji, `git pull --rebase` before push, no force-push/no `--no-verify`, full quality gates, and per-cycle deploy policy when picked up.

Security/correctness/data-loss handling: C3-AGG-01, C3-AGG-02, and C3-AGG-03 are scheduled in the implementation plan rather than deferred. Items below are performance, scale-out topology, architecture, test-quality, or low-risk maintainability items under current documented constraints. The repo rule allowing single-instance assumptions is `CLAUDE.md` "Runtime topology": the shipped Docker Compose deployment is a "single web-instance / single-writer" topology and process-local states weaken only under scale-out.

## Deferred Items

### DEF-C3-01 - Automated visual snapshots for nav artifacts

- Finding: C3-AGG-14.
- Original severity/confidence: Low / High.
- Citation: `apps/web/e2e/nav-visual-check.spec.ts`.
- Reason for deferral: current geometry assertions cover the blocking 44px/overlap contract; visual baseline policy and artifact thresholds are a broader e2e visual-regression decision.
- Exit criterion: a design-token/layout regression reaches production despite geometry checks, or Playwright visual-baseline policy is adopted.

### DEF-C3-02 - Timeline/year/on-this-day query/index redesign

- Finding: C3-AGG-16 remainder after scheduled comment-honesty fix.
- Original severity/confidence: Medium / High.
- Citation: `apps/web/src/lib/data-timeline.ts:95-205`, `apps/web/src/db/schema.ts:111-117`.
- Reason for deferral: schema/query-performance work requiring `EXPLAIN`, generated columns or range/index planning, migration, journal, and legacy reconcile updates. Not a current security or data-loss defect.
- Exit criterion: archive size or production traces show timeline/year/on-this-day DB latency, or a schema/index cycle is opened for public archive performance.

### DEF-C3-03 - Semantic/similar search vector recall and request-path scan architecture

- Finding: C3-AGG-17.
- Original severity/confidence: Medium / High.
- Citation: `apps/web/src/app/api/search/semantic/route.ts:240-281`, `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`, `apps/web/src/lib/clip-embeddings.ts:32-40`.
- Reason for deferral: vector-index/ANN or worker-backed retrieval requires architectural design beyond this cycle. Current production docs state roughly 445 real embeddings, below the default `SEMANTIC_SCAN_LIMIT=2000`, so the recall issue is not confirmed under current documented production size.
- Exit criterion: eligible embedding count exceeds `SEMANTIC_SCAN_LIMIT`, older relevant search results are observed missing, semantic search latency rises, or a vector-search backend is introduced.

### DEF-C3-04 - Production CLIP embedding queue/backpressure design

- Finding: C3-AGG-18.
- Original severity/confidence: Medium / High.
- Citation: `apps/web/src/lib/image-queue.ts:204-212`, `apps/web/src/lib/image-queue.ts:512-567`, `apps/web/src/lib/clip-model.ts:151-186`.
- Reason for deferral: performance/concurrency tuning for production semantic throughput; no current data-loss/security defect and no live overload evidence in the documented single-process deployment.
- Exit criterion: production upload batches overlap embedding and Sharp work enough to affect latency/RSS, `QUEUE_CONCURRENCY`/semantic throughput is raised, or embedding jobs are moved to durable queue infrastructure.

### DEF-C3-05 - Process-local topology enforcement/shared-state migration

- Finding: C3-AGG-19.
- Original severity/confidence: Medium / High.
- Citation: `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/lib/upload-tracker-state.ts:7-20`, `apps/web/src/lib/rate-limit.ts:68-89`, `apps/web/src/lib/rate-limit.ts:314-318`, `apps/web/src/lib/image-queue.ts:180-224`, `apps/web/docker-compose.yml:14-21`.
- Reason for deferral: `CLAUDE.md` explicitly documents a single web-instance/single-writer topology. This becomes correctness/security-relevant only if scale-out or multi-process deployment is introduced.
- Exit criterion: any deploy/topology plan introduces multiple web instances, or shared DB/Redis coordination is added.

### DEF-C3-06 - Upload quota claim lifecycle refactor

- Finding: C3-AGG-21.
- Original severity/confidence: Medium / High.
- Citation: `apps/web/src/app/actions/images.ts:224-279`, `apps/web/src/app/actions/images.ts:540-564`, `apps/web/src/app/actions/images.ts:590-592`.
- Reason for deferral: maintainability risk currently covered by comments and existing claim-settlement behavior; a scoped-claim refactor touches the long upload action and should be paired with a dedicated upload-action test pass.
- Exit criterion: upload action is edited in the claim-to-settle span, a phantom quota claim is observed, or a focused upload lifecycle refactor is scheduled.

### DEF-C3-07 - Calendar timezone/date-part semantics

- Finding: C3-AGG-23.
- Original severity/confidence: Low / Medium.
- Citation: `apps/web/src/components/on-this-day-widget.tsx:14-23`, `apps/web/src/components/on-this-day-widget.tsx:51-52`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:87-97`, `apps/web/src/lib/data-timeline.ts:237-245`, `apps/web/src/lib/process-image.ts:507-520`.
- Reason for deferral: product semantics for gallery-local/server-local/viewer-local calendar behavior are not specified. Prior history rejected a blanket UTC conversion; this needs an explicit product decision before code changes.
- Exit criterion: product chooses fixed-zone/viewer-local semantics, server timezone changes, or midnight-boundary date bugs are reported.

### DEF-C3-08 - Public map marker/index scalability

- Finding: C3-AGG-24.
- Original severity/confidence: Medium / High.
- Citation: `apps/web/src/lib/data.ts:1624-1660`, `apps/web/src/components/map/map-client.tsx:76-143`, `apps/web/src/db/schema.ts:111-117`.
- Reason for deferral: product/performance design requiring clustering or viewport loading plus index validation. Not a current security, correctness, or data-loss defect at current scale.
- Exit criterion: GPS-heavy archives approach the 10,000-marker cap, map LCP/INP regresses, or map performance is explicitly scheduled.

### DEF-C3-09 - Smart-collection cursor count optimization

- Finding: C3-AGG-25.
- Original severity/confidence: Low / High.
- Citation: `apps/web/src/lib/data.ts:1388-1428`, `apps/web/src/app/actions/public.ts:161-213`.
- Reason for deferral: low-priority query-shape optimization with no current correctness risk.
- Exit criterion: smart-collection pagination queries show slow traces or a data-access optimization pass is scheduled.

### DEF-C3-10 - Backfill stale-candidate index

- Finding: C3-AGG-26.
- Original severity/confidence: Low / Medium.
- Citation: `apps/web/src/lib/admin-backfill-runner.ts:370-410`, `apps/web/src/db/schema.ts:111-117`.
- Reason for deferral: admin-only maintenance-path optimization requiring migration/index planning.
- Exit criterion: backfill candidate discovery becomes slow on production table size or a migration cycle is opened for image maintenance indexes.

### DEF-C3-11 - Topic slug mutable-natural-key architecture

- Finding: C3-AGG-27.
- Original severity/confidence: Medium / High.
- Citation: `apps/web/src/db/schema.ts:4-33`, `apps/web/src/db/schema.ts:234-243`, `apps/web/src/db/schema.ts:288-302`, `apps/web/src/app/actions/topics.ts:282-337`, `apps/web/src/__tests__/topic-slug-fk-registry.test.ts:1-83`.
- Reason for deferral: migration to immutable topic IDs is broad architectural work; current behavior is fenced by registry/fan-out tests.
- Exit criterion: a new topic-slug store is added, topic rename defects occur, or a schema redesign cycle opens.

### DEF-C3-12 - Public image selector consolidation

- Finding: C3-AGG-28.
- Original severity/confidence: Low-Medium / High.
- Citation: `apps/web/src/lib/data.ts:364-483`, `apps/web/src/lib/data-timeline.ts:35-73`, `apps/web/src/lib/search-enrichment-fields.ts:29-47`, `apps/web/src/__tests__/privacy-fields.test.ts:6-114`.
- Reason for deferral: architecture cleanup with no current public PII leak; existing compile-time and fixture guards protect known selector families.
- Exit criterion: a new public image read path is added, privacy selector drift recurs, or selector consolidation is scheduled.

### DEF-C3-13 - Auth helper layering refactor

- Finding: C3-AGG-29.
- Original severity/confidence: Low-Medium / Medium.
- Citation: `apps/web/src/lib/api-auth.ts:1`, `apps/web/src/app/actions/auth.ts:1-56`.
- Reason for deferral: layering cleanup with no current runtime/auth defect. Moving current-user helpers deserves a focused auth-boundary pass.
- Exit criterion: auth modules are refactored, circular import pressure appears, or route/action auth semantics diverge.

### DEF-C3-14 - Dormant storage abstraction cleanup

- Finding: C3-AGG-30.
- Original severity/confidence: Low / High.
- Citation: `apps/web/src/lib/storage/index.ts:4-146`, `apps/web/src/__tests__/storage-quarantine.test.ts:1-131`.
- Reason for deferral: dead-abstraction cleanup is low risk and current quarantine tests prevent live non-test imports.
- Exit criterion: any non-test live import of `@/lib/storage` appears, or multi-backend storage is scheduled.
