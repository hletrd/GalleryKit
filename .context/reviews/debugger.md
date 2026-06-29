# Debugger Review - review-plan-fix cycle 4

Date: 2026-06-29
Role: debugger
Scope: current HEAD only, `10b500bb`
Result: 0 fresh debugger findings
Application code edited: no

## Instructions and Context Loaded

- Read `AGENTS.md` first.
- Read `CLAUDE.md` for architecture, operations, runtime topology, queueing, restore, deploy, browser, color/HDR, CLIP, and testing context.
- Loaded the `code-review` skill because this is a review task.
- Consulted `.context/reviews/debugger.md` from cycle 3, `.context/reviews/_aggregate.md`, and the cycle 4 reviewer reports only enough to avoid duplicate findings.
- Confirmed the current HEAD delta from the executable source baseline is review-documentation only; the application/runtime source reviewed here matches the cycle 4 source already examined by sibling lanes.

## Bug-Surface Inventory

I built the review inventory first, then inspected the relevant files in each surface.

### Startup, Shutdown, and Background Work

Reviewed:

- `apps/web/src/instrumentation.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/queue-shutdown.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/lib/clip-model.ts`

Failure modes checked:

- SIGTERM/SIGINT ordering and timeout behavior
- queue drain and restore quiescing
- claim/retry/backoff behavior
- detached CLIP embedding work
- bootstrap idempotence and process-local state
- shutdown with pending async work

### Restore, Upload, and Maintenance Gates

Reviewed:

- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/upload-processing-lock.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/lr-contract.ts`
- `apps/web/src/lib/restore-maintenance.ts`

Failure modes checked:

- database restore lock ordering
- maintenance-mode write blocking
- temporary SQL file cleanup
- dangerous restore SQL pre-scan
- mysql child-process event ordering
- upload disk preclaim and rollback
- LR contract stale state
- public writes during restore
- token creation/revocation during restore

### Public Routes, Server Actions, and Auth Boundaries

Reviewed:

- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/api/admin/*`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/proxy.ts`

Failure modes checked:

- missing admin wrappers
- missing same-origin checks on mutating actions
- public mutating route rate limits
- session/runtime differences
- stale token and cache behavior
- non-admin data leakage
- restore-gate bypasses

### Data Access, Pagination, and Edge-Case Rows

Reviewed:

- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/data-timeline.ts`
- `apps/web/src/lib/data-map.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/drizzle/*.sql`
- `apps/web/drizzle/meta/_journal.json`
- `apps/web/scripts/migrate.js`

Failure modes checked:

- cursor stability
- large collections
- NULL and missing GPS/capture-date rows
- MySQL date/time semantics
- view-count buffering
- schema baseline/reconcile behavior
- journal ordering and migration post-conditions
- stale schema/test fixture drift

### Browser, Runtime, and Generated Artifacts

Reviewed:

- `apps/web/src/components/register-service-worker.tsx`
- `apps/web/public/sw.template.js`
- `apps/web/public/sw.js`
- `apps/web/scripts/build-sw.ts`
- `apps/web/src/lib/use-display-capability.ts`
- `apps/web/src/components/wide-gamut-hint.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/similar-photos.tsx`
- `apps/web/src/components/map/map-loader.tsx`
- `apps/web/src/components/map/map-client.tsx`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/package.json`

Failure modes checked:

- stale service worker generation
- bind-mounted public assets overriding build output
- browser color-gamut differences
- Chromium/Safari/Firefox behavior differences
- racey search responses
- map loading failure fallback
- Docker runtime file layout

## Fresh Findings

No fresh debugger findings were confirmed or judged likely for current HEAD.

This pass found several real risk areas, but each matched an already-recorded cycle 3 or cycle 4 finding and is therefore not duplicated below as a new debugger issue.

## Known Risks Not Refiled

These are intentionally not counted as fresh findings because they are already present in cycle 3 or sibling cycle 4 reports.

### Timeline and Calendar Query Shape

- Existing finding: `PERF-C4-01`
- Regions: `apps/web/src/lib/data-timeline.ts:97-116`, `apps/web/src/lib/data-timeline.ts:129-141`, `apps/web/src/lib/data-timeline.ts:186-207`
- Status: still relevant, but already filed.
- Failure mode: month/day extraction and generated date logic can remain non-sargable or timezone-sensitive for large datasets.

### Map Scalability and GPS Indexing

- Existing finding: `PERF-C4-02`
- Regions: `apps/web/src/lib/data.ts:593-625`, `apps/web/src/components/map/map-client.tsx`
- Status: still relevant, but already filed.
- Failure mode: large GPS-heavy galleries can force full marker transfer and heavy browser clustering/rendering.

### CLIP Embedding Work Escapes Queue Backpressure

- Existing findings: `C3-03`, `PERF-C4-03`
- Region: `apps/web/src/lib/image-queue.ts:512-567`
- Status: still relevant, but already filed.
- Failure mode: detached embedding generation can continue outside the image queue's retry/backpressure contract and may be abandoned on shutdown.

### Semantic and Similar Search Scan/Rerank Cost

- Existing findings: `C3-02`, `PERF-C4-04`
- Regions: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`
- Status: still relevant, but already filed.
- Failure mode: newest-first candidate limits can miss older relevant images and synchronous reranking can overload API paths.

### Smart Collection Count and Backfill Filter Costs

- Existing findings: `PERF-C4-05`, `PERF-C4-06`
- Regions: `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/db/schema.ts`
- Status: still relevant, but already filed.
- Failure mode: unnecessary counts and unindexed `pipeline_version` filters can increase latency on large galleries.

### Process-Local Coordination Under Horizontal Scale-Out

- Existing findings: `C3-06`, `SEC-C4-01`
- Regions: `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/upload-processing-lock.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/admin-rate-limit.ts`, `apps/web/src/lib/view-count-buffer.ts`
- Status: still relevant, but already filed.
- Failure mode: multi-process or multi-container deployments can split locks, rate limits, queued counters, and restore gates.

### Calendar Local-Time Semantics

- Existing finding: `C3-05`
- Region: `apps/web/src/lib/data-timeline.ts`
- Status: still relevant as a product/runtime semantic risk, but already filed.
- Failure mode: server-local date interpretation can disagree with photographer/user expectations around midnight and timezone boundaries.

## Non-Findings From This Pass

### Service Worker Stale Artifact

`apps/web/public/sw.js` contains an older generated stamp than current HEAD, but this is not a fresh production bug for current HEAD:

- `apps/web/package.json` runs `scripts/build-sw.ts` in `prebuild`.
- `apps/web/Dockerfile` runs `npm run build`.
- `apps/web/docker-compose.yml` now bind-mounts only `./public/uploads`, not the entire `public` directory.

Concrete scenario checked: a deploy should regenerate the service worker at build time and should not be overwritten by a stale host-level `public/sw.js` bind mount. The stale committed artifact remains untidy, but the earlier production failure mode is no longer present in the inspected deployment path.

### Restore Write-Gap Regressions

The prior restore-gap class was rechecked across `images.ts`, `lr-tokens.ts`, `public.ts`, and the LR upload route. Mutating paths now carry maintenance/admin/origin gating in the relevant high-risk regions. No fresh bypass was found.

### Migration Journal Drift

`apps/web/drizzle/meta/_journal.json` still contains historical non-monotonic entries, but `apps/web/scripts/migrate.js` now reconciles legacy schemas, baselines journal entries, and asserts committed journal hashes after migration. This remains an operationally important area, but I did not find a fresh latent migration failure beyond already-known history.

### Browser Runtime Fallbacks

Search request staleness, map loader failure fallback, and wide-gamut capability handling were rechecked. I did not find a fresh browser/runtime exception path that is not already covered by existing reviewer notes.

## Missed-Issues Sweep

Final sweep areas and result:

- Async failures: inspected queue drain, restore quiescing, child-process restore, detached embedding, background retries, and shutdown timeout paths. No fresh finding beyond filed CLIP/backpressure and scale-out risks.
- Queue/restoration failures: inspected restore lock, upload lock, maintenance mode, temp-file cleanup, and write gates. No fresh finding.
- Edge-case data: inspected NULL/missing capture dates, GPS data, cursor paths, view counters, smart collections, semantic candidates, and schema-sensitive privacy fields. No fresh finding beyond filed performance/semantic risks.
- Stale generated artifacts: inspected service worker template/output/build hook and Docker/public mounts. No fresh production bug.
- Browser/runtime differences: inspected service worker registration, wide-gamut detection, search races, and map fallback behavior. No fresh finding.
- Tests may miss: reviewed migration, privacy, route-lint, origin-lint, public-rate-limit, touch-target, and queue-related test coverage at a surface level. Remaining risk is primarily scale/data-volume behavior already captured in sibling reports.

## Coverage Statement

This was a static latent-bug review of current HEAD. I examined the relevant source, scripts, schema, generated artifact, and deployment files identified by the inventory above. I did not inspect binary assets, screenshots, or photo fixtures because they are not relevant to the requested latent failure-mode review.

I did not rerun the full quality gate suite in this debugger lane because no application code was changed and the task asked for a review artifact. I relied on direct source inspection plus the fresh cycle 4 sibling review evidence for current-source verification, including lint, auth/origin/rate-limit lint, typecheck, full unit tests, targeted tests, and build results recorded in those reports.

Stop condition met: no unreported fresh debugger finding remained after the final missed-issues sweep, and the report was written to `.context/reviews/debugger.md`.
