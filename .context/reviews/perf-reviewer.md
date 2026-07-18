# Performance Review — Cycle 1 Group B

Date: 2026-07-18 KST
Start HEAD: `64f6ac63`
Role: perf-reviewer

## Inventory and method

I read `AGENTS.md` and `CLAUDE.md`, inventoried all runtime source, tests,
scripts, deployment files, migrations, and plans, and traced the main request
surfaces end to end: public SSR and metadata, gallery pagination, image serving,
photo/lightbox navigation, semantic search/CLIP, upload/Sharp queues, analytics,
admin backfill, restore, sitemap/feed/OG, DB indexes, and client lifecycle work.
The inventory includes all 81 app files, 61 components, 115 library files, 3 DB
files, 369 tests, and the supporting scripts/configuration.

## Findings

### PERF-C1-01 — Desktop first-row image priority is corrected only after hydration

- Severity: **Medium**
- Confidence: **High**
- Status: Confirmed perceived-performance mismatch
- Regions: `apps/web/src/components/home-client.tsx:26-76,124-126,227-242`
- Downstream region: the `MasonryCard` props produced later in
  `apps/web/src/components/home-client.tsx` from `computeIsAboveFold(...)`

`useColumnCount()` initializes `count` to 2 at line 27. The actual 1/2/3/4/5
breakpoint value is not known until the effect runs at lines 34-76. The server
render and hydration render therefore classify only the first two cards as
above-fold on every viewport. On a 3-, 4-, or 5-column desktop, cards 3-5 begin
as lazy/auto-priority and are upgraded only after hydration/effect-driven state
updates. By then the browser has already made its initial loading decisions,
which weakens the intended LCP protection for much of the visible first row.

Concrete failure scenario: on a wide screen with a cold JS/cache path, the
third through fifth visible images wait behind hydration and other resources,
despite the comments saying the 2xl fifth slot receives eager/high priority.
The breakpoint mirroring is correct after mount; the initial state is the gap.

Suggested fix: choose an SSR-safe initial loading strategy that does not depend
on an after-paint viewport effect. One pragmatic option is to make the first
maximum-row set eager while limiting `fetchPriority="high"` more conservatively;
another is a CSS/media-aware preload strategy. Validate mobile overfetch versus
desktop LCP with a cold-cache trace before selecting the policy. Add a test that
asserts initial (pre-effect) priority semantics, not only breakpoint math.

### PERF-C1-02 — Public map duplicates the full marker set into map props and fallback DOM

- Severity: **Medium**
- Confidence: **High**
- Status: Confirmed scaling cost; agrees with prior architecture review
- Regions: `apps/web/src/lib/data.ts:1766-1816`,
  `apps/web/src/app/[locale]/(public)/map/page.tsx:42-67,90-111`,
  `apps/web/src/components/map/map-client.tsx`

The DB cap of 10,000 prevents an unbounded query, but the page maps the complete
row set into a client `markers` payload and then renders the same complete set
again as `<ul>` fallback links. At the upper bound this produces thousands of
serialized objects, thousands of server-rendered list nodes, client hydration
work, and Leaflet marker work in one request. The cap prevents runaway memory;
it does not make the endpoint interactive at its documented maximum.

Concrete failure scenario: a GPS-heavy gallery near the cap makes `/map` ship a
large RSC/HTML payload and create 10,000 list items plus 10,000 interactive map
markers, causing slow TTFB/parse/hydration and main-thread stalls on mobile.

Suggested fix: cluster/virtualize map markers and page or virtualize the
accessible fallback list. Prefer viewport/bbox loading if product semantics
allow it. Preserve a discoverable non-map list and the current GPS opt-in guard.
Benchmark representative 1k/5k/10k datasets before choosing thresholds.

### PERF-C1-03 — Semantic and similar search each rebuild the same brute-force matrix per request

- Severity: **Medium**
- Confidence: **High**
- Status: Confirmed hot-path duplication; agrees with prior architecture review
- Regions: `apps/web/src/app/api/search/semantic/route.ts:263-353`,
  `apps/web/src/app/api/search/similar/[id]/route.ts:137-270`,
  `apps/web/src/lib/clip-embeddings.ts:36-48,80-86`

Both routes fetch up to 25,000 MEDIUMBLOB vectors, decode every row into a
Float32 view, score it in JavaScript, allocate a scored object per valid row,
then issue a second enrichment query. Similar search additionally loads the
target vector separately. There is no shared decoded-vector snapshot or ranking
service, so concurrent searches repeat DB transfer, decode, allocation, and
512-dimensional scoring over the same corpus.

Concrete failure scenario: a handful of concurrent requests at a raised
`SEMANTIC_SCAN_LIMIT` multiply roughly `rows × 2 KiB` DB transfer plus
`rows × 512` floating operations and object allocation, competing with Sharp
and foreground DB work in the single Node process.

Suggested fix: centralize ranking and maintain a bounded, version-keyed decoded
embedding snapshot (or move vector search to a purpose-built index). Ensure
embedding updates invalidate/swap the snapshot atomically, keep request aborts,
and budget memory explicitly before raising the scan cap.

## Verified performance controls / non-findings

- Public listing uses bounded keyset pagination and the corresponding compound
  indexes; load-more prevents overlap and ignores stale/unmounted results.
- Sharp work has queue/thread caps, bounded fan-out, upload size/pixel guards,
  and atomic derivative publication.
- Analytics DB writes are concurrency-bounded and queue-bounded; restore and
  shutdown drains are tracked and timeout-aware.
- Image serving streams from file descriptors, handles HEAD/304 without body
  streams, and debounces its settings hash/config read.
- Search aborts stale semantic fetches; Similar Photos fetches only on demand.
- Sitemap/feed/OG routes have explicit caps/caches/rate limits, and the recent
  `geoip-lite` fix does not add the database to client bundles.

## Final missed-issue sweep

I rechecked sequential awaits, unbounded selects/maps, request-local versus
module caches, timers/listeners/observers, image priority/preload behavior,
buffer materialization, background queues, and query/index alignment. No new
high-confidence catastrophic leak or unbounded production loop was found.
Shared resource-budget fragmentation, non-sargable On This Day predicates, and
deploy-failure Docker cleanup remain documented deferred risks rather than new
findings.
