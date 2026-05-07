# UI/UX Review R2 — Aggregate

**Date:** 2026-05-07
**Companion plan:** `.context/plans/37-color-r2-followup.md` (covers UI/UX + color findings together).
**Premise:** photos uploaded AFTER editing. No edit/scoring features. Recent ~30 commits added significant color-management UI surfaces.

---

## Per-angle reviews (three, parallel)

| Angle | File | Length | Verdict |
|---|---|---|---|
| Visual + interaction | `visual-interaction.md` | ~2,700 words | **FIX AND SHIP** — 5 CRIT/HIGH, 5 MED, 5 LOW |
| Performance | `performance.md` | 271 lines | **FIX AND SHIP** — 1 CRIT, 1 HIGH, 9 MED, 25 LOW |
| Accessibility + responsive | `accessibility-responsive.md` | 4,916 lines | 16 sections, 80 severity tags |

---

## Convergent findings (≥2 reviewers agree)

### U1 ✓ ✓ — HDR `<source>` not gated on per-image existence

**Reviewers:** visual (UX-CRIT-1), performance (PERF-CRIT-1).

**Code:** `photo-viewer.tsx:413`, `lightbox.tsx:418-425`, `home-client.tsx:282-289`.

**Effect:** the `<source media="(dynamic-range: high)">` source fires for any photo with `image.is_hdr = true` whenever `NEXT_PUBLIC_HDR_FEATURE_FLAG=true`. The `_hdr_<size>.avif` files don't exist (encoder deferred). Per `<picture>` spec, the chosen source 404 → browser falls straight to `<img>` JPEG, skipping AVIF/WebP entirely. SW HDR-bypass at `sw.js:42-46` doesn't `event.respondWith` so 404s aren't negative-cached; 200-800 KB waste per HDR-display nav.

**Severity:** **CRIT** when flag enabled. Today flag is `false` so it's a pre-launch landmine.

**Fix:** mirror the `hdrExists` HEAD-probe pattern already used by the download menu, OR move the gate to server-side rendering by including a `hdr_variant_exists` column on the image row.

---

### U2 ✓ ✓ — Mobile bottom-sheet missing all color UI

**Reviewers:** visual (UX-CRIT-2), a11y (RESP-MED-1).

**Code:** `info-bottom-sheet.tsx:241`. Renders only the canonical EXIF block; missing color details accordion, HDR badge, gamut-aware download dropdown, calibration tooltip.

**Effect:** iPhone 15 Pro users (the modal P3 + HDR audience) see none of the new color metadata. The whole audit story breaks on mobile.

**Severity:** **HIGH**.

---

### U3 ✓ ✓ — Calibration tooltip invisible to keyboard / screen-reader

**Reviewers:** visual (UX-CRIT-5), a11y (A11Y-MED-12).

**Code:** `photo-viewer.tsx:847-851`. Tooltip trigger is a `<span>` nested inside the accordion `<button>`. The span isn't focusable; Radix `aria-describedby` link never wires. Tap on mobile fires the accordion, not the tooltip.

**Severity:** **HIGH**.

---

### U4 ✓ — Color details accordion missing aria-expanded / aria-controls

**Reviewers:** a11y (A11Y-MED-3).

**Code:** `photo-viewer.tsx:840-857`. Disclosure state encoded only in chevron rotation; no aria attribute.

**Severity:** **MED**.

---

### U5 ✓ — Histogram AVIF probe runs every mount → double-fetch

**Reviewers:** performance (PERF-MED), implied by visual.

**Code:** `histogram.tsx:247-252`. Feature-detect for canvas-P3 + AVIF runs on every Histogram mount, so first render uses JPEG, then probe completes and source swaps to AVIF.

**Effect:** double-fetch ~200-400 KB per nav for wide-gamut images.

**Severity:** **MED**.

---

### U6 ✓ — HEAD probe for HDR variant fires every nav

**Reviewers:** performance (PERF-MED).

**Code:** `photo-viewer.tsx:230-240`.

**Effect:** every HDR-flagged photo (including the C2 false-positive iPhone HEICs) hits a 404 HEAD on every navigation; SW bypass means no negative caching.

**Severity:** **MED**.

---

### U7 ✓ — WI-15 memory cap is width-only

**Reviewers:** performance (PERF-MED).

**Code:** `process-image.ts:660-672`. Cap on width threshold; a 5999×16000 source (96 MP) bypasses. Estimated ~575 MB peak heap; OOM risk on 1 GB containers.

**Severity:** **MED**.

---

## Single-reviewer findings worth surfacing

### Visual

- **UX-HIGH-3** — "Color Space" + "Color primaries" panel rows render the same string for Display P3 source. `icc_profile_name` "Display P3" and `humanizeColorPrimaries("p3-d65")` "Display P3" duplicate visually with no explanation.
- **UX-HIGH-4** — Sidebar has no internal scroll. On a fully-equipped image the page scrolls past the photo to reach the download button.
- **UX-MED** — Ghost button focus state is a near-invisible background shift on white.
- **UX-MED** — Download button is a full-menu trigger with no primary direct action — adds a step for every download.
- **UX-MED** — Inline `<style>` block for `.hdr-badge` accumulates on photo navigation instead of living in `globals.css`.
- **UX-MED** — Tag filter count label at `text-[10px] opacity-60` is below comfortable legibility.
- **UX-MED** — "Transfer function" terminology is opaque to non-pro visitors on a public surface.

### Performance

- **PERF-HIGH** — SW HDR pass-through repeats 404s without negative caching.
- **PERF-MED** — Three independent rgb16 pipelines run in parallel; peak ~360 MB heap on a wide-gamut 6000-wide intermediate. Real OOM risk on 1 GB containers.
- **PERF-MED** — `color_pipeline_decision` is admin-only at rendering layer but flows through `publicSelectFields` to all visitors. Information leak + waste.
- **PERF-LOW** (~25) — minor render-thrash, bundle weight, animation polish.

### Accessibility

- **A11Y-MED-1** — Touch-target audit at `__tests__/touch-target-audit.test.ts` does NOT actively cover raw `<button>` element sizing or `min-h-[44px]` arbitrary values. The new color details accordion clears 44 px because it specifies `min-h-[44px]`, but a regression to `min-h-[36px]` would not be caught.
- **A11Y-MED-7** — Color details raw `<button>` does NOT inherit shadcn `Button`'s improved `focus-visible:ring-[3px]` (commit 97e44bf). Same defect at `histogram.tsx:343-350` (collapse triangle).
- **A11Y-MED-9** — HDR badge announces only "HDR" with no expansion. Korean i18n at `ko.json:316` preserves the acronym; jargon-opaque to non-photographers.
- **A11Y-MED-16, 17** — HDR badge and color details have no `@media (forced-colors: active)` rules. The masonry-card fix at `globals.css:246-257` was not propagated.
- **RESP-MED-2** — The orientation-aware landscape tablet override at `globals.css:193-197` is dead code: it conditions on `.photo-viewer-grid` but the parent only gets `lg:grid-cols-[1fr_350px]` at 1024 px, never inside the 768-1023 px range.

---

## What is correct (do not change)

- Global `prefers-reduced-motion` at `globals.css:227-236` catches every transition without per-component code.
- HDR badge gates on `@media (dynamic-range: high)` so non-HDR displays don't see it.
- Smart-collection page `/c/[slug]` inherits correct H1/H2 hierarchy from HomeClient.
- Histogram correctly probes canvas-P3 + AVIF support before preferring AVIF source.
- All en/ko i18n keys for the new color UI confirmed present.
- Bottom sheet uses `dvh` + `safe-area-inset-bottom`.
- Download dropdown items all carry explicit `min-h-11`.
- The recent ghost-button `focus-visible:ring-[3px]` fix (97e44bf) is correctly applied at `button.tsx:8`.
- Encoder runs on upload only; no per-render encoder cost.
- srcSet is memoized; masonry reserves space cleanly.
- Service-worker cache strategy is sound (HDR-bypass logic notwithstanding).

---

## Severity-rated summary (UI/UX track)

| Severity | Count | Items |
|---|---|---|
| CRIT | 1 | U1 (HDR source ungated) |
| HIGH | 2 | U2 (mobile color UI gap), U3 (calibration tooltip a11y) |
| MED | 7 | U4 (accordion aria), U5 (histogram double-fetch), U6 (HDR HEAD per-nav), U7 (memory cap width-only), focus-visible inheritance, forced-colors gap, dead landscape CSS |
| LOW | ~30 | bundle weight, animation polish, minor copy / iconography, terminology |

The plan in `.context/plans/37-color-r2-followup.md` covers both color and UI/UX tracks together.
