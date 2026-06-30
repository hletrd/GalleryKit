# Cycle 26/100 Deferred Findings

Date: 2026-06-30 KST
Review source: `.context/reviews/_aggregate.md`
Status: deferred carry-forward

Deferral rules applied: every item below preserves original severity/confidence and cites the aggregate item. Security, correctness, and data-loss findings are not deferred. Deferred work remains bound by repo policy: GPG-signed Conventional Commit + gitmoji commits, pull-rebase before push, required gates, no force-push, no `--no-verify`, and current toolchain/package policy.

## Deferred Items

### D26-01 - Public data failures render a stripped generic error shell

- Finding/citation: `AGG-C26-07`; `apps/web/src/app/[locale]/error.tsx:22-57`, `apps/web/src/app/[locale]/(public)/page.tsx:93,151-167`
- Original severity/confidence: Medium / High
- Reason for deferral: UX availability redesign requiring client-safe layout/error-boundary work and browser validation. This is not security, correctness, or data-loss.
- Exit criterion: reopen when public error boundaries, first-run setup UX, or DB outage handling are edited.

### D26-02 - Fire-and-forget analytics inserts can cross restore boundary

- Finding/citation: `AGG-C26-08`; `apps/web/src/app/actions/public.ts:416-505`, `apps/web/src/app/[locale]/admin/db-actions.ts:482-489`
- Original severity/confidence: Medium / Medium
- Reason for deferral: row-level public analytics are approximate by product/runtime contract. `CLAUDE.md:235` states shared-group view-count buffering is best-effort and lost writes must not be treated as billing/audit-grade state. Cycle 25 added late maintenance gates and durable public view-record limiting; a full analytics pause/drain queue is a broader analytics design change.
- Exit criterion: reopen if row-level analytics become audit-grade, restore begins waiting on all side effects, or analytics queue/drop-counter work is scheduled.

### D26-03 - Admin settings copy blends decisions with operator runbook detail

- Finding/citation: `AGG-C26-10`; `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:296-328,741-789`, locale keys `apps/web/messages/en.json:748-781`, `apps/web/messages/ko.json:748-781`
- Original severity/confidence: Medium / Medium
- Reason for deferral: product-copy and information-architecture rewrite across English and Korean surfaces; no behavior defect.
- Exit criterion: reopen when settings IA, semantic search setup, re-encode UX, or Korean admin copy is revised.

### D26-04 - Public first-page gallery queries compute exact grouped totals

- Finding/citation: `AGG-C26-11`; `apps/web/src/lib/data.ts:878-907,1446-1461`
- Original severity/confidence: Medium / High
- Reason for deferral: performance-only query/UX contract change requiring production `EXPLAIN` validation and decisions about exact totals.
- Exit criterion: reopen when listing TTFB telemetry shows pressure, exact totals are redesigned, or smart-collection predicate work is scheduled.

### D26-05 - GPS stripping buffers full originals

- Finding/citation: `AGG-C26-12`; `apps/web/src/lib/process-image.ts:905-910,1737-1763`
- Original severity/confidence: Medium / High
- Reason for deferral: streaming/segment metadata stripping is binary-parser work with format-regression risk; upload caps bound current worst-case memory.
- Exit criterion: reopen when GPS-strip memory warnings occur, upload caps change, or metadata parser work is scheduled.

### D26-06 - Upload-processing contract lock spans slow I/O and CPU work

- Finding/citation: `AGG-C26-13`; `apps/web/src/app/actions/images.ts:175-630`, `apps/web/src/app/api/admin/lr/upload/route.ts:243-551`
- Original severity/confidence: Low-Medium / High
- Reason for deferral: lock-boundary changes affect browser and PAT upload consistency. Current behavior favors correctness over throughput and needs dedicated concurrency design.
- Exit criterion: reopen when upload contention is measured or upload settings/contract locking is refactored.

### D26-07 - Infinite masonry keeps every loaded photo mounted

- Finding/citation: `AGG-C26-14`; `apps/web/src/components/home-client.tsx:124-424`, `apps/web/src/components/load-more.tsx:41-132`
- Original severity/confidence: Medium / High
- Reason for deferral: virtualization/windowing is a larger UI architecture change requiring scroll restoration and responsive visual QA.
- Exit criterion: reopen when large-gallery DOM/heap evidence appears or infinite-scroll UI is redesigned.

### D26-08 - Public map can mount 10,000 markers and list rows

- Finding/citation: `AGG-C26-15`; `apps/web/src/lib/data.ts:1649-1685`, `apps/web/src/app/[locale]/(public)/map/page.tsx:31-89`, `apps/web/src/components/map/map-client.tsx:86-140`
- Original severity/confidence: Medium / High
- Reason for deferral: clustering/viewport APIs and accessible list virtualization are a separate map redesign.
- Exit criterion: reopen when map-visible GPS count grows, map route latency is measured, or map API work is scheduled.

### D26-09 - CSV export duplicates large data in memory

- Finding/citation: `AGG-C26-16`; `apps/web/src/app/[locale]/admin/db-actions.ts:80-160`
- Original severity/confidence: Medium / High
- Reason for deferral: streaming export/background jobs require a broader admin workflow change; current export cap prevents unbounded export.
- Exit criterion: reopen if export cap increases, memory pressure is observed, or admin DB/export workflow is revised.

### D26-10 - Timeline/year routes use non-sargable date predicates

- Finding/citation: `AGG-C26-17`; `apps/web/src/lib/data-timeline.ts:97-207`
- Original severity/confidence: Low-Medium / High
- Reason for deferral: range rewrites/generated columns need query-plan validation and possibly schema migration; current issue is performance-only.
- Exit criterion: reopen when timeline/year routes become hot or archive schema/index work is scheduled.

### D26-11 - Public nav pays for sitemap-only topic timestamps

- Finding/citation: `AGG-C26-18`; `apps/web/src/lib/data.ts:509-529`, `apps/web/src/components/nav.tsx:8-20`
- Original severity/confidence: Low / Medium
- Reason for deferral: low-severity helper split whose impact needs query latency evidence.
- Exit criterion: reopen when nav/topic query latency appears or sitemap freshness logic changes.

### D26-12 - Cached image display waits on per-tile synchronous HEAD probes

- Finding/citation: `AGG-C26-19`; `apps/web/public/sw.template.js:34-38,250-286`, `apps/web/public/sw.js:34-38,250-286`
- Original severity/confidence: Low-Medium / Medium
- Reason for deferral: cache freshness behavior needs browser trace validation and product choice about stale-first image correctness.
- Exit criterion: reopen when service-worker strategy is revised or warm-cache image paint is measured as slow.

## Scheduled Elsewhere In Cycle 26

The following findings are not deferred because they are scheduled in `cycle-26-2026-06-30-plan.md`: `AGG-C26-01`, `AGG-C26-02`, `AGG-C26-03`, `AGG-C26-04`, `AGG-C26-05`, `AGG-C26-06`, and `AGG-C26-09`.
