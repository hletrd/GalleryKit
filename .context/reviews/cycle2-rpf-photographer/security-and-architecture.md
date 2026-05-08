# Cycle 2 RPF — Security + architecture + test-engineering combined review

**Date:** 2026-05-08
**Cycle:** 2/100
**Combined angles:** security-reviewer, architect, test-engineer, debugger, critic.

The repo's primary security gates (api-auth, action-origin, lint, vitest) all pass on master HEAD. No new security-blocking findings this cycle — the prior plan-37 hardening, plan-38 P3-3 admin-only HDR fields, and the existing `_PrivacySensitiveKeys` compile-time guard cover the photographer-perspective-relevant attack surface.

This file records architectural / test-coverage / debugging findings that were uncovered during the cycle-2 read-through, to keep one provenance file per review angle.

---

## C2-SEC — security findings

No NEW findings this cycle. Re-confirmed status of prior hardening:
- `withAdminAuth` lint scanner is green.
- `requireSameOriginAdmin()` lint scanner is green.
- `publicSelectFields` compile-time guard catches central-definition leakage of admin-only fields (P3-3 confirmed locked).
- DB advisory locks (`gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit:image-processing:{jobId}`) are intact.
- CSV escape handling (Trojan-Source / formula injection / invisible chars) is intact.

**Note (informational, not a finding):** the absence of a runtime test for the admin-only HDR-field omission (covered as `C2-COL-MED-1` in the color-fidelity review) is the closest thing to a security gap this cycle, and it is MED rather than CRIT/HIGH.

---

## C2-ARCH-MED-1 — `colorDetailsToggleRef` and `histogramCycleRef` are passed only to the desktop sidebar; mobile bottom-sheet has its own `<ColorDetailsSection>` that is not connected to the keyboard handler

**Severity:** MED.
**Confidence:** HIGH.
**Photographer-axis:** ergonomic parity, audit-surface symmetry.

**Files:**
- `apps/web/src/components/photo-viewer.tsx:343-350` (keyboard handler)
- `apps/web/src/components/info-bottom-sheet.tsx` (mobile bottom-sheet host)
- `apps/web/src/components/color-details-section.tsx` (the shared component)

**Why it's a problem:** see also `ui-ux-photographer.md` C2-UX-MED-2. The architectural shape is "two parallel sites of `<ColorDetailsSection>`" but only one of them is wired to the imperative keyboard ref. The cleanest fix is **one source of truth** for the toggle state, hoisted to the parent. Two design options:

**Option A** — hoist `showColorDetails` state into `photo-viewer.tsx`, pass it down to both `<ColorDetailsSection>` instances as a prop, and have the keyboard `c` shortcut call `setShowColorDetails`. Eliminates the imperative ref dance entirely.

**Option B** — keep the imperative ref but bind it to whichever instance is currently visible, by gating the ref pass-through on the active breakpoint (`isLg ? sidebarRef : sheetRef`).

**Recommendation:** Option A is cleaner architecturally; Option B is smaller. Defer to plan-39.

---

## C2-TEST-MED-1 — No vitest coverage for `parseCicpFromHeif` against actual HEIF binary fixtures

**Severity:** MED.
**Confidence:** HIGH.
**Photographer-axis:** correctness of the load-bearing CICP parser that drives HDR detection.

**Files:** `apps/web/src/lib/color-detection.ts:155-...` (`parseCicpFromHeif`); `apps/web/src/__tests__/`.

**Why it's a problem:** the CICP NCLX parser at `parseCicpFromHeif` is the load-bearing primitive for HDR detection (P3-2's reject-on-HDR depends on it via `data.colorSignals.isHdr`). The parser is tested with **synthetic Buffer fixtures** (good) but no end-to-end test against a real HEIF binary. The synthetic fixtures only cover the CICP triplet bytes; they do not exercise the ISOBMFF box-walker on a real file's parent box hierarchy (`meta` → `iprp` → `ipco` → `colr`).

**Failure scenario:** a real Apple iPhone HEIF (or a Sony α7 HLG HEIF) has a slightly different box layout than the synthetic fixture; the walker either falls through silently (no `colr` found, returns null, `isHdr=false`) or has an off-by-one on one of the box-size handlers. Result: HDR rejection at upload silently fails open, the photographer's HDR source is accepted, and we ship malformed SDR pixels.

**Fix:** add `apps/web/__test_fixtures__/color/`:
- `pq-hdr-sample.heif` — a small (≤ 50 KB) real HEIF with NCLX 9/16/9. Generated via `avifenc --cicp 9/16/9 -y 444 input.png pq-hdr.avif` then `mp4box` to repackage as HEIF; or extracted from public-domain Apple developer resources.
- `hlg-hdr-sample.heif` — same with NCLX 9/18/9.
- `srgb-jpeg-sample.jpg` — control with sRGB ICC.

Then add `__tests__/cicp-parse-real-heif.test.ts`:
```ts
it('parseCicpFromHeif extracts NCLX 9/16/9 from a real PQ HEIF', () => {
    const buffer = readFileSync(fixtures('pq-hdr-sample.heif'));
    const cicp = parseCicpFromHeif(buffer);
    expect(cicp).toEqual({ colourPrimaries: 9, transferCharacteristics: 16, matrixCoefficients: 9 });
});
```

**Recommendation:** plan-39 P3-12 already calls for these fixtures. This is the test-engineer angle on the same gap — high signal, ship it.

---

## C2-TEST-LOW-1 — `process-image-blur-wiring.test.ts` and `images-action-blur-wiring.test.ts` lock the blur-data-url contract but no analogous test locks the `force_srgb_derivatives` setting flow end-to-end

**Severity:** LOW.
**Confidence:** MEDIUM.
**Photographer-axis:** admin-controlled override that affects every wide-gamut delivery.

**Files:**
- `apps/web/src/__tests__/process-image-blur-wiring.test.ts` (existing)
- `apps/web/src/__tests__/images-action-blur-wiring.test.ts` (existing)
- `apps/web/src/lib/process-image.ts:680-690` (the `targetIcc` decision uses `forceSrgbDerivatives`)
- `apps/web/src/app/actions/images.ts` (the `processImageFormats` call site)

**Why it's a problem:** `forceSrgbDerivatives` is an admin opt-in that flattens wide-gamut sources to sRGB-tagged derivatives (for compatibility with broken proxies / older browsers / CDN cache poisoning concerns). The wiring goes: admin settings UI → `gallery_config` row → `getGalleryConfig` → `uploadConfig.forceSrgbDerivatives` → `processImageFormats` → `targetIcc`. There is no test that pins this end-to-end. A future refactor of `gallery-config.ts` could silently drop the propagation; the tests would still pass.

**Failure scenario:** photographer admin enables `force_srgb_derivatives=true` to debug a CDN; subsequent uploads still produce P3-tagged derivatives because the propagation broke. They don't notice for weeks.

**Fix:** add a fixture-style test that asserts `processImageFormats` calls `withIccProfile('srgb')` for a P3 source when `forceSrgbDerivatives=true`. Use a Sharp mock or a real lightweight P3 fixture.

**Recommendation:** **defer** to plan-39 P3-12.

---

## C2-DEBUG-LOW-1 — `_omit*` discard variables in `data.ts` carry `eslint-disable-next-line` comments; pattern is brittle to formatter changes

**Severity:** LOW.
**Confidence:** MEDIUM.
**Photographer-axis:** internal hygiene; not user-facing.

**File:** `apps/web/src/lib/data.ts:312-316, 345-349`.

**Code:**
```ts
const {
    …
    is_hdr: _omitIsHdr,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- P3-3: transfer_function is admin-only
    transfer_function: _omitTransferFunction,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- P3-3: matrix_coefficients is admin-only
    matrix_coefficients: _omitMatrixCoefficients,
} = adminSelectFields;
```

**Why it's a problem:** the `eslint-disable-next-line` directives only attach to the immediately following key. Prettier moving the multiline destructure could reflow the comments off-target, suddenly tripping the `no-unused-vars` rule. The first key (`is_hdr: _omitIsHdr`) doesn't have a disable comment — so either it's not flagged (because the destructure pattern matches `noUnusedAfter` context) or the rule is configured leniently.

The pattern works today because the eslint config has `argsIgnorePattern: '^_'` (typical TS config); the `_omit*` prefix matches it. The `eslint-disable` comments are therefore *redundant* for the no-unused-vars rule but were added defensively after a formatter reflow concern. The intent is to document the admin-only-by-design omission for human readers, not to suppress a real rule fire.

**Fix:** replace the inline disable comments with a single comment block above the destructure, explaining the omission contract. Or, even cleaner, use `Omit<>` types and the `pick`-style helper in TypeScript instead of object destructure with discard variables:

```ts
// Cleaner alternative
const PUBLIC_OMIT_KEYS = ['latitude', 'longitude', 'filename_original', 'user_filename', 'processed', 'original_format', 'original_file_size', 'color_pipeline_decision', 'is_hdr', 'transfer_function', 'matrix_coefficients'] as const;

export const publicSelectFields = Object.fromEntries(
    Object.entries(adminSelectFields).filter(([k]) => !PUBLIC_OMIT_KEYS.includes(k as (typeof PUBLIC_OMIT_KEYS)[number]))
) as Omit<typeof adminSelectFields, (typeof PUBLIC_OMIT_KEYS)[number]>;
```

**Recommendation:** **defer.** No-impact polish.

---

## C2-CRIT — multi-perspective critique

The current cycle's findings are all MED or LOW. This is consistent with the cycle-1 verdict that the codebase is in much better shape than the photographer-r3 round found it. The **critic-pass observation** is that several MED items in this cycle (C2-COL-MED-1 admin-only test, C2-COL-MED-3 wide-gamut hint copy, C2-TEST-MED-1 real-HEIF fixtures, C2-INT-MED-1 admin tunable for max source pixels) are all in service of "audit honesty" — i.e. closing the gap between what the system *promises* the photographer and what it can *demonstrate* under test.

The deferred items in this cycle (`C2-COL-LOW-1`, `C2-INT-LOW-1`, `C2-INT-LOW-2`, `C2-UX-LOW-1`, `C2-UX-LOW-2`, `C2-DEBUG-LOW-1`) form a polish queue that can wait.

---

## Summary

| Severity | Angle | Count |
|---|---|---|
| MED | architecture | 1 |
| MED | test-engineer | 1 |
| LOW | test-engineer | 1 |
| LOW | debug | 1 |

No HIGH / CRIT findings.
