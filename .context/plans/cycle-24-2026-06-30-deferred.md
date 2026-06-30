# Cycle 24/100 Deferred Findings

Date: 2026-06-30 KST  
Review source: `.context/reviews/_aggregate.md`  
Status: deferred carry-forward

Deferral rules applied: every item below preserves original severity/confidence and cites the aggregate item. Security, correctness, and data-loss findings are not deferred unless already scheduled or classified as deployment/manual validation risk rather than a confirmed source vulnerability.

## Deferred Items

### D24-01 - DB-offline public pages can remain on a loading shell

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source reviews `designer.md`, `ui-ux-designer-reviewer.md`
- Original severity/confidence: High / High
- Reason for deferral: browser evidence depends on local DB-unavailable RSC behavior and requires careful route/error-boundary design across public layouts; current cycle prioritizes the confirmed CI gate break and security/env fixes. This is a UX availability finding, not data loss.
- Exit criterion: reopen when editing public error/loading boundaries, DB outage handling, or first-run setup UX; reopen immediately if production outage monitoring shows spinner-only pages.

### D24-02 - Category admin server validation is toast-only

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `designer.md`
- Original severity/confidence: Medium / High
- Reason for deferral: admin form validation redesign across create/edit/alias flows needs structured action errors; not a security/correctness failure.
- Exit criterion: reopen when editing category manager actions/UI or adding form error handling patterns.

### D24-03 - Admin settings copy exposes too much operator/runbook detail inline

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `ui-ux-designer-reviewer.md`
- Original severity/confidence: Medium / High
- Reason for deferral: copy/IA redesign across settings sections and Korean translations; lower priority than incorrect admin SEO/color claims scheduled this cycle.
- Exit criterion: reopen when redesigning settings IA or semantic/color backfill copy.

### D24-04 - Protected admin navigation is likely too heavy on small screens

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `ui-ux-designer-reviewer.md`
- Original severity/confidence: Medium / Medium
- Reason for deferral: responsive admin navigation redesign needs authenticated browser validation and broader layout testing.
- Exit criterion: reopen when adding admin sections or scheduling admin mobile ergonomics work.

### D24-05 - Single-writer runtime topology is documented but not enforced

- Finding/citation: `AGG24-04` related cross-agent notes and deferred catalog; reviews `critic.md`, `code-reviewer.md`, `tracer.md`, `architect.md`
- Original severity/confidence: Medium / High
- Reason for deferral: deployment architecture change requiring startup DB advisory lease design; current repo policy documents single-instance deployment and shipped compose runs one service.
- Exit criterion: reopen before horizontal scaling, blue/green overlap, process-manager migration, or any second web writer.

### D24-06 - Browser and Lightroom ingestion duplicate upload lifecycle

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `code-reviewer.md`
- Original severity/confidence: Medium / High
- Reason for deferral: broad refactor across upload adapters; no new immediate correctness bug beyond separately scheduled/tested items.
- Exit criterion: reopen when adding upload metadata/settings fields or touching browser/LR parity.

### D24-07 - Topic slug remains a mutable primary key

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `code-reviewer.md`
- Original severity/confidence: Medium / High
- Reason for deferral: schema/data migration with broad URL and smart-collection impact; current rename handling covers known references.
- Exit criterion: reopen before adding topic references/hierarchy or planning immutable topic IDs.

### D24-08 - Embedding schema has two sources of truth

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `architect.md`
- Original severity/confidence: Medium / High
- Reason for deferral: schema type modeling cleanup requiring Drizzle custom type and migration/reconcile review; not causing current runtime failure because decode handles current binary storage.
- Exit criterion: reopen before changing embedding schema, Drizzle schema generation, or CLIP storage code.

### D24-09 - Client action imports and auth reuse cross app/lib boundary

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `architect.md`
- Original severity/confidence: Medium / High
- Reason for deferral: broad layering refactor; no confirmed current client bundle break.
- Exit criterion: reopen when touching action barrels, client/server import scanning, or auth context modules.

### D24-10 - Fire-and-forget public analytics writes are not shutdown-owned

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `architect.md`
- Original severity/confidence: Low / High
- Reason for deferral: approximate analytics ownership decision; docs already frame analytics/view counts as best effort in related areas.
- Exit criterion: reopen if analytics durability is promoted beyond approximate metrics or when adding shutdown queues.

### D24-11 - Public first pages still pay exact grouped count work

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; reviews `perf-reviewer.md`, `architect.md`
- Original severity/confidence: Medium / High
- Reason for deferral: public UI/product behavior tradeoff because exact totals are user-visible and query redesign needs performance validation.
- Exit criterion: reopen with query telemetry, larger gallery scale, or count UI redesign.

### D24-12 - Map route can ship/mount 10,000 markers

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `perf-reviewer.md`
- Original severity/confidence: Medium / High
- Reason for deferral: map clustering/bbox/pagination redesign requiring browser validation and API design.
- Exit criterion: reopen when map-visible GPS image count grows or map performance degrades.

### D24-13 - Infinite masonry keeps all loaded cards mounted

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `perf-reviewer.md`
- Original severity/confidence: Medium / High
- Reason for deferral: masonry virtualization/windowing is a larger UI architecture change.
- Exit criterion: reopen with large-gallery DOM/heap evidence or when modifying infinite scroll.

### D24-14 - CSV export materializes full export in memory

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `perf-reviewer.md`
- Original severity/confidence: Medium / High
- Reason for deferral: requires streaming route or background export workflow; current cap prevents unbounded export.
- Exit criterion: reopen if export cap increases, memory warnings occur, or admin DB/export work is scheduled.

### D24-15 - Admin analytics aggregate fan-out can contend on the shared DB pool

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `perf-reviewer.md`
- Original severity/confidence: Low-Medium / Medium
- Reason for deferral: performance tuning dependent on production query telemetry.
- Exit criterion: reopen if analytics route shows DB pool pressure or when adding rollups/cache.

### D24-16 - Topic navigation computes sitemap-only freshness

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `perf-reviewer.md`
- Original severity/confidence: Low / Medium
- Reason for deferral: low-severity query optimization requiring helper split and possible index tradeoff.
- Exit criterion: reopen when nav/topic query latency appears or sitemap freshness changes.

### D24-17 - Semantic/similar search recall and CPU cost are bounded by recency scans

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; reviews `architect.md`, `perf-reviewer.md`
- Original severity/confidence: Medium / High
- Reason for deferral: architectural vector-search decision requiring corpus-size and recall goals; P24-04 fixes a concrete stale/unprocessed scan bug first.
- Exit criterion: reopen when embedding count exceeds scan budget, search quality complaints appear, or vector index work is planned.

### D24-18 - Timeline/date archive predicates are non-sargable

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `perf-reviewer.md`
- Original severity/confidence: Low / High
- Reason for deferral: low-severity performance risk needing production `EXPLAIN` and possible schema/index work.
- Exit criterion: reopen if timeline/year pages become hot or generated date columns/indexes are planned.

### D24-19 - Image processing format fan-out needs profiling when knobs increase

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `perf-reviewer.md`
- Original severity/confidence: Low / Medium
- Reason for deferral: operational validation risk, not current defect at shipped defaults.
- Exit criterion: reopen before raising sizes/concurrency or running large backfills.

### D24-20 - Lightroom upload behavior tests are still mostly source-contract based

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `test-engineer.md`
- Original severity/confidence: Medium / High
- Reason for deferral: broad route harness build; no confirmed runtime failure in LR route this cycle.
- Exit criterion: reopen before modifying LR upload side effects, quota, locks, cleanup, or queue payload.

### D24-21 - Browser upload quota settlement behavior assertions are incomplete

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `test-engineer.md`
- Original severity/confidence: Medium / High
- Reason for deferral: test coverage improvement; current code has idempotent settlement from cycle 23 and no new runtime bug was confirmed.
- Exit criterion: reopen when editing browser upload failure paths.

### D24-22 - CLIP inference queue behavior is source-string locked

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `test-engineer.md`
- Original severity/confidence: Medium / High
- Reason for deferral: requires scheduler extraction/resettable test factory.
- Exit criterion: reopen before changing CLIP concurrency, abort, timeout, or slot-release behavior.

### D24-23 - Real production CLIP validation is skipped by default gates

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `test-engineer.md`
- Original severity/confidence: Low-Medium / High
- Reason for deferral: production model-weight validation lane requires external artifacts and operator environment.
- Exit criterion: reopen before enabling production semantic search on a new host or changing model packaging.

### D24-24 - Production semantic threshold needs real-gallery calibration

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `code-reviewer.md`
- Original severity/confidence: Low / High
- Reason for deferral: product-quality validation requiring real-gallery evaluation data.
- Exit criterion: reopen when collecting semantic-search metrics or changing threshold.

### D24-25 - Container base image / OS packages are mutable

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `security-reviewer.md`
- Original severity/confidence: Low / High
- Reason for deferral: supply-chain policy tradeoff with user rule to track latest stable versions/security updates.
- Exit criterion: reopen when adding SBOM/provenance, release hardening, or digest-pinning policy.

### D24-26 - Bundled nginx cleartext edge assumption needs deployment validation

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `security-reviewer.md`
- Original severity/confidence: High-impact if misdeployed / Medium
- Reason for deferral: manual topology validation risk, not a confirmed repo deployment defect; current docs state nginx is internal behind TLS.
- Exit criterion: reopen if nginx becomes public edge or deployment smoke checks add TLS topology assertions.

### D24-27 - Raw auth error messages are logged

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `security-reviewer.md`
- Original severity/confidence: Low / Medium
- Reason for deferral: low-severity logging hardening; no confirmed secret exposure and stronger High/Medium fixes are scheduled first.
- Exit criterion: reopen when touching auth logging or generalized stderr redaction.

### D24-28 - E2E visual checks capture screenshots without baselines / multi-browser visual coverage is limited

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; reviews `critic.md`, `test-engineer.md`
- Original severity/confidence: Low-Medium / High
- Reason for deferral: visual baseline workflow requires fixture/stability decisions and more CI cost.
- Exit criterion: reopen when investing in visual regression coverage or adding multi-browser E2E lanes.

### D24-29 - Smart collection/archive pages can ship text-only social cards

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `product-marketer-reviewer.md`
- Original severity/confidence: Low / High
- Reason for deferral: product/metadata enhancement requiring generated OG strategy and social-platform validation.
- Exit criterion: reopen when adding OG routes or improving smart collection/archive social sharing.

### D24-30 - Path override env-var support boundary is implicit

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `document-specialist.md`
- Original severity/confidence: Low / Medium
- Reason for deferral: docs policy decision: internal/test-only versus supported operator knobs.
- Exit criterion: reopen when documenting path overrides or changing upload/topic resource mount behavior.

### D24-31 - Reverse-proxy IP trust depends on deployment env validation

- Finding/citation: `.context/reviews/_aggregate.md`, deferred catalog; source review `debugger.md`
- Original severity/confidence: Medium if misconfigured / High
- Reason for deferral: deployment validation risk; current docs require `TRUST_PROXY=true` behind reverse proxy and production env is outside repo.
- Exit criterion: reopen when adding deploy smoke checks or startup validation for proxy topology.
