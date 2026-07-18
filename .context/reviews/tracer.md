# Tracer — cycle 4 provenance

Review target: `01d39653`, 2026-07-18 KST. Review only.

## Inventory and trace coverage

I inventoried the full maintained repository, then traced request→guards→mutation→DB, upload→quota→private original→queue→derivatives/embedding, delete→transaction→durable cleanup, restore→locks/barrier/import/migrations/stores, SSR→image attributes→CSS placement→browser request, nav activation→focus→collapse, tag disclosure→layout/hit testing, semantic inference→ranking/enrichment, migration journal→apply→postcondition, and deploy→replacement→health→production. Every post-Cycle-3 change was followed through callers, tests, SSR output, and current production output.

## New trace findings

### TRC-C4-01 — The Cycle 3 release trace reaches production but not its authoritative terminal ledger

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed** evidence-chain break; same root as `CR-C4-01`
- Trace/regions: `.context/plans/cycle-3-2026-07-18-plan.md:5` declares push/deploy pending → signed commits `2d9060de..01d39653` exist on `origin/master` → production SSR contains the changed tag/nav/masonry output → `.context/plans/cycle-3-2026-07-18-plan.md:45-48,64-65` still terminates before push/deploy → `.context/plans/README.md:34-38` keeps Cycle 3 active

Concrete failure: recovery tooling or a reviewer follows the ledger rather than reconstructing git plus live state, and repeats terminal work or misstates which release production runs.

Suggested fix: append the signed commit frontier and live proof, mark both transitions complete, archive Cycle 3, and make Cycle 4 the active trace root.

### TRC-C4-02 — The image-priority code path and its adjacent declared contract now diverge

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed** maintainability trace break; runtime output is correct
- Trace/regions: `apps/web/src/components/home-client.tsx:26-49` declares desktop media preloads/first-row eager scheduling → `home-client.tsx:127-145` actually returns true only for index 0 and contains no preload call → `masonry-card.tsx:28-33` still declares first-N/wider-eager props → `masonry-card.tsx:121-144` receives only the index-0 policy

Concrete failure: a maintainer traces from interface comments, assumes missing first-row scheduling is an implementation omission, and restores the invalid DOM-first-N behavior.

Suggested fix: align comments and types with the actual trace, remove ignored policy inputs, and expose one universal-first-card predicate.

## Revalidated carry-forward traces

- **TRC-C4-R1 — background reservation traces converge on one DB pool** — High / High / confirmed carry-forward; `db/index.ts:21-45`, `image-queue.ts:120-152`, `admin-backfill-runner.ts:97-142`. Use a shared weighted budget.
- **TRC-C4-R2 — restore consistency stops at the SQL/filesystem generation boundary** — Medium / High / documented carry-forward; `db-actions.ts:789-1098`, `docker-compose.yml:24-32`. Pair snapshots with a generation/manifest or reconcile after restore.
- **TRC-C4-R3 — deploy failure is observed after promotion with no reverse transition** — Medium / High / confirmed carry-forward; `apps/web/deploy.sh:63-89`. Preserve and restore the prior release or promote a candidate only after health.

## Final causal sweep

The closing trace rechecked sitemap runtime cache ownership, search/listbox ownership, every writer's origin/rate-limit/barrier sequence, processing/delete races, restore sidecars/advisory locks, schema application, settings→encoder→ETag flow, proxy IP→rate-limit/analytics flow, service-worker cache mutation, and deploy/prune ordering. No further new causal break survived validation.
