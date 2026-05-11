# Photographer-Perspective Review R5 — Aggregate

**Date:** 2026-05-11
**Reviewer perspective:** professional photographer + end-user workflow
**Premise:** photos arrive AFTER culling/refinement/editing. The product's job is to deliver the photographer's intent accurately to every viewer's display, on every supported browser.
**Review method:** Single comprehensive reviewer pass (agent fan-out not available in current toolset). All angles examined: color science, encoder pipeline, display capability, UI/UX, security, performance, test coverage, documentation, i18n.

---

## 0. State of the codebase (2026-05-11, post-R4-implementation)

All 11 R4 findings have been implemented in commits `94c43393` through `a8a59b0d`:

- P4-A1: Apple HDR gain map detection (`gain-map-detection.ts`) + schema + admin audit row
- P4-A2: ICC chromaticity-based gamut detection (`icc-chromaticity.ts`) + fixtures
- P4-B1: Unified `useDisplayCapability` hook with layered detection
- P4-B2: Synthetic ICC chromaticity test fixtures
- P4-C1/C4/C5: LightboxColorPip extracted + histogram + 44px touch target
- P4-C2: DCI-P3 label shortened + Bradford tooltip
- P4-C3: Mobile bottom-sheet IA reorder for non-trivial color
- P4-C6: Copy color metadata affordance
- P4-E1: mluc locale-matched ICC extraction
- P4-E2: ETag includes color-settings hash
- P4-E3: `humanizeColorPipelineDecision` parameter tightened

The codebase is remarkably mature. R5 looks for *new angles* — items the prior reviews and implementations did not surface.

---

## 1. R5 NEW findings (severity-rated)

### CRIT — none

The codebase has no open critical photographer-intent issue. The product surface is in honest, deliverable state.

---

### HIGH

#### R5-H1 — `useDisplayCapability` SSR default causes post-hydration layout shift on sRGB displays

**Code:** `use-display-capability.ts:37`

```ts
const SERVER_DEFAULT: DisplayCapability = { colorGamut: 'p3', isHdr: false };
```

**Problem:** On SSR, `WideGamutHint` receives `colorGamut === 'p3'`, so it returns `null` (suppressed). After hydration on an actual sRGB display, `detect()` resolves to `'srgb'`, and the hint suddenly renders as a block element with padding (`px-3 py-2`, border, background). This pushes content downward, causing Cumulative Layout Shift (CLS).

**Photographer-intent impact:** On an sRGB laptop viewing a wide-gamut photo, the page loads without the hint, then ~100-500ms later the hint appears and shifts the Color Details accordion + EXIF grid down by ~40px. This is jarring during photo review.

**Why R4 missed it:** R4 focused on the detection accuracy (Firefox false-positive fix) but did not evaluate the SSR/hydration boundary for layout stability.

**Fix shape:** Add a `mounted` flag to `WideGamutHint` that suppresses rendering until after hydration:

```tsx
export default function WideGamutHint({ colorPrimaries, t }: WideGamutHintProps) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const isWideGamut = isWideGamutPrimary(colorPrimaries);
    const { colorGamut } = useDisplayCapability();
    const isSrgbDisplay = colorGamut === 'srgb';

    // Suppress during hydration to avoid SSR→client mismatch + CLS
    if (!mounted || !isWideGamut || !isSrgbDisplay) return null;
    // ...
}
```

**Effort:** S.
**Acceptance:** No CLS on sRGB displays for wide-gamut photos; Lighthouse CLS score unaffected.

---

#### R5-H2 — `settings-hash.ts` omits `wide_gamut_max_source_pixels` and `sdr_jpeg_chroma` from ETag invalidation

**Code:** `settings-hash.ts:29-33`

```ts
const COLOR_IMPACTING_KEYS = [
    'wide_gamut_jpeg_chroma',
    'avif_effort',
    'force_srgb_derivatives',
] as const;
```

**Problem:** Two admin-tunable settings that directly affect encoded bytes are missing:

1. **`wide_gamut_max_source_pixels`** — When an admin lowers this from 50M to 25M, wide-gamut sources above 25M get downscaled before fan-out. The resulting derivatives have different pixel dimensions (and thus different bytes). But cached clients keep the old 50M-threshold variants because the ETag doesn't include this setting.

2. **`sdr_jpeg_chroma`** — When flipped from 4:2:0 to 4:4:4, all SDR JPEG derivatives change chroma subsampling. Cached clients keep stale 4:2:0 variants.

**Photographer-intent impact:** An admin trying to improve SDR JPEG quality by switching to 4:4:4 sees no effect on cached browsers until `max-age=86400` expires or the file mtime changes. The backfill script would update mtimes, but an admin who toggles the setting and expects immediate visual improvement on their own browser is confused.

**Why R4 missed it:** R4-L3 noted the ETag settings hash concept but only verified the 3 keys that were implemented. The review did not audit whether ALL color-impacting settings were included.

**Fix shape:** Add both keys to `COLOR_IMPACTING_KEYS`:

```ts
const COLOR_IMPACTING_KEYS = [
    'wide_gamut_jpeg_chroma',
    'sdr_jpeg_chroma',
    'avif_effort',
    'force_srgb_derivatives',
    'wide_gamut_max_source_pixels',
] as const;
```

Update `__tests__/settings-hash.test.ts` to cover the new keys.

**Effort:** S.
**Acceptance:** Changing `sdr_jpeg_chroma` or `wide_gamut_max_source_pixels` produces a different ETag hash; test fixture validates both.

---

#### R5-H3 — Histogram RGB-mode clip blink only checks luminance, not per-channel clipping

**Code:** `histogram.tsx:293`

```ts
const clipBins = mode === 'luminance' ? data.l : mode === 'r' ? data.r : mode === 'g' ? data.g : mode === 'b' ? data.b : data.l;
```

**Problem:** When `mode === 'rgb'`, the fall-through uses `data.l` (luminance). A photo with severe red-channel clipping (e.g., sunset with blown-out reds) but safe overall luminance will NOT show the red clip blink in RGB mode. The photographer expects RGB mode to show per-channel clipping behavior.

**Photographer-intent impact:** A photographer auditing a sunset photo switches to RGB histogram mode to check channel-specific clipping. The red channel is pegged at 255 but luminance is distributed. No clip blink appears, falsely reassuring the photographer that no channels are clipped.

**Why prior reviews missed it:** R3 P3-9 specified clip blink at ≥0.5% threshold. Cycles 3-5 implemented it for luminance mode. The RGB mode fall-through was likely assumed to be correct because `data.l` is a reasonable composite.

**Fix shape:** For `mode === 'rgb'`, check the worst-case channel (max of `data.r[0]`, `data.g[0]`, `data.b[0]` for below-black and `data.r[255]`, `data.g[255]`, `data.b[255]` for above-white):

```ts
let belowBlack = 0, aboveWhite = 0;
if (mode === 'rgb') {
    belowBlack = Math.max(data.r[0], data.g[0], data.b[0]);
    aboveWhite = Math.max(data.r[255], data.g[255], data.b[255]);
    const total = data.r.reduce((s, v) => s + v, 0); // any channel total ≈ same
    // ...
} else {
    clipBins = /* existing logic */;
}
```

**Effort:** S.
**Acceptance:** RGB mode shows clip blink when ANY channel exceeds 0.5% at 0 or 255; existing luminance/R/G/B modes unchanged.

---

#### R5-H4 — Lightbox fullscreen missing `h` keyboard shortcut for histogram mode cycle

**Code:** `lightbox.tsx:296`

```ts
if (['f', 'F', 'c', 'C', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key)) {
```

**Problem:** The desktop sidebar `Histogram` component supports `h` key to cycle modes (luminance → rgb → r → g → b). The lightbox fullscreen view has a histogram inside `LightboxColorPip` (P4-C1) but the lightbox's global keyboard handler does not wire `h`. A photographer in fullscreen must mouse-click the histogram mode button instead of using the keyboard.

**Photographer-intent impact:** Keyboard-driven workflow interruption. The photographer presses `h` expecting mode cycle; nothing happens. They must exit fullscreen or use the mouse to click the small mode toggle.

**Why prior reviews missed it:** R4-M2 requested the histogram IN the lightbox panel, which was implemented. But no review checked whether the existing `h` shortcut worked in the new context.

**Fix shape:** Add `h`/`H` to the lightbox key handler, routing to the `LightboxColorPip`'s `cycleModeRef`:

```ts
// In lightbox.tsx key handler
if (e.key === 'h' || e.key === 'H') {
    if (isEditableTarget(e)) return;
    // Route to the color pip's histogram cycle ref
    colorPipCycleModeRef.current?.();
}
```

Expose the ref from `LightboxColorPip` or handle mode cycling at the lightbox level and pass it down.

**Effort:** S.
**Acceptance:** Pressing `h` in lightbox fullscreen cycles the histogram mode; mode label updates; no regression on other shortcuts.

---

### MED

#### R5-M1 — `LightboxColorPip` histogram uses fixed 200px width without responsive bounds

**Code:** `lightbox-color-pip.tsx:124`

```tsx
<Histogram ... className="w-[200px]" />
```

**Problem:** The panel container has `min-w-[180px]` and the histogram is fixed at 200px. On an iPhone SE (375px logical width) with the panel positioned at `bottom-4 left-4`, the 200px histogram + `p-3` padding (24px) + panel margins can exceed available width, causing horizontal overflow or clipping.

**Photographer-intent impact:** Minor visual degradation on the smallest mobile viewports.

**Fix shape:** Use `max-w-full` or `w-full` with a max-width cap:

```tsx
<Histogram ... className="w-full max-w-[200px]" />
```

**Effort:** XS.
**Acceptance:** Histogram fits within panel bounds on iPhone SE; no overflow.

---

#### R5-M2 — `extractIccProfileName` locale parameter is dead code for upload-time detection

**Code:** `color-detection.ts:281`

```ts
iccName = extractIccProfileName(metadata.icc);
```

**Problem:** P4-E1 added locale-aware mluc matching to `extractIccProfileName`, but `detectColorSignals` calls it without a locale argument. The upload pipeline is server-side and has no request locale context. The locale-aware code path is unreachable for the primary use case (upload-time color detection).

The locale IS available at render time (in `ColorDetailsSection` via `useTranslation`), but the ICC name is already stored in the DB at upload time. So a Korean photographer uploading a multi-locale ICC profile gets the English description stored, and the Korean locale in the UI can't retroactively localize it.

**Fix shape:** Two options:

1. **Minimal:** Document the limitation in `extractIccProfileName` and `detectColorSignals` comments. Accept that upload-time detection is English-first.

2. **Full:** Store ALL mluc records in a JSON column and localize at render time. High effort; marginal benefit.

**Recommendation:** Option 1 (document). The Latinate convention already means photographers see English technical names.

**Effort:** XS (docs).
**Acceptance:** Comment in `color-detection.ts:281` documents why locale is omitted at upload time.

---

#### R5-M3 — `gain-map-detection.ts` `tmap` heuristic may false-positive on non-gain-map tone map items

**Code:** `gain-map-detection.ts:247-249`

```ts
if (entry.itemType === 'tmap') {
    gainMapItemIds.add(entry.itemId);
    continue;
}
```

**Problem:** Heuristic 1 treats ANY `infe` with `item_type === 'tmap'` as a gain map. ISO 21496-1 defines `tmap` as a generic "tone map representation" item type. While current Apple/Adobe/Pixel implementations use `tmap` exclusively for HDR gain maps, future or third-party encoders could use `tmap` for other tone-mapping purposes (e.g., SDR tone curve mapping, log-to-linear conversions).

A false positive would mark `has_gain_map = true` on a non-HDR photo, surfacing the "Gain map: present (delivered as SDR base only)" audit row incorrectly.

**Photographer-intent impact:** Low probability today, but increases as ISO 21496-1 adoption broadens beyond Apple.

**Fix shape:** Strengthen heuristic 1 to require EITHER `tmap` with an `auxl` reference pointing at it, OR `tmap` with a `urim` URI containing the Apple gain map URN. Standalone `tmap` items without auxiliary references are ambiguous.

```ts
// Change heuristic 1 to only flag tmap when there's supporting evidence
if (entry.itemType === 'tmap') {
    // Defer to heuristic 2 (iref auxl check) for standalone tmap items
    // Only immediately flag tmap if it carries the Apple URN
    if (entry.itemUri && entry.itemUri.includes('apple') && entry.itemUri.includes('hdr')) {
        gainMapItemIds.add(entry.itemId);
    }
    continue;
}
```

**Effort:** S.
**Acceptance:** Synthetic fixture with standalone `tmap` (no `auxl`) returns `false`; fixture with `tmap` + `auxl` returns `true`.

---

#### R5-M4 — `useDisplayCapability` `screen.colorGamut` changes not detectable (browser API limitation)

**Code:** `use-display-capability.ts:105-121`

**Problem:** The `subscribe` function registers `addEventListener('change', callback)` on `(color-gamut: p3)`, `(color-gamut: rec2020)`, and `(dynamic-range: high)` media queries. But `screen.colorGamut` (the primary signal for Chromium 121+ / Safari 18+) has no change event API. If a user drags the browser window from a P3 external monitor to an sRGB laptop screen, the MQ may or may not fire depending on OS/browser behavior, but `screen.colorGamut` will definitely change without notifying the hook.

**Photographer-intent impact:** The `WideGamutHint` or histogram AVIF preference may show stale state after display changes until a full page reload.

**Fix shape:** Document the limitation in code comments. Poll `screen.colorGamut` on `window.focus` or `visibilitychange` events as a best-effort fallback:

```ts
function subscribe(callback: () => void): () => void {
    // ... existing MQ subscriptions ...
    // Best-effort: re-detect on window focus / visibility change
    // because screen.colorGamut has no change event.
    const handleVisibility = () => { if (!document.hidden) callback(); };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', callback);
    return () => {
        // ... remove MQ listeners ...
        document.removeEventListener('visibilitychange', handleVisibility);
        window.removeEventListener('focus', callback);
    };
}
```

**Effort:** S.
**Acceptance:** Comment documents the limitation; focus/visibilitychange polling added; no infinite render loop (snapshot memoization already handles this).

---

#### R5-M5 — `process-image.ts` `.wi15.tmp` cleanup doesn't handle process kill (SIGTERM)

**Code:** `process-image.ts:717,925-926`

```ts
const tmpPath = inputPath + '.wi15.tmp';
// ... downscale to tmpPath ...
// cleanup in finally block:
if (processingInputPath !== inputPath) {
    await fs.unlink(processingInputPath).catch(() => {});
}
```

**Problem:** If the Node process receives SIGTERM (e.g., Docker container shutdown during processing) between `toFile(tmpPath)` and the `finally` block, the `.wi15.tmp` file is orphaned in `data/uploads/original/`. Over time, these accumulate and consume disk space.

**Photographer-intent impact:** Operational hygiene. Not a correctness bug, but a deploy-host disk leak.

**Fix shape:** Use a tmp directory outside the upload tree (e.g., `os.tmpdir()`), or add a startup cleanup that removes `*.wi15.tmp` files older than 1 hour:

```ts
const tmpPath = path.join(os.tmpdir(), `${path.basename(inputPath)}.wi15.tmp`);
```

**Effort:** S.
**Acceptance:** No `.wi15.tmp` files in `data/uploads/original/` after processing; tmp files use system tmpdir.

---

#### R5-M6 — `ColorDetailsSection` copy metadata omits `pipeline_version` from exported JSON

**Code:** `color-details-section.tsx:151-161`

**Problem:** The copied JSON includes `iccProfileName`, `primaries`, `transfer`, `matrix`, `decision`, `isHdr`, `hasGainMap`, `sourceBitDepth` but omits `pipeline_version`. When a photographer pastes this into a support ticket, the maintainer cannot tell which encoder version produced the derivatives. This matters for debugging "why does this photo look different after re-upload?" questions.

**Fix shape:** Add `pipelineVersion` to the copied JSON:

```ts
const data = {
    // ... existing fields ...
    pipelineVersion: image.pipeline_version ?? null,
};
```

**Effort:** XS.
**Acceptance:** Copied JSON includes `pipelineVersion` key.

---

### LOW

#### R5-L1 — `humanizeColorPrimaries` empty string fallback vs `humanizeTransferFunction` null handling inconsistency

**Code:** `color-details-section.tsx:19-28, 42-55`

**Problem:** `humanizeColorPrimaries` returns `''` for unknown/null. `humanizeTransferFunction` also returns `''`. But the caller for primaries uses `|| t('viewer.colorUnknown')` fallback, while transfer uses the same pattern. The behavior is correct but the API contracts differ: `humanizeColorPrimaries` could return `null` to signal "no value" more explicitly. Empty string is ambiguous (could mean "zero-length name" vs "unknown").

**Fix shape:** Return `null` from humanizers for unknown values; callers already handle falsy. Minor API cleanup.

**Effort:** XS.

---

#### R5-L2 — `wide-gamut-hint.tsx` imports `useDisplayCapability` but only uses `colorGamut`

**Code:** `wide-gamut-hint.tsx:4, 19`

**Problem:** The component destructures only `colorGamut` from the hook, ignoring `isHdr`. The hook comment says it returns `{ colorGamut, isHdr }` for "WideGamutHint and Histogram both consume this hook." But `WideGamutHint` doesn't use `isHdr`. Minor documentation-code mismatch.

**Fix shape:** Update the comment in `use-display-capability.ts` to clarify that `WideGamutHint` only uses `colorGamut`.

**Effort:** XS.

---

#### R5-L3 — Touch-target audit doesn't explicitly verify `lightbox-color-pip.tsx` extracted component

**Code:** `__tests__/touch-target-audit.test.ts` (assumed scan roots)

**Problem:** The audit walks `components/` recursively, so the extracted `lightbox-color-pip.tsx` IS covered. But there's no explicit `KNOWN_VIOLATIONS` entry or dedicated fixture verifying the pip's `min-h-11` touch target. If a future refactor removes `min-h-11`, the audit's generic `<button>` regex might not catch it (the pip uses `min-h-11` which the audit may not explicitly match if the regex only looks for `h-8`/`h-9` forbidden patterns).

**Fix shape:** Add a dedicated touch-target fixture for `lightbox-color-pip.tsx` that asserts the pip button height ≥ 44px, or add the file to the audit's explicit coverage list.

**Effort:** XS.

---

#### R5-L4 — `info-bottom-sheet.tsx` `isAdminProp` naming inconsistency

**Code:** `info-bottom-sheet.tsx:39, 163`

**Problem:** The prop is destructured as `isAdminProp` but then assigned to `isAdmin` locally. Minor naming inconsistency that confused the R4 review (R4-M5 referenced `isAdmin` but the prop is `isAdminProp`).

**Fix shape:** Rename prop to `isAdmin` or use `isAdminProp` consistently.

**Effort:** XS.

---

## 2. Cross-referenced deferred items (re-examined)

| ID | Original | R5 verdict | Reason |
|---|---|---|---|
| C8-D1 (full_range_flag) | LOW | **KEEP DEFERRED** | Still WI-09 gated |
| C8-D2 (Legacy is_hdr diagnostic) | LOW | **KEEP DEFERRED** | Still WI-09 gated |
| C8-D5 (10-bit AVIF probe not reset) | LOW | **KEEP DEFERRED** | Process-lifetime caching is by design |
| C8-D6 (.wi15.tmp cleanup race) | LOW | **PROMOTE → R5-M5** | Now addressable with tmpdir fix |
| C8-D8 (colorDetailsId collision) | LOW | KEEP DEFERRED | No collision observed in practice |
| C8-D9 (histogram clip threshold) | LOW | KEEP DEFERRED | Photographer preference, not bug |
| C8-D10 (histogram canvas responsive) | LOW | KEEP DEFERRED | 240px fits in 320px sheet |
| C8-D11 (c/h shortcuts dead on mobile) | LOW | **PARTIALLY ADDRESSED** | `h` now needed in lightbox (R5-H4) |
| C8-D12 (mobile bottom-sheet hoist state) | MED | **IMPLEMENTED** (P4-C3) | IA reorder landed |
| C8-D13 (encoder-side jpeg_chroma fixture) | MED | **IMPLEMENTED** (P4-B2) | Chromaticity fixtures cover path |
| C8-D14 (p3-from-rec2020-hlg enum split) | LOW | KEEP DEFERRED | WI-09 gated |
| C8-D15 (humanize tightening) | LOW | **IMPLEMENTED** (P4-E3) | Type tightened |

---

## 3. Severity-rated summary (R5 NEW)

| Severity | Count | Items |
|---|---|---|
| **CRIT** | 0 | (none — codebase remains honest and deliverable) |
| **HIGH** | 4 | R5-H1 SSR CLS · R5-H2 settings-hash omissions · R5-H3 RGB clip blink · R5-H4 lightbox `h` shortcut |
| **MED** | 6 | R5-M1 histogram responsive · R5-M2 mluc locale dead code · R5-M3 tmap false positive · R5-M4 screen.colorGamut undetected change · R5-M5 .wi15.tmp SIGTERM orphan · R5-M6 pipeline_version in copy JSON |
| **LOW** | 4 | R5-L1 humanizer null inconsistency · R5-L2 wide-gamut-hint isHdr unused · R5-L3 touch-target explicit coverage · R5-L4 isAdminProp naming |

---

## 4. What remains correct (do not change)

- NCLX `colr` walker correct; bounded depth/scan.
- ICC chromaticity detection correctly reads wtpt/rXYZ/gXYZ/bXYZ and converts XYZ→xy.
- Gain map detection covers both `urim` + Apple URI and `tmap` + `auxl` iref.
- DCI-P3 → Display P3 D65 Bradford adaptation correct.
- 10-bit AVIF probe with graceful fallback.
- 50 MP wide-gamut downscale gate.
- ETag-based pipeline-version + settings-hash invalidation (once R5-H2 fixes the omissions).
- `useDisplayCapability` layered detection (once R5-H1 fixes SSR, R5-M4 documents limitation).
- Korean i18n coverage complete for all new labels.
- Touch-target audit fixture-driven enforcement.
- Compile-time `_PrivacySensitiveKeys` guard including `has_gain_map`.
- `isP3Pipeline` / `isWideGamutPrimary` / `WIDE_GAMUT_PRIMARIES` consolidations.
- Mobile bottom-sheet IA reorder for non-trivial color (P4-C3).
- Lightbox histogram in slide-up panel (P4-C1).

---

## 5. Recommended implementation order

**Phase A — Layout stability / correctness:**
1. R5-H1 `WideGamutHint` mounted flag (prevents CLS).
2. R5-H2 Add `wide_gamut_max_source_pixels` + `sdr_jpeg_chroma` to settings-hash.
3. R5-H3 Histogram RGB-mode per-channel clip blink.

**Phase B — Photographer workflow:**
4. R5-H4 Lightbox `h` keyboard shortcut for histogram mode cycle.
5. R5-M6 Include `pipeline_version` in copied color metadata.

**Phase C — Robustness:**
6. R5-M3 Strengthen `tmap` heuristic (auxl reference required).
7. R5-M4 Document + poll `screen.colorGamut` on focus/visibilitychange.
8. R5-M5 Move `.wi15.tmp` to system tmpdir.

**Phase D — Polish:**
9. R5-M1 Histogram responsive width in lightbox.
10. R5-M2 Document mluc locale limitation at upload time.
11. R5-L1 through R5-L4 cosmetic fixes.

---

## 6. Reference

- This review: `.context/reviews/photographer-r5/_aggregate.md`
- Predecessor R4: `.context/reviews/photographer-r4/_aggregate.md`
- Predecessor R3: `.context/reviews/photographer-r3/_aggregate.md`
- Implemented R4 fixes: commits `94c43393` through `a8a59b0d`
