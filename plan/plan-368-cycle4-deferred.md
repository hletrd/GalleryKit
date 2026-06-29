# Plan 368 — Cycle 4/100 Deferred Register

**Created:** 2026-06-29
**Source:** `.context/reviews/_aggregate.md` plus all cycle-4 per-agent reviews.
**Status:** DEFERRED REGISTER

This file records every cycle-4 review finding not scheduled for immediate implementation in `plan/plan-367-cycle4-fixes.md`. Each deferred item preserves the original severity/confidence, file+line citation, concrete reason, and re-open criterion. Deferred work remains bound by repo policy: GPG-signed commits, Conventional Commit + gitmoji, no `--no-verify`, no force-push, required gates, and current toolchain/version rules.

Security, correctness, and data-loss findings are not deferred here except where the repo's own documented current topology explicitly permits treating the item as a non-current scale-out guardrail.

## DEF-C4-01 — Timeline and on-this-day queries are non-sargable

- **Source:** `perf-reviewer` PERF-C4-01
- **File+line:** `apps/web/src/lib/data-timeline.ts:97-116`, `apps/web/src/lib/data-timeline.ts:129-141`, `apps/web/src/lib/data-timeline.ts:186-207`
- **Original severity/confidence:** Medium / High
- **Reason for deferral:** Performance-only schema/query redesign requiring generated columns, functional indexing, or broader query-shape migration. No security, correctness, or data-loss impact was claimed. This also overlaps prior known performance debt.
- **Exit criterion:** Re-open when timeline/on-this-day latency scales with total processed image count, library size grows enough to make the route hot, or the next schema/index migration batch is planned.

## DEF-C4-02 — Public map lacks a map/GPS access path and renders too many markers

- **Source:** `perf-reviewer` PERF-C4-02
- **File+line:** `apps/web/src/lib/data.ts:1624-1660`, `apps/web/src/app/[locale]/(public)/map/page.tsx:8-49`, `apps/web/src/components/map/map-client.tsx:76-143`
- **Original severity/confidence:** Medium / High
- **Reason for deferral:** Performance-only map architecture/indexing work. The current personal-gallery deployment is bounded by `MAP_MAX_MARKERS`; the finding did not claim privacy/security or data-loss impact.
- **Exit criterion:** Re-open when public geotagged photo count approaches the marker cap, map route latency becomes visible, or a map endpoint/index migration is planned.

## DEF-C4-03 — Production CLIP embedding work escapes image-queue backpressure

- **Source:** `perf-reviewer` PERF-C4-03
- **File+line:** `apps/web/src/lib/image-queue.ts:204-212`, `apps/web/src/lib/image-queue.ts:305-569`, `apps/web/src/lib/image-queue.ts:512-567`, `apps/web/src/lib/clip-model.ts:151-199`
- **Original severity/confidence:** Medium / High
- **Reason for deferral:** Availability/performance architecture work requiring a dedicated embedding queue or durable job model. This overlaps already-open cycle-3 deferred debt and is not a correctness/data-loss finding for current single-instance operation.
- **Exit criterion:** Re-open before raising upload concurrency, when production semantic ingestion volume grows, or when adding queue/drain observability.

## DEF-C4-04 — Semantic/similar search scan and sort embeddings synchronously on request path

- **Source:** `perf-reviewer` PERF-C4-04
- **File+line:** `apps/web/src/app/api/search/semantic/route.ts:240-281`, `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`, `apps/web/src/lib/clip-embeddings.ts:36-44`
- **Original severity/confidence:** Medium / Medium
- **Reason for deferral:** Performance/recall architecture work requiring vector indexing or a bounded top-K rewrite. The current route has explicit scan caps, same-origin checks, and public rate limits.
- **Exit criterion:** Re-open when `SEMANTIC_SCAN_LIMIT` is raised above the default, search latency exceeds budget, or a vector-index backend is introduced.

## DEF-C4-05 — Color-pipeline backfill filters on unindexed `pipeline_version`

- **Source:** `perf-reviewer` PERF-C4-06
- **File+line:** `apps/web/src/lib/admin-backfill-runner.ts:370-410`, `apps/web/scripts/backfill-color-pipeline.ts:326-332`, `apps/web/src/db/schema.ts:73-77`
- **Original severity/confidence:** Low / Medium
- **Reason for deferral:** Performance-only admin maintenance optimization. A proper fix needs an index migration or progress UX redesign, which is disproportionate for this cycle and does not affect correctness/security.
- **Exit criterion:** Re-open on the next pipeline-version bump, when backfill discovery becomes slow, or when adding operational indexes.

## DEF-C4-06 — Process-local security state is unsafe if production is horizontally scaled

- **Source:** `security-reviewer` SEC-C4-01
- **File+line:** `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/lib/upload-tracker-state.ts:7-79`, `apps/web/src/lib/rate-limit.ts:68-108`, `apps/web/src/lib/rate-limit.ts:314-318`, `apps/web/docker-compose.yml:14-21`
- **Original severity/confidence:** Medium / High
- **Reason for deferral:** The repo explicitly constrains current production to a single web instance. CLAUDE.md says: "The shipped Docker Compose deployment is a single web-instance / single-writer topology" and "do not horizontally scale the web service unless those coordination states are moved to a shared store." Under that repo rule, this is a scale-out guardrail rather than a current deployment defect.
- **Exit criterion:** Re-open before any multi-process, multi-replica, worker split, or load-balanced deployment; or when adding Redis/DB-backed shared state.

## Coverage assertion

All cycle-4 findings are accounted for:

- AGG-C4-01 through AGG-C4-15 -> scheduled in `plan/plan-367-cycle4-fixes.md`.
- DEF-C4-01 through DEF-C4-06 -> recorded here.

