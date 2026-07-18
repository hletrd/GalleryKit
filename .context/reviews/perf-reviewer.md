# Performance Review — Cycle 2

Date: 2026-07-18 KST
Review HEAD: `ba4bc60a`
Role: perf-reviewer
Mode: review-only

## Inventory and method

After reading `AGENTS.md` and `CLAUDE.md`, I inventoried the complete app/lib/
component/script/schema/test surface and traced public SSR/RSC, masonry image
selection and hydration, pagination, photo/lightbox navigation, search and CLIP
ranking, map rendering, Sharp queues, DB pool budgets, analytics, feeds/OG,
restore, and deploy cleanup. I reviewed all changes since the cycle-1 baseline
and ran a fresh isolated browser session against production at 320x700 so HTTP
cache state could not hide initial image transfers.

## New finding

### PERF-C2-01 — The desktop LCP fix eagerly downloads five mobile cards before hydration can correct it

- Severity: **Medium**
- Confidence: **High**
- Status: Confirmed new regression with cold-browser runtime evidence
- Regions: `apps/web/src/components/home-client.tsx:26-32,94-108,299-309`;
  `apps/web/src/components/masonry-card.tsx:81-124,128-145`;
  `apps/web/src/__tests__/masonry-card-memo.test.ts:190-195`

`useColumnCount()` begins with two columns and an unmeasured viewport. While
unmeasured, `computeShouldEagerLoad()` deliberately returns true for the first
five cards. The SSR HTML therefore marks five images `loading="eager"` on every
viewport and initially marks the first two `fetchpriority="high"`. The mobile
effect later changes the DOM to one eager/high image, but network requests
started from the server HTML cannot be cancelled retroactively.

Runtime evidence: in a new browser session at 320x700, the first five 640px
AVIF requests all began at 62 ms. Their encoded sizes were 58,307, 61,966,
62,434, 56,926, and 169,453 bytes (about 409 KiB total), although only the first
card was finally above-fold/eager after hydration. Cards 2-5 therefore consumed
about 351 KiB on the cold mobile navigation. Post-hydration DOM inspection
misleadingly showed cards 2-5 as lazy even though all five transfers had
already completed.

Concrete failure scenario: a visitor on a metered/slow mobile connection opens
the gallery and competes for bandwidth with four below-fold AVIFs. This delays
the actually visible image and JS/CSS while spending data the visitor may never
scroll to. The source test positively pins the five-card unmeasured behavior
but has no cold-navigation request assertion.

Suggested fix: keep the initial mobile-safe eager set small and use a
desktop-media-qualified preload/priority mechanism for cards 3-5 (or another
server-known responsive hint) rather than a viewport-agnostic eager attribute.
Add cold-cache 320px and 1536px browser assertions over requests initiated
before hydration, not merely the final DOM attributes.

## Revalidated carry-forward findings

### PERF-C2-R1 — The map duplicates up to 10,000 rows into client markers and fallback DOM

- Severity: **Medium**
- Confidence: **High**
- Status: Confirmed carry-forward
- Regions: `apps/web/src/lib/data.ts:1781-1816` and
  `apps/web/src/app/[locale]/(public)/map/page.tsx:42-111`

The DB cap bounds memory but the page still serializes the whole marker set,
renders the same rows as fallback links, and asks Leaflet to create the marker
layer. A GPS-heavy gallery near the cap can stall TTFB, parsing, hydration, and
mobile interaction. Cluster/viewport-load markers and paginate or virtualize
the accessible list while preserving the GPS opt-in projection.

### PERF-C2-R2 — Semantic and similar search repeat full vector transfer/decode/ranking

- Severity: **Medium**
- Confidence: **High**
- Status: Confirmed carry-forward
- Regions: `apps/web/src/app/api/search/semantic/route.ts:263-353` and
  `apps/web/src/app/api/search/similar/[id]/route.ts:137-270`

Each request loads and decodes up to the configured scan cap of 2 KiB vectors,
allocates scored rows, sorts, and performs enrichment. Concurrent requests
repeat the identical matrix work in the single web process. Centralize ranking
behind a bounded model-versioned snapshot/index or a vector store, with atomic
invalidation and an explicit memory budget.

## Final missed-issue sweep

I rechecked unbounded collections, `offset`/keyset use, query/index alignment,
sequential awaits, buffer materialization, image priority/srcset behavior,
observers/listeners/timers, request caches, queue/thread caps, and failure-path
Docker cleanup. Pagination, Sharp limits, bounded background writes, abortable
search, and streamed upload serving remain intact. No further new performance
regression survived the final sweep.
