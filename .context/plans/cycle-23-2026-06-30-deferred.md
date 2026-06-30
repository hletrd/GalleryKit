# Cycle 23/100 Deferred Findings

Date: 2026-06-30 KST  
Review source: `.context/reviews/_aggregate.md`  
Status: deferred carry-forward

Deferral rules applied: every item below preserves original severity/confidence and cites the aggregate line. Security, correctness, and data-loss findings are not deferred here; they are scheduled in `cycle-23-2026-06-30-plan.md`.

## Deferred Items

### D23-01 - Queue pool pinning redesign

- Finding/citation: `AGG23-01`, `.context/reviews/_aggregate.md:49`
- Original severity/confidence: Medium / High
- Reason for deferral: operational performance/availability architecture issue requiring queue claim redesign or pool-budget policy; not a data-loss/security finding and too broad to safely combine with this cycle's correctness/security fixes.
- Exit criterion: schedule when changing queue concurrency, advisory-lock ownership, or pool budgeting; reopen immediately if production shows DB pool starvation during uploads.

### D23-02 - Shared browser/LR upload-ingest coordinator

- Finding/citation: `AGG23-02`, `.context/reviews/_aggregate.md:59`
- Original severity/confidence: Medium / High
- Reason for deferral: broad refactor across two upload adapters; this cycle schedules the concrete correctness gaps inside those flows instead.
- Exit criterion: reopen when adding any upload metadata/settings field or when another browser/LR parity fix is required.

### D23-03 - Single-writer startup/runtime lease

- Finding/citation: `AGG23-03`, `.context/reviews/_aggregate.md:69`
- Original severity/confidence: Medium / High
- Reason for deferral: deployment topology architecture change; current repo policy documents the single-writer topology and the production compose path runs one web service.
- Exit criterion: reopen before any horizontal scaling, process-manager change, blue/green overlap, or multi-instance deploy.

### D23-04 - Immutable topic ID migration

- Finding/citation: `AGG23-04`, `.context/reviews/_aggregate.md:79`
- Original severity/confidence: Medium / High
- Reason for deferral: schema/data-model migration with broad URL and smart-collection impact; current rename guards/tests reduce immediate regression risk.
- Exit criterion: reopen before adding new topic references, topic hierarchy, external topic APIs, or a migration window for immutable IDs.

### D23-05 - Hot public exact-count query redesign

- Finding/citation: `AGG23-08`, `.context/reviews/_aggregate.md:119`
- Original severity/confidence: Medium / High
- Reason for deferral: performance/product behavior tradeoff because exact counts are currently user-visible copy.
- Exit criterion: reopen when gallery scale or query telemetry shows first-page latency, or when count UI can be redesigned.

### D23-06 - Infinite masonry virtualization

- Finding/citation: `AGG23-09`, `.context/reviews/_aggregate.md:129`
- Original severity/confidence: Medium / High
- Reason for deferral: UI architecture/performance work requiring virtualization decisions and browser regression coverage.
- Exit criterion: reopen with galleries large enough to cause DOM/memory pressure or when touching the masonry list.

### D23-07 - Streaming CSV export

- Finding/citation: `AGG23-10`, `.context/reviews/_aggregate.md:139`
- Original severity/confidence: Medium / High
- Reason for deferral: performance/memory refactor to a new authenticated route or background export workflow; no correctness/security data loss in current capped export.
- Exit criterion: reopen if export row cap increases, memory warnings occur, or admin DB/export route work is scheduled.

### D23-08 - Analytics aggregate concurrency/caching

- Finding/citation: `AGG23-11`, `.context/reviews/_aggregate.md:149`
- Original severity/confidence: Low-Medium / Medium
- Reason for deferral: performance tuning dependent on production query telemetry.
- Exit criterion: reopen if analytics pages cause pool contention or when adding analytics summaries.

### D23-09 - Timeline/date sargability

- Finding/citation: `AGG23-12`, `.context/reviews/_aggregate.md:159`
- Original severity/confidence: Low / High
- Reason for deferral: low-severity performance issue requiring schema/index strategy.
- Exit criterion: reopen before timeline/year traffic growth or when adding date generated columns/indexes.

### D23-10 - Topic freshness query optimization

- Finding/citation: `AGG23-13`, `.context/reviews/_aggregate.md:169`
- Original severity/confidence: Low / Medium
- Reason for deferral: low-severity performance issue needing index/materialization tradeoff.
- Exit criterion: reopen if nav/sitemap query latency appears or when changing topic freshness semantics.

### D23-11 - Public map marker/list scaling

- Finding/citation: `AGG23-14`, `.context/reviews/_aggregate.md:179`
- Original severity/confidence: Low-Medium / High
- Reason for deferral: UI/performance redesign requiring clustering or pagination.
- Exit criterion: reopen when map-visible GPS images approach marker cap or map route performance degrades.

### D23-12 - Upload-processing contract lock narrowing

- Finding/citation: `AGG23-15`, `.context/reviews/_aggregate.md:189`
- Original severity/confidence: Low / High
- Reason for deferral: performance lock-window refactor; scheduled browser quota idempotence addresses the immediate correctness part.
- Exit criterion: reopen with upload throughput work or evidence of lock/pool contention.

### D23-13 - Production CLIP smoke/readiness lane

- Finding/citation: `AGG23-19`, `.context/reviews/_aggregate.md:229`
- Original severity/confidence: Medium / High
- Reason for deferral: production-operator validation lane requiring model weights and environment-specific readiness checks; not safe to invent without the production model artifact contract in this cycle.
- Exit criterion: reopen before toggling production semantic search on a new host or changing CLIP model packaging.

### D23-14 - Lightroom upload behavior harness

- Finding/citation: `AGG23-21`, `.context/reviews/_aggregate.md:249`
- Original severity/confidence: Medium / High
- Reason for deferral: broad route-test harness build; this cycle schedules narrower upload correctness fixes.
- Exit criterion: reopen before modifying LR route side effects or adding new PAT upload fields.

### D23-15 - CLIP queue behavior test extraction

- Finding/citation: `AGG23-22`, `.context/reviews/_aggregate.md:259`
- Original severity/confidence: Medium / High
- Reason for deferral: testability refactor of internal queue primitive; current production behavior has existing source-contract coverage.
- Exit criterion: reopen before changing CLIP queue concurrency, abort, timeout, or slot-release logic.

### D23-16 - `data.ts` decomposition

- Finding/citation: `AGG23-25`, `.context/reviews/_aggregate.md:289`
- Original severity/confidence: Medium / High
- Reason for deferral: broad architecture cleanup, not a single-cycle correctness fix.
- Exit criterion: reopen when touching privacy selector boundaries, map/search/share data, or side-effect buffers.

### D23-17 - Admin capability model

- Finding/citation: `AGG23-26`, `.context/reviews/_aggregate.md:299`
- Original severity/confidence: Medium / High
- Reason for deferral: product/authorization model change; `CLAUDE.md` currently documents multiple root admins and no role/capability separation as the accepted product model.
- Exit criterion: reopen if GalleryKit moves beyond personal/single-operator trust boundaries or adds non-root collaborators.

### D23-18 - Admin image manager mobile layout

- Finding/citation: `AGG23-44`, `.context/reviews/_aggregate.md:479`
- Original severity/confidence: Medium / High
- Reason for deferral: responsive admin UI redesign with many action states; this cycle addresses smaller public/admin UI defects first.
- Exit criterion: reopen when admin mobile usage becomes priority or image-manager layout is otherwise touched.

### D23-19 - Admin IA grouping

- Finding/citation: `AGG23-49`, `.context/reviews/_aggregate.md:529`
- Original severity/confidence: Low-Medium / Medium
- Reason for deferral: information architecture polish, no correctness/security risk.
- Exit criterion: reopen when adding more admin sections or redesigning navigation.
