# Latent Issues + UI/UX Residuals (R4)

**Date:** 2026-05-08
**Premise:** photos arrive AFTER editing. Find concrete file:line bugs and UI/UX residuals that escaped R3 + 8 cycles + cycle 9 convergence.
**Scope:** code-correctness latents · UI/UX gaps · photographer tooling.

---

## 0. State of UX (post-cycle-9)

The audit-surface UX has matured through plan-37 + plan-38 + cycles 1-8. Confirmed:

- ColorDetailsSection accordion (default-open for non-trivial color, P3-25 ✓).
- Calibration tooltip is sibling button, keyboard + SR + tap accessible ✓.
- HDR badge gradient amber→orange ✓.
- LightboxColorPip with HDR badge ✓.
- Source bit depth + delivered bit depth co-located ✓.
- Delivered formats chips (WebP / AVIF / JPEG) ✓.
- WideGamutHint (P3-8) shows on sRGB displays for wide-gamut photos ✓.
- `force_show_color_chips` admin opt-in ✓.
- Korean translations for all photographer-relevant labels ✓.
- Touch-target audit fixture-driven (1239/1239 vitest green) ✓.

What follows are the residual / new findings under fresh inspection.

---

## LATENT-L1 — `extractIccProfileName` `mluc` branch returns first record always

### Code

`apps/web/src/lib/icc-extractor.ts:63-82`:

```ts
if (descType === 'mluc') {
  // Multi-localized Unicode: type/reserved, record count, record
  // size, then records. Text is UTF-16BE per ICC, not UTF-16LE.
  const numRecords = Math.min(icc.readUInt32BE(dataOffset + 8), 100);
  const recordSize = icc.readUInt32BE(dataOffset + 12);
  if (recordSize < 12) break;
  const recordsStart = dataOffset + 16;
  for (let recordIndex = 0; recordIndex < numRecords; recordIndex++) {
    const recOffset = recordsStart + recordIndex * recordSize;
    if (recOffset + 12 > iccLen || recOffset + 12 > dataOffset + dataSize) break;
    const recLen = Math.min(icc.readUInt32BE(recOffset + 4), 1024);
    const recTextOffset = icc.readUInt32BE(recOffset + 8);
    const strStart = dataOffset + recTextOffset;
    const strEnd = strStart + recLen;
    if (strEnd > iccLen || strEnd > dataOffset + dataSize || strStart >= strEnd) continue;
    const decoded = decodeUtf16BE(icc.subarray(strStart, strEnd));
    const cleaned = cleanString(decoded);
    if (cleaned) return cleaned;
  }
}
```

### Finding

The loop returns the first non-empty record. ICC v4 spec (ISO 15076-1:2010 §10.13): each record has a 2-byte language code + 2-byte country code at the start (offsets +0 and +2 within the 12-byte record header). The locale-aware path: pick the record whose language code matches the requested locale.

Today: always first record. Apple Display P3 ICC has en/ja/de/fr/zh records — we always read English.

### Photographer-intent impact

For Korean photographers viewing the Color Details panel, the ICC name shows in English ("Display P3"). Per cycle-3 D2 convention, primaries names stay Latinate so this is acceptable in practice. But:

- For a custom monitor profile with `ko-KR` and `en-US` records, we want the Korean record on Korean locale.
- For an enterprise photographer with multi-locale ICCs, the wrong locale shows.

### Severity

**LOW** — convention says Latinate names; only real impact on custom multi-locale ICCs.

### Fix shape

```ts
export function extractIccProfileName(
  icc?: Buffer | null,
  locale?: string,  // e.g. 'ko' or 'ko-KR' or 'en' or 'en-US'
): string | null {
  // ... existing ...
  if (descType === 'mluc') {
    // Try locale-matched record first
    if (locale) {
      const langCode = locale.slice(0, 2).toUpperCase(); // 'KO' / 'EN'
      // Walk records; if record.languageCode === langCode, prefer it
      for (let i = 0; i < numRecords; i++) {
        const recOffset = recordsStart + i * recordSize;
        const recLang = icc.toString('ascii', recOffset, recOffset + 2);
        if (recLang.toUpperCase() === langCode) {
          // Return this record's text
          // ...
        }
      }
    }
    // Fallback: first non-empty
    // ... existing loop ...
  }
}
```

Plumb the locale through `detectColorSignals` from the request context.

### Effort

XS.

### Acceptance

- [ ] Korean locale + multi-locale ICC: returns the Korean record.
- [ ] English locale: returns the English record.
- [ ] Single-record ICC (modal case, e.g. Apple Display P3 only-en): unchanged.
- [ ] Existing tests pass.

---

## LATENT-L2 — `humanizeColorPipelineDecision` parameter typed loose

(Cross-reference: cycle-8 deferred C8-D15.)

### Code

`apps/web/src/components/color-details-section.tsx:56-70`:

```ts
export function humanizeColorPipelineDecision(
  value: string | null | undefined,
  t: (key: string) => string,
): string {
  switch (value) { /* ... */ }
}
```

### Finding

`value` is `string | null | undefined`. Could be the strict `ColorPipelineDecision | null | undefined` since the DB column is constrained to the enum.

C8-D15 noted: defensive typing because the DB column is `varchar(64)` — could in principle be any string. Future-strictness migration would lock the column to the enum (e.g. via CHECK constraint).

### Severity

**LOW** (cosmetic).

### Fix shape

Tighten the parameter type:

```ts
import type { ColorPipelineDecision } from '@/lib/color-pipeline-decisions';

export function humanizeColorPipelineDecision(
  value: ColorPipelineDecision | null | undefined,
  t: (key: string) => string,
): string {
  // ...
}
```

Callers may need a type assertion at the boundary if the DB column type isn't already tight.

### Effort

XS.

---

## LATENT-L3 — `process-image.ts:24` exports type but the type-only import below is redundant

### Code

```ts
import type { ColorPipelineDecision } from '@/lib/color-pipeline-decisions';
export type { ColorPipelineDecision } from '@/lib/color-pipeline-decisions';
export { COLOR_PIPELINE_DECISIONS } from '@/lib/color-pipeline-decisions';
```

### Finding

The `import type` and `export type` lines reference the same source. Could collapse to a single `export type { ColorPipelineDecision }` and reference `ColorPipelineDecision` via the `@/lib/color-pipeline-decisions` import elsewhere. Cosmetic.

### Severity

**LOW** (cosmetic, pre-existing pattern).

---

## UX-M1 — Lightbox slide-up panel has no histogram

### Code

`apps/web/src/components/lightbox.tsx:78-200` (`LightboxColorPip` + expanded panel).

### Finding

The closed pip shows gamut + HDR badge. The expanded panel shows ICC name, primaries, transfer function, decision (admin), and HDR badge. **No histogram.**

### Photographer-intent impact

Photographer demoing in fullscreen mode wants to read exposure (clip blink, % below black, % above white). Without histogram in lightbox, they have to:
1. Press Esc to leave fullscreen.
2. Click the Info pin to open the sidebar.
3. Scroll to find the histogram.
4. Then re-enter fullscreen.

Multi-step interruption of the demo flow.

R3 P3-16 originally specified "tap reveals slide-up panel with full color metadata + histogram + download buttons." Cycles 3-5 implemented gamut + HDR + decision. Histogram was scoped out (likely for component reuse complexity — Histogram has a Web Worker dependency).

### Severity

**MED**.

### Fix shape

Render `<Histogram>` inside the LightboxColorPip expanded panel:

```tsx
{open && (
  <div className="lightbox-color-pip-panel ...">
    {/* existing gamut / primaries / transfer / decision / HDR */}
    {image.filename_jpeg && (
      <Histogram
        imageUrl={imageUrl(`/uploads/jpeg/${jpegSized}.jpg`)}
        avifUrl={...}
        colorPrimaries={image.color_primaries}
        className="w-[200px] mt-2"
      />
    )}
  </div>
)}
```

Caveat: Histogram component constructs a Web Worker on mount. In the lightbox (which mounts/unmounts on toggle), this incurs worker spawn latency. Mitigation: lazy-mount the Histogram via `<Suspense>` + dynamic import; or memoize the worker by hoisting to a parent.

### Effort

S.

### Acceptance

- [ ] Lightbox tap pip → expanded panel includes a 200×100 (or responsive) histogram.
- [ ] Histogram mode cycles via `h` key while in lightbox.
- [ ] Worker spawn doesn't impact tap-to-open latency (lazy mount).
- [ ] No regression on lightbox navigation / slideshow.

---

## UX-M2 — DCI-P3 audit label is verbose

### Code

`messages/en.json` — `viewer.colorPipelineP3FromDcip3: "Display P3 (from DCI-P3, D65 adapted)"`.

### Finding

This is the longest label among `humanizeColorPipelineDecision` outputs. It occupies a full row width in the Color Details accordion grid (which is `grid-cols-2`). For wide-gamut photo with both ICC name + primaries + transfer + decision rows, the layout gets cramped.

### Severity

**MED** (visual budget).

### Fix shape

Shorten to "Display P3 (from DCI-P3)". Add a tooltip on the label: "white point adapted from DCI to D65 via Bradford CAT" — for admins / curious users who want the technical detail. The tooltip is admin-relevant, so it can be more verbose.

i18n update:
- en: `colorPipelineP3FromDcip3: "Display P3 (from DCI-P3)"`, new key `colorPipelineP3FromDcip3Tooltip: "White point adapted from DCI white (0.314, 0.351) to D65 (0.3127, 0.3290) via Bradford chromatic adaptation."`
- ko: `colorPipelineP3FromDcip3: "Display P3 (DCI-P3 원본)"`, `colorPipelineP3FromDcip3Tooltip: "DCI 백색점(0.314, 0.351)에서 D65(0.3127, 0.3290)로 Bradford 색채 적응을 통해 변환되었습니다."`

### Effort

XS.

---

## UX-M3 — Mobile bottom-sheet IA reorder for non-trivial color: NOT landed

(Cross-reference: aggregate R4-M5 / cycle-8 deferred C8-D12.)

### Code

`apps/web/src/components/info-bottom-sheet.tsx:255-505` expanded sheet content order:

1. Tags
2. Description
3. EXIF section header + grid (16+ rows: camera, lens, focal, aperture, shutter, ISO, dimensions, format, WB, metering, EC, EP, flash, GPS)
4. Color Details accordion
5. Histogram
6. Capture date
7. Download dropdown

### Finding

For the modal P3 + HDR audience on mobile (iPhone 15 Pro), Color Details + Histogram + Download are the high-value blocks. They're below the fold of the sheet at peek state and require scrolling past 16+ EXIF rows in expanded state.

R3 P3-28 specified Option A: for non-trivial color sources, reorder to Color Details / Histogram / Download → EXIF. Cycle plans don't show this implemented.

### Severity

**MED**.

### Fix shape

Conditional render order. Use the same `isNonTrivialColor` predicate as P3-25:

```tsx
const isNonTrivialColor = Boolean(
  (image.color_primaries && image.color_primaries !== 'bt709') ||
  (isAdmin && image.transfer_function && (image.transfer_function === 'pq' || image.transfer_function === 'hlg')) ||
  (image.color_pipeline_decision && image.color_pipeline_decision !== 'srgb')
);

return (
  <div ...>
    {/* Tags, description, capture date — always at top */}

    {isNonTrivialColor ? (
      <>
        <ColorDetailsSection ... />
        <Histogram ... />
        {downloadDropdown}
        <ExifGrid />
      </>
    ) : (
      <>
        <ExifGrid />
        <ColorDetailsSection ... />
        <Histogram ... />
        {downloadDropdown}
      </>
    )}
  </div>
);
```

### Effort

S.

### Acceptance

- [ ] Wide-gamut / HDR photo: mobile sheet shows Color Details / Histogram / Download above EXIF.
- [ ] sRGB photo: unchanged order (EXIF first).
- [ ] No regression on sheet drag / scroll behavior.
- [ ] Snapshot fixture covers both branches.

---

## UX-L1 — `LightboxColorPip` is inline in lightbox.tsx, not a separate file

### Code

`apps/web/src/components/lightbox.tsx:78-200`. Convention drift: `ColorDetailsSection` is a standalone component file; `LightboxColorPip` is an internal component.

### Finding

For testability + reuse, extract to `apps/web/src/components/lightbox-color-pip.tsx`. The cycle-3 / cycle-5 commits ✓ shipped the inline form; the extraction is a follow-up cleanup.

### Severity

**LOW** (cosmetic).

### Fix shape

`git mv` not applicable since it's not a separate file yet. Extract:

```ts
// new file: lightbox-color-pip.tsx
'use client';
import { ... } from '...';

interface LightboxColorPipProps { /* ... */ }

export default function LightboxColorPip({ ... }: LightboxColorPipProps) {
  /* moved from lightbox.tsx */
}
```

Update `lightbox.tsx`:

```diff
+ import LightboxColorPip from '@/components/lightbox-color-pip';
- function LightboxColorPip(...) { ... }
```

The existing `__tests__/lightbox-color-pip-hdr.test.ts` already source-inspects `lightbox.tsx`. Update the path to the new file.

### Effort

XS.

---

## UX-L2 — Touch-target audit doesn't explicitly catch LightboxColorPip pip height

(Cross-reference: cross-platform-color CP-L1.)

### Code

`apps/web/src/components/lightbox.tsx` — the LightboxColorPip closed-state pip uses `px-3 py-1.5 text-xs` on a raw `<button>`. Total height ≈ 30 px. Below the 44 px floor.

The touch-target audit catches `<button className="...h-8...">` and `<Button size="sm">` patterns but doesn't catch raw `<button>` with arbitrary padding.

### Severity

**MED** (a11y).

### Fix shape

Add `min-h-11` to the LightboxColorPip pip className:

```diff
-className="lightbox-color-pip flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs ..."
+className="lightbox-color-pip flex items-center gap-1.5 rounded-full bg-black/70 px-3 min-h-11 text-xs ..."
```

### Effort

XS.

### Acceptance

- [ ] LightboxColorPip pip ≥ 44 px tall.
- [ ] Touch-target audit fixture extended to verify the pip.
- [ ] Visual smoke: pip stays compact-feeling despite taller min-height (use `inline-flex items-center` so the icon + text sit centered).

---

## UX-L3 — `<Histogram>` inside ColorDetailsSection has fixed 240×120 dimensions

### Code

`apps/web/src/components/histogram.tsx:360`:

```tsx
<div className="relative w-[240px] h-[120px] bg-black/20 rounded overflow-hidden">
```

### Finding

Fixed 240×120 px. On a narrow mobile viewport (iPhone SE 320px), the sidebar / sheet has limited horizontal space — the histogram fits, but the surrounding text wraps awkwardly.

C8-D10 noted: "histogram canvas not responsive". Re-promote? On further reflection, for a 240px-fixed canvas in a 320px-wide sheet, the visual is fine. **Keep deferred.**

### Severity

**LOW** (cosmetic).

---

## UX-L4 — Color Details accordion `pl-6` was removed in cycle 4 — verify no regression

### Code

`apps/web/src/components/color-details-section.tsx:166`:

```tsx
<div id={colorDetailsId} className="grid grid-cols-2 gap-y-3 gap-x-2 text-sm mt-2 transition-all">
```

(No `pl-6`.) ✓ Good — matches the EXIF grid horizontal alignment.

---

## UX-L5 — Photographer tooling gaps (out-of-scope confirmation)

The task brief excludes "edit / culling / scoring functions." Several tools that pro photographers expect are explicitly out-of-scope:

- ❌ Soft-proof / target-display preview ("show me what this looks like on a sRGB / P3 / HDR / paper target") — out-of-scope.
- ❌ Comparison view between adjacent photos (exposure consistency review) — out-of-scope.
- ❌ Photo-bound calibration patches (step-wedge or color checker overlay) — out-of-scope.
- ❌ Print proof / paper preview — out-of-scope.
- ❌ Custom rendering intent per-photo (perceptual / saturated / relative-colorimetric) — deferred via P3-13 family.

These are reaffirmed out-of-scope and listed for completeness. No plan entries.

---

## UX-L6 — "Copy color metadata" affordance still missing

### Code

None — the affordance does not exist.

### Finding

Pro photographers writing forum posts, support tickets, or email signatures want a one-click way to copy the color audit as JSON or as a formatted string. Today the photographer has to manually transcribe each row.

### Severity

**LOW** (workflow polish).

### Fix shape

Add a small "copy" icon button next to the Color Details header. Click → JSON.stringify the relevant fields → clipboard via `navigator.clipboard.writeText`. Toast confirmation.

```tsx
<button
  type="button"
  onClick={async () => {
    const data = {
      iccProfileName: image.icc_profile_name,
      primaries: image.color_primaries,
      transfer: image.transfer_function,
      decision: image.color_pipeline_decision,
      isHdr: image.is_hdr,
      sourceBitDepth: image.bit_depth,
    };
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast.success(t('viewer.colorMetadataCopied'));
  }}
  aria-label={t('viewer.copyColorMetadata')}
  className="ml-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full ..."
>
  <Copy className="h-4 w-4" />
</button>
```

i18n keys:
- en: `copyColorMetadata: "Copy color metadata"`, `colorMetadataCopied: "Color metadata copied"`
- ko: `copyColorMetadata: "색상 메타데이터 복사"`, `colorMetadataCopied: "색상 메타데이터가 복사되었습니다"`

### Effort

XS.

---

## UX-L7 — `c` and `h` keyboard shortcuts dead on mobile

(Cross-reference: cycle-8 deferred C8-D11.)

### Finding

`c` toggles ColorDetails accordion; `h` cycles histogram mode. Both are keyboard-only — useless on mobile (no physical keyboard).

### Severity

**LOW** (acceptable; keyboard shortcuts are a desktop affordance).

**Keep deferred.**

---

## UX-L8 — `humanizeColorPrimaries` returns Latinate names un-translated

### Code

`color-details-section.tsx:18-28`. Returns `'BT.709' | 'Display P3' | 'DCI-P3' | 'Rec. 2020' | 'Adobe RGB' | 'ProPhoto RGB'` for all locales.

### Finding

Established convention per cycle-3 D2: primaries names stay Latinate; only transfer functions get translated.

For Korean photographers, the convention reads as English jargon mixed with Korean labels ("색 공간: Display P3"). Acceptable per technical-term convention.

### Severity

**LOW** (convention-locked, no change recommended).

---

## Severity-rated summary (latent + UX track)

| ID | Severity | Effort |
|---|---|---|
| LATENT-L1 (mluc locale-matched) | LOW | XS |
| LATENT-L2 (humanize tightening) | LOW | XS |
| LATENT-L3 (process-image cosmetic export) | LOW | XS |
| UX-M1 (lightbox histogram in panel) | MED | S |
| UX-M2 (DCI-P3 label shorten) | MED | XS |
| UX-M3 (mobile sheet IA reorder) | MED | S |
| UX-L1 (extract LightboxColorPip) | LOW | XS |
| UX-L2 (touch-target on pip) | MED | XS |
| UX-L3 (histogram responsive) | LOW | DEFERRED |
| UX-L4 (verified — no action) | NONE | — |
| UX-L5 (out-of-scope tooling) | NONE | — |
| UX-L6 (copy color metadata) | LOW | XS |
| UX-L7 (mobile keyboard shortcuts) | LOW | DEFERRED |
| UX-L8 (humanizeColorPrimaries Latinate) | NONE | — |

Net new actionable: 1 latent + 6 UX (3 MED + 3 LOW).

---

## Out of scope (per task premise)

- Edit / culling / scoring features.
- Soft-proof / target-display preview.
- Comparison view between adjacent photos.
- Photo-bound calibration patches.
- Print proof.
- Custom rendering intent UI.
