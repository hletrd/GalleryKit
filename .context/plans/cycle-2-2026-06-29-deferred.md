# Cycle 2/100 Deferred Findings

Date: 2026-06-29  
Review aggregate: `.context/reviews/_aggregate.md`  
Status: TODO / deferred

Repo rules read before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, current `.context/reviews/**`, and `docs/superpowers/**`. No `.cursorrules` or `CONTRIBUTING.md` exists. Deferred work remains bound by repo policy: GPG-signed conventional commits with gitmoji, `git pull --rebase` before push, no force-push/no `--no-verify`, full quality gates, and per-cycle deploy policy when picked up.

Security/correctness/data-loss handling: confirmed security/correctness fixes were not deferred. AGG-C2-15 is scheduled in the implementation plan. Items below are performance, scaling, architecture, or test-quality risks, not current confirmed security/data-loss defects under the documented single-instance deployment. The repo rule allowing single-instance assumptions is `CLAUDE.md` "Runtime topology": the shipped Docker Compose deployment is a "single web-instance / single-writer" topology and process-local states weaken only under scale-out.

## Deferred Items

### DEF-C2-01 - Timeline/on-this-day non-sargable date queries

- Finding: AGG-C2-02.
- Original severity/confidence: Medium / High.
- Citation: `apps/web/src/lib/data-timeline.ts:95-205`.
- Reason for deferral: schema/query-performance work requiring `EXPLAIN`, possible generated columns, and migration planning. Not a security, correctness, or data-loss defect.
- Exit criterion: archive size or production traces show timeline/year/on-this-day DB latency, or a schema/index cycle is opened for public archive performance.

### DEF-C2-02 - Map marker/index scalability

- Finding: AGG-C2-03.
- Original severity/confidence: Medium / High.
- Citation: `apps/web/src/lib/data.ts:1624-1661`, `apps/web/src/db/schema.ts:111-117`, `apps/web/src/components/map/map-client.tsx:86-143`.
- Reason for deferral: product/performance design requiring clustering or viewport-loading plus index validation. Not a security, correctness, or data-loss defect.
- Exit criterion: GPS-heavy archives approach the 10,000-marker cap, map LCP/INP regresses, or map performance is explicitly scheduled.

### DEF-C2-03 - CLIP embedding backpressure

- Finding: AGG-C2-04.
- Original severity/confidence: Medium / High.
- Citation: `apps/web/src/lib/image-queue.ts:512-569`, `apps/web/src/lib/clip-model.ts:151-186`.
- Reason for deferral: concurrency tuning for production semantic-search throughput; no current data-loss/security defect and no evidence of live overload at the documented production size.
- Exit criterion: production upload batches overlap embedding and Sharp work enough to affect latency/RSS, or `QUEUE_CONCURRENCY`/semantic production throughput is raised.

### DEF-C2-04 - Semantic search request-path scan and newest-first cap

- Finding: AGG-C2-05.
- Original severity/confidence: Medium / High.
- Citation: `apps/web/src/app/api/search/semantic/route.ts:240-281`, `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`, `apps/web/src/lib/clip-embeddings.ts:18-40`.
- Reason for deferral: vector-index/worker-boundary design exceeds this cycle and is a scaling/relevance risk, not a current correctness/security defect at the documented corpus size.
- Exit criterion: production embedding count exceeds `SEMANTIC_SCAN_LIMIT`, search latency rises, or older relevant results are observed missing.

### DEF-C2-05 - Smart-collection cursor count cost

- Finding: AGG-C2-06.
- Original severity/confidence: Low / Medium.
- Citation: `apps/web/src/lib/data.ts:1388-1430`.
- Reason for deferral: low-priority query-shape optimization with no current correctness risk.
- Exit criterion: smart-collection pagination queries show slow traces or a data-access optimization pass is scheduled.

### DEF-C2-06 - Backfill stale-candidate index

- Finding: AGG-C2-07.
- Original severity/confidence: Low / Medium.
- Citation: `apps/web/src/lib/admin-backfill-runner.ts:370-410`, `apps/web/src/db/schema.ts:111-117`.
- Reason for deferral: admin-only maintenance-path optimization requiring migration/index planning.
- Exit criterion: backfill candidate discovery becomes slow on production table size or a migration cycle is opened for image maintenance indexes.

### DEF-C2-07 - Restore-maintenance process-local scale-out risk

- Finding: AGG-C2-08.
- Original severity/confidence: Medium / High.
- Citation: `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/app/[locale]/admin/db-actions.ts:263-350`.
- Reason for deferral: repo explicitly documents single-instance topology in `CLAUDE.md` "Runtime topology"; the risk becomes a correctness issue only if horizontal scaling is introduced before shared restore state.
- Exit criterion: any deploy/topology plan introduces multiple web instances, or a shared coordination store is added.

### DEF-C2-08 - `clip-embeddings.ts` client/server boundary smell

- Finding: AGG-C2-09.
- Original severity/confidence: Low / High.
- Citation: `apps/web/src/lib/clip-embeddings.ts:18-40`, `apps/web/src/components/search.tsx:1,19`.
- Reason for deferral: boundary cleanup with no current runtime bug because current client import uses only safe constants.
- Exit criterion: a client component needs semantic limit values, or a client/server boundary cleanup pass is scheduled.

### DEF-C2-09 - Upload quota claim rollback shape

- Finding: AGG-C2-10.
- Original severity/confidence: Medium / High.
- Citation: `apps/web/src/app/actions/images.ts:224-279`, `apps/web/src/app/actions/images.ts:520-564`.
- Reason for deferral: maintainability risk currently covered by comments/tests; fixing requires refactoring a long upload action and should be paired with focused regression tests.
- Exit criterion: upload action is edited in the claim-to-settle span, or a phantom quota claim is observed.

### DEF-C2-10 - Topic mutable natural-key fan-out

- Finding: AGG-C2-11.
- Original severity/confidence: Medium / High.
- Citation: `apps/web/src/db/schema.ts:14-17,33,234-243,288-302`, `apps/web/src/app/actions/topics.ts:320-337`.
- Reason for deferral: architectural migration to immutable IDs is broad and existing registry/fan-out tests fence current behavior.
- Exit criterion: a new topic-slug store is added, topic rename defects occur, or a schema redesign cycle opens.

### DEF-C2-11 - Public image selector duplication

- Finding: AGG-C2-12.
- Original severity/confidence: Low-Medium / High.
- Citation: `apps/web/src/lib/data.ts:364-482`, `apps/web/src/lib/data-timeline.ts:20-73`, `apps/web/src/lib/search-enrichment-fields.ts:29-46`.
- Reason for deferral: architecture cleanup with no current public PII leak found; privacy tests currently guard known fields.
- Exit criterion: a new public image read path is added or privacy selector work is scheduled.

### DEF-C2-12 - Dormant storage abstraction

- Finding: AGG-C2-13.
- Original severity/confidence: Low / High.
- Citation: `apps/web/src/lib/storage/index.ts:4-143`.
- Reason for deferral: dead-abstraction cleanup is low risk and unrelated to current behavior; no live non-test importers were found.
- Exit criterion: any non-test live import of `@/lib/storage` appears, or multi-backend storage is scheduled.

### DEF-C2-13 - `api-auth` upward dependency on action auth

- Finding: AGG-C2-14.
- Original severity/confidence: Low-Medium / Medium.
- Citation: `apps/web/src/lib/api-auth.ts:1`, `apps/web/src/app/actions/auth.ts:23-56`.
- Reason for deferral: layering cleanup with no current runtime/auth defect; broad enough to deserve a focused auth-boundary pass.
- Exit criterion: auth modules are refactored, circular import pressure appears, or route/action auth semantics diverge.

### DEF-C2-14 - Client async behavior source-scan tests

- Finding: AGG-C2-20.
- Original severity/confidence: Medium / Medium.
- Citation: `apps/web/src/__tests__/search-stale-response.test.ts:8-27`, `apps/web/src/__tests__/upload-dropzone-topic-wiring.test.ts:15-21`.
- Reason for deferral: test-harness upgrade requiring component/browser behavior infrastructure; not a current product defect.
- Exit criterion: jsdom/component harness is introduced, or either source-scan test flakes/fails during a refactor.

### DEF-C2-15 - Calendar semantics risk

- Finding: code/debugger risk, not promoted as a confirmed aggregate defect.
- Original severity/confidence: Low / Medium.
- Citation: `apps/web/src/components/on-this-day-widget.tsx:15-17`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:67-70`, `apps/web/src/lib/data-timeline.ts:237-242`.
- Reason for deferral: product semantics for viewer-local vs server-local calendar dates are not specified; MySQL `DATETIME`/EXIF timestamps are timezone-less.
- Exit criterion: product chooses fixed-zone/viewer-local semantics, or midnight-boundary bugs are reported.

