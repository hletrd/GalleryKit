# Color-Deep Review — Aggregate

**Date:** 2026-05-07
**Premise:** Photos arrive after culling, refinement, and editing. The job is to deliver the photographer's intent — gamut, tonality, dynamic range — accurately to every viewer's display, on every supported browser. **No edit / culling / scoring features.**
**Scope:** color reproduction, ICC profile management, HDR workflow, internal color formats, wide-color-gamut coverage (P3, Adobe RGB, ProPhoto, Rec.2020), display chromaticity primitives, browser color support.

---

## Per-angle reviews (five, parallel)

| Angle | File | Length | Key contribution |
|---|---|---|---|
| Color science | `color-science.md` | 547 lines | First-principles ΔE₂₀₀₀ on CC24 patches; PQ/HLG headroom math; tone-mapping comparison; bit-depth banding analysis |
| Pipeline architecture | `pipeline-architecture.md` | 527 lines | End-to-end data flow; schema design; ETag formula; SW partitioning; CDN compatibility; Sharp/libvips API constraints |
| Format & browser compat | `format-browser-compat.md` | 367 lines | Per-format carriage matrix; per-browser version-pinned support; 12 documented quirks; codec library specifics |
| Code correctness | `code-correctness.md` | ~17 findings | Severity-rated defect list with file:line citations; CRIT bug in OG route, HIGH parser bugs |
| Photographer workflow | `photographer-workflow.md` | 371 lines | Six personas end-to-end; comparison vs SmugMug / Pixieset / PhotoShelter; cross-cutting failure modes |

✓ marks indicate cross-reviewer convergence (≥2 angles independently flagged the same issue). Findings hit by ≥3 angles are **bolded** as convergent.

---

## State of the codebase (corrects earlier assumptions)

The earlier reviews in this directory (`.context/reviews/photographer-color-review.md`, `color-management-comprehensive-review.md`) were written before reading every line of the codebase and mistakenly described several already-implemented surfaces as "not yet done." **Multiple reviewers in this round confirmed:**

- `IMAGE_PIPELINE_VERSION = 5` in `process-image.ts:107` — Phases 1 and 2 (wide-gamut WebP/JPEG, ProPhoto/AdobeRGB → P3) **have already shipped**.
- `force_srgb_derivatives` admin toggle exists in `gallery-config-shared.ts`.
- `images.color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr` schema columns **all exist** (`schema.ts:63-69`).
- `images.color_pipeline_decision` audit column **exists** (`schema.ts:53`).
- `apps/web/src/lib/color-detection.ts` exists with `detectColorSignals()` and `parseCicpFromHeif()` already wired into the upload path.
- The HDR variant URL convention `<id>_<size>_hdr.avif` is **already committed** in `photo-viewer.tsx:213`.
- The histogram canvas already requests `colorSpace: 'display-p3'` on P3 displays (`histogram.tsx:129`).

What is **not** done:

- **No HDR AVIF actually emitted** — the encoder reads `is_hdr` from the DB but never branches on it (`processImageFormats` has no HDR path).
- **The `_hdr.avif` URL in `<picture>` has no file backing it** — designer review confirms it 404s.
- **CICP nclx box parsing is broken** by a 4-byte offset bug — code-reviewer Finding 2.
- **OG route emits P3 ICC over sRGB-clipped pixels** — code-reviewer Finding 9 (CRIT).
- **`color_pipeline_decision` is written but never surfaced in any UI** — designer + code-reviewer convergent finding.
- **CSS `--display-gamut` and `--display-hdr` custom properties are dead** — code-reviewer Finding 4.
- **Several parser bugs** in `extractIccProfileName` duplicate (in `color-detection.ts`, doesn't match `process-image.ts` original).

This is a **maturity-gap problem**, not a green-field problem. The plan in `.context/plans/36-color-deep-implementation.md` reflects this correctly.

---

## Convergent findings (≥2 reviewers, ranked by impact)

### CD-CRIT-1 ✓✓ — HDR detection succeeds; HDR delivery is missing.

**Reviewers:** color-science (Finding 4), pipeline-architecture (data-flow edge C→D), photographer-workflow (Persona 1, Persona 6), format-browser-compat (Section 5), code-correctness (implicit via findings 14 + 9).

**Quantified:** 49.2% of the PQ code range — 3.32 stops above SDR white — silently discarded for every HDR source. iPhone 15 Pro 1000-nit specular highlights collapse to SDR white (color-science Finding 4 with PQ math).

**Code state:**
- `color-detection.ts:222-282` correctly parses CICP nclx and writes `is_hdr = true`.
- `schema.ts:63-69` stores transfer function and primaries.
- `photo-viewer.tsx:213-226` emits a placeholder `_hdr.avif` `HEAD` request that always 404s.
- `processImageFormats` (`process-image.ts:712-892`) does not read `is_hdr`, has no HDR encode branch.

**Architectural blocker:** Sharp 0.34.5 / libvips do not write CICP nclx into AVIF output (libvips issue #3912; format-browser-compat Section 5; pipeline-architecture point 10). HDR delivery requires either:
- Wait for libvips to ship CICP write support, or
- Shell out to `avifenc` (Option C) and post-process the AVIF container, with concurrency budget impact (architect: serialize HDR after SDR to avoid 33% CPU overrun).

**Severity:** CRIT for HDR-shooting personas (1 and 6). Cross-platform for HDR display owners (~30-50% of modern phone audience).

---

### CD-CRIT-2 ✓ — OG image embeds P3 ICC over sRGB-clipped pixels.

**Reviewers:** code-correctness (Finding 9), photographer-workflow (Section 7).

**Code:** `apps/web/src/app/api/og/photo/[id]/route.tsx:38-45`.

**Root cause:** Satori (the next/og renderer) flattens to sRGB internally via resvg's SVG renderer. The post-Sharp `withIccProfile('p3')` step then writes a P3 ICC tag onto sRGB-interior pixels. Cross-platform sharing on iOS iMessage 17+ (which color-manages embedded JPEG previews) shows desaturated colors with a P3 tag — wrong for both interpretations.

**Severity:** CRIT for the cross-platform sharing persona (Persona 5). Subtle for end users; honest about the bug for the photographer.

**Fix shape:** either drop the post-Sharp ICC override (always sRGB), or replace Satori with a Sharp-only OG composer that color-manages end-to-end.

---

### CD-CRIT-3 ✓ — `colr` box parser bug silently breaks CICP detection.

**Reviewers:** code-correctness (Finding 2), pipeline-architecture (data-flow edge B), photographer-workflow (notes the HDR detection seems to work but...).

**Code:** `apps/web/src/lib/color-detection.ts:182-194`.

**Root cause:** The parser treats `colr` as a FullBox (skips 4 bytes for version+flags) but ISOBMFF defines it as a regular Box. The +4-byte offset means the `'nclx'` colour_type identifier is never matched.

**Effect:** Any HEIF / AVIF / HEIC source with CICP nclx signaling has its primaries / transfer / matrix silently set to `'unknown'`. This means the workflow review's claim that detection works is partially misleading — `is_hdr = true` is being set via some other path, or the detection is failing silently in a way the schema-write path masks.

**Severity:** CRIT for any HDR source. Once CD-CRIT-1 (encoder) is unblocked, this MUST also be fixed or the encoder will never see HDR sources flagged.

---

### CD-HIGH-1 ✓✓ — `color_pipeline_decision` is written but never surfaced.

**Reviewers:** photographer-workflow (Persona 2 walk-through), code-correctness (Finding 14), pipeline-architecture (point 8).

**Effect:** The audit column populates correctly on encode but no UI consumer reads it. Photographers cannot verify which encoder branch their photo took. This is dead observability — the column has the right shape, the data is there, no surface exists.

**Fix shape:** add to EXIF panel as an admin-only "Color decision" line, or expose via an `X-Color-Pipeline` debug response header sampled at 1% of traffic.

---

### CD-HIGH-2 ✓ — Sharp `pipelineColorspace('rgb16')` shared-state risk.

**Reviewers:** code-correctness (Finding 6), pipeline-architecture (point 5).

**Code:** `process-image.ts:768-771`. The same parent `image` instance is `clone()`d into three parallel format pipelines (`generateForFormat` for AVIF/WebP/JPEG via `Promise.all`). One of the three then calls `pipelineColorspace('rgb16')` on the clone. Whether this leaks state through the shared decode pipeline depends on undocumented Sharp internals.

**Severity:** HIGH because cross-format leakage could corrupt one variant's color while leaving others correct, and the bug would be intermittent (race-dependent).

**Fix shape:** explicitly serialize the wide-gamut `pipelineColorspace` call by re-decoding from the source path inside each closure rather than cloning, OR by ensuring all three formats use the same `pipelineColorspace` setting (consistent rgb16 for wide-gamut).

---

### CD-HIGH-3 ✓ — Memory pressure on 100 MP wide-gamut sources.

**Reviewers:** code-correctness (Finding 12), pipeline-architecture (point 5 sub-bullet).

**Quantified:** ~1.1 GB working set per image with `rgb16` pipeline + 3-way format fan-out. With `QUEUE_CONCURRENCY > 1` this OOMs typical 2 GB Docker containers.

**Fix shape:** cap wide-gamut sources to one format at a time (serial), or cap `rgb16` source resolution to a smaller upper bound (e.g. 6000-wide) before fan-out.

---

### CD-HIGH-4 ✓ — Duplicate / divergent ICC parsing.

**Reviewers:** code-correctness (Finding 1), pipeline-architecture (point 8 sub-bullet on `color_space` vs `icc_profile_name` vs `color_primaries`).

**Code:** `process-image.ts` has the canonical `extractIccProfileName`. `color-detection.ts:309-374` has a duplicate that diverges:
- ICC v4 `mluc` tag handled as ASCII (should be UTF-16BE).
- Searches `dmdd` / `dmnd` tags as fallback, which can return manufacturer names instead of profile descriptions.

**Severity:** HIGH because the two parsers feed two different consumers, and divergence means the audit column (`color_pipeline_decision`) and the displayed `color_space` value can disagree on the same image.

**Fix shape:** consolidate to one parser (the `process-image.ts` original is more correct). Drop the duplicate.

---

### CD-HIGH-5 — `color_space` column polluted by ICC name, not EXIF tag.

**Reviewers:** code-correctness (Finding 3).

**Code:** `apps/web/src/app/actions/images.ts:333` writes the ICC profile name into `color_space` instead of the EXIF `ColorSpace` tag value (e.g. `'1'` = sRGB, `'65535'` = Uncalibrated).

**Effect:** the EXIF panel shows "Color Space: Adobe RGB (1998)" while the EXIF spec expected enum value is "Uncalibrated" (because Adobe RGB photos are tagged Uncalibrated). The displayed string is more user-useful but is in the wrong column. Photographers see a confusing label discrepancy.

**Fix shape:** rename `color_space` → `iccProfileName` in queries (the column already exists), and expose the EXIF tag value in a separate UI line if needed.

---

### CD-MED-1 ✓ — Histogram source is sRGB-clipped JPEG even when AVIF is available.

**Reviewers:** color-science (Finding 8 confirms canvas P3 is correct), code-correctness (Finding 5), photographer-workflow (Section 14 audit story).

**Code:** `photo-viewer.tsx:776` passes the small JPEG URL to the histogram. The canvas correctly requests `colorSpace: 'display-p3'` (`histogram.tsx:129`) but reads sRGB-clipped pixel values into a P3 context. The histogram is correct for the JPEG variant, wrong for the photographer's intent on a P3 source.

**Fix shape:** prefer the AVIF variant for histogram when the source is wide-gamut and the browser supports canvas-P3 + AVIF decode. Designer review notes: `is_hdr = true` source's histogram is doubly wrong (sRGB clip + SDR tone-map).

---

### CD-MED-2 ✓ — DCI-P3 sources treated as Display P3 with uncorrected white-point error.

**Reviewers:** color-science (Finding 3).

**Quantified:** Δy = 0.022 between DCI white (0.314, 0.351) and D65 (0.3127, 0.3290). Mean ΔE₂₀₀₀ = 0.537, max = 1.25 (bluish green) on CC24. Below the 1.5 skin-tone threshold; risk is low because DCI-P3 photographic stills are rare in practice.

**Severity:** MED. Documented for completeness; defer behind higher-impact items.

**Fix shape:** before mapping DCI-P3 → P3, apply Bradford chromatic adaptation from DCI-white to D65.

---

### CD-MED-3 ✓ — "Download sRGB JPEG" label is wrong when the file is P3-tagged.

**Reviewers:** photographer-workflow (CW-CRIT-2 in their numbering — converted to MED here because it's a label, not a delivery defect).

**Effect:** post-Phase-1 (which has shipped), the JPEG variant for a P3 source is P3-tagged, not sRGB. The button label still says "Download JPEG" or "Download sRGB JPEG."

**Fix shape:** label dynamically based on the source's `color_pipeline_decision` (or `color_primaries`).

---

### CD-MED-4 — ProPhoto → P3 fundamental gamut mismatch (clipping).

**Reviewers:** color-science (Finding 2 — quantified ΔE₂₀₀₀ up to 15.75 on cyan, mean 2.38, 9/24 patches out of P3 gamut).

**Effect:** ProPhoto sources lose saturated cyans and blues with no soft rolloff. Sharp/libvips does not expose CIECAM02-space soft clipping.

**Status:** acknowledged trade-off (already documented in current `process-image.ts` comments at line 484-487). ProPhoto users gain more than they lose vs the pre-Phase-2 ProPhoto → sRGB clip, but the worst patches still clip hard.

**Fix shape:** longer-term, add an admin-configurable "soft gamut compression" setting that shells out to LCMS2 for perceptual rendering intent. Defer (Phase 6 in `34-color-management-roadmap.md`).

---

### CD-MED-5 ✓ — `<picture>` source order missing `media="(dynamic-range: high)"`.

**Reviewers:** pipeline-architecture (point 5), photographer-workflow (Persona 1 + 6), format-browser-compat (Section 6).

**Effect:** even once CD-CRIT-1 is unblocked and HDR variants are emitted, the viewer doesn't tier on display capability. Browsers fall through to the SDR AVIF.

**Code:** `photo-viewer.tsx`, `lightbox.tsx`, `home-client.tsx` all build `<picture>` independently. Source-order strategy is documented in pipeline-architecture review.

**Fix shape:** the `media` attribute is universally supported. Pure JSX change.

---

### CD-MED-6 ✓ — Firefox NEVER matches `(color-gamut: p3)`.

**Reviewers:** format-browser-compat (Section 2).

**Effect:** the EXIF P3 badge never appears for Firefox users regardless of display capability. This is a Firefox bug, not a GalleryKit bug, but it affects how we should choose to display gamut information.

**Fix shape:** consider a non-MQ-only gating (e.g. always show the badge with a tooltip explaining it's the source's color space) so Firefox users get the same information as other browsers. Alternatively, accept the gap and document.

---

### CD-LOW-1 ✓ — CSS custom properties `--display-gamut` and `--display-hdr` are dead code.

**Reviewers:** code-correctness (Finding 4).

**Code:** `globals.css:168-170`. Set under `@media` queries but no rule reads them.

**Fix shape:** either remove or wire them into photo rendering (e.g. opt-in HDR variant via a `<source>` `media` clause that mirrors the CSS detection).

---

### CD-LOW-2 ✓ — Service worker should bypass HDR variants.

**Reviewers:** pipeline-architecture (point 6).

**Effect:** once HDR variants ship, caching them in the 50 MB SW LRU would starve SDR entries. The recommendation is pass-through-to-network for `_hdr.avif`.

**Fix shape:** SW route table addition.

---

## Severity-rated summary

| Severity | Count | Items |
|---|---|---|
| CRIT | 3 | CD-CRIT-1 (HDR not delivered), CD-CRIT-2 (OG sRGB-over-P3), CD-CRIT-3 (colr-box parser bug) |
| HIGH | 5 | CD-HIGH-1 (audit dead UI), CD-HIGH-2 (Sharp shared-state), CD-HIGH-3 (memory), CD-HIGH-4 (parser duplication), CD-HIGH-5 (color_space pollution) |
| MED | 6 | CD-MED-1 (histogram source), CD-MED-2 (DCI white-point), CD-MED-3 (download label), CD-MED-4 (ProPhoto clip), CD-MED-5 (`<picture>` media), CD-MED-6 (Firefox MQ) |
| LOW | 2 | CD-LOW-1 (dead CSS), CD-LOW-2 (SW HDR bypass) |

---

## What is correct (do not change)

Cross-reviewer agreement on what's working:

- `IMAGE_PIPELINE_VERSION` + ETag invalidation pattern (architecture point 9, code-correctness implicit).
- 10-bit AVIF probe + lazy memoization (color-science Finding 5; code-correctness Finding 7 confirms probe state preservation).
- 4:4:4 chroma subsampling for wide-gamut JPEG (color-science implied via banding analysis).
- `pipelineColorspace('rgb16')` for wide-gamut sources (color-science Finding 1; cost/quality split is correct).
- Strict P3 allowlist in `resolveAvifIccProfile` (do not relax; extend).
- AdobeRGB → P3 mapping (color-science Finding 1; mean ΔE₂₀₀₀ = 0.163, photographic-content-grade).
- `force_srgb_derivatives` admin escape hatch (already exists).
- EXIF stripping from delivery variants (privacy guard).
- Failure-mode handling on `image.metadata()` (deletes original on parse failure).
- Bradford CAT default in libvips/LCMS2 (color-science Finding 7 confirms perceptually indistinguishable from CAT02).
- Histogram canvas `colorSpace: 'display-p3'` request (`histogram.tsx:129` — correct).

---

## Recommended sequencing

The implementation plan in `.context/plans/36-color-deep-implementation.md` orders work as:

1. **CD-CRIT-3** first (`colr` parser bug). Without this, every HDR source has unknown CICP and the encoder cannot distinguish HDR from SDR.
2. **CD-HIGH-4** consolidate ICC parsers. Single source of truth for color decisions.
3. **CD-HIGH-5** fix `color_space` column pollution. UI labeling correctness.
4. **CD-CRIT-2** OG route. Cross-platform sharing correctness.
5. **CD-HIGH-1** surface `color_pipeline_decision`. Photographer audit.
6. **CD-MED-1** histogram source switching.
7. **CD-MED-3** download label.
8. **CD-MED-5** `<picture>` `media` attribute (preparation for HDR).
9. **CD-CRIT-1** HDR AVIF emission via `avifenc` shell-out. The largest piece.
10. **CD-LOW-1** wire dead CSS or remove.
11. **CD-LOW-2** SW HDR bypass.
12. **CD-MED-2** DCI white-point Bradford.
13. **CD-MED-4** soft gamut compression (longer-term).
14. **CD-HIGH-2** Sharp shared-state hardening (correctness).
15. **CD-HIGH-3** memory pressure mitigation (operational).

Items 1-8 are code-trivial and ship as separate PRs. Item 9 is the largest piece and depends on 1, 5, 8.

---

## Open product questions for sign-off

These need answers before implementation begins:

1. **Avifenc shell-out vs wait-for-libvips:** the libvips nclx CICP gap is tracked in libvips#3912. Wait for upstream (months) or ship Option C now (avifenc binary in the Docker image)?
2. **Tone-mapping algorithm:** color-science Finding 6 recommends ACES (Hill approximation). Confirm vs Hable as a v1 fallback?
3. **HDR variant max width:** architect recommends capping at 2048-wide (iOS Safari OOM mitigation). Acceptable, or do we need a 4K HDR path for Apple XDR / OLED TV viewers?
4. **`color_pipeline_decision` UI surface:** admin-only EXIF row, or always-on with technical jargon hidden behind a tooltip?
5. **Firefox `(color-gamut: p3)` workaround:** accept the gap and document, or use a JS feature-detect path (canvas-P3 query) as the gating signal instead?

The plan in `.context/plans/36-color-deep-implementation.md` proposes default answers but flags these as items requiring product confirmation before code lands.
