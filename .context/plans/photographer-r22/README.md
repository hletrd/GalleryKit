# R22 Implementation Plan

**Source:** Photographer Review R22 (cycle 13/100)
**Date:** 2026-05-17
**Status:** Active (this cycle ships items below)

R11..R21 plans are fully closed. R10 backlog stays open under
`photographer-r10/README.md`.

## Strict deferral policy

Per cycle instructions and `CLAUDE.md`:
- Every R22 finding is either scheduled below or recorded in
  "Deferred" with reason + exit criterion.
- No R22 finding silently dropped.
- No edit / star-rating / culling / scoring / pick-flag / adjust ideas
  surfaced under REVIEW FRAMING — nothing discarded.

## Cycle-13 scope (this cycle implements)

1. **R22-M1** — Per-photo page `<img>` gets an `onError` swap to
   the base JPEG filename when the sized derivative 404s. Mirrors
   the R21-M1 fix on the lightbox so both viewer surfaces are
   consistent. Use a per-image one-shot guard ref so the swap
   doesn't loop on a true 404. Files:
   - `apps/web/src/components/photo-viewer.tsx`

2. **SW version refresh** — bump `SW_VERSION` to the new HEAD
   after the above lands so the service worker invalidates its
   caches with the photo-viewer change.

## Items deferred this cycle

| ID | Finding | Reason | Exit criterion |
|----|---------|--------|----------------|
| R17-L2 (still deferred) | Per-entry `<author>` on Atom entries. | Requires `uploaded_by` schema migration; no current data path provides per-photo uploader identity. | First cycle that introduces `uploaded_by` column on `images` (would pair with R10-H2 / R10-H5 schema work). |
| R19-L2-OG (still deferred) | `/api/og?collection=...` discriminator that renders a smart-collection-specific OG image. | Net-new OG-generation path adds a Satori template and an additional rate-limit budget; out of scope for a LOW polish item. | Dedicated cycle that audits the `/api/og` surface end-to-end. |

## Carry-over backlog explicitly NOT picked up this cycle

R10 backlog (still open in `photographer-r10/README.md`):
- HIGH: R10-C1, R10-H2, R10-H4 (full), R10-H5.
- MED: R10-M2/M4/M5/M6/M7/M11/M12.
- LOW: R10-L8, R10-L19, R10-L20.

R11..R17 deferred items: see their respective README files.

**Exit criterion for the still-open HIGH/MED carryovers:** dedicated
cycle that bundles schema-migration work (R10-H2 + R10-H5 + R17-L2)
and a fixture-authoring cycle for R10-C1 / R11-L4.

## Discarded findings

None this cycle. No reviewer proposed edit / star / cull / adjust
features.

## Acceptance criteria

### R22-M1 — Photo-viewer onError → base JPEG
- [ ] `<img>` at `photo-viewer.tsx:461` carries an `onError`
      handler that swaps `src` to
      `imageUrl('/uploads/jpeg/' + image.filename_jpeg)` once.
- [ ] The first `<Image>` branch (line 436, used when
      `baseWebp` / `baseAvif` are absent) carries the same
      handler so the no-AVIF/no-WebP path is also protected.
- [ ] A per-image one-shot guard prevents the swap from looping
      when even the base file is missing.
- [ ] The guard resets when `image.id` changes (next photo gets a
      fresh attempt).
- [ ] All gates pass.

### SW version refresh
- [ ] `apps/web/public/sw.js` SW_VERSION constant set to a
      timestamp/hash that changes on each cycle.

## Progress tracking

- [x] R22 review aggregate written
- [x] R22 plan written
- [ ] R22-M1 — photo-viewer onError fallback
- [ ] SW version refresh
- [ ] Gates green
- [ ] Deploy
