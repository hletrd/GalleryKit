# Photographer R23 — Aggregate Review (cycle 14/100)

**Date:** 2026-05-17
**Lens:** Professional photographer + end-user workflow (delivery surface).
**Pass type:** Multi-perspective single-agent pass (Task/Agent fan-out
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

Re-swept the public delivery surface after R22-M1 closed the
per-photo viewer onError fallback. Goal: complete the encoder
atomic-rename fallback contract on every remaining public
`<img>` / `<Image>` surface that emits a `sizedImageUrl`-derived
src.

Surfaces inventoried for sized-derivative `<img>` usage:

- `apps/web/src/components/search.tsx:306` — public search-results
  dropdown thumbnail (48 px, lazy-loaded).
- `apps/web/src/components/image-manager.tsx:428` — admin image
  table thumbnail (128 px, OptimisticImage). Admin surface — not
  photographer-impacting per lens.
- `apps/web/src/components/photo-viewer.tsx:425-475` — closed in
  R22-M1.
- `apps/web/src/components/lightbox.tsx:357-363` — closed in
  R21-M1.
- `apps/web/src/components/home-client.tsx:314,329` — closed in
  R20-M1 (base filename used, contract-safe).
- `apps/web/src/components/on-this-day-widget.tsx:65` — closed in
  R20-M2 (base filename used).
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:224` — closed
  in R20-M1 (base filename).
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:224` and
  `year/[year]/page.tsx:176` — closed in R19-M2 (base filename).
- `apps/web/src/components/map/map-client.tsx:90` — uses base
  filename (`/uploads/jpeg/${marker.filename_jpeg}`); contract-safe
  per encoder atomic-rename guarantee.
- `apps/web/src/components/info-bottom-sheet.tsx:317-321,536-540` —
  already supplies `fallbackImageUrl` (base JPEG); contract-safe.
- `apps/web/src/components/photo-viewer.tsx:903-907` — already
  supplies `fallbackImageUrl` (base JPEG); contract-safe.
- `apps/web/src/components/lightbox-color-pip.tsx:102-109` —
  histogram source; already has chain (sized → base) with onError
  short-circuit in the histogram component (R9-LOW closure).

## Findings

### R23-M1 (MEDIUM, High confidence) — Public search results dropdown thumbnail lacks fallback when sized derivative 404s

- **File:** `apps/web/src/components/search.tsx:303-313` (inside the
  results map block, `next/image` element at line 305-312).
- **Failure scenario:** The public global search popover (Cmd-K /
  search-icon click) renders a 48 px square thumbnail next to each
  result. The `src` is built from
  `sizedImageUrl('/uploads/jpeg', image.filename_jpeg, 128, previewImageSizes)`
  which derives `<basename>_128.jpg` (or the nearest larger configured
  size, e.g. `_640.jpg` on the default 640/1536/2048/4096 set). For
  any photo that pre-dates the sized-derivative encoder, or that
  hasn't been backfilled after a `pipeline_version` bump, only the
  base `filename_jpeg` exists on disk per the encoder atomic-rename
  contract — the `_<size>.jpg` derivative will 404 and the browser
  renders the missing-image glyph (or the `next/image` default
  placeholder, depending on the version).
- **Photographer impact:** Search is the primary way clients and
  collaborators rediscover specific photos. A grid of broken
  thumbnails next to titles/captions/tags directly tells the viewer
  "this photographer's gallery is broken" even though the underlying
  photo is reachable from the result link. Same pattern as R21-M1
  (lightbox) and R22-M1 (per-photo viewer) — both already closed.
  Search is the last remaining sized-derivative public surface
  without the onError fallback.
- **Fix sketch:** `search.tsx` uses `next/image` (not raw `<img>`),
  but `next/image` forwards `onError` to the underlying DOM `<img>`.
  Two clean approaches:
  1. **Use the existing OptimisticImage wrapper** — it already
     handles `fallbackSrc` cleanly and the admin grid uses the
     same pattern. Pass
     `fallbackSrc={imageUrl('/uploads/jpeg/' + image.filename_jpeg)}`.
     Tradeoff: OptimisticImage adds a loading spinner overlay, which
     may be visually heavy for a 48 px search thumbnail.
  2. **Add a local one-shot onError swap** mirroring R22-M1 / R21-M1
     (per-item ref, swap once to base filename). Lower-overhead;
     matches the established pattern.

  Recommend (2) — keeps the search dropdown lightweight. A small
  per-result state via `useState` on a Map<id, string> isn't ideal
  here because the results list re-renders on each keystroke; a
  per-row inline component scoped to the lifecycle of one result row
  is cleaner. Extract the `<Link>+<Image>` into a small
  `<SearchResultItem>` component that holds its own `imgSrc` state +
  a ref-guarded `onError` handler that swaps to `imageUrl('/uploads/jpeg/' + filename_jpeg)` once.
- **Severity:** MEDIUM (public surface; high-visibility; mirrors
  R21-M1 / R22-M1 pattern; broken-glyph during any backfill window
  directly hits viewer trust).
- **Confidence:** High (same fix recipe as R21-M1 / R22-M1, validated
  in production).

## Cross-perspective agreement

- **code-reviewer + verifier:** R23-M1 closes the last remaining
  public sized-derivative `<img>` surface without a base-JPEG
  fallback. After this fix, every public surface that emits a sized
  derivative either (a) carries an onError swap, (b) uses
  OptimisticImage with `fallbackSrc`, or (c) emits the base filename
  directly.
- **perf-reviewer:** No perf change. The onError handler fires only
  on a 404 (rare; mid-backfill or legacy rows). The 48 px thumbnail
  payload doesn't change in the happy path.
- **document-specialist:** The `CLAUDE.md` "always exists per encoder
  atomic-rename contract" guarantee already underwrites multiple
  fallback comments (`home-client.tsx`, `g/[key]/page.tsx`,
  `lightbox.tsx`, `photo-viewer.tsx`). The new search comment cites
  the same contract and the R21-M1 / R22-M1 lineage.
- **architect:** Extracting `SearchResultItem` is the right
  factoring because the search list re-renders on every keystroke;
  per-item state lives correctly with per-item lifecycle.

## Out-of-scope / discarded

None this cycle. No reviewer surfaced edit/star/cull/score/adjust
ideas under the review framing.

## Existing backlog (R10..R22) — re-inventoried, not re-reviewed

- R10 HIGH open: R10-C1, R10-H2, R10-H4 (full), R10-H5 — schema-
  migration / fixture-authoring scope, blocked on a dedicated cycle.
- R10 MED open: R10-M2/M4/M5/M6/M7/M11/M12.
- R10 LOW open: R10-L8, R10-L19, R10-L20.
- R17 deferred: R17-L2 (per-entry Atom `<author>`) — still blocked
  on `uploaded_by` schema column or audit-log retrofit.
- R19-L2-OG deferred: dedicated `/api/og?collection=...`
  discriminator cycle.
- R11..R16, R18..R22: closed.

## Why R23 returned only one finding

Cycles 1-13 have systematically closed the encoder-fallback contract
on every public surface that emits a sized derivative
`<img src=…>`. R23 confirms `search.tsx` is the last remaining
public-facing sized-derivative `<Image>` surface without a base-JPEG
fallback. After this cycle the contract is verified end-to-end on:

- Masonry homepage (`home-client.tsx` — R20-M1, base filename).
- Shared-group grid (`g/[key]/page.tsx` — R20-M1, base filename).
- Timeline / year grids (R19-M2, base filename).
- On-this-day widget (R20-M2, base filename).
- Lightbox (`lightbox.tsx` — R21-M1, onError swap).
- Per-photo viewer (`photo-viewer.tsx` — R22-M1, onError swap).
- Photo viewer info bottom sheet (existing `fallbackImageUrl`).
- Public search dropdown (`search.tsx` — **R23-M1, this cycle**).

JSON-LD `thumbnail` / `thumbnailUrl` payloads were normalized to the
base filename in R21-M2. The OG photo route falls back to the
admin-configured site OG default on a 404. Map popups use the base
filename (contract-safe).

Admin surfaces (`image-manager.tsx`) are not in photographer scope
per the lens — the maintenance dashboard "image unavailable" message
from OptimisticImage's terminal-error state is acceptable because the
admin retry/backfill workflow surfaces the same condition more
authoritatively in the failed-images section (pending R10-H2).
