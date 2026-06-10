# Perf-reviewer + architect — Run-4 Cycle 5

Angle: performance, concurrency, memory/DOM growth, layering and
single-source-of-truth risks.

## Inventory

- Serving hot path post-R4C4: `lib/serve-upload.ts` SWR debounce (full
  re-read of the rewritten `getServingColorSettingsHash`).
- Pagination data paths: `lib/data.ts` `getImagesLite` /
  `getImagesLitePage` / `getImagesForSmartCollection` /
  `normalizePaginatedRows` / cursor machinery; `COUNT(*) OVER()` usage.
- Client growth surfaces: `components/load-more.tsx` (IntersectionObserver
  lifecycle), `components/home-client.tsx` (masonry state append,
  column-count resize handling).
- `app/sitemap.ts` budget math + ISR posture; `feed.xml` conditional-GET
  path; OG photo route buffer handling.
- Action-layer rate-limit round-trips (`public.ts`).
- Architecture: smart-collection module boundaries (`lib/smart-collections`
  pure compiler vs `lib/data` executor vs action vs page), dead-export
  hygiene, helper-contract drift between the two load-more actions.

## Findings

### PERF facet of COR-R4C5-01 — unbounded duplicate DOM growth on smart-collection pages — MED (shared root cause) / Confidence: High
- Because every cursor-bearing `loadMoreSmartCollectionImages` call
  resolves to offset 0 (see code-reviewer file), a visitor scrolling a
  >30-image collection appends the same 30 `<OptimisticImage>` nodes on
  every sentinel intersection: ~30 nodes per ~viewport-height scrolled,
  duplicate React keys forcing full-list reconciliation each append, and
  one wasted `COUNT(*) OVER()` window-scan query per fire. On a long
  scroll session this grows the DOM without bound — the masonry reorder
  `useMemo` recomputes over an ever-growing duplicated array. Same fix as
  COR-R4C5-01 (single root cause; no separate fix item).
- **Architect's note on the fix shape:** do NOT fork a second collection
  query — extend `getImagesForSmartCollection` with the SAME
  `offsetOrCursor` contract `getImagesLite` already has, reusing
  `normalizeImageListCursor` + `buildCursorCondition` (identical ORDER BY
  triple, so the predicate is provably order-compatible). Accepted
  trade-off: the cursor path keeps the `COUNT(*) OVER()` column the
  helper already selects (the action discards `totalCount`); dropping it
  would require forking the select shape — not worth the drift risk at
  personal-gallery scale. Record as accepted, not deferred.

### ARCH facet of SEC-R4C5-02 — dead exports on a `'use server'` boundary are not inert
- `collections.ts` exports four actions; three have no UI callers (the
  collections manager UI does not exist yet) and one
  (`getSmartCollections`) is dead AND unauthenticated. On a server-action
  boundary, "dead code" still registers an invokable endpoint at build
  time. Architectural rule worth keeping: a `'use server'` file's export
  list IS its attack surface; exports must be added with their consumer,
  not ahead of it. Fix folds into SEC-R4C5-02 (delete the dead getter;
  the three CRUD actions stay — they are auth+origin-gated and the
  intended DB-management path documented by US-P42).

## Verified clean

- **SWR debounce (R4C4-01) under load:** stale-window requests return
  synchronously from cache; exactly one inflight refresh exists at a
  time (`servingHashInflight` null-check arms it; `finally` clears);
  hung-DB worst case = one parked promise, zero queued responses. Cold
  start correctly collapses a burst to ONE config SELECT (verified by the
  burst test in the suite + in-source read). No regression risk found.
- `getImagesLite` cursor path uses keyset predicates (no OFFSET scan) —
  the deep-pagination DoS cap (offset > 10000 → invalid) only applies to
  the legacy offset path. Correct layering.
- `home-client.tsx` resize handler is rAF-debounced with cancel-on-unmount;
  IntersectionObserver in `load-more.tsx` disconnects on ref swap AND
  unmount; no leak.
- `sitemap.ts`: ISR 3600 s effective (no force-dynamic), localized URL
  budget arithmetic correct (reserved slots subtracted before image
  budget; per-locale flatMap bounded).
- Feed route: 304 path allocates the XML once (acceptable — needed for
  Last-Modified derivation), conditional compare at second precision.
- OG photo route: per-attempt byte caps + 10 s abort signal in
  `pickFirstAvailablePhotoBuffer`; Satori → Sharp single re-encode; rate
  limiter rollback on every early return (verified all 5 paths).
- Pool/queue posture unchanged this cycle (10 conns / queue 20 /
  QUEUE_CONCURRENCY default 1) — consistent with the single-writer
  topology note in CLAUDE.md.
