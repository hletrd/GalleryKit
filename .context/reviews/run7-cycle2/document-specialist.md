# Run-7 Cycle-2 — DOCUMENTATION-CODE-CONSISTENCY Review

**Agent:** document-specialist
**Angle:** Verify documentation claims (CLAUDE.md, code comments) against AUTHORITATIVE EXTERNAL SPECS (ITU-T H.273, FFmpeg enum mirror, OWASP, Stripe, Sharp/libvips, WCAG, caniuse/MDN/Bugzilla) + internal code-vs-doc consistency.
**HEAD:** `1cdbb883`
**Date:** 2026-06-18

## Prior-Fix Verification (run-7 cycle-1)

Both cycle-1 findings are confirmed FIXED and COMPLETE at HEAD. Not re-raised.

### R7C1-F1 (YCgCo) — VERIFIED FIXED at `60a5690c`
- `apps/web/src/lib/color-detection.ts:207` — `8: 'ycgco'` with corrected comment `// ITU-T H.273 Table 4 value 8 = YCgCo (NOT BT.2020-NCL; that is value 9)`.
- `ColorSignals.matrixCoefficients` union at line 27 now includes `'ycgco'`.
- `color-details-section.tsx` carries the `YCgCo` display label.
- `color-detection.test.ts` and `color-details-section-delivered.test.ts` both pin the corrected behavior.
- Cross-confirmed against FFmpeg `AVCOL_SPC_YCGCO = 8` (pixfmt.h, fetched this cycle — see source below).

### R7C1-F2 (Firefox MQ overstatement) — VERIFIED FIXED at `10108963`
- `use-display-capability.ts:61-67` comment now correctly states Firefox parses the MQ syntax since v110 but it always returns false (Mozilla bug 1626624).
- CLAUDE.md browser matrix, Firefox impact section, WideGamutHint description, and Display-change limitations all corrected to "always returns false on all Firefox versions".
- Code behavior was already correct (conservative 'srgb' fallback); fix was doc/comment-only. Confirmed accurate.

## Findings

### R7C2-F1 — NCLX transfer code 5 is GAMMA 2.8 (BT.470BG), not GAMMA 2.2 (BT.470 System M) [CONFIRMED SPEC ERROR]

**Severity:** MEDIUM (admin-only audit label is wrong; same class as the cycle-1 YCgCo error — a real ITU-T H.273 code mislabeled, with a test actively pinning the wrong spec)

**Doc location:**
- `apps/web/src/lib/color-detection.ts:180-181` — comment: `// gamma-2.2 family (BT.470M, BT.470BG, SMPTE 240M respectively)` — BT.470BG is gamma **2.8**, not 2.2.
- `apps/web/src/lib/color-detection.ts:183` — `5: 'gamma22', // BT.470 System M` — BOTH the mapped value AND the inline comment are wrong. Code 5 is BT.470**BG** (gamma 2.8); "System M" is code 4 (BT.470M, gamma 2.2).

**Code location (the mislabel):**
- `apps/web/src/lib/color-detection.ts:177-202` (`NCLX_TRANSFER_MAP`): `5: 'gamma22'`.
- `apps/web/src/lib/color-detection.ts:25` — `transferFunction` union lacks a `'gamma28'` value (so the fix requires adding it, exactly like cycle-1 added `'ycgco'`).

**Test pinning the wrong spec (harmful, same pattern as the YCgCo test):**
- `apps/web/src/__tests__/color-detection.test.ts:206` — block comment `// R8-M1: NCLX transfer values 4, 5, 7 (gamma-2.2 family)` — wrong grouping; 5 is not in the gamma-2.2 family.
- `apps/web/src/__tests__/color-detection.test.ts:213-217` — `it('maps nclx transfer=5 to gamma22', ...)` asserts the wrong value.

**Authoritative source — FFmpeg `libavutil/pixfmt.h` (canonical mirror of ITU-T H.273 / ISO/IEC 23091-2_2019 subclause 8.2):**

```c
enum AVColorTransferCharacteristic {
    AVCOL_TRC_BT709 = 1,
    AVCOL_TRC_GAMMA22 = 4, ///< also ITU-R BT470M / ITU-R BT1700 625 PAL & SECAM
    AVCOL_TRC_GAMMA28 = 5, ///< also ITU-R BT470BG
    AVCOL_TRC_SMPTE170M = 6,
    AVCOL_TRC_SMPTE240M = 7,
    AVCOL_TRC_LINEAR = 8,
    AVCOL_TRC_IEC61966_2_4 = 11,
    AVCOL_TRC_IEC61966_2_1 = 13, ///< sRGB
    AVCOL_TRC_BT2020_10 = 14,
    AVCOL_TRC_BT2020_12 = 15,
    AVCOL_TRC_SMPTE2084 = 16, ///< PQ
    AVCOL_TRC_SMPTE428 = 17,
    AVCOL_TRC_ARIB_STD_B67 = 18, ///< HLG
};
```

- Code **4** = `AVCOL_TRC_GAMMA22` = "ITU-R BT470M" (NTSC 525-line, gamma 2.2) — GalleryKit maps `4: 'gamma22'` ✓ correct.
- Code **5** = `AVCOL_TRC_GAMMA28` = "ITU-R BT470BG" (PAL/SECAM 625-line, gamma **2.8**) — GalleryKit maps `5: 'gamma22'` ✗ **WRONG**. Comment "BT.470 System M" is also wrong (System M = code 4).
- Code **6** = `AVCOL_TRC_SMPTE170M` (BT.601 NTSC) — mapped `'gamma22'`, lossy approximation (no 'smpte170m' label in the enum); defensible, NOT a finding.
- Code **7** = `AVCOL_TRC_SMPTE240M` — mapped `'gamma22'`, same lossy-approximation rationale; defensible.
- Codes 1, 8, 11, 13, 14, 15, 16, 17, 18 all verified CORRECT against the FFmpeg enum.

**Discrepancy:** ITU-T H.273 Table 3 code 5 is the BT.470BG gamma-2.8 transfer (PAL/SECAM). GalleryKit labels it `gamma22` and annotates it "BT.470 System M". Both are spec errors. A photographer shipping a PAL/SECAM-mastered Rec.2020 SDR export (rare but possible) would see "Gamma 2.2" in the admin Color Details audit when the source actually declares gamma 2.8.

**Fix (mirrors the cycle-1 YCgCo fix shape):**
1. `color-detection.ts:25` — add `'gamma28'` to the `transferFunction` union.
2. `color-detection.ts:183` — change `5: 'gamma22', // BT.470 System M` → `5: 'gamma28', // ITU-T H.273 Table 3 value 5 = BT.470BG (PAL/SECAM gamma 2.8) — NOT System M (that is code 4)`.
3. `color-detection.ts:180-181` — correct the block comment: values 4 (BT.470M) and 7 (SMPTE 240M) are gamma-2.2-ish; **5 (BT.470BG) is gamma 2.8**, not part of the 2.2 family.
4. `color-details-section.tsx` `humanizeTransferFunction` — add `case 'gamma28': return t('viewer.transferGamma28');` (line ~72, alongside gamma22/18/24/26).
5. `messages/en.json` + `messages/ko.json` — add `viewer.transferGamma28` key (en: `"Gamma 2.8 (BT.470 BG / PAL·SECAM)"`, ko: `"감마 2.8 (BT.470 BG / PAL·SECAM)"`). Note the i18n key-parity check (DOC-R5C3-07) requires the SAME key set in both files; value shape may differ.
6. `color-detection.test.ts:206` — fix block comment to remove 5 from the "gamma-2.2 family".
7. `color-detection.test.ts:213-217` — change assertion to `expect(signals.transferFunction).toBe('gamma28')` and rename the test `it('maps nclx transfer=5 to gamma28 (BT.470BG)')`.
8. `color-details-section-delivered.test.ts` — if any fixture exercises transfer=5, pin the new `gamma28` label.
9. `CLAUDE.md` — the "transfer_function" row in the `images` color columns table currently lists `gamma24`/`gamma26`/`gamma18` examples; add `gamma28` to the enum enumeration for completeness.

**Confidence:** HIGH. FFmpeg's `AVColorTransferCharacteristic` enum is the canonical, widely-used mirror of ITU-T H.273 Table 3; the comment `"also ITU-R BT470BG"` on `AVCOL_TRC_GAMMA28 = 5` is unambiguous. BT.470BG being gamma 2.8 is also independently documented in ITU-R BT.470 and broadcast references (PAL/SECAM 625-line systems use a 2.8 display gamma). The cycle-1 YCgCo fix established the exact remediation pattern (union + map + label + test + i18n).

**Note on `isHdr`:** this fix does NOT change `isHdr` — `isHdr` is derived solely from `'pq'` / `'hlg'`, so gamma28 remains SDR. No upload-gate or delivered-byte impact. Pure audit-label correctness fix.

---

### (No further findings)

## Claims Verified CORRECT (no action needed)

These were checked against authoritative sources and are accurate as documented.

### ITU-T H.273 NCLX mappings (color-detection.ts) — remainder verified CORRECT
- **Primaries** (`NCLX_PRIMARIES_MAP`): `1=bt709`, `9=bt2020`, `11=dci-p3` (SMPTE 431-2 / DCI P3), `12=p3-d65` (SMPTE 432-1 / Display P3) — all match FFmpeg `AVCOL_PRI_*`. The 11/12 split (DCI-P3 vs Display P3) is correctly NOT swapped.
- **Matrix** (`NCLX_MATRIX_MAP`): `0=identity`, `1=bt709`, `8=ycgco` (fixed cycle-1), `9=bt2020-ncl`, `10=bt2020-cl` — all match FFmpeg `AVCOL_SPC_*`.
- **Transfer** codes 1, 4, 6, 7, 8, 11, 13, 14, 15, 16, 17, 18 — all match FFmpeg `AVCOL_TRC_*`. (Code 5 is the only error — see R7C2-F1.)

### Sharp / libvips API claims — CORRECT
- **"Sharp reports `format: 'heif'` for HEIC"** (implicit in `color-detection.ts:326` checking `format === 'heif' || format === 'avif'`): CORRECT. Sharp issue #2504 (lovell/sharp) confirms libvips reports BOTH HEIC and AVIF input as `'heif'` because they share the libheif loader. GalleryKit's defensive `|| format === 'avif'` is harmless belt-and-braces for a future Sharp version that may distinguish them.
- **"Sharp default JPEG chromaSubsampling is 4:2:0"** (`process-image.ts:1057` comment): CORRECT. Sharp/libvips JPEG output defaults to `4:2:0` chroma subsampling; `4:4:4` is "no subsampling" (Sharp issue #2902). The SDR default `'4:2:0'` and the wide-gamut `'4:4:4'` override are consistent with the library.
- **10-bit AVIF gating on libheif probe** (`process-image.ts:55-104`): CORRECT approach. Sharp's prebuilt binaries bundle libheif but bitdepth:10 support varies; the Promise-singleton probe + per-image fallback to 8-bit on encode rejection is the documented-safe pattern.

### Browser capability matrix (CLAUDE.md) — CORRECT after cycle-1 fix
- Firefox `(color-gamut: p3)` MQ: parses since v110 but always returns false (bug 1626624) — correctly stated after R7C1-F2.
- Firefox `(dynamic-range: high)` MQ: not implemented → `isHdr` always false on Firefox — CORRECT.
- `screen.colorGamut`: unsupported in Firefox all versions; Chrome/Safari/Edge supported — CORRECT per MDN/caniuse.
- Chrome `(dynamic-range: high)`: ✗ (Chromium gap) — CORRECT.
- Safari 18+ TP `screen.colorGamut` — CORRECT.

### OWASP Argon2id parameters — CORRECT ("exceeds OWASP minimums")
- CLAUDE.md claims "Argon2id, memoryCost=65536 / 64 MiB, timeCost=3, parallelism=4 — exceeds OWASP minimums".
- OWASP Password Storage Cheat Sheet minimum: m=19 MiB (19456 KiB), t=2, p=1.
- GalleryKit (`password-hashing.ts:10-15`): m=65536 KiB (64 MiB), t=3, p=4.
- Memory and time BOTH exceed the OWASP minimums. Parallelism p=4 vs OWASP p=1 is NOT a violation — OWASP's p=1 is the minimum floor for the published benchmark; higher parallelism with proportionally high memory is acceptable and common. The "exceeds OWASP minimums" claim is accurate.
- Source: OWASP Password Storage Cheat Sheet (https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

### Stripe API claims — CORRECT
- **Card-only checkout pin** (`checkout/[imageId]/route.ts:207`): `payment_method_types: ['card']` with comment explaining async methods (SEPA/ACH/bank-transfer/OXXO/Boleto) fire `completed`+`unpaid` then settle via `async_payment_succeeded`. CORRECT per Stripe Checkout docs — `checkout.session.completed` fires for all payment methods including async ones where `payment_status` can be `'unpaid'`.
- **`async_payment_succeeded` unhandled** (`webhook/route.ts:88-118`): the webhook only handles `checkout.session.completed` and gates on `payment_status === 'paid'`, treating `'unpaid'` as a documented no-op. The CLAUDE.md "Warning" block and the in-code comments (C3-RPF-01 / C4-RPF-03 / CRT-R5C1-04) accurately describe this gap and the card-only interim guard. CORRECT.
- Source: Stripe Checkout Sessions API docs (https://docs.stripe.com/api/checkout/sessions/create) + Stripe webhooks reference.

### WCAG / touch-target (44 px) claims — CORRECT
- CLAUDE.md + `touch-target-audit.test.ts:9-12`: "WCAG 2.5.5 Target Size (Enhanced) — Level AAA in WCAG 2.2 (44×44 px)" and "WCAG 2.2 also adds 2.5.8 Target Size (Minimum), Level AA, 24×24 px". Both CORRECT per the WCAG 2.2 Recommendation (2.5.5 Enhanced = 44px AAA; 2.5.8 Minimum = 24px AA). The repo exceeds both.

## Doc-drift check on recent commits — CLEAN
- `1cdbb883` (SW_VERSION stamp refresh): `public/sw.js` 2-line version-string change only. No doc content. No drift.
- `10108963` (Firefox MQ fix): doc/comment-only, verified accurate above.
- `60a5690c` (YCgCo fix): code+test+doc, verified accurate above.

## Summary

| ID | Severity | Claim | Status |
|----|----------|-------|--------|
| R7C1-F1 | — | YCgCo matrix code 8 | VERIFIED FIXED (not re-raised) |
| R7C1-F2 | — | Firefox MQ overstatement | VERIFIED FIXED (not re-raised) |
| **R7C2-F1** | **MEDIUM** | **NCLX transfer code 5 = gamma28 (BT.470BG), mislabeled as gamma22 / "BT.470 System M"** | **NEW — needs fix (union + map + label + i18n + test + CLAUDE.md)** |

**New findings this cycle: 1** (R7C2-F1). Same class as the cycle-1 YCgCo spec error — a real ITU-T H.273 code mislabeled, with a test actively pinning the wrong value. The remediation pattern is established (cycle-1).

**Informational (not a finding):** transfer codes 6 (SMPTE170M) and 7 (SMPTE240M) are mapped to `'gamma22'` as a lossy approximation because the enum exposes no `smpte170m`/`smpte240m` label. SMPTE 170M/240M use BT.709-like piecewise curves, not pure gamma 2.2, but the approximation is defensible given the enum's granularity. Flag for awareness only.

## Sources

- FFmpeg `libavutil/pixfmt.h` (authoritative mirror of ITU-T H.273 / ISO/IEC 23091-2_2019): https://github.com/FFmpeg/FFmpeg/blob/master/libavutil/pixfmt.h — `AVColorPrimaries`, `AVColorTransferCharacteristic`, `AVColorSpace` enums. Fetched 2026-06-18.
- ITU-T H.273 (V4, 07/2024): https://www.itu.int/epublications/publication/itu-t-h-273-v4-2024-07-coding-independent-code-points-for-video-signal-type-identification
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- Stripe Checkout Sessions API: https://docs.stripe.com/api/checkout/sessions/create
- Sharp issue #2504 (AVIF/HEIC format reporting as 'heif'): https://github.com/lovell/sharp/issues/2504
- Sharp issue #2902 (JPEG chroma subsampling default): https://github.com/lovell/sharp/issues/2902
- Sharp API output docs: https://sharp.pixelplumbing.com/api-output
- Mozilla Bugzilla 1626624 (Firefox color-gamut MQ): referenced via cycle-1 fix verification
- WCAG 2.2 Recommendation (2.5.5 / 2.5.8 Target Size): https://www.w3.org/TR/WCAG22/
