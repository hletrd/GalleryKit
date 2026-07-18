# Architect — cycle 3 provenance

Review target: `afa11cf4`, 2026-07-18 KST. Review only.

## Architecture inventory

I inventoried all 939 files, including 81 route/action/page files, 115 libraries, 61 components, DB/schema/migrations/reconcile, scripts and background jobs, 368 unit tests and 12 Playwright files, build/runtime/deploy/nginx/PWA assets, and governing/operator/review/deferred documentation. Boundaries traced end-to-end were request→action→auth/barrier→DB, upload→original→derivatives→embedding, delete→durable cleanup, restore→writers→migration→mutable stores, SSR→resource hints→CSS layout→hydration, CLIP inference→blob ranking, and deploy→health→promotion/cleanup.

## Genuinely new cycle-3 findings

### ARCH-C3-01 — Image scheduling assumes ownership of layout placement it cannot know

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed new cycle-3 architectural mismatch**
- Regions: `apps/web/src/components/home-client.tsx:129-169,272-314,363-375`; `apps/web/src/components/masonry-card.tsx:21-33,121-145`; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:187-196`

The scheduling layer declares DOM indices 0-N to be “above fold”/“first row,” but placement belongs to the CSS multi-column balancing algorithm. The server knows image dimensions and order but not the balanced column breaks for the actual viewport; the client helper knows only column count, not element geometry. A Chromium proof showed four-column top items at indices 0/5/10/15 while hints targeted 1/2/3. This is split ownership: scheduling asserts an invariant the layout architecture does not expose.

Concrete failure: performance policy sends parser-time hints to below-fold objects while visible column leaders remain normal/lazy, making LCP depend on an accidental CSS balance result.

Suggested fix: establish one owner. Either keep CSS columns and only prioritize the universally first item, or introduce deterministic column assignment/layout metadata that the scheduling layer can consume. Centralize the policy so home, shared group, timeline, and year pages cannot each recreate a different first-N heuristic.

### ARCH-C3-02 — Browser evidence is recorded as complete but the test boundary remains source text

- Severity: **Low-Medium**
- Confidence: **High**
- Status: **Confirmed new cycle-3 test-architecture finding**
- Regions: `.context/plans/cycle-2-2026-07-18-plan.md:29-32,64-78`; `apps/web/src/__tests__/masonry-card-memo.test.ts:115-123`; `apps/web/e2e/public.spec.ts:4-49`

The cycle ledger says request-timeline coverage exists, but the test boundary stops at string presence. No maintained browser test crosses resource hint → CSS placement → request initiation. This is why the invalid inter-layer assumption passed all gates.

Suggested fix: make a small browser contract the architecture boundary: for each responsive column count, collect card geometry and early derivative requests, and assert explicit priority belongs only to actually visible candidates. Update plan evidence to match what is committed.

## Revalidated carry-forward architecture risks (not new)

### ARCH-C3-R1 — Background DB capacity has module-local, non-composable owners

- Severity/Confidence: **High / High**
- Regions: `apps/web/src/db/index.ts:21-45`; `apps/web/src/lib/image-queue.ts:120-152`; `apps/web/src/lib/admin-backfill-runner.ts:97-142`

Queue and backfill each reserve half the same pool as though the other did not exist. Their locks differ, so they can overlap. Replace independent arithmetic with a process-wide weighted admission controller or explicit mutual exclusion.

### ARCH-C3-R2 — SQL restore and mutable photo stores have no shared generation

- Severity/Confidence: **Medium / High**
- Regions: `apps/web/src/app/[locale]/admin/db-actions.ts:789-1046`; `apps/web/docker-compose.yml:24-32`

Restore locks make DB import internally safe but do not pair the SQL generation with original/derivative/resource bind mounts. Restoring old rows can reference deleted files and leave newer files orphaned. This remains a documented operational boundary; add a manifest/generation and reconciliation report if full-stack rollback becomes a product requirement.

### ARCH-C3-R3 — Single-instance correctness remains warn-only

- Severity/Confidence: **Medium / Medium**
- Regions: `apps/web/src/lib/single-writer-guard.ts:6-16,218-235`; process-local state in `apps/web/src/lib/rate-limit.ts`, `upload-tracker-state.ts`, and queue/backfill status modules

The shipped topology is explicitly single-instance, and the guard only logs contention. No repository evidence shows topology change, so this remains carry-forward under the documented operator contract rather than a new cycle-3 defect.

## Final coverage sweep

The final architecture sweep covered server/client boundaries, runtime/build-time config, persistence mounts, schema/reconcile/journal, every writer against restore barriers/locks, auth/rate-limit ownership, file lifecycle durability, process-local versus DB-shared coordination, cache invalidation, and deploy promotion. Sitemap runtime ownership and combobox/listbox ownership now align. No other new architecture break survived cross-file validation; known scale/topology/restore/deploy risks remain explicitly carry-forward.
