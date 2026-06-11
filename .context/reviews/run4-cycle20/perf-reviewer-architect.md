# Perf-reviewer / Architect — Run-4 Cycle 20

Single-subagent in-context pass.

## Inventory (this angle)

Concurrency / shared-state and layering review of the rotation cluster
plus the keyset-pagination change from cycle 19 (`backfill-alt-text.ts`,
`backfill-clip-embeddings.ts`).

## Findings

No new performance defect this cycle.

### Architecture note on SEC-R4C20-01 (no separate fix)

The same-origin policy for `seo_og_image_url` lives in one validator
(`validateSeoOgImageUrl`) consumed at a single write-time chokepoint and
re-read by two render paths. This is the correct shape — the fix belongs
in the validator, not scattered across the og:image consumers. Keeping it
centralized is consistent with the `requireSameOriginAdmin` (C2R-02) and
`csv-escape` single-source-of-truth precedents. No layering change needed.

## Perf re-confirmation of cycle-19 keyset change — SOUND

`backfill-alt-text.ts` and `backfill-clip-embeddings.ts` now drive an
`id > cursor ORDER BY id ASC LIMIT BATCH` keyset loop. Verified:
- The `cursor = rows[rows.length - 1].id` advance is guarded by the
  `rows.length === 0 → break` check above it, so no read of `.id` on an
  empty array.
- Each batch is an index range seek on the PK instead of an O(offset)
  scan-and-discard — strictly faster AND complete (the prior OFFSET loop
  skipped ~half the backlog as the UPDATEs shrank the WHERE set). This is
  both a correctness and a perf win; no regression.

## Clean-pass

- `bounded-map.ts` prune is O(n) per call but bounded by hard caps
  (500–5000 keys); no growth hazard.
- `og-photo-fetch.ts` iterates `imageSizes` (≤ 8) ascending with a 10 s
  per-attempt cap — worst case bounded; the ascending order biases to the
  smallest sufficient derivative. No change.
- Single-writer topology invariants (CLAUDE.md) unaffected by this cycle's
  surfaces.
