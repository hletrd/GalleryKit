# Architect — cycle 2 provenance

Review target: `ba4bc60acd4bc41b29ec02f509c3455d115ba083`, 2026-07-18 KST. Review only.

## Relevant-file inventory

Repository-wide architecture inventory covered all 939 files, with direct tracing across: App Router pages/routes/actions (81 files); data, auth, queue, processing, restore, rate-limit, semantic-search, storage, cache, and config libraries (115); DB schema/pool plus 31 migrations/reconcile; 61 UI components and their server/client boundaries; 369 unit tests and 9 browser specs; instrumentation/proxy; Docker/Compose/nginx/deploy scripts; CI and package/build configs; service-worker source/generated artifact; and all governing/operator docs. Boundaries examined were request→action→DB, upload→private original→derivatives, restore→writers/sidecars, build→runtime config, process-local→DB-shared coordination, and deploy→host traffic.

## Findings

### ARCH-2-01 — Queue and color backfill independently spend the same reserved DB capacity

- Severity: **High**
- Confidence: **High**
- Status: **Confirmed; revalidated carry-forward**
- Region: `apps/web/src/lib/image-queue.ts:120-141`; `apps/web/src/lib/admin-backfill-runner.ts:97-142`; `apps/web/src/db/index.ts:31-45`

Failure scenario: at the shipped pool limit of 10, the upload queue independently permits two workers and the color backfill independently permits two workers. The backfill also pins its run lock. Their combined worst case is about nine connections, despite each resolver claiming to reserve five for live traffic. A photo request fan-out, topic mutation, or restore preparation then queues behind encode-duration holds and can exhaust the pool queue.

Suggested fix: introduce one process-wide background DB/CPU budget leased by queue workers and backfills, or make the color backfill quiesce the upload queue. Test combined occupancy, not each resolver in isolation.

### ARCH-2-02 — Sitemap freshness is owned by both build-time prerendering and runtime DB state

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed**
- Region: `apps/web/src/app/sitemap.ts:4-12,36-82`; build output `.next/prerender-manifest.json` (`/sitemap.xml.initialRevalidateSeconds = 3600`)

Failure scenario: build time owns the initial sitemap even though build time intentionally has no DB. Runtime owns the authoritative topics, photos, freshness timestamps, and navigation-discovery flags, but cannot replace the build fallback until the route-cache TTL expires. This is split ownership of one SEO artifact, not merely graceful degradation.

Suggested fix: choose one owner. Prefer first-request runtime generation backed by a successful-result cache/revalidation policy; do not commit a known-incomplete build result to the same freshness window as an authoritative runtime result.

### ARCH-2-03 — The deployment health check observes replacement rather than gates promotion

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed; revalidated carry-forward**
- Region: `apps/web/deploy.sh:63-89`; `apps/web/docker-compose.yml:12-17`

Failure scenario: Compose replaces the only web instance before health is known. A bad release enters `restart: always`; the old healthy instance is gone; the subsequent 90-second loop can only report the outage. With no staging and mandatory per-iteration deploys, this failure domain is exercised frequently.

Suggested fix: blue/green the candidate on a second local port/container and atomically switch nginx/upstream after health, or implement captured-image rollback. Preserve the single-writer constraint by promoting only after the old writer is drained/stopped.

## Architecture defenses / accepted boundaries

- Restore drains foreground mutations, image queue, maintenance, background DB writes, and buffered group counts; sidecars use durable maintenance/advisory locks. No new missing writer was confirmed.
- Local-filesystem storage only, build-time JSON semantics, SQL-only backup scope, same-origin public image caching, and single-instance topology are accurately called out in `CLAUDE.md`.
- The single-writer guard remains warn-only by explicit product policy; I did not relabel that accepted tradeoff as a new defect.
- Public/admin projection separation and compile-time privacy guards remain layered correctly.

## Final missed-issues sweep

I swept circular/shared-state ownership, async shutdown, restore ordering, lock namespace and connection lifetime, schema/reconcile dual ownership, cache invalidation, build/runtime env freezing, CDN/service-worker boundaries, multi-instance assumptions, and deploy/host ownership. No additional architectural issue was confirmed beyond the three recorded items.
