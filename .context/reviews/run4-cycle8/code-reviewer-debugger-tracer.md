# Run-4 Cycle 8 — code-reviewer / debugger / tracer angle

Inventory: independent regression review of all cycle-7 fix commits
(`ddadc171` download interstitial, `3b02af3b` topicRef, `82991b62`
smart-collection validate narrowing, SW refreshes); full reads of the
photo-viewing client stack (photo-viewer.tsx 1067 L, lightbox.tsx 668 L,
image-zoom.tsx, photo-navigation.tsx, histogram.tsx 732 L, home-client.tsx,
load-more.tsx), the color pipeline core (process-image.ts 1470 L full,
color-detection.ts full, image-queue.ts full), serve-upload.ts,
gallery-config-shared.ts, data.ts cursor machinery + listing helpers,
public pages p/[id] + g/[key]; vendored-source verification of Sharp
0.34.5 (`lib/output.js` heif()/toFile()) and three live Chromium
experiments (playwright) for client-behavior hypotheses.

## Regression review of cycle-7 commits — ALL SOUND
- `ddadc171` — GET interstitial / POST claim split: validation chain is
  byte-equal across methods; open-before-claim ordering preserved; no
  token in HTML body; CSP correct; D-101-06 disambiguation intact.
- `3b02af3b` — topicRef latest-wins wiring matches the tag-ref contract.
- `82991b62` — per-column operator narrowing correct; compiler throw
  kept as depth defense.

## Findings

### COR-R4C8-02 — shipped AVIF-probe data URL is structurally invalid; the histogram's P3/AVIF path is dead code (MED-HIGH / Confidence: High — empirically proven)
`apps/web/src/components/histogram.tsx:44` (`AVIF_PROBE_DATA_URL`).
Decoding the base64 and walking the ISOBMFF boxes shows: `ftyp(avif)` +
`meta` containing `hdlr`, `pitm`, then a bogus **`pbal`** box, an
invalid size-1 box, and a trailing `tbm\0` fragment. There is **no
`iloc`, no `iinf`, no `iprp/ipco` (no `av1C`, no `ispe`), and no
`mdat`** — the file cannot be decoded by any AVIF implementation.
Live Chromium (playwright): `new Image()` on the shipped URL fires
`onerror` (**FAILS**) while a sharp-generated 1×1 AVIF fires `onload`
(**LOADS**). Consequence chain: `getAvifSupportPromise()` resolves
`false` in every browser → `avifSupported === false` forever →
`preferAvif` is false at histogram.tsx:512 → the R7-M7 / P4-B1 priority
chain (AVIF → sized JPEG → base) never selects AVIF → on a P3 display
the histogram always computes from sRGB-clipped JPEG bytes, the
`histogramSource` label always reads "JPEG", and `resolveIsClipped`
never fires its P3-fallback branch (line 422) because `preferAvif` is
false. The product premise (accurate gamut audit for photographers) is
silently defeated on every P3-capable browser. Failure scenario: a
photographer checks highlight clipping on a Display-P3 export — the
histogram reports clipping positions computed from sRGB-clipped data.
Fix: replace the constant with a valid minimal 1×1 AVIF (generate via
sharp at fix time), and add a unit test that base64-decodes the literal
from the component source and round-trips it through sharp so the
constant can never regress to garbage again.

### COR-R4C8-04 — histogram canvas blanks when the viewport crosses the 768 px breakpoint (MED / High)
`apps/web/src/components/histogram.tsx:603-606` vs `:463-472,654-657`.
The draw effect's dependency array is `[histogramData, mode, collapsed,
isDark]`, but the `<canvas>` element's `width`/`height` attributes come
from `canvasDims` state (240×120 ↔ 320×160 across 768 px). Per the
HTML spec, assigning a canvas `width`/`height` attribute resets the
drawing buffer (clears it). When a resize crosses the breakpoint, React
updates the attributes, the buffer clears, and **no effect re-runs the
draw** — the histogram is blank until the next mode/theme/photo change.
Repro: open a photo with the info panel on a 800 px-wide window, narrow
to 700 px (or rotate a tablet). Fix: add `canvasDims` to the draw
effect deps (the data is already cached in state; redraw is cheap).

### COR-R4C8-05 — `<picture>` onError base-JPEG fallback is ineffective while `<source>` elements match (MED / High — empirically proven)
`apps/web/src/components/lightbox.tsx:499-508` (R21-M1) and
`apps/web/src/components/photo-viewer.tsx:463-472` (R22-M1).
Both swap `img.src` to the base JPEG when the sized derivative 404s.
Per the HTML image-selection algorithm, mutating `src` re-runs source
selection, which again prefers the matching `<source type="image/avif">`
— the swap only matters when no `<source>` matches. Live Chromium
(playwright, fixture replicating the exact markup): after onerror +
swap, `currentSrc` is STILL the 404ing `missing_2048.avif`,
`naturalWidth === 0` (broken image). So for a photo that HAS
`filename_avif`/`filename_webp` rows but is missing sized derivatives
(legacy rows mid-backfill after a pipeline bump — the exact population
R21-M1/R22-M1 claim to serve), the viewer/lightbox render a broken
image, not the base JPEG. The fallback only ever worked on the
no-AVIF/no-WebP `<Image>` branch. Fix: on error, track failure in
state and re-render the `<picture>` without the `<source>` rows (img
pointing at the base JPEG), keeping the one-shot guard; mirror in both
components. Note: home-client/g/[key]/timeline/year already use the
base JPEG directly as the `<img src>` (R20-M1) so the masonry surfaces
are unaffected.

### COR-R4C8-06 — 8-bit AVIF per-image fallback re-encodes with bitdepth 10 (LOW-MED / High — vendored-source verified)
`apps/web/src/lib/process-image.ts:1105-1119`. The catch path calls
`base.clone().toColorspace(...).withIccProfile(...).avif({ quality,
effort })`. Sharp 0.34.5 `heif()` (node_modules/sharp/lib/output.js)
only assigns option keys that are **defined** in the passed object —
it never resets `heifBitdepth` — and `clone()` copies the options
snapshot, so the retry encodes with `heifBitdepth: 10` again and (in
the scenario that triggered the catch) throws again; the image then
fails processing entirely. The CLAUDE.md contract "falls back to 8-bit
per-image on encode-time rejection" is structurally unsatisfiable.
Additionally `lib/output.js` shows prebuilt binaries throw
**synchronously** on `bitdepth !== 8` ("Expected 8 for bitdepth when
using prebuilt binaries"), which the probe correctly converts to a
permanent `false` — so reachability requires a custom libvips build,
making this latent, not live, on the shipped Docker image. Fix: pass
`bitdepth: 8` explicitly in the retry options.

### COR-R4C8-07 — WI-15 pixel-count gate mixes post-orientation width with pre-orientation height (LOW / Medium)
`apps/web/src/lib/process-image.ts:959-962`. `baseWidth` comes from the
upload flow's `autoOrient: true` metadata (post-rotation), but
`inputMeta` is read WITHOUT `autoOrient`, so `baseHeight` is the
pre-rotation height. For a rotated portrait source (orientation 6/8,
e.g. 8000×6000 sensor → oriented 6000×8000), `basePixels` computes
6000×6000 = 36 MP instead of 48 MP, under-evaluating the
`WIDE_GAMUT_MAX_SOURCE_PIXELS` cap — a >50 MP rotated wide-gamut
source can skip the WI-15 downscale and hit the rgb16 pipeline at full
size (the OOM guard the cap exists for). Fix: read `inputMeta` with
`autoOrient: true` so both dimensions are post-orientation.

### QUAL-R4C8-08 — dead `queryVersionRef` in home-client with a misleading staleness comment (LOW / High)
`apps/web/src/components/home-client.tsx:115,162-166`. The ref is
incremented on every `images` prop change under a comment claiming
"Increment version so stale in-flight load-more responses are
discarded" — but nothing ever READS it. The real staleness guard lives
inside `load-more.tsx` (its own `queryVersionRef`, checked at lines
41/46/83 and bumped by the queryKey effect), which is correct and
sufficient. The dead ref misleads readers into thinking home-client
participates in the staleness protocol. Fix: delete the ref + comment
(or wire it for real — deletion is correct since LoadMore owns it).

## Verified-clean highlights
- navigate()/currentIndex guards in photo-viewer (C7-LOW-03/C8-MED-03)
  still hold with the c7 topicRef pattern.
- Lightbox hide-timer focus logic (R4C6 UX-03) re-derived: sound.
- LoadMore staleness protocol (version + loadingRef + queryKey reset)
  is correct including the `finally` version check.
- image-queue claim/retry/permanent-failure state machine: consistent
  cleanup on every path (claim-retry, retry, permanent, success);
  pruneRetryMaps bounded; bootstrap cursor + notInArray exclusion sound.
- serve-upload ETag/304/HEAD path; cursor pagination tuple conditions
  (keyset over capture_date/created_at/id with NULL branch) correct.
- ImageZoom pinch/pan state machine: stopPropagation interplay with
  PhotoNavigation's window-level listeners suppresses swipe-nav exactly
  when zoomed/pinching (correct), passive-listener nuance noted in the
  designer file as an observation.
- Pattern sweeps: parseInt radix clean repo-wide; `setInterval` sites
  unref'd; IME guards centralized in lib/ime.ts (c6 contract intact);
  JSON.parse sites guarded; sessionStorage/localStorage try-wrapped.
