# Photographer-Perspective Review R4 — Aggregate

**Date:** 2026-05-08 (post-cycle-9 convergence)
**Reviewer perspective:** professional photographer + end-user-workflow.
**Premise:** photos arrive AFTER culling/refinement/editing. The product's job is to deliver the photographer's intent — gamut, tonality, dynamic range — accurately to every viewer's display, on every supported browser. (사진가가 원했던 사진의 의도를 반영해서 정확하게 출력되어야 해.) **No edit / culling / scoring features.**

**Per-angle reviews (this directory):**

| File | Angle |
|---|---|
| `forward-architecture.md` | WI-09 HDR readiness checklist · JPEG XL scoping · mastering metadata · gain map · custom-ICC chromaticity detection |
| `cross-platform-color.md` | Browser × OS × display matrix v3, focusing on `screen.colorGamut` API + Firefox MQ workaround + Edge Auto HDR |
| `latent-and-ux-residuals.md` | File:line bugs not yet caught by 8 cycles + UI/UX residuals + photographer tooling gaps |

---

## 0. State of the codebase (2026-05-08, post-cycle-9)

R3 + 9 cycles of /review-plan-fix have shipped a remarkable amount. Confirmed against current code:

### Color science — solid

- ✓ `colr` ISOBMFF parser correct (`color-detection.ts:156-220`); walks `meta`/`iprp`/`ipco`; bounded depth/scan.
- ✓ NCLX maps match ITU-T H.273 (transfer 13=sRGB, 16=PQ, 18=HLG; primaries 11=DCI-P3, 12=P3-D65).
- ✓ ICC parser consolidated in `icc-extractor.ts` with `mluc` UTF-16BE.
- ✓ `resolveColorPipelineDecision` AND `resolveAvifIccProfile` both accept `signals?` parameter — NCLX-only (no ICC) Rec.2020 / P3 / Adobe RGB / ProPhoto AVIFs route correctly. **P3-11 shipped.**
- ✓ DCI-P3 → Display P3 D65 Bradford: ΔE = 0 on CC24.
- ✓ Wide-gamut sources >50 MP downscale before fan-out (memory).
- ✓ Sharp shared-state hardened.

### Schema — clean

- ✓ `color_space` holds EXIF tag (sRGB / Uncalibrated); `icc_profile_name` holds ICC description; `color_pipeline_decision` admin-only; `is_hdr` / `transfer_function` / `matrix_coefficients` admin-only via `_PrivacySensitiveKeys` compile-time guard.
- ✓ `IMAGE_PIPELINE_VERSION = 6` (P3-20/P3-21 tunable parameters added).

### Encoder — honest about limits

- ✓ HDR `<picture> <source media="(dynamic-range: high)">` removed from photo-viewer / lightbox / home-client (no 404 landmines on inline `<picture>`).
- ✓ HDR download menu item deleted from photo-viewer (was the cycle-1 R3-C1 landmine).
- ✓ HDR ingest gated on `allow_hdr_ingest` setting (default `false`); rejects PQ / HLG sources with localized error message until WI-09 ships.
- ✓ AVIF `effort` and JPEG `chromaSubsampling` for wide-gamut now admin-tunable (P3-20 / P3-21).
- ✓ OG route always emits sRGB JPEG.

### UI/UX — comprehensive

- ✓ `ColorDetailsSection` shared between desktop sidebar and mobile bottom sheet.
- ✓ Accordion opens by default for non-trivial color (P3-25).
- ✓ Calibration tooltip is sibling button with full a11y (focus-visible, keyboard, SR, forced-colors).
- ✓ HDR badge gradient amber→orange w/ white text (P3-15).
- ✓ Lightbox `LightboxColorPip` (inline in `lightbox.tsx:78-150`) shows gamut + HDR badge; tap-to-expand panel; admin-only HDR.
- ✓ Histogram canvas-P3 + AVIF probe via Promise-singleton + `colorSpace: 'display-p3'` request.
- ✓ "(sRGB clipped)" indicator on histogram for wide-gamut sources read via JPEG.
- ✓ Source bit depth + delivered bit depth co-located in Color Details accordion (P3-5).
- ✓ "Delivered formats" row (WebP / AVIF / JPEG chips) in Color Details (P3-22).
- ✓ `WideGamutHint` (P3-8) shows on sRGB displays for wide-gamut photos via `useSyncExternalStore` MQ subscription.
- ✓ `force_show_color_chips` admin opt-in for photographer demos on non-matching displays (P3-26).
- ✓ Gamut-aware download dropdown via `isP3Pipeline` helper centralized across 4 call sites.
- ✓ Korean i18n for transfer / pipeline / HDR badge / wide-gamut hint / settings.
- ✓ `humanizeColorPrimaries` Latinate names (BT.709, Display P3, Adobe RGB, etc.) per cycle-3 D2 convention.
- ✓ Accordion `aria-expanded` / `aria-controls`; forced-colors mode rules; touch-target audit covers components/.
- ✓ 1239 / 1239 vitest green; 17+ color-related test fixtures.

### Convergence trajectory

| Cycle | Findings | Commits |
|---|---|---|
| 1 | 9 | 6 |
| 2 | 18 | 8 |
| 3 | 25 | 9 |
| 4 | 13 | 9 |
| 5 | 4 | 6 |
| 6 | 1 | 4 |
| 7 | 1 | 3 |
| 8 | 0 | 1 |
| 9 | 0 | 0 |

The codebase is **converged** on the photographer surface as covered by R3 + cycles. R4 looks for *new angles* — items the prior reviews did not surface.

---

## 1. R4 NEW findings (severity-rated)

### CRIT — none

The codebase has **no** open critical photographer-intent issue. The cycle 9 zero/zero result holds.

### HIGH

#### R4-H1 — Apple HDR gain maps silently stripped on iPhone 14+ HDR HEIC ingest

**Reviewers:** forward-architecture (FA-H1), cross-platform-color (CP-H1).

**Code path:**
1. iPhone 14+ HDR HEIC carries an SDR base image + an Apple HDR gain map (ISO 21496-1, in a sub-track).
2. Sharp / libheif decode reads only the SDR base. The gain map is NOT exposed via `metadata.icc` or NCLX.
3. `detectColorSignals` returns `transfer='srgb'`, `is_hdr=false` — accurate for the SDR base, but a **false negative** on the photographer's HDR intent.
4. Encoder emits sRGB / P3 SDR derivatives. The HDR gain map is lost.
5. No audit signal: no `has_gain_map` column, no UI hint, no warning to the photographer at upload.

**Quantified:** all iPhone 14+ HDR HEIFs (the modal HDR-shooting persona for personal galleries — the exact audience this product is built for) lose their HDR work silently. iOS Photos.app, Apple Mail, and iMessage all preserve gain maps; uploading to GalleryKit drops them.

**Why it's NOT in R3 / cycles 1-9:** the prior reviews focused on PQ / HLG transfer functions (NCLX-tagged HDR). Apple gain maps are a separate HDR signaling path that NCLX cannot detect.

**Severity:** HIGH for the iPhone-photographer audience; LOW-MED for everyone else.

**Fix shape:** detect the `urim` / `tmap` boxes (gain map auxiliary track) and the `iref` `auxl` reference in the HEIF container; flag `images.has_gain_map = true` admin-only column; surface in admin Color Details audit "Gain map: present (delivered as SDR base only)". Bonus: when WI-09 ships, transcode gain map → AVIF gain map (libavif 1.0+ supports the ISO/IEC 21496-1 spec).

**Effort:** S for detection + audit. XL for transcode (depends on WI-09).

**Acceptance:** uploaded iPhone 14+ HDR HEIC has `has_gain_map=true`; admin Color Details panel shows "Gain map: present"; no public surface.

---

#### R4-H2 — Custom monitor ICCs (Eizo, BenQ SW-series, X-Rite) silently fall through to `srgb-from-unknown`

**Reviewers:** forward-architecture (FA-H2), cross-platform-color (CP-MED).

**Code:** `process-image.ts:420-458` `resolveColorPipelineDecision`, `:488-526` `resolveAvifIccProfile`. Both use string-matching against profile description.

**Problem:** professional photographers with calibrated monitors (Eizo CG2700X, BenQ SW272U, X-Rite ColorMunki Display, Datacolor Spyder) export with custom ICC profile names like:

- `EIZO ColorEdge CG2700X — 2026-04-12 calibrated`
- `BenQ SW272U — D65 native`
- `Custom — sRGB ColorMunki 2025-12-01`

None match the allowlist (`'display p3'` / `'adobe rgb'` / `'prophoto'` / `'rec.2020'` / `'srgb'`). All fall through to `'srgb-from-unknown'` and `'srgb'` AVIF tag. The ACTUAL gamut may be:

- Eizo CG2700X native: ~99% Adobe RGB, ~98% P3 → wider than sRGB.
- BenQ SW272U native: ~99% Adobe RGB, ~95% P3.
- ColorMunki sRGB calibration: pinned to sRGB.

For the first two, photographer-intent silently lost (delivered as sRGB-clipped derivatives).

**Why it's deferred (C8-D3 — P3-13):** ICC TRC parsing is large; ICC chromaticity (`wtpt` / `rXYZ` / `gXYZ` / `bXYZ` tags) is medium-effort.

**Severity:** HIGH for the pro-photographer audience that uses calibrated monitors. R3 mentioned this once (CF-LOW-1) at LOW; the audience is photographer-modal so promote.

**Fix shape:** parse the ICC tag table for `wtpt`, `rXYZ`, `gXYZ`, `bXYZ`; convert XYZ → xy chromaticity; match against gamut presets (sRGB, P3, AdobeRGB, ProPhoto, Rec.2020) within ΔE 0.005 tolerance; chromaticity-detected primary feeds `resolveAvifIccProfile`'s `signals` argument.

```ts
// New: lib/icc-chromaticity.ts (~150 lines)
export function detectGamutFromIccChromaticity(icc: Buffer): {
  primary: 'srgb' | 'p3' | 'adobergb' | 'prophoto' | 'rec2020' | 'unknown';
  whitePoint: { x: number; y: number };
  confidence: number;
};
```

Pure JS. No new dependency. Plug into `detectColorSignals` as a third resolver after NCLX and ICC-name match.

**Effort:** M.

**Acceptance:** Eizo CG2700X-tagged photo (with native primaries close to Adobe RGB) routes through the AdobeRGB → P3 path, not the sRGB clip.

---

### MED

#### R4-M1 — `screen.colorGamut` JS API not used; Firefox + P3 display still triggers `WideGamutHint` false positive

**Reviewers:** cross-platform-color (CP-H2).

**Code:** `wide-gamut-hint.tsx:14-22`. Uses `window.matchMedia('(color-gamut: p3)')`. Firefox always returns false (Mozilla bug 1591455).

**Problem:** Firefox 124+ on macOS with internal P3 display: the MQ says false; `WideGamutHint` renders for every wide-gamut photo telling the visitor "your display shows the sRGB version." This is the **opposite** of the truth — Firefox correctly color-manages the P3-tagged AVIF via its non-MQ path. The hint is a lie.

**Why R3 / cycles missed it:** prior reviews flagged the histogram canvas-P3 problem (CF-HIGH-4, fixed in cycle 3 via Promise-singleton + canvas-context probe). The `WideGamutHint` MQ check has the same root cause but got attached to `useSyncExternalStore` cleanly in cycle 1, masking the issue.

**Fix shape:** layered detection in a shared `useDisplayCapability()` hook:

```ts
function detectP3Display(): boolean {
  // 1. screen.colorGamut API — Chromium 121+, Safari 18+
  if (typeof window !== 'undefined' && 'screen' in window && 'colorGamut' in window.screen) {
    const cg = (window.screen as Screen & { colorGamut?: string }).colorGamut;
    if (cg === 'p3' || cg === 'rec2020') return true;
    if (cg === 'srgb') return false;
  }
  // 2. matchMedia — works on Chrome / Safari / Edge but NOT Firefox
  if (typeof window !== 'undefined' && window.matchMedia('(color-gamut: p3)').matches) return true;
  // 3. canvas-P3 feature probe — works on Firefox 113+
  return probeCanvasP3();
}
```

`WideGamutHint` and `histogram.tsx` both consume this hook. Single source of truth for display capability.

**Effort:** S.

**Acceptance:** Firefox 124+ on macOS internal P3 display: `WideGamutHint` does NOT render for P3 photos. Chrome / Safari unchanged.

---

#### R4-M2 — Lightbox color pip slide-up panel has gamut + HDR but NO histogram

**Reviewers:** latent-and-ux-residuals (UX-M1).

**Code:** `lightbox.tsx:78-150` `LightboxColorPip` — closed pip shows badge + HDR; expanded panel shows gamut metadata; histogram NOT included.

**Photographer-intent impact:** photographer demoing in fullscreen wants to read exposure (clip indicators). Without histogram in lightbox, they have to leave fullscreen, return to photo viewer, expand color details accordion to see histogram — multi-step.

**Why R3 missed it:** R3 P3-16 specified "tap reveals slide-up panel with full color metadata + histogram + download buttons." Cycles 3-5 implemented LightboxColorPip with gamut + HDR but stopped short of histogram (likely scope-management).

**Fix shape:** add `<Histogram>` component to the expanded panel below the gamut metadata.

**Effort:** S.

**Acceptance:** lightbox tap → slide-up panel includes a 240×120 (or smaller) histogram showing the same data as the sidebar panel.

---

#### R4-M3 — DCI-P3 audit label is verbose ("Display P3 (from DCI-P3, D65 adapted)")

**Reviewers:** latent-and-ux-residuals (UX-M2).

**Code:** `messages/en.json:colorPipelineP3FromDcip3` etc.

**Problem:** the label is technically accurate but visually long. For a photographer using a DCI-P3 source occasionally, it occupies a row's worth of width in the Color Details accordion grid.

**Photographer-intent impact:** marginal.

**Fix shape:** shorten to "Display P3 (from DCI-P3)" — drop the "D65 adapted" qualifier; add a tooltip on the label that says "white point adapted from DCI to D65 via Bradford CAT" for admins who want the technical detail.

**Effort:** XS.

---

#### R4-M4 — Real PQ HEIF / HLG HEIF test fixtures still missing

**Reviewers:** forward-architecture (FA-M1).

**Code:** `apps/web/__test_fixtures__/` directory does not exist (find returns nothing). 17 color-related tests; none exercise a real HEIF source with PQ / HLG NCLX.

**Why C8-D7 deferred:** "When P3-12 plan scheduled." That plan was scoped in plan 38 §P3-12 but never run.

**Fix shape:** commit small (≤ 50 KB each) PQ / HLG / DCI-P3 / Rec.2020-NCLX-only / custom-monitor-ICC fixtures to `apps/web/__test_fixtures__/color/`. Wire into existing tests.

Sources: synthesize via `avifenc --cicp` + `heif-convert`, or extract from public-domain Apple developer / Sony / Nikon test rigs.

**Effort:** S (fixture commits) + S (test wiring).

---

#### R4-M5 — Mobile bottom-sheet IA reorder for non-trivial color: not landed

**Reviewers:** latent-and-ux-residuals (UX-M3).

**Code:** `info-bottom-sheet.tsx:255-505`. Sheet content order: Tags → Description → EXIF grid → Color Details → Histogram → Capture date → Download.

**Photographer-intent impact:** for the modal P3 + HDR audience on mobile, scrolling past 16+ EXIF rows to reach Color Details + Histogram is friction.

**Plan-38 P3-28 specified Option A:** for non-trivial color sources, render Color Details / Histogram / Download BEFORE EXIF. Cycle plans don't show this implemented.

**Fix shape:** add the conditional reorder.

**Effort:** S.

---

### LOW

#### R4-L1 — Lightbox `LightboxColorPip` is inline in `lightbox.tsx`, not a separate file

**Reviewers:** latent-and-ux-residuals (UX-L1).

**Code:** `lightbox.tsx:78-150`. Convention drift: `ColorDetailsSection` is a standalone component; `LightboxColorPip` is inline.

**Fix shape:** extract to `components/lightbox-color-pip.tsx`. Improves testability + reuse.

**Effort:** XS.

---

#### R4-L2 — `extractIccProfileName` `mluc` branch returns first record always, not locale-matched

**Reviewers:** latent-and-ux-residuals (LATENT-L1).

**Code:** `icc-extractor.ts:63-82`. ICC v4 spec: pick the record whose language code matches the requested locale. Today: returns the first non-empty record.

**Photographer-intent impact:** Apple Display P3 ICC has en/ja/de/fr/zh records; we always read en. For Korean photographers viewing the audit panel, the ICC name is in English. Acceptable per Latinate convention but technically not spec-compliant.

**Fix shape:** accept an optional `locale` parameter; iterate records; prefer the one whose `language code` matches. Fallback to first.

**Effort:** XS.

---

#### R4-L3 — ETag formula does not include settings hash

**Reviewers:** forward-architecture (FA-L1).

**Code:** `serve-upload.ts:97`. `W/"v${IMAGE_PIPELINE_VERSION}-${mtime}-${size}"`.

**Problem:** when admin flips `wide_gamut_jpeg_chroma` 4:4:4 → 4:2:2 without re-running the backfill script, cached clients keep stale 4:4:4 variants. Operator must run backfill + the file mtime updates handle invalidation.

**Photographer-intent impact:** marginal — operator-discipline issue. But future-proofing would tie cache invalidation to settings change automatically.

**Fix shape:** `W/"v${VERSION}-${mtime}-${size}-${settingsHash.slice(0, 8)}"` where `settingsHash = sha256(JSON.stringify({wide_gamut_jpeg_chroma, avif_effort, force_srgb_derivatives, ...}))`. Document; defer if operator-discipline is acceptable.

**Effort:** S.

---

#### R4-L4 — `humanizeColorPipelineDecision` parameter type loose (`string | null | undefined`)

**Reviewers:** latent-and-ux-residuals (LATENT-L2).

**Code:** `color-details-section.tsx:56-70`.

**C8-D15 deferred.** Confirmed deferred; no R4 change needed. Just document.

---

## 2. Forward-looking architecture (READ FORWARD-ARCHITECTURE.MD)

R4 surfaces several architecture-readiness items that are not bug-class but matter for the next major release:

| Item | Severity | Effort | Source |
|---|---|---|---|
| **WI-09 readiness checklist consolidation** | DOC | S | scattered across plans 36 / 38 / cycle plans |
| **Mastering metadata schema** (SMPTE 2086 / MaxCLL / MaxFALL) | LOW (now) / HIGH (when WI-09 ships) | M | plan 36 noted as deferred-v2 |
| **JPEG XL output as 4th derivative** | LOW | M | Sharp + libjxl support |
| **Apple gain map detection** | HIGH (R4-H1) | S detection / XL transcode | new finding |
| **ICC chromaticity-based gamut detection** | HIGH (R4-H2) | M | C8-D3 / P3-13 |
| **`screen.colorGamut` JS API integration** | MED (R4-M1) | S | new finding |

Detail in `forward-architecture.md`.

---

## 3. Cross-platform color matrix (READ CROSS-PLATFORM-COLOR.MD)

Updated browser × OS × display matrix focusing on:

- Firefox `(color-gamut: p3)` MQ false-negative + remediation via canvas-P3 probe + `screen.colorGamut`.
- Edge Auto HDR mode interaction with `<picture> media="(dynamic-range: high)"` (post-WI-09).
- Android Chrome wide-gamut detection lag (Pixel 8+ has P3 display but signals `srgb` until Android 15+).
- Safari iOS 18 P3 + HDR gradient UI (Apple Photos pip parity considerations).

---

## 4. Latent + UX residuals (READ LATENT-AND-UX-RESIDUALS.MD)

Concrete file:line bugs and UX gaps not caught by 8 cycles + R3:

- LATENT-L1, LATENT-L2 (icc-extractor mluc locale; humanize loose typing).
- UX-M1 (lightbox histogram missing).
- UX-M2 (DCI-P3 label verbose).
- UX-M3 (mobile bottom sheet IA non-trivial reorder).
- UX-L1 (extract LightboxColorPip).
- UX-L2 (touch-target audit confirmed-but-could-explicit-cover lightbox-color-pip pip + expanded panel).
- Photographer tooling gaps: download-original, target-display soft-proof preview, copy-color-metadata, comparison view between adjacent photos (reaffirmed out-of-scope per premise).

---

## 5. Re-examination of cycle 8 deferred items (C8-D1 .. C8-D15)

Each deferred item re-examined under R4's photographer lens:

| ID | Original sev | R4 verdict | Reason |
|---|---|---|---|
| C8-D1 (full_range_flag unconsumed) | LOW | **KEEP DEFERRED** until WI-09 |
| C8-D2 (Legacy is_hdr admin diagnostic) | LOW | **KEEP DEFERRED** until WI-09 |
| C8-D3 (P3-13 ICC TRC parsing) | HIGH | **PROMOTE → R4-H2** ICC chromaticity-based detection (alternative path); ship before TRC |
| C8-D4 (validatedNumber silent clamp) | MED | **KEEP DEFERRED** |
| C8-D5 (10-bit AVIF probe not reset) | LOW | **KEEP DEFERRED** |
| C8-D6 (.wi15.tmp cleanup race) | LOW | **KEEP DEFERRED** |
| C8-D7 (real HEIF + ICC fixtures) | LOW | **PROMOTE → R4-M4** test infra; needed for HDR audit |
| C8-D8 (colorDetailsId collision) | LOW | KEEP DEFERRED; couples to D12 |
| C8-D9 (histogram clip threshold hardcoded) | LOW | KEEP DEFERRED |
| C8-D10 (histogram canvas not responsive) | LOW | KEEP DEFERRED |
| C8-D11 (c/h shortcuts dead on mobile) | LOW | KEEP DEFERRED; couples to D12 |
| C8-D12 (mobile bottom-sheet hoist state) | MED | **PROMOTE → R4-M5** mobile sheet IA reorder for non-trivial color |
| C8-D13 (encoder-side fixture for jpeg_chroma) | MED | KEEP DEFERRED; fixture infra (R4-M4) blocks |
| C8-D14 (p3-from-rec2020-hlg enum split) | LOW | KEEP DEFERRED until WI-09 |
| C8-D15 (humanizeColorPipelineDecision tightening) | LOW | KEEP DEFERRED (cosmetic) |

Net: 3 promoted, 12 honestly kept deferred.

---

## 6. Severity-rated summary (R4 NEW)

| Severity | Count | Items |
|---|---|---|
| **CRIT** | 0 | (none — codebase is in honest, deliverable state) |
| **HIGH** | 2 | R4-H1 Apple gain map detection · R4-H2 ICC chromaticity-based gamut detection |
| **MED** | 5 | R4-M1 screen.colorGamut + Firefox · R4-M2 lightbox histogram · R4-M3 DCI-P3 label shorten · R4-M4 HEIF/HLG fixtures · R4-M5 mobile sheet IA reorder |
| **LOW** | 4 | R4-L1 LightboxColorPip extraction · R4-L2 mluc locale · R4-L3 ETag settings hash · R4-L4 humanize tightening |

Plus 3 promoted from cycle-8 deferred (now R4-H2, R4-M4, R4-M5).

---

## 7. What is correct (do not change)

R3 + 8 cycles of fixes have produced a remarkably mature codebase. Specifically:

- The HDR honesty model: schema columns admin-only, ingest rejected with localized error, no UI badge for legacy `is_hdr=true` rows on public surfaces.
- The chromaticity-correct DCI-P3 → Display P3 D65 Bradford adaptation.
- The wide-gamut WebP / JPEG (P3-tagged when source is wide-gamut, sRGB when `force_srgb_derivatives=true`).
- The 10-bit AVIF probe with graceful fallback.
- The 50 MP wide-gamut downscale gate.
- The ETag-based pipeline-version invalidation.
- The Service Worker cache strategy (50 MB LRU; no HDR-pass-through needed since no HDR variants).
- The OG route always-sRGB.
- The bidi/zero-width Unicode rejection on every admin-string input.
- The touch-target audit fixture-driven test enforcement.
- The Korean / English i18n coverage on all photographer-relevant labels.
- The forced-colors (Windows High Contrast) rules for HDR badge + P3 chip.
- The `useImperativeHandle` / `useSyncExternalStore` React 19 hook-rule compliance.
- The compile-time `_PrivacySensitiveKeys` guard.
- The `isP3Pipeline` / `isWideGamutPrimary` / `WIDE_GAMUT_PRIMARIES` / `COLOR_PIPELINE_DECISIONS` consolidations across 4-5 call sites each.
- The Promise-singleton AVIF probe + canvas-P3 probe.

---

## 8. Recommended next steps

The companion plan `.context/plans/48-photographer-r4-followup.md` orders work as:

**Phase A — High-impact photographer-intent fixes:**
1. R4-H1 Apple gain map detection (admin-only audit surface).
2. R4-H2 ICC chromaticity-based gamut detection (re-promoted from C8-D3).

**Phase B — Cross-browser / display capability:**
3. R4-M1 `screen.colorGamut` API integration + shared `useDisplayCapability` hook.
4. R4-M4 real HEIF/HLG/Rec.2020-CICP/custom-ICC test fixtures (re-promoted from C8-D7).

**Phase C — UX polish:**
5. R4-M2 lightbox histogram in slide-up panel.
6. R4-M3 DCI-P3 label shorten + tooltip.
7. R4-M5 mobile bottom-sheet IA reorder for non-trivial color (re-promoted from C8-D12).
8. R4-L1 extract LightboxColorPip to standalone component.

**Phase D — Forward architecture (separate plans / when WI-09 schedules):**
9. WI-09 readiness checklist consolidation.
10. Mastering metadata schema design.
11. JPEG XL output scoping.

**Phase E — Cosmetic:**
12. R4-L2 mluc locale-matched.
13. R4-L3 ETag settings hash.
14. R4-L4 humanize tightening.

Phase A is the only critical-path block (HIGH severity). Phases B-E can land in any order.

---

## 9. Open product questions for sign-off

1. **Apple gain map detection vs. transcode** (R4-H1). Detect-only and admit "delivered as SDR base only" honestly, OR scope a transcode path for WI-09. Recommendation: **detect-only now; transcode in WI-09**.
2. **Custom ICC chromaticity tolerance** (R4-H2). ΔE 0.005 (strict) vs. ΔE 0.01 (lenient). Recommendation: **0.005**, photographer-grade strict.
3. **`useDisplayCapability` hook scope** (R4-M1). Layer all three signals (screen.colorGamut + matchMedia + canvas-P3) or use just two? Recommendation: **all three**, in priority order.
4. **Lightbox histogram size** (R4-M2). Same 240×120 as sidebar, or smaller (e.g. 200×100) for fullscreen visual budget? Recommendation: **200×100 or responsive**.
5. **DCI-P3 label phrasing** (R4-M3). "Display P3 (from DCI-P3)" + tooltip vs. "Display P3" alone vs. keep current verbose. Recommendation: **shortened + tooltip**.
6. **Mobile sheet IA reorder threshold** (R4-M5). Reorder for any non-trivial color, or only for HDR + wide-gamut? Recommendation: **same threshold as ColorDetails accordion default-open** (per P3-25).
7. **WI-09 schedule** (forward-arch). Months out vs. start now? Recommendation: **gate on libvips upstream CICP write OR avifenc shell-out feasibility study; defer until product wants HDR delivery**.

---

## 10. Reference

- `.context/reviews/photographer-r4/{forward-architecture,cross-platform-color,latent-and-ux-residuals}.md` — per-angle.
- `.context/plans/48-photographer-r4-followup.md` — companion plan.
- Predecessor R3: `.context/reviews/photographer-r3/{_aggregate, color-fidelity, hdr-workflow, internal-formats, ui-ux-photographer}.md`.
- Predecessor cycle reviews: `.context/reviews/cycle{1..8}-rpf-photographer/`.
- Plans 36, 38, 47 (current) + done/43..46.

---

**Note for the reader:** this is the third pass of "as photographers" deep review. R3 found 4 CRIT + 7 HIGH; cycles 1-8 closed almost everything (last cycle: zero/zero). R4 finds 0 CRIT + 2 HIGH + 5 MED + 4 LOW. The HIGH items are **new angles** (Apple gain map, custom-monitor ICCs) the prior reviews did not cover. The product surface for the photographer-intent premise is in honest, deliverable state. Closing the R4 HIGHs would land it in unambiguously-best-in-class territory for self-hosted photo galleries.
