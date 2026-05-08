# Cycle 3 RPF — Color Fidelity Review

**Date:** 2026-05-08
**Reviewer perspective:** professional photographer + end-user-workflow.
**Scope:** color reproduction accuracy, ICC management, wide-gamut delivery, browser/display compatibility matrix.
**Predecessor reviews:** `.context/reviews/photographer-r3/color-fidelity.md`, `.context/reviews/cycle2-rpf-photographer/color-fidelity.md`.
**Master plan in flight:** `.context/plans/40-cycle2-rpf-photographer.md` (FULLY SHIPPED).

---

## State of the codebase entering cycle 3

All 7 cycle-2 implementation items (`C2-A1`..`C2-A7`) shipped in commits `239da472` (privacy guard test), `32f4fd79` (orphan i18n key removal), `6acf7674` (wide-gamut hint copy), `4c55bcba` (pipeline version history docstring), `0587d8d1` (sdr_jpeg_chroma + wide_gamut_max_source_pixels admin tunables), `b24b1c2e` (NCLX-vs-ICC precedence) plus `e07730dd` and `2f4a3021` (deslop / NCLX mapped-value fixtures + backfill A1/A2). Gates green: 131 test files / 1132 tests pass; eslint clean.

The four photographer-perspective HIGH/CRIT axes are all closed (Phase A and Phase B HIGH are 100 % shipped; Phase C MED items mostly shipped). The color-fidelity surface today:

- Source detection: ICC-name parser (with `mluc` UTF-16BE), bounded `colr` ISOBMFF walker, NCLX maps per ITU-T H.273. NCLX wins over ICC name on conflict (cycle 2 C2-A7).
- Pipeline decision: 7 canonical labels (`srgb`, `p3-from-displayp3`, `p3-from-dcip3`, `p3-from-adobergb`, `p3-from-prophoto`, `p3-from-rec2020`, `srgb-from-unknown`) all rendered through translated humanizer with clip-acknowledgement copy.
- DCI-P3 → Display P3 Bradford adaptation (WI-12). 50 MP wide-gamut downscale (WI-15). 10-bit AVIF probe (lazy, singleton, Promise-based — no race).
- Admin tunables: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `wide_gamut_max_source_pixels`, `avif_effort`, `force_srgb_derivatives`, `allow_hdr_ingest`, `force_show_color_chips`.
- Privacy: `is_hdr` / `transfer_function` / `matrix_coefficients` / `color_pipeline_decision` are admin-only; runtime test `map-privacy.test.ts` locks them out of `publicSelectFields`.
- HDR ingest: rejected by default; opt-in toggle `allow_hdr_ingest`; orphan `viewer.downloadHdrAvif` translation key deleted (will be re-added when WI-09 ships).

The codebase is **substantially better** than at cycle 2 entry. Cycle 3 surfaces residual polish opportunities and one architectural-symmetry concern, no CRIT, no HIGH.

---

## Findings (cycle 3)

### MED (3)

#### C3-COL-MED-1 — `humanizeTransferFunction` is not localized

**File:** `apps/web/src/components/color-details-section.tsx:20-30`.
**Severity:** MED.
**Confidence:** HIGH.

`humanizeTransferFunction` is a free function that returns hardcoded English-only strings (`'sRGB'`, `'Gamma 2.2'`, `'PQ (ST 2084)'`, `'HLG'`, `'Linear'`). Called by both `ColorDetailsSection` (sidebar + bottom-sheet) and `Lightbox` (`lightbox.tsx:90`). Korean photographers in the lightbox color-pip see the English transfer-function string next to the Korean primaries label, breaking the locale's tone.

The `humanizeColorPipelineDecision` helper takes a `t` callback for translation (`color-details-section.tsx:32-46`); the same pattern would apply here. Asymmetric design.

**Photographer impact:** at the moment the photographer is most likely to demo a photo to a client (lightbox), the audit pip mixes `BT.709` / `Gamma 2.2` (English) with `색 재현 영역` (Korean). Inconsistent.

**Fix shape:** convert `humanizeTransferFunction` to take a `t` callback (or move the rendering to the component using inline `t('viewer.transferGamma22')` keys); add corresponding keys to `messages/{en,ko}.json`. Update both call sites (`color-details-section.tsx:160`, `lightbox.tsx:90`).

**Tests:** add a fixture-style test in `__tests__/transfer-function-i18n.test.ts` that asserts every transfer value renders to a non-empty string in both locales.

#### C3-COL-MED-2 — `humanizeColorPrimaries` shares the same English-only flaw

**File:** `apps/web/src/components/color-details-section.tsx:8-18`.
**Severity:** MED.
**Confidence:** HIGH.

Same issue as C3-COL-MED-1 but for `colorPrimaries`. Returns `'BT.709'`, `'Display P3'`, `'DCI-P3'`, etc. — all English. Korean photographer sees `Color primaries / Display P3` mixed with translated `Transfer function / 전달 함수`. The labels themselves (BT.709, Display P3, DCI-P3) are arguably technical Latinate and DO NOT need translation, but the lightbox pip's leading display ("Display P3" or "BT.709") could use the Korean-friendly humanizer that returns `Display P3`/`광색역` paired form, or accept a `t` callback for parity with `humanizeColorPipelineDecision`.

The technical names are universally recognizable. **MEDIUM** confidence as a finding because it's a consistency / convention concern more than a hard miss.

**Fix shape:** either (a) add a `t` parameter for parity with `humanizeColorPipelineDecision`, OR (b) document inline that primaries names are Latinate-by-convention and don't need locale-specific rendering. Pick one and lock it via test.

#### C3-COL-MED-3 — `force_srgb_derivatives=true` does NOT force AVIF to sRGB

**File:** `apps/web/src/lib/process-image.ts:687-696, 795-835`.
**Severity:** MED.
**Confidence:** HIGH.

The setting is documented in admin help text as "force sRGB derivatives." But examine the code:

```ts
const avifDecision = resolveAvifIccProfile(iccProfileName, signals);
const isWideGamutSource = avifDecision === 'p3' || avifDecision === 'p3-from-wide';
const avifIcc: 'p3' | 'srgb' = isWideGamutSource ? 'p3' : 'srgb';
const targetIcc: 'p3' | 'srgb' = (isWideGamutSource && !forceSrgbDerivatives) ? 'p3' : 'srgb';
```

`avifIcc` doesn't read `forceSrgbDerivatives`. So when an admin enables `force_srgb_derivatives=true`, WebP and JPEG go to sRGB, but AVIF still emits P3 with the wide-gamut source's pixels reinterpreted as P3. The cycle-2 admin help text (`forceSrgbDerivatives` in `messages/{en,ko}.json`) does say "AVIF variants always carry their original gamut" — so this is documented behavior. But:

- The **setting label** is "Force sRGB derivatives" — which a paranoid e-commerce admin reads as "all derivatives go sRGB."
- The hint text does mention AVIF retains gamut, but in two locales the photographer audits at a time. R3-M3 in the master review classified this MED.

**Photographer impact:** an admin who flips this setting expecting fully-sRGB output (e.g. for legacy Canvas screenshot workflows) is surprised when their AVIF still carries P3 — and if the consuming pipeline downstream doesn't honor ICC, the P3 pixels look desaturated.

**Fix options:**
- (a) Honor `forceSrgbDerivatives` for AVIF too. Drop the AVIF-vs-WebP/JPEG asymmetry entirely. Simpler mental model. Loses the "AVIF is always full gamut" property.
- (b) Rename the setting to `force_srgb_jpeg_webp` (more accurate) and document the AVIF carve-out clearly.
- (c) Add a separate `force_srgb_avif` setting so the admin has explicit control over each.

Recommendation: **(b)** — keep the existing semantics, rename + clarify the label. The AVIF-always-P3 default is the right photographer-default. The current label is the issue.

**Tests:** existing `force-srgb-derivatives.test.ts` covers behavior. Add an admin-UI / settings copy lock if the rename is implemented.

---

### LOW (4)

#### C3-COL-LOW-1 — `isWideGamutSource` regex is duplicated across files

**Files:** `apps/web/src/components/photo-viewer.tsx:194`, `apps/web/src/lib/process-image.ts:688`, `apps/web/src/components/histogram.tsx:41`, `apps/web/src/app/actions/images.ts:273`.
**Severity:** LOW.
**Confidence:** HIGH.

Each file independently defines `WIDE_GAMUT_PRIMARIES = new Set(['p3-d65', 'bt2020', 'adobergb', 'prophoto', 'dci-p3'])` or its inline array equivalent. Adding a new wide-gamut primary (e.g. `'rec2100'` for HDR variants when WI-09 ships) means hunting every site.

**Fix shape:** centralize in `apps/web/src/lib/color-detection.ts` as a named export:

```ts
export const WIDE_GAMUT_PRIMARIES: ReadonlySet<ColorSignals['colorPrimaries']> = new Set([
    'p3-d65', 'bt2020', 'adobergb', 'prophoto', 'dci-p3'
]);

export function isWideGamutPrimary(p: string | null | undefined): boolean {
    return Boolean(p && (WIDE_GAMUT_PRIMARIES as Set<string>).has(p));
}
```

Then replace the 4 inline sites. Lock via test.

**Photographer impact:** none directly. Drift risk for future maintenance.

#### C3-COL-LOW-2 — `getAvifSupported()` first-call returns false until image probe resolves; never re-evaluated

**File:** `apps/web/src/components/histogram.tsx:44-53`.
**Severity:** LOW.
**Confidence:** MEDIUM.

The cached AVIF probe pattern returns `false` on first call (before the `<img>` onload fires). It populates `_cachedAvifSupported` on next eventloop tick. Caller does:

```ts
const avifSupported = getAvifSupported();
const preferAvif = isWideGamut && avifSupported && getSupportsCanvasP3() && Boolean(avifUrl);
```

On the very first wide-gamut image render in a session, `avifSupported = false`, so `preferAvif = false`, so the histogram pulls the JPEG / WebP URL even on AVIF-capable browsers, and `isClipped = true` shows the "(sRGB clipped)" hint. The hint flips off on the NEXT navigation when `_cachedAvifSupported` has resolved. Visible UX tic.

**Fix shape:** convert to Promise-based singleton (same pattern used for `_highBitdepthAvifProbePromise` in `process-image.ts:53-78`). The histogram useEffect can `await getAvifSupportedAsync()` and trigger a re-render when the probe resolves.

OR: probe synchronously at module init using a `<link rel=preload as=image>` or `HTMLCanvasElement`-based decode (limited browser support but fast).

OR: set `avifSupported = true` optimistically since AVIF is widely supported (Chrome 85+, Firefox 113+, Safari 16+). Let the `<img>.onerror` invalidate the assumption only if it fires.

Recommendation: **synchronous optimistic default + onerror invalidation** — simplest with the least UX flicker.

**Photographer impact:** first wide-gamut photo audit in a session shows misleading "(sRGB clipped)" hint. Bounded to the very first page load.

#### C3-COL-LOW-3 — `forceShowColorChips` flag scope is global via `data-force-show-color-chips` attribute on `<html>`

**File:** `apps/web/src/components/photo-viewer.tsx:296-301`.
**Severity:** LOW.
**Confidence:** MEDIUM.

The setting is read from gallery config and applied as a `data-` attribute on `document.documentElement`. The CSS rule (presumably) keys off `[data-force-show-color-chips="true"]` to bypass the `@media (color-gamut: p3)` gate.

The cleanup `useEffect` removes the attribute on unmount. But the attribute is set/cleared inside `PhotoViewer` only — admin pages and other surfaces (e.g. the masonry grid, image manager) don't render it. So `force_show_color_chips=true` is honored only inside the photo viewer route. Other surfaces (e.g. an admin-side gallery thumbnail with a P3 chip) won't see it.

**Photographer impact:** if a photographer wants to demo "(P3)" chips on a non-P3 client laptop and stays on the home grid, the chips don't show; only when they click into a photo does the chip appear. Mostly aligned with the use case (photographer demos at the photo level).

**Fix shape:** if the admin intent is "always show chips wherever rendered," hoist the attribute setter into the locale layout (`app/[locale]/layout.tsx`) so it's set globally per-render. If the intent is "show in viewer only," the current implementation is correct and could be documented inline.

Recommendation: **document inline as photo-viewer-scoped** unless future telemetry shows photographers demoing on the grid.

#### C3-COL-LOW-4 — `_omit*` discard variables use formatter-fragile inline `eslint-disable`

**File:** `apps/web/src/lib/data.ts:307-318, 339-350`.
**Severity:** LOW.
**Confidence:** HIGH.

Carry-forward from cycle 2's `C2-D11`. Each omitted-from-public-fields entry uses:

```ts
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- P3-3: transfer_function is admin-only
transfer_function: _omitTransferFunction,
```

Prettier rewrites can split the comment from the line, breaking the disable. Cycle 2 deferred this to "when `data.ts` is refactored for any other reason."

**Fix shape:** rename the discards to `_*` prefix style (matching project convention) and configure ESLint to ignore underscore-prefixed unused vars at config level (`varsIgnorePattern: '^_'`). This is already configured (every discard begins with `_omit`). The `eslint-disable-next-line` comments are then redundant and can be deleted.

**Verification:** `eslint apps/web/src/lib/data.ts` after removing the comments. If it passes, the comments were redundant.

---

### Photographer-axis re-confirmation

The 7 photographer priority axes from the cycle brief, verified against the codebase as of cycle-3 entry:

| # | Axis | State | Notes |
|---|---|---|---|
| 1 | Color reproduction accuracy | GOOD | Bradford D65 adaptation for DCI-P3, rgb16 pipeline for wide-gamut, ETag invalidation on encoder change |
| 2 | ICC profile / management | GOOD | bounded `mluc` UTF-16BE parser, ICC-vs-NCLX precedence (cycle 2 C2-A7), strict P3 allowlist for AVIF |
| 3 | HDR workflow | HONEST | ingest rejected by default, badge admin-only, no 404 download menu, `viewer.downloadHdrAvif` orphan deleted |
| 4 | Wide color gamuts | GOOD | P3 / AdobeRGB / ProPhoto / Rec.2020 source paths covered, audit labels acknowledge clip on AdobeRGB→P3 / ProPhoto→P3 / Rec.2020→P3 |
| 5 | Display color primitives + browser support | GOOD | canvas-P3 runtime probe (P3-6), `<picture>` srcset for AVIF/WebP/JPEG, P3-tagged AVIF for wide-gamut sources |
| 6 | Internal color formats | GOOD | 10-bit AVIF (lazy probe, singleton), 4:4:4 wide-gamut JPEG (admin-tunable), 4:2:0 SDR JPEG (admin-tunable) |
| 7 | UI/UX of audit surfaces | GOOD | accordion default-open for non-trivial sources, lightbox color pip, P3 / HDR badges, admin-only HDR badge, `force_show_color_chips` admin opt-in |

No regression observed.

---

## Convergent findings (this round)

None — the 7 findings above are single-angle. C3-COL-MED-1 / C3-COL-MED-2 are the same locale-coverage concern from two angles (humanizers).

---

## Provenance

This file is the color-fidelity angle of the cycle-3 RPF photographer review. Per the cycle brief, the review is performed by the orchestrator across photographer-perspective axes. No Agent subagents are registered for this repo beyond `~/.claude/agents/perf-reviewer.md`; the multi-angle fan-out is therefore performed as focused single-orchestrator passes, one per angle.
