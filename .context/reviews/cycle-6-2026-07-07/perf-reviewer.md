# perf-reviewer review — cycle 6

## Summary

Reviewed the committed HEAD (`583277fb`) from a performance/concurrency angle: DB query
shapes in `lib/data.ts` callers, the Sharp image pipeline, the service worker cache, React
components (masonry grid, admin bulk tables, map, histogram, search, lightbox), rate-limit
and bounded-map infrastructure, the CLIP inference queue, and API routes. This repository has
already been through ~10 review "runs" and the overwhelming majority of files I inspected
(`process-image.ts`, `rate-limit.ts`, `bounded-map.ts`, `analytics-data.ts`,
`clip-embeddings.ts`, `clip-model.ts`, `histogram.tsx`, `masonry-card.tsx`, `sitemap.ts`,
`revalidation.ts`, `similar-photos.tsx`, `search.tsx`) show dense evidence of prior
perf-specific review (inline comments citing dozens of past finding IDs) and are already
well-bounded/memoized/documented — no new issues found there. Three concrete, previously
unflagged findings below, all in files outside the peer-dirty list.

## Findings

### F1 — `bulkUpdateImages` applies suggested alt-text via a sequential per-row UPDATE loop inside one transaction  [SEV: MED | CONF: High | apps/web/src/app/actions/images.ts:1170-1180]

When an admin bulk-applies suggested alt text (`applyAltSuggested: 'title' | 'description'`)
to a batch of up to 100 images (`requestedIds.length > 100` rejected at line 1037), the code
builds a `toUpdate` list of `{id, caption}` pairs and then does:

```ts
for (const { id, caption } of toUpdate) {
    if (applyAltSuggested === 'title') {
        await tx.update(images).set({ title: caption }).where(eq(images.id, id));
    } else {
        await tx.update(images).set({ description: caption }).where(eq(images.id, id));
    }
}
```

This runs inside the `db.transaction(async (tx) => {...})` wrapping the whole action (started
at line 1106), so up to 100 sequential UPDATE statements execute one-by-one on the *same*
held connection before the transaction commits. The comment above the loop explains why a
single bulk `SET` wasn't used ("Per-row updates avoid a bulk SET that would overwrite
different suggested values with a single expression") — true for a naive `SET title = ?`, but
MySQL supports a single UPDATE with a `CASE id WHEN ... THEN ... END` expression (or a
`INSERT ... ON DUPLICATE KEY UPDATE` values-list trick) that applies a *different* value per
row in one statement/round-trip.

**Failure scenario:** an admin selects 100 photos in the dashboard and clicks "apply suggested
titles to all". Each UPDATE is a separate MySQL protocol round-trip on the same connection
still held via `db.transaction`. Even at 2-5 ms/round-trip locally this is 200-500 ms of pure
head-of-line DB latency for one click; over a higher-latency DB link (managed MySQL, remote
host) each round-trip can cost 10-50+ ms, pushing the whole action into multi-second territory
— during which the same connection, the transaction, and the process-wide
`acquireAdminMutationSlot()` restore-fence slot (held for the entire action body per the
C1-03/`using mutationSlot` comment at line 772) are all pinned. A concurrent restore attempt
must drain this slot (30 s timeout) before importing, so a long bulk-edit action bites into
that same budget.

**Fix:** batch the per-row updates into one statement, e.g. build a single
`UPDATE images SET title = CASE id ${...} END WHERE id IN (${toUpdate.map(r=>r.id)})` (or the
`description` equivalent) via `sql` template literals with parameter binding, so N round-trips
become 1 regardless of batch size. This mirrors the pattern already used for the scalar
`setClause` bulk `UPDATE` a few lines above (line 1126), which correctly does one statement
for the whole batch.

### F2 — Bulk photo uploads always send one file per server-action call, even though the server already supports batching  [SEV: LOW-MED | CONF: Medium | apps/web/src/components/upload-dropzone.tsx:240-297, apps/web/src/app/actions/images.ts:129-230]

`uploadImages(formData)` reads files via `formData.getAll('files')` (images.ts:148) and is
fully designed to process an arbitrary-size batch of files in one call — it validates
filenames for the whole batch, acquires the `gallerykit_upload_processing_contract` advisory
lock ONCE, reads gallery config ONCE, and (per the images.ts:196-197 comment) already handles
"cumulative upload tracking across per-file invocations" specifically *because* the client
currently calls it once per file.

The client (`upload-dropzone.tsx`) never exercises this batch path: `uploadFile()` builds a
`FormData` with exactly one `formData.append('files', file)` (line 244), and the driving loop
awaits `uploadFile(item)` once per file (lines 294-297). The surrounding comment correctly
explains why uploads must stay *sequential* (the server serializes against one named MySQL
lock, so parallel client requests would self-collide) — but sequential and one-file-per-call
are independent choices. Every single-file call still pays the full per-call overhead:
`requireSameOriginAdmin()`, `acquireAdminMutationSlot()`, `getCurrentUser()`,
`acquireUploadProcessingContractLock()` (a dedicated advisory-lock connection acquire +
release), `getGalleryConfigStrict()`, and upload-tracker prune/claim bookkeeping — all
repeated N times for an N-file batch instead of once per batch of, say, 5-10 files.

**Failure scenario:** a photographer imports a 60-photo shoot. The batch runs as 60 sequential
HTTP/server-action round-trips, each paying full admin-auth + lock-acquire + config-read
overhead on top of the actual save+EXIF-extract work, instead of ~6-12 round-trips of ~5-10
files each (still sequential, still respecting the single-writer lock, just fewer redundant
setup round-trips). The added overhead scales with file count and network latency to the
deploy host, independent of the (already necessary, already documented in the deferred
register as C4-10) sequential constraint.

**Fix:** batch the client-side loop into fixed-size chunks (e.g. 5-10 files per FormData call)
while keeping chunk-to-chunk awaits sequential — the server side already loops over
`formData.getAll('files')` internally and needs no change. Low priority since actual upload
bandwidth (200 MB/file cap) likely dominates wall-clock time for large photos; the win is
clearest for many-small-file or high-DB-latency deployments.

### F3 — Smart-collection predicate compilation has no cost ceiling on the always-dynamic `/c/[slug]` route  [SEV: LOW | CONF: Low-Medium | apps/web/src/lib/smart-collections.ts:142-273, apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17,105]

`compileSmartCollection` bounds AST *shape* (max depth 4, max 512 nodes, max 64 children per
AND/OR group, max 100 IN values) but not compiled *SQL cost*. Every `tag` predicate
(`eq`/`contains`) compiles to its own `images.id IN (SELECT ... FROM image_tags JOIN tags
WHERE ...)` subquery (lines 250-268); a query authored near the structural ceiling (dozens of
tag `contains`/LIKE subqueries ANDed/ORed together) produces a single WHERE clause with dozens
of independent derived-table scans. The `/c/[slug]` page sets `export const revalidate = 0`
(page.tsx:17), so this compiles and executes fresh on every request — no ISR/cache layer
absorbs repeat hits, including from crawlers (the collection is also listed in `sitemap.ts` via
topic-adjacent entries) — and `getImagesForSmartCollection` (in the peer-dirty `data.ts`, verified
at committed HEAD lines 1488-1530) runs the compiled condition **twice** per page view (once
for the `COUNT(*)`, once for the row page).

**Why LOW, not MED:** per `CLAUDE.md`, smart collections currently have **no admin authoring
UI** — rows exist only via direct DB `INSERT`, so an operator would have to hand-author a
near-ceiling predicate tree today for this to bite. This is a latent risk that becomes real
the moment an authoring UI ships (already tracked as a product-decision deferred item,
C1-25(a)/AGG-C10-18 lineage), not a currently-exploitable hot path.

**Fix:** when the authoring UI lands, either lower the practical node/child ceilings well
below the current structural max, add a compiled-condition complexity score (e.g. count of
tag subqueries) enforced at save time, or cache compiled results per collection with
explicit invalidation on image/tag mutation (mirroring the `revalidate=0` design intentionally
chosen for freshness elsewhere in this app).

## Files examined (inventory)

DB/pool: `src/db/index.ts`, `src/lib/analytics-data.ts`, `src/lib/smart-collections.ts`,
`src/lib/rate-limit.ts`, `src/lib/bounded-map.ts`, `src/lib/upload-tracker.ts`,
`src/lib/upload-tracker-state.ts` (read), `src/lib/revalidation.ts`.

Image pipeline: `src/lib/process-image.ts` (full), `src/lib/clip-model.ts`,
`src/lib/clip-inference.ts`, `src/lib/clip-embeddings.ts` (HEAD via `git show`, peer-dirty),
`src/lib/image-queue.ts` (HEAD via `git show`, peer-dirty — `bootstrapMissingActiveEmbeddings`
and its call site), `src/lib/data-timeline.ts` (HEAD via `git show`, peer-dirty — confirmed
already-known AGG-C10-03/04 date-function predicates, no new evidence).

Server actions / routes: `src/app/actions/images.ts` (full, incl. `deleteImages`,
`updateImageMetadata`, `bulkUpdateImages`), `src/app/actions/tags.ts` (batch tag actions),
`src/app/actions/sharing.ts` (`createGroupShareLink`), `src/app/sitemap.ts`,
`src/lib/atom-feed.ts`, `src/app/[locale]/admin/(protected)/dashboard/page.tsx` +
`dashboard-client.tsx`.

React components: `src/components/image-manager.tsx` (full), `src/components/masonry-card.tsx`
(full), `src/components/histogram.tsx` (full), `src/components/map/map-client.tsx` (full),
`src/components/search.tsx` (debounce/effects), `src/components/similar-photos.tsx` (full),
`src/components/lightbox.tsx` (slideshow timer), `src/components/upload-dropzone.tsx`
(upload-loop region).

Spot-checked (no issues, not detailed above): `src/lib/pagination.ts`, `src/lib/http-etag.ts`
(never cited in any prior review artifact — confirmed clean/trivial).

## Final sweep (commonly-missed) notes

- Grepped for synchronous FS calls (`readFileSync`/`writeFileSync`/`execSync`) outside module
  init and rare admin-restore paths — none on hot paths.
- Grepped for `setInterval` across the tree — both non-test hits (`lightbox.tsx` slideshow,
  `gallery-config.ts` detached-cache TTL doc) are already cleanup-safe and intentionally
  documented.
- Grepped for `.map(...).find(...)` nested-lookup patterns in components/pages — the two hits
  (`page.tsx`, `[topic]/page.tsx` tag-label resolution) run server-side once per page render
  over small (tag-count-bounded) arrays; not a real cost.
- Cross-checked `.context/reviews/_aggregate.md` and `.context/plans/deferred-carry-forward.md`
  before writing findings; confirmed F1-F3 are not already-tracked perf items (the only
  superficially-similar prior item, `PERF/DEF-03` in `run2-cycle2/perf-reviewer.md`, is about
  `admin-backfill-runner.ts`'s per-row UPDATE, a different code path, already deferred/accepted
  at that call site).
- Did not find a new N+1 in any `lib/data.ts` caller outside the three findings above — most
  list/page queries already use single joined+grouped queries with `Promise.all` fan-out
  (confirmed in dashboard `page.tsx`, and via `git show HEAD` spot-checks of the peer-dirty
  `data.ts`/`image-queue.ts`/`data-timeline.ts`).
- No new connection-pool-budget concern found; `db/index.ts`'s query/execute wrapping and the
  documented pool-budget arithmetic (backfill/CLIP concurrency caps) are unchanged from what's
  already extensively documented in `CLAUDE.md`.
