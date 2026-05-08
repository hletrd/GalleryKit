# Cycle 1 RPF (review-plan-fix) — Photographer Perspective Aggregate

**Date:** 2026-05-08
**Cycle:** 1/100
**Reviewer perspective:** professional photographer + end-user-workflow.
**Predecessor reviews:** `.context/reviews/photographer-r3/_aggregate.md` (R3 round, 4 critical and 7 high findings, mostly addressed by Phase A and B work that has already shipped).
**Master plan in flight:** `.context/plans/38-photographer-r3-followup.md` (33 work items P3-1..P3-33).

---

## Executive summary

Phase A (P3-1, P3-2, P3-3) and most of Phase B (P3-4..P3-7, P3-15, P3-16, P3-25) of plan-38 have shipped on master, plus several Phase C/D items (P3-9, P3-14, P3-18, P3-19, P3-26, etc.). The codebase is in much better shape than the photographer-r3 round found it.

**However, this cycle's gate run uncovered fresh blocking lint errors introduced by recent UI work** that ship the photographer-audit surface — exactly the surface the photographer-perspective brief prioritizes. The errors are React 19 hook rules (`react-hooks/refs`, `react-hooks/set-state-in-effect`) and they block CI. They are NEW findings, not duplicates of any photographer-r3 entry.

This review records:

1. **Gate-blocking findings (CRIT)** — must be fixed in Phase A of cycle 1.
2. **Photographer-perspective findings still open** — items from plan-38 that have NOT yet shipped (P3-8, P3-10, P3-11, P3-12, P3-13, P3-17, P3-20, P3-21, P3-22, P3-23, P3-24, P3-27..P3-33).
3. **Cross-cutting risks** uncovered while reading the recent commits against the photographer-intent premise.

---

## State of gates (cycle 1 baseline)

| Gate | Status | Note |
|---|---|---|
| `lint` (eslint) | **FAILING** | 3 errors, 1 warning (this cycle's finding C1-CRIT-1, C1-CRIT-2, C1-CRIT-3) |
| `lint:api-auth` | PASS | |
| `lint:action-origin` | PASS | |
| `vitest` | PASS | 131 files / 1130 tests |
| `build` | (pending while ESLint blocks) | |

Build will be re-run after lint is fixed; build cannot run if `next build` runs lint internally and fails first. The errors must be fixed before `npm run deploy` can succeed.

---

## C1-CRIT — gate-blocking lint errors (NEW this cycle)

### C1-CRIT-1 — `color-details-section.tsx:74` — Cannot update ref during render

**Severity:** CRIT (blocks lint gate; deploy gate cannot pass).
**Photographer-axis:** UI-UX of the audit surface (Color Details accordion is THE photographer-intent surface).

**Code:**
```tsx
// apps/web/src/components/color-details-section.tsx:73-75
if (toggleRef) {
    toggleRef.current = () => setShowColorDetails((prev) => !prev);
}
```

**Why it's a problem:** React 19 strict rule `react-hooks/refs` — ref `current` must not be assigned during render. Mutating during render breaks concurrent rendering, can drop or duplicate the imperative handle if React re-renders mid-commit, and is undefined behavior under `<StrictMode>` mount/unmount/mount.

**Failure scenario:** when the photo viewer's `c` keyboard shortcut fires (`photo-viewer.tsx:344`) during a concurrent re-render, `colorDetailsToggleRef.current` could be a stale closure that toggles the wrong state, or `null` if the ref assignment was suspended. Photographer hits `c`, accordion does not respond.

**Fix:** Replace the bare `if (toggleRef) { toggleRef.current = ... }` pattern with `useImperativeHandle` (the React-canonical way to expose imperative methods to a parent ref):

```tsx
// Replace lines 60-75 with:
import { useImperativeHandle } from 'react';

interface ColorDetailsSectionProps {
    image: ImageDetail;
    isAdmin?: boolean;
    t: (key: string) => string;
    toggleRef?: React.RefObject<(() => void) | null>;
}

export default function ColorDetailsSection({ image, isAdmin = false, t, toggleRef }: ColorDetailsSectionProps) {
    const isHdr = image.transfer_function === 'pq' || image.transfer_function === 'hlg';
    const isNonTrivialColor = Boolean(
        (image.color_primaries && image.color_primaries !== 'bt709') ||
        (isAdmin && isHdr) ||
        (image.color_pipeline_decision && image.color_pipeline_decision !== 'srgb'),
    );
    const [showColorDetails, setShowColorDetails] = useState(isNonTrivialColor);

    useImperativeHandle(toggleRef, () => () => setShowColorDetails((prev) => !prev), []);
    ...
}
```

`useImperativeHandle` runs after commit and is the React-blessed way. Functional component support has shipped since React 19 (no `forwardRef` wrapper needed).

**Confidence:** High.

---

### C1-CRIT-2 — `histogram.tsx:384` — Cannot update ref during render

**Severity:** CRIT.
**Photographer-axis:** UI-UX of the audit surface (histogram is the photographer's exposure-verification tool).

**Code:**
```tsx
// apps/web/src/components/histogram.tsx:383-385
if (cycleModeRef) {
    cycleModeRef.current = cycleMode;
}
```

**Why it's a problem:** Same React 19 rule as C1-CRIT-1.

**Failure scenario:** photographer hits `h` to cycle the histogram mode (luma → RGB → R → G → B → luma). The keyboard shortcut handler reads `histogramCycleRef.current` from the photo-viewer; if React was mid-concurrent-render the handler runs a stale `cycleMode` callback that closes over the wrong `mode` value, the histogram skips a mode or no-ops.

**Fix:** Same `useImperativeHandle` migration:

```tsx
useImperativeHandle(cycleModeRef, () => cycleMode, [cycleMode]);
```

**Confidence:** High.

---

### C1-CRIT-3 — `wide-gamut-hint.tsx:18` — Calling setState synchronously within an effect

**Severity:** WARNING (in lint output) but treated CRIT here because plan-38 keeps the wide-gamut-hint surface as part of P3-8 ("display can't show full saturation" hint). Functional.
**Photographer-axis:** Wide-gamut delivery + display capability detection (R3-M2 in photographer-r3 aggregate; one of the photographer-intent axes).

**Code:**
```tsx
// apps/web/src/components/wide-gamut-hint.tsx:14-26
const [isSrgbDisplay, setIsSrgbDisplay] = useState(false);

useEffect(() => {
    const mq = window.matchMedia('(color-gamut: p3)');
    setIsSrgbDisplay(!mq.matches);                  // <-- WARNING (cascading render)

    const handler = (e: MediaQueryListEvent) => {
        setIsSrgbDisplay(!e.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
}, []);
```

**Why it's a problem:** the `setIsSrgbDisplay(!mq.matches)` immediate setState in the effect body causes a second render right after mount, which is the cascading-render anti-pattern flagged by `react-hooks/set-state-in-effect`. The recommended pattern for matchMedia is `useSyncExternalStore`.

**Fix:** Replace with `useSyncExternalStore` (React 18+ canonical pattern for external subscription state). This eliminates the initial cascading render AND keeps the same SSR-safe story:

```tsx
'use client';

import { useSyncExternalStore } from 'react';

const WIDE_GAMUT_PRIMARIES = new Set(['p3-d65', 'bt2020', 'adobergb', 'prophoto', 'dci-p3']);

interface WideGamutHintProps {
    colorPrimaries?: string | null;
    t: (key: string) => string;
}

function subscribeToP3Mq(callback: () => void): () => void {
    const mq = window.matchMedia('(color-gamut: p3)');
    mq.addEventListener('change', callback);
    return () => mq.removeEventListener('change', callback);
}
function getP3Snapshot(): boolean {
    return window.matchMedia('(color-gamut: p3)').matches;
}
function getServerSnapshot(): boolean {
    // Default to true (P3-capable); the hint shows only when isSrgbDisplay=true,
    // and rendering nothing on the server is the safe default for an SDR-only hint.
    return true;
}

export default function WideGamutHint({ colorPrimaries, t }: WideGamutHintProps) {
    const isWideGamut = Boolean(colorPrimaries && WIDE_GAMUT_PRIMARIES.has(colorPrimaries));
    const isP3Display = useSyncExternalStore(subscribeToP3Mq, getP3Snapshot, getServerSnapshot);
    const isSrgbDisplay = !isP3Display;

    if (!isWideGamut || !isSrgbDisplay) return null;
    return (
        <div className="mt-2 px-3 py-2 text-xs rounded bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800/40">
            {t('viewer.wideGamutHint')}
        </div>
    );
}
```

**Confidence:** High.

---

## Open photographer-perspective findings (carry-forward from plan-38)

These plan-38 items have NOT shipped yet (no commit references them in `git log`). They remain on the priority queue. None are gate-blocking. None need to be re-recorded as new findings — they are tracked in `.context/plans/38-photographer-r3-followup.md`.

| Plan ID | Severity | Status |
|---|---|---|
| P3-8 — wide-gamut hint copy improvements | MED | Component shipped (`wide-gamut-hint.tsx`) but copy and translations not finalized; P3-8's acceptance is broader (admin opt-in to force show) |
| P3-10 — chip contrast bump | MED | Partially shipped (`7f059a72`); verify against WCAG 4.5:1 |
| P3-11 — colorSignals NCLX fallback | MED | Shipped (`86dab813`) — verify with test |
| P3-12 — HDR/Rec.2020 test fixtures | MED | Open — fixture files needed |
| P3-13 — ICC TRC-based HDR detection | MED | Open |
| P3-17 — drop `!important` on `.hdr-badge` | MED | Shipped (`7f059a72`) |
| P3-18 — render badge based on `transfer_function` | MED | Shipped (`caefaf37`) |
| P3-19 — extract `_hdr.avif` filename helper | MED | Shipped (`caefaf37`) |
| P3-20 — admin setting `wide_gamut_jpeg_chroma` | MED | Shipped (`f76b8339`) |
| P3-21 — admin setting `avif_effort` | MED | Shipped (`f76b8339`) |
| P3-22 — "Delivered formats" row | MED | Shipped (`a6c802e1`) |
| P3-23 — pipeline version history docstring | LOW | Open |
| P3-24 — upload-time 50 MP cap warning | MED | Shipped (`a6c802e1`) |
| P3-26 — `force_show_color_chips` | MED | Shipped (`b3a597ee`, `16c24820`) |
| P3-27 — deduplicate `(P3)` chip | MED | Shipped (`2a177793`) |
| P3-28 — mobile bottom sheet IA pass | MED | Partially shipped (`1d41dd15`) |
| P3-29 — Korean translation pass | MED | Open |
| P3-30 — `primariesMatchIcc` normalization | MED | Shipped (`2a177793`) |
| P3-31 — download dropdown menu descriptions | MED | Shipped (`7de39416`) |
| P3-32 — sidebar layout — Color Details up | MED | Shipped (`2a177793`) |
| P3-33 — UI-UX polish bundle | LOW | Open |

**Items still genuinely open (not yet shipped, not yet deferred):** P3-8 (broader admin-toggle scope), P3-12 (test fixtures), P3-13 (ICC TRC HDR detection), P3-23 (docstring), P3-29 (Korean translations), P3-33 (polish bundle).

---

## C1-MED — new findings from this cycle's read (NOT in plan-38)

### C1-MED-1 — `MutableRefObject` is deprecated in React 19

**Severity:** MED (deprecation warning; lint may upgrade to error in a future React version).
**Photographer-axis:** indirectly affects audit-surface ergonomics by leaving the codebase on a deprecated API.

**Code:** `color-details-section.tsx:61`, `histogram.tsx:74`:
```ts
toggleRef?: React.MutableRefObject<(() => void) | null>;
cycleModeRef?: React.MutableRefObject<(() => void) | null>;
```

**Why:** `React.MutableRefObject<T>` is the legacy type for `useRef`. React 19 prefers `React.RefObject<T | null>` (the unified ref type). When migrating to `useImperativeHandle` for C1-CRIT-1 / C1-CRIT-2, also update the prop types.

**Fix:** Change to `React.RefObject<(() => void) | null>`. Also update the parent `useRef` to match (or omit the explicit type annotation since `useRef<(() => void) | null>(null)` infers fine).

**Confidence:** High.

---

### C1-MED-2 — `getSetting` raw is loosely typed and `allowHdrIngest` flag has redundant validation paths

**Severity:** MED (defensive coding hot-spot).
**Photographer-axis:** HDR ingest gating is the load-bearing P3-2 check.

**Code:** `gallery-config.ts:134-140`:
```ts
allowHdrIngest: (() => {
    const raw = getSetting(map, 'allow_hdr_ingest');
    if (!isValidSettingValue('allow_hdr_ingest', raw)) return DEFAULTS.allow_hdr_ingest === 'true';
    return raw === 'true';
})(),
```

**Note:** the IIFE is fine and the `isValidSettingValue` guard correctly covers the case where the DB row contains a corrupt string. The redundancy is the explicit equality check `raw === 'true'` — which is the validator's only allowed value. Acceptable, no fix needed; flagged here as a low-impact polish item.

**Confidence:** Low (likely no-fix; flag for awareness only).

---

### C1-MED-3 — `is_hdr` admin-only flag is enforced via TypeScript guard but no runtime test pins the omission from `publicSelectFields`

**Severity:** MED.
**Photographer-axis:** privacy + photographer-promise honesty (R3-C4).

**Code:** `data.ts:375-386`:
```ts
type _PrivacySensitiveKeys = 'latitude' | 'longitude' | 'filename_original' | 'user_filename' | 'processed' | 'original_format' | 'original_file_size' | 'color_pipeline_decision' | 'is_hdr' | 'transfer_function' | 'matrix_coefficients';
type _SensitiveKeysInPublic = Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>;
const _privacyGuard: _SensitiveKeysInPublic extends never ? true : [_SensitiveKeysInPublic, 'ERROR: privacy-sensitive field found in publicSelectFields ...'] = true;
```

The compile-time guard prevents accidental re-introduction of `is_hdr` to `publicSelectFields`. **Strong defense.** But there is no runtime test that asserts `publicSelectFieldKeys` does not contain `is_hdr`. A future contributor could import `adminSelectFields` directly into a public-facing query path and re-leak the field at the call site (the guard only protects the central definition).

**Recommended fix:** add `__tests__/data-public-fields-omit-hdr.test.ts` that imports `publicSelectFieldKeys` and `publicMapSelectFieldKeys` and asserts neither contains `is_hdr`, `transfer_function`, or `matrix_coefficients`. Belt-and-braces with the type guard.

**Confidence:** Medium.

---

### C1-MED-4 — `color-detection.ts` NCLX maps are not exhaustive against ITU-T H.273

**Severity:** MED.
**Photographer-axis:** correctness of CICP signaling for the HDR sources the schema is meant to detect.

**Code:** `color-detection.ts:125-147`:
```ts
const NCLX_PRIMARIES_MAP: Record<number, ColorSignals['colorPrimaries']> = {
    1: 'bt709',
    9: 'bt2020',
    11: 'dci-p3',
    12: 'p3-d65',
};
const NCLX_TRANSFER_MAP: Record<number, ColorSignals['transferFunction']> = {
    1: 'srgb', 2: 'gamma22', 6: 'gamma22', 13: 'srgb',
    14: 'gamma22', 15: 'gamma22', 16: 'pq', 18: 'hlg',
};
```

H.273 enumerates additional values (e.g. primaries 4=BT.470M, 5=BT.470BG, 6=SMPTE 170M; transfer 7=SMPTE 240M, 8=Linear, 11=IEC 61966-2-4, 12=BT.1361 extended, 17=SMPTE ST 428-1). These are uncommon in modern stills but a strict-photographer source could legitimately tag with one of them (e.g. cinema HEIF using ST 428-1).

**Why MED, not HIGH:** the unknown values fall through to `'unknown'`, which the rest of the pipeline treats as "neither wide-gamut nor HDR" — same as the default. So the *failure mode* is "fewer photos get the P3 / HDR classification than they should." Not a silent miscolor (the encoder still does its sRGB-fallback path). Just a missed opportunity for some niche cinema sources.

**Recommended fix:** add `4 → bt709` (BT.470M is close enough to BT.709 for fallback — or just leave unknown), and add a `// TODO(WI-future): expand NCLX maps per H.273` comment. **Defer** unless a concrete affected source is reported.

**Confidence:** Medium.

---

### C1-MED-5 — `processImageFormats` uses `chromaSubsampling: '4:4:4'` only when `isWideGamutSource` — sRGB sources get Sharp default `'4:2:0'`

**Severity:** MED.
**Photographer-axis:** internal-format fidelity. R3 internal-formats IF-MED-2 noted no admin override; reviewing now confirms sRGB sources never get 4:4:4.

**Code:** `process-image.ts:828-836`:
```ts
} else {
    await base
        .toColorspace(targetIcc)
        .withIccProfile(targetIcc)
        .jpeg({
            quality: qualityJpeg,
            ...(isWideGamutSource ? { chromaSubsampling: effectiveChroma as '4:4:4' | '4:2:2' | '4:2:0' } : {}),
        })
        .toFile(outputPath);
}
```

For sRGB sources, the JPEG encoder uses Sharp's default which has been `'4:2:0'` historically. For a serious photographer demoing red text or saturated red roses on sRGB-tagged exports from Capture One, 4:2:0 chroma decimation visibly smears red edges (well-known JPEG artifact). The wide-gamut path was correctly given 4:4:4 because the wider gamut needs it more, but a photographer who exports sRGB JPEG from a precise editor *also* values 4:4:4 chroma fidelity.

**Fix shape:** the existing `wide_gamut_jpeg_chroma` admin setting (P3-20, shipped `f76b8339`) only applies on the wide-gamut branch. Add a parallel `sdr_jpeg_chroma` setting (default `'4:2:0'` for compatibility/file-size; admin can opt-in to `'4:4:4'`). OR rename and unify into a single `jpeg_chroma_subsampling` setting that applies everywhere.

**Recommended:** defer to plan-39 (cycle-2 followup) unless the photographer-perspective brief explicitly requests it. Document in deferred list with exit criterion: "when a photographer reports red-edge smear on sRGB JPEG output."

**Confidence:** Medium.

---

### C1-MED-6 — `process-image.ts:715` — Sharp instance is created from `processingInputPath` BEFORE the WI-15 50 MP downscale path may have rewritten it

**Severity:** MED (correctness).
**Photographer-axis:** wide-gamut delivery on very high-resolution sources.

**Code:** `process-image.ts:694-715`:
```ts
let processingInputPath = inputPath;
let processingBaseWidth = baseWidth;
const inputMeta = await sharp(inputPath, { ... }).metadata();
const baseHeight = (inputMeta.height && inputMeta.height > 0) ? inputMeta.height : 0;
const basePixels = baseWidth * baseHeight;
if (isWideGamutSource && basePixels > WIDE_GAMUT_MAX_SOURCE_PIXELS) {
    const scale = Math.sqrt(WIDE_GAMUT_MAX_SOURCE_PIXELS / basePixels);
    const targetWidth = Math.max(1, Math.round(baseWidth * scale));
    const tmpPath = inputPath + '.wi15.tmp';
    await sharp(inputPath, { ... }).resize({ width: targetWidth, withoutEnlargement: true }).toFile(tmpPath);
    processingInputPath = tmpPath;
    processingBaseWidth = targetWidth;
}

const image = sharp(processingInputPath, { ... });
```

This is correct — `processingInputPath` is updated *before* `image` is created on line 715. So the parent Sharp instance reads the downscaled tmp. ✓ No bug; flagged here only because the dataflow is subtle and warrants a comment that ties the WI-15 path to the parent `image`.

**Recommended fix:** add a `// processingInputPath may be the .wi15.tmp downscale (WI-15)` comment at line 715. No code change.

**Confidence:** Low (no functional bug).

---

## C1-LOW — polish

- **C1-LOW-1**: `wide-gamut-hint.tsx` uses `cn`-style className composition in source — no issue, just visual consistency.
- **C1-LOW-2**: `histogram.tsx:407` — fixed `w-[240px] h-[120px]` violates the responsive design suggestion in the photographer-r3 review (R3-L7). Already a deferred item.
- **C1-LOW-3**: `process-image.ts` 50 MP threshold is a bare constant `WIDE_GAMUT_MAX_SOURCE_PIXELS = 50_000_000` — admin-tunability deferred (plan-38 P3 series).

---

## Reference

- `.context/reviews/photographer-r3/_aggregate.md` — predecessor R3 master aggregate.
- `.context/plans/38-photographer-r3-followup.md` — predecessor master plan (33 items).
- `.context/plans/cycle1-rpf-photographer.md` — companion plan written this cycle (see PROMPT 2 output).
