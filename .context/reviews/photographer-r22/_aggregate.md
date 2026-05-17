# Photographer R22 — Aggregate Review (cycle 13/100)

**Date:** 2026-05-17
**Lens:** Professional photographer + end-user workflow (delivery surface).
**Pass type:** Multi-perspective single-agent pass (Task / Agent fan-out
not registered in this environment; perspectives applied serially:
code-reviewer, perf-reviewer, security-reviewer, critic, verifier,
test-engineer, tracer, document-specialist, designer, architect).

## Strict scope reminder

In-scope: color/HDR/EXIF/gallery/share/topic/SEO/i18n/admin/upload/
processing/serving/perf/a11y/security/copyright/metadata/licensing/
download/embed/Lightroom-publish surfaces. Out-of-scope: any edit /
star-rating / culling / scoring / pick-flag / image-adjustment /
retouch / develop ideas.

## Coverage this pass

Re-swept after the R21 closures landed in cycle 12:

- `apps/web/src/components/photo-viewer.tsx` (per-photo page viewer,
  the page customers hit first when sharing a single photo URL).
- `apps/web/src/components/lightbox.tsx` (already closed in R21 —
  spot-check passed).
- `apps/web/src/components/home-client.tsx` (already closed in
  R20-M1 — spot-check passed).
- `apps/web/src/components/info-bottom-sheet.tsx` (uses sized
  `OptimisticImage` — see `optimistic-image.tsx` for the wrapping
  fallback).
- `apps/web/src/components/optimistic-image.tsx`.
- `apps/web/src/app/api/og/photo/[id]/route.tsx` (server-side fetch
  of sized JPEG with a clean fall-through to admin OG default; no
  action needed).
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` (already
  closed in R20-M1 — spot-check passed).
- All JSON-LD `thumbnail` / `thumbnailUrl` fields (closed in R21-M2,
  spot-check passed).

## Findings

### R22-M1 (MEDIUM, High confidence) — Per-photo page `<img>` lacks `onError` swap to base JPEG when sized derivative 404s

- **File:** `apps/web/src/components/photo-viewer.tsx:425-475`
- **Failure scenario:** `srcSetData` (`useMemo` at 425) builds
  `jpegSrc = sizedImageUrl('/uploads/jpeg', image.filename_jpeg, jpegFallbackTargetSize, imageSizes)`
  (line 431) where `jpegFallbackTargetSize` is the second-largest
  configured image size (e.g. `2048` for a default
  640/1536/2048/4096 set). The `<picture>` element emits AVIF +
  WebP `<source>` rows whose `srcSet` is a sized derivative list
  (lines 451-460), then the inner `<img>` (line 461) hard-binds to
  `jpegSrc` (sized) + `jpegSrcSet` (also sized). Legacy photos that
  pre-date the sized-derivative encoder, or rows caught
  mid-backfill after an `IMAGE_PIPELINE_VERSION` bump, only have
  the **base** `filename_jpeg` on disk per the encoder
  atomic-rename contract. Same exact failure mode as R21-M1
  (lightbox) — the only difference is the surface. There is no
  `onError` handler, so the per-photo page renders a broken-image
  glyph at full size.
- **Photographer impact:** The per-photo page is the canonical URL
  every share link points to (`/p/[id]`) — when a photographer
  hands a client a "look at this photo" link, this is what loads
  first. R21-M1 fixed the lightbox (the F-key full-screen layer);
  this finding closes the same gap on the page underneath the
  lightbox. Without this fix, the photo viewer hides a broken
  image until the user presses F. With the fix, both surfaces are
  consistent.
- **Fix sketch:** Mirror the R21-M1 implementation in `lightbox.tsx`:
  1. In the `srcSetData` `useMemo`, additionally compute
     `jpegBaseSrc = imageUrl('/uploads/jpeg/' + image.filename_jpeg)`.
  2. Add a `useRef<boolean>(false)` `jpegFallbackTriedRef` and a
     `useEffect([image.id])` that resets it on each photo change so
     a true 404 on the base file doesn't loop the swap.
  3. Add `onError={(e) => { … swap once to jpegBaseSrc … }}` on
     the `<img>` at line 461.

  The first `<Image>` branch (line 436, used when `baseWebp` /
  `baseAvif` are missing) uses next/image with `unoptimized`. It
  already calls `sizedImageUrl` to derive its `src`; the same
  sized-derivative 404 risk applies. next/image forwards `onError`
  to the underlying `<img>`, so the same handler pattern lifts
  cleanly to that branch.
- **Severity:** MEDIUM (highest-traffic per-photo surface; direct
  parity with R21-M1; broken-image glyph during any backfill
  window directly hits the photographer's client-share flow).
- **Confidence:** High (same pattern as R19-M2 / R20-M1 / R21-M1;
  fix is a proven recipe).

## Cross-perspective agreement

- **code-reviewer + verifier:** R22-M1 is a direct R21-M1 repeat
  on the page-level viewer. The lightbox closed last cycle, the
  page-level viewer was missed; bringing it into parity completes
  the encoder atomic-rename contract end-to-end on every public
  viewer surface.
- **perf-reviewer:** No perf change — the `onError` handler only
  fires on a 404 (rare, only mid-backfill / on legacy rows). When
  it doesn't fire, the sized derivative loads as today.
- **document-specialist:** The CLAUDE.md "always exists per encoder
  atomic-rename contract" guarantee is already referenced in
  multiple existing fallback comments (`home-client.tsx:302-311`,
  `g/[key]/page.tsx:213-222`, `lightbox.tsx:358-363`); the new
  comment can cite the same contract and the R21-M1 lineage.

## Out-of-scope / discarded

None this cycle. No reviewer surfaced edit / star / cull / score /
adjust ideas under the review framing.

## Existing backlog (R10..R21) — re-inventoried, not re-reviewed

- R10 HIGH open: R10-C1, R10-H2, R10-H4 (full), R10-H5 — schema-
  migration / fixture-authoring scope blocked on a dedicated cycle.
- R10 MED open: R10-M2/M4/M5/M6/M7/M11/M12.
- R10 LOW open: R10-L8, R10-L19, R10-L20.
- R17 deferred: R17-L2 (per-entry Atom `<author>`) — still blocked
  on `uploaded_by` column or audit-log retrofit.
- R19-L2-OG deferred: dedicated `/api/og?collection=...`
  discriminator cycle.
- R11..R16, R18..R21: closed.

## Why R22 returned only one finding

Cycles 1-12 have systematically closed the encoder-fallback
contract on every public surface that emits a sized derivative
`<img src=…>`. R22 found exactly the one remaining sibling on
`photo-viewer.tsx` (the lightbox's parent page). After this
cycle the contract is verified end-to-end on:

- Masonry homepage (`home-client.tsx` — R20-M1).
- Shared-group grid (`g/[key]/page.tsx` — R20-M1).
- Timeline / year grids (R19-M2).
- On-this-day widget (R20-M2).
- Lightbox (`lightbox.tsx` — R21-M1).
- Per-photo viewer (`photo-viewer.tsx` — **R22-M1, this cycle**).

JSON-LD `thumbnail` / `thumbnailUrl` payloads were normalized to
the base filename in R21-M2. The OG photo route falls back to the
admin-configured site OG default on a 404 (no broken glyph
possible).
