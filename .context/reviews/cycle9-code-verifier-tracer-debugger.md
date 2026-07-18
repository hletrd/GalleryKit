# Cycle 9 Code Reviewer / Verifier / Tracer / Debugger Provenance

Date: 2026-07-18 KST
Review target: `f50e96b31d04dae85cdd73eb2a99e816c8b403e7`
Mode: review only; no application code changed

## Inventory and method

I read `AGENTS.md` and all 770 lines of `CLAUDE.md`, then inventoried the
maintained repository before reviewing behavior: 629 TypeScript/TSX files
under `apps/web/src` (364 Vitest files), 80 App Router files, 116 library
modules, 61 components, 13 action modules plus admin DB actions, 12 route
handlers, 28 maintained TS/JS/MJS scripts, 13 Playwright specs, and 31 SQL
migrations with 31 matching journal entries and the legacy reconciliation
path. I also read the current Cycle 8 aggregate/plan, the consolidated deferred
register, and relevant historical findings so fixed or explicitly deferred
items would not be re-filed as new.

The full pass traced public listing/search/share/feed flows, admin auth and
mutation barriers, upload -> DB -> queue -> derivative handoffs, delete ->
durable cleanup, restore drains/finalizers, gallery-setting lifetime, detached
background consumers, migrations/schema/privacy projections, responsive image
selection, and deploy/runtime boundaries. The recent responsive-masonry diff
was an entry point rather than a scope boundary. A closing sweep rechecked
error swallowing, promise/timer ownership, cache invalidation, transaction/file
boundaries, pagination order, background-writer admission, custom setting
values, and current tests against implementation behavior.

Fresh baseline evidence:

- ESLint passed.
- API-auth, action-origin/mutation-barrier, and public-route-rate-limit gates
  passed.
- App and script typechecks passed.
- Focused queue/restore/responsive/blur-wiring tests passed: 4 files, 42 tests.
- Production dependency audit reported zero vulnerabilities.
- Migration files and journal tags are one-to-one (31/31); the historical
  non-monotonic journal segment remains intentionally handled by
  `migrate.js`, while the current tail is above the old maximum.
- `git diff --check` passed at the review target.

## Findings

### COR-C9-01 — A late detached-config read can undo post-commit cache invalidation

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed current production-capable race by source trace; exact
  timing reproduction/manual impact validation still recommended**
- Regions: `apps/web/src/lib/gallery-config.ts:234-269`;
  `apps/web/src/app/actions/settings.ts:235-267`;
  consumers at `apps/web/src/lib/image-queue.ts:542-549,862-881,981-1008`;
  incomplete coverage at
  `apps/web/src/__tests__/gallery-config-uncached-microcache.test.ts:76-94,129-141`

`getGalleryConfigDetached()` writes both `uncachedConfigCache` and
`uncachedConfigInFlight` unconditionally when its DB read settles. The runtime
invalidator clears those variables, but it has no generation/epoch or promise
identity guard. A pre-invalidation promise therefore remains able to publish
after the settings transaction commits:

1. A queue/background caller starts read A and stores promise A in
   `uncachedConfigInFlight`.
2. `updateGallerySettings()` commits value B and calls
   `invalidateDetachedGalleryConfigCache()`, which sets cache and in-flight to
   null.
3. Read A resolves afterward and unconditionally caches stale value A for a
   fresh two-second TTL. Its `finally` also unconditionally sets the in-flight
   slot to null, which can erase the handle for a post-invalidation read B that
   has already started.
4. A detached queue consumer can now observe A after the mutation returned
   success, contrary to the documented immediate-invalidation contract.

Concrete failure: while an embedding-mode/config lookup is in flight, an admin
disables stub semantic search. The commit invalidates the cache, but the late
read republishes `stub`; a just-processed image can still write a stub embedding
after the successful disable. Legacy pending jobs without a persisted
processing snapshot can likewise resolve old encode/auto-caption settings
after a flip. The normal upload path's strict persisted snapshot reduces the
common encode impact, and the stale window is bounded by the two-second TTL,
but neither removes the production race.

This also fires the concrete exit criterion of deferred `C6-24`: that row
described theoretical duplicated-cache/HMR staleness, whereas this is a
single-module, single-production-instance late-promise overwrite.

Fix: add an invalidation generation. Each fetch captures the generation and
may publish its result only if it still matches; its `finally` may clear the
in-flight slot only when that slot still equals the same promise. Invalidation
increments the generation and clears the visible cache/slot so the next call
starts a fresh read. Add a controlled deferred-promise test that starts A,
invalidates, starts B, resolves A first, and proves A neither populates the
cache nor clears B's in-flight ownership.

### COR-C9-02 — Grid source sets truncate configurable derivatives by array position

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed deterministic source-selection defect; perceived
  sharpness and exact browser `currentSrc` should be browser-validated**
- Regions: accepted configuration contract at
  `apps/web/src/lib/gallery-config-shared.ts:152-177,255-301` and
  `apps/web/messages/en.json:745,755-762`;
  main grid at `apps/web/src/components/masonry-card.tsx:87-115`;
  timeline at
  `apps/web/src/app/[locale]/(public)/timeline/page.tsx:98-100,230-276`;
  year archive at
  `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:104-111,192-238`;
  shared groups at
  `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:124-127,198-242`;
  sizing policy at `apps/web/src/lib/responsive-masonry.ts:37-74`

The settings contract accepts one to eight sorted widths anywhere from 128 to
10,000 px, and output sizes are deliberately configurable before the first
photo exists. The grid renderers do not select candidates by required width:
main and shared grids use `imageSizes[0]` and `[1]`; timeline/year find the
candidate nearest 640 for the first entry but still use positional `[1]` for
the second. Every larger configured derivative is omitted from `srcset`, even
when the now-accurate `sizes` attribute asks for it.

Concrete failure: a fresh operator-valid configuration
`128,256,640,1536` produces all four derivatives. The normal three-photo main
grid advertises a roughly 490 px slot above the container cap, but its AVIF,
WebP, and JPEG source sets expose only 128w and 256w, so even a DPR-1 browser
must upscale the 256w file while the adequate 640w/1536w files sit unused.
Timeline/year produce the internally inverted semantic pair 640w + 256w for
the same configuration because the first candidate is target-derived and the
second is positional. With defaults, a one-photo 2xl main grid advertises a
1,504 px slot but exposes only 640w/1536w; at DPR 2 the browser needs about
3,008 source pixels and cannot choose the already-generated 2048/4096 variants.

This is not the stale historical “configured sizes were hardcoded/unsorted”
finding: current config is correctly passed and sorted. The remaining defect is
that all current public grid consumers truncate the valid sorted set by ordinal
position, an assumption the validator and UI do not promise. Cycle 8's browser
tests use only the default 640/1536-leading array, so they cannot expose it.

Fix: centralize grid candidate selection and build a monotonic, deduplicated
ladder from configured widths based on actual slot needs, rather than positions
zero and one. Emitting all configured widths is the simplest correct contract;
if markup size requires a bounded ladder, it still needs small/medium/high-DPR
coverage and a largest fallback. Reuse it across main, timeline, year, and
shared grids. Add unit/browser cases for `128,256,640,1536`, a one-item
high-DPR gallery, and a list with only one or two configured widths.

## Revalidated rather than re-filed

The shared queue/backfill DB budget, streaming upload/restore memory envelope,
warn-only single-writer guard, concurrent-restore auth ordering, large map and
semantic scans, migration/reconcile integration-test gap, custom admin/browser
matrix, and host-nginx/operator claims remain in the consolidated deferred
register with unchanged exit criteria except that `C6-24` now has the concrete
production race above. The Cycle 8 container-capped `sizes` arithmetic itself
matches the shipped Tailwind container/padding/gap breakpoints and its new
default-ladder browser cases; I did not repeat the closed viewport-owned-sizing
finding.

## Final missed-issue sweep

The final sweep revisited all sibling responsive consumers, custom size
normalization, queue bootstrap/retry maps, image delete and pending-file ledger
races, restore maintenance/barrier drains, analytics tracking, session/PAT
auth, topic/tag/share mutations, SQL grouping/order/index alignment, privacy
select guards, migration journal/reconcile parity, PWA/ETag/config lifetime,
and release/deploy ledgers. No third fresh correctness finding survived source
validation and historical deduplication.
