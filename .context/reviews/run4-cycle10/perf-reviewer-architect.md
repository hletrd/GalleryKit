# Perf-reviewer / Architect — Run-4 Cycle 10

Angle: cost model + coupling/layering of the surfaces touched this cycle and
the least-perf-reviewed paths.

## Inventory
- `lib/gps-exif-strip.ts` (allocation profile of the trailer fix), SW
  `staleWhileRevalidateImage` (post-c9), OnThisDay/OptimisticImage delivery,
  `data-timeline.ts` queries, `og/photo` Sharp path, map page data flow.

## Findings: none net-new perf-critical. Notes on the two fixes:

### SEC-R4C10-01 fix has a bounded perf cost (acceptable)
Returning `null` for a trailer-bearing JPEG routes it to the tier-2 Sharp
re-encode (q95 4:4:4). That re-encode is heavier than the byte-surgery path,
but it runs ONLY when (a) `strip_gps_on_upload` is ON and (b) the upload
carries a post-EOI trailer (motion photo / MPF) — a narrow slice of ingests,
on the background queue, off the request path. The trailer detection itself
is one `Buffer.indexOf([0xff,0xd9])` from the scan region — O(n) single pass,
no extra allocation. Architecturally it REUSES the existing tier-1→tier-2
fallback contract rather than adding a new code path, which is the right
layering: the lossless scrubber stays single-image-only and explicitly
delegates "structurally richer than I handle" to the safe re-encoder.

### COR-R4C10-01 fix is O(rows-for-this-admin), inside the existing txn
`UPDATE audit_log SET user_id = NULL WHERE user_id = ?` adds one indexed
write (the `audit_user_idx(user_id, created_at)` covers the predicate) inside
the already-open advisory-locked delete transaction. Admin deletion is a
rare, human-paced operation, so the added write is immaterial. No new lock,
no new connection.

## Re-verified clean
- SW c9 lazy revalidate: the 304 path now does ONE HEAD + `touchMeta`
  (single meta read-modify-write) instead of the prior eager full GET +
  `cache.put` + `recordAndEvict`. Confirmed the eager-fetch cost is gone.
- OnThisDay: 6 raw `<img>` full-res JPEGs → 6 next/image ~48-96px variants.
  The home landing-page byte budget drop (c9 PERF-R4C9-03) holds.
- `data-timeline` queries stay on the `(processed, capture_date, created_at)`
  prefix; `YEAR()/MONTH()` non-sargable filters documented inline.
- `og/photo` Sharp post-process bounded by the per-attempt byte cap in
  `pickFirstAvailablePhotoBuffer`.

## Architecture note (no action)
Two independent hand-maintained privacy mirrors now exist (`publicSelectFields`,
`publicMapSelectFields`, `timelineSelectFields`), all three guarded by the
SAME exported `PrivacySensitiveKeys` union after c9. The guard-reuse is the
correct DRY resolution; no further consolidation needed.
