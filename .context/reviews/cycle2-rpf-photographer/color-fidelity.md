# Cycle 2 RPF — Color-fidelity review (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 2/100
**Reviewer angle:** color reproduction accuracy, ICC management, wide-gamut delivery, internal AVIF / WebP / JPEG fidelity.
**Predecessor reviews:** `.context/reviews/photographer-r3/color-fidelity.md`, `.context/reviews/cycle1-rpf-photographer/_aggregate.md`.
**Master plan in flight:** `.context/plans/38-photographer-r3-followup.md` (most of Phase A and B shipped; some Phase C/D items still open).

This review records NEW or under-specified findings observed THIS cycle. It avoids duplicating closed items.

---

## C2-COL-MED-1 — `map-privacy.test.ts` does not lock the new admin-only HDR fields

**Severity:** MED.
**Confidence:** HIGH.
**Photographer-axis:** privacy + photographer-promise honesty (R3-C4 / P3-3 acceptance).

**File:** `apps/web/src/__tests__/map-privacy.test.ts:14-20`.

**Code:**
```ts
const ADMIN_ONLY_SENSITIVE = [
    'filename_original',
    'user_filename',
    'processed',
    'original_format',
    'original_file_size',
] as const;
```

**Why it's a problem:** P3-3 added `is_hdr`, `transfer_function`, and `matrix_coefficients` to the admin-only set in `data.ts:375` and `data.ts:383`. The compile-time guard (`_PrivacySensitiveKeys → _SensitiveKeysInPublic` extends-never assert) protects the *central definition* of `publicSelectFields`. But `map-privacy.test.ts` is the only **runtime** assertion that the public field surface excludes admin-only fields, and its `ADMIN_ONLY_SENSITIVE` list still names just the original five.

**Failure scenario:** a future contributor adds a new `getPublicMapImages` variant that imports `adminSelectFields` (e.g. for an admin-only debugging map) and accidentally exports it through a public route. The compile-time guard does not fire because the central `publicSelectFields` definition is unchanged; the runtime test does not fire because `is_hdr` is not in the assertion list. Result: `is_hdr` leaks back to the public response, the HDR badge re-appears for legacy `is_hdr=true` rows, and P3-3's "no false promise on the badge" property is silently broken.

**Fix:** extend `ADMIN_ONLY_SENSITIVE` (and add a parallel test for `publicSelectFieldKeys`):
```ts
const ADMIN_ONLY_SENSITIVE = [
    'filename_original',
    'user_filename',
    'processed',
    'original_format',
    'original_file_size',
    'color_pipeline_decision',  // also missing — P3-3-adjacent
    'is_hdr',
    'transfer_function',
    'matrix_coefficients',
] as const;
```

Add a new test:
```ts
it('publicSelectFields excludes admin-only HDR / pipeline fields', () => {
    for (const key of ADMIN_ONLY_SENSITIVE) {
        expect(publicSelectFieldKeys).not.toContain(key);
    }
});
```

**Acceptance criterion:** runtime test fails if any of these admin-only keys are reintroduced into either `publicSelectFields` or `publicMapSelectFields`.

---

## C2-COL-MED-2 — sRGB JPEG path uses Sharp default chroma (`4:2:0`); no admin override exists

**Severity:** MED.
**Confidence:** HIGH.
**Photographer-axis:** internal-format fidelity for sRGB-tagged JPEG output.

**File:** `apps/web/src/lib/process-image.ts:822-836`.

**Code:**
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

**Why it's a problem:** `wide_gamut_jpeg_chroma` (P3-20) is admin-tunable for the wide-gamut path only. For sRGB-tagged sources (most uploads), `chromaSubsampling` is omitted from the options, so Sharp/libvips uses its default — historically `'4:2:0'` for JPEG. A photographer who exports sRGB JPEG from Capture One / Lightroom with intentionally crisp red text or saturated red roses will see chroma decimation visibly smearing red edges (textbook 4:2:0 artifact).

**Failure scenario:** the photographer re-exports the same image to GalleryKit and to Flickr; on Flickr the red edges are crisp (4:4:4 export retained), on GalleryKit they're smeared. The visitor can't tell — the photographer can.

**Fix:** add a parallel `sdr_jpeg_chroma` admin setting (default `'4:2:0'` to preserve current file-size behavior, opt-in to `'4:4:4'`). OR unify both into a single `jpeg_chroma_subsampling` setting that applies to both branches.

```diff
@@ apps/web/src/lib/gallery-config-shared.ts
 export const SETTING_KEYS = [
   …
   'wide_gamut_jpeg_chroma',
+  'sdr_jpeg_chroma',
 ] as const;
 export const DEFAULTS = {
   …
   wide_gamut_jpeg_chroma: '4:4:4',
+  sdr_jpeg_chroma: '4:2:0',
 } as const;
 export const VALIDATORS = {
   …
+  sdr_jpeg_chroma: (v: string) => ['4:4:4', '4:2:2', '4:2:0'].includes(v),
 };
```

```diff
@@ process-image.ts (around line 829)
 await base
     .toColorspace(targetIcc)
     .withIccProfile(targetIcc)
     .jpeg({
         quality: qualityJpeg,
-        ...(isWideGamutSource ? { chromaSubsampling: effectiveChroma as '4:4:4' | '4:2:2' | '4:2:0' } : {}),
+        chromaSubsampling: (isWideGamutSource
+            ? (wideGamutJpegChroma ?? '4:4:4')
+            : (sdrJpegChroma ?? '4:2:0')) as '4:4:4' | '4:2:2' | '4:2:0',
     })
     .toFile(outputPath);
```

**Risk:** larger sRGB JPEG file sizes if admin opts into 4:4:4. Mitigated by keeping the default at 4:2:0 (no behavior change unless admin opts in). Photographer who cares can flip the setting.

**Acceptance criterion:** admin can choose chroma subsampling separately for sRGB and wide-gamut JPEG output. Default behavior is unchanged.

---

## C2-COL-MED-3 — `wide-gamut-hint` copy is wrong direction

**Severity:** MED.
**Confidence:** HIGH.
**Photographer-axis:** wide-gamut audit-surface honesty.

**Files:**
- `apps/web/messages/en.json:338` — `"wideGamutHint": "This photo uses a wide color gamut. Your display may not show all colors accurately."`
- `apps/web/messages/ko.json:338` — Korean equivalent with same semantics.
- `apps/web/src/components/wide-gamut-hint.tsx:30-43`.

**Why it's a problem:** the hint is shown when `isWideGamut && isSrgbDisplay`. The promise (per plan-38 P3-8) is to communicate clearly to a sRGB-only visitor that the photo is being shown in clipped sRGB, NOT that "the display may show all colors inaccurately" — the latter implies the *display* is at fault, when in fact GalleryKit is delivering the sRGB-clipped version on purpose because the visitor's display can't render the full gamut.

The current English text is also weaker than the cycle-1 copy that was specified in plan-38 §P3-8: *"Your display shows the sRGB version of this photo. Additional saturation is available on supported displays."*

**Failure scenario:** the photographer reads the hint on their P3 monitor in a private incognito session (which forces the sRGB hint due to MediaQuery negotiating between sources), and concludes "GalleryKit thinks my colors are inaccurate" rather than the intended "GalleryKit detected that you're on a sRGB display, so it's serving the sRGB rendition." The hint discredits the platform.

**Fix:** rewrite both copies with the user-friendly framing from plan-38 P3-8:
- en: `"Your display shows the sRGB version of this photo. The full color gamut is available on Display P3 / wide-gamut screens."`
- ko: `"현재 디스플레이에서는 sRGB로 변환된 색이 표시됩니다. Display P3 / 광색역 디스플레이에서는 더 넓은 색역을 볼 수 있습니다."`

**Acceptance criterion:** hint clearly attributes the limitation to the visitor's display and tells them how to see the full gamut, instead of suggesting "your display may be wrong."

---

## C2-COL-LOW-1 — `_cachedSupportsCanvasP3` probe runs only on first call; never re-evaluated when DPR or display changes

**Severity:** LOW.
**Confidence:** MEDIUM.
**Photographer-axis:** histogram audit on portable photographer setup (laptop + external P3 monitor swap).

**File:** `apps/web/src/components/histogram.tsx:55-67`.

**Why it's a problem:** the runtime feature probe (P3-6) is a one-shot. The probe asks "does this user agent support `getContext('2d', { colorSpace: 'display-p3' })` *at all*?" That's the right question. **However**, the consumer code in `histogram.tsx:307` *also* calls `getSupportsCanvasP3()` to decide whether to load the AVIF source — and the AVIF source rendering only matches the visible monitor when the DOM canvas is composited to that monitor. If the photographer drags the browser window from a sRGB display to a P3 display mid-session, the histogram still uses the cached "yes" verdict and shows P3 numbers, but the canvas is being composited to a sRGB display now and may clip differently.

This is **less common** than browser-supports-the-API drift (which never happens). The fix is correctness-only and likely deferrable — flagging here for the RPF record.

**Failure scenario:** photographer with MacBook Pro Liquid Retina (P3) + external sRGB monitor, drags GalleryKit window to the external monitor; the histogram still reads from the AVIF (P3 source); P3 values clip to sRGB at composite, so what the photographer sees on-screen does not match the histogram bins. Subtle.

**Fix:** acceptable to defer. If addressed, listen to `window.matchMedia('(color-gamut: p3)').addEventListener('change', ...)` and re-probe.

**Recommendation:** **defer.** Document in plan-39 cycle-2 followup.

---

## C2-COL-LOW-2 — `humanizeColorPipelineDecision` has no fallback for unknown values

**Severity:** LOW.
**Confidence:** HIGH.
**Photographer-axis:** label correctness on niche / future pipeline values.

**File:** `apps/web/src/components/color-details-section.tsx:32-46`.

**Code:**
```ts
case 'srgb-from-unknown': return t('viewer.colorPipelineSrgbFromUnknown');
default: return '';
```

**Why it's a problem:** the `default` returns an empty string. A future pipeline value (e.g. `'p3-from-rec709-bt2020'`) would render as a blank line in the Color Details accordion — a soft regression. The schema has no enum constraint pinning the values; `color_pipeline_decision` is `varchar`.

**Fix:** either log a `console.warn` at runtime when unknown values are encountered AND show a generic "Unknown pipeline" string, or constrain the schema.

**Recommendation:** **defer** unless a new pipeline label is being added. Track in plan-39.

---

## C2-COL-LOW-3 — `IMAGE_PIPELINE_VERSION = 6` has no docstring update for v6 semantics

**Severity:** LOW.
**Confidence:** HIGH.
**Photographer-axis:** photographer-audit traceability — when the encoder semantics change, version pinning lets the cache bust.

**File:** `apps/web/src/lib/process-image.ts:96-111`.

**Why it's a problem:** the docstring (line 96-110) describes the bump-when-encoder-semantics-change contract but does not enumerate what was changed at each version. P3-23 (LOW) in plan-38 noted this gap. Without the history, a future contributor cannot tell whether a given image's bytes are pre- or post-P3-2 / P3-4 / P3-5.

**Fix:** add a version table:
```ts
/**
 * Color-pipeline version history:
 *   v2 — initial versioned output (post-pre-fix bytes)
 *   v3 — CM-MED-2 rgb16 pipeline for wide-gamut sources
 *   v4 — DCI-P3 white-point Bradford adaptation (WI-12)
 *   v5 — 50 MP wide-gamut downscale (WI-15) + 10-bit AVIF probe
 *   v6 — wide_gamut_jpeg_chroma + avif_effort admin tunables (P3-20/21)
 */
export const IMAGE_PIPELINE_VERSION = 6;
```

**Recommendation:** ship as part of the cycle-2 work.

---

## Carry-forward — items from prior reviews still relevant

| ID | From | Status this cycle |
|---|---|---|
| P3-8 | plan-38 / cycle-1 | Component shipped; copy is wrong (see C2-COL-MED-3 above) |
| P3-12 | plan-38 / cycle-1 | Open — fixture files needed |
| P3-13 | plan-38 / cycle-1 | Open — non-trivial; defer to its own plan |
| P3-23 | plan-38 / cycle-1 | Addressed by C2-COL-LOW-3 above |
| P3-29 | plan-38 / cycle-1 | Mostly shipped — Korean translation parity verified for the main keys |
| P3-33 | plan-38 / cycle-1 | Polish bundle — open |

---

## Summary

| Severity | Count |
|---|---|
| MED | 3 |
| LOW | 3 |

The codebase is in shape. New findings are all about test-surface coverage, audit-label clarity, and one missed admin tunable on the SDR JPEG path. Nothing CRIT or HIGH this cycle from the color-fidelity angle.
