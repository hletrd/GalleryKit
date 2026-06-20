# Document-Specialist Report — Run-7 Cycle-4

**Date:** 2026-06-20
**Scope:** External-spec verification of NCLX H.273 constants in `color-detection.ts` and load-bearing CLAUDE.md constants.
**Findings:** 0 new actionable. 1 explicitly verified non-finding (code-4 candidate).

---

## 1. Scope and Method

This pass re-confirmed the conclusions established by the prior document-specialist run for run-7 cycle-4. Direct inspection of `apps/web/src/lib/color-detection.ts` (lines 170–220) was performed and cross-checked against:

- **ITU-T H.273 (2021)** — "Coding-independent code points for video signal type identification", Table 3 (transfer characteristics), Table 4 (matrix coefficients)
- **FFmpeg libavutil/pixfmt.h** `AVColorTransferCharacteristic` enum (as a widely-used implementation reference)

---

## 2. Verified Correct: ea303321 NCLX Comment Fixes

Commit `ea303321` landed the following comment clarifications. All were re-confirmed correct against H.273.

### 2a. Code 11 — xvYCC / IEC 61966-2-4

```ts
11: 'srgb',    // R5-M1 / AGG-R7C3-01: IEC 61966-2-4 (xvYCC) uses the BT.709 transfer
               // function (the SAME curve as code 1), extended to negative R'G'B' for a
               // wider gamut — NOT the sRGB transfer (xvYCC ≠ IEC 61966-2-1). We approximate
               // it as 'srgb' because that is the same enum label we use for code-1/BT.709
               // (we expose no distinct bt709-extended label). Value is correct; the prior
               // "same transfer as sRGB" comment was inaccurate about the curve.
```

**Verdict: CORRECT.** H.273 Table 3, code 11: "IEC 61966-2-4" — IEC 61966-2-4 (xvYCC) uses the BT.709 OETF extended to negative R'G'B'. It is distinct from the sRGB IEC 61966-2-1 EOTF (code 13). The comment now accurately states "BT.709 transfer function ... NOT the sRGB transfer."

### 2b. Codes 14/15 — BT.2020 transfer vs. BT.2020-NCL matrix

```ts
// R10-M9 / AGG-R7C3-01: ITU-T H.273 Table 3 values 14 and 15 (BT.2020 10/12-bit
// SDR) are the "Rec. ITU-R BT.2020" transfer characteristic. (BT.2020-NCL is the
// *matrix* coefficient name — Table 4 code 9 — distinct from this transfer; the
// prior comment conflated the two.)
14: 'gamma24', // BT.2020 10-bit (BT.1886 / gamma 2.4)
15: 'gamma24', // BT.2020 12-bit (BT.1886 / gamma 2.4)
```

**Verdict: CORRECT.** H.273 Table 3 codes 14/15 are the Rec. ITU-R BT.2020 *transfer* characteristic (BT.1886 / display gamma ~2.4). H.273 Table 4 code 9 is the BT.2020-NCL *matrix*. These are distinct concepts. The comment correctly distinguishes them. The `gamma24` mapped value is the closest single-curve label available in the enum.

---

## 3. Verified Non-Finding: Code 4 — "BT.470M, NTSC 525-line"

The prior pass flagged code 4's comment wording as a candidate to review:

```ts
4: 'gamma22', // ITU-T H.273 Gamma 2.2 curve (BT.470M, NTSC 525-line)
```

**Claim under review:** Is "BT.470M, NTSC 525-line" an accurate characterisation of H.273 code 4?

**H.273 Table 3, code 4 (authoritative text):**
> "Assumed display gamma 2.2 — Rec. ITU-R BT.470-6 System M (historical) (associated with the NTSC television system)"

BT.470 System M is the NTSC 525-line system. The comment "BT.470M, NTSC 525-line" is therefore a precise and correct shorthand for the H.273 specification text.

**Contrast with code 5 (already correctly handled):**

```ts
5: 'gamma28', // ITU-T H.273 Table 3 value 5 = BT.470BG (PAL/SECAM gamma 2.8) — NOT System M (that is code 4)
```

H.273 Table 3, code 5: "Rec. ITU-R BT.470-6 System B, G (historical)" — PAL/SECAM, gamma 2.8. The code-5 comment explicitly cross-references code 4 to avoid confusion.

**Verdict: NOT A FINDING.** The code-4 comment is spec-correct and precise. No change required.

---

## 4. Full NCLX Sweep — No Additional Errors

All mapped values verified:

| Code | Mapped value | H.273 Table 3 spec | Status |
|------|-------------|-------------------|--------|
| 1 | `srgb` | BT.709 OETF (practical SDR approximation) | Correct |
| 4 | `gamma22` | BT.470 System M, gamma 2.2 | Correct |
| 5 | `gamma28` | BT.470 System B/G (PAL/SECAM), gamma 2.8 | Correct |
| 6 | `gamma22` | SMPTE 170M (gamma ~2.2 family) | Correct |
| 7 | `gamma22` | SMPTE 240M (gamma ~2.2 family) | Correct |
| 8 | `linear` | Linear | Correct |
| 11 | `srgb` | IEC 61966-2-4 / xvYCC (BT.709 OETF extended) | Correct (enum approximation) |
| 13 | `srgb` | IEC 61966-2-1 (sRGB canonical code) | Correct |
| 14 | `gamma24` | BT.2020 10-bit (BT.1886) | Correct |
| 15 | `gamma24` | BT.2020 12-bit (BT.1886) | Correct |
| 16 | `pq` | SMPTE ST 2084 (PQ) | Correct |
| 17 | `gamma26` | SMPTE ST 428-1 (DCI-P3 gamma 2.6) | Correct |
| 18 | `hlg` | ARIB STD-B67 (HLG) | Correct |

Matrix map:

| Code | Mapped value | H.273 Table 4 spec | Status |
|------|-------------|-------------------|--------|
| 0 | `identity` | Identity | Correct |
| 1 | `bt709` | BT.709 | Correct |
| 8 | `ycgco` | YCgCo | Correct (prior run fixed: was erroneously BT.2020-NCL) |
| 9 | `bt2020-ncl` | BT.2020 non-constant luminance | Correct |
| 10 | `bt2020-cl` | BT.2020 constant luminance | Correct |

The three spec fixes shipped in run-7 (matrix 8 → YCgCo; transfer 5 → gamma28; xvYCC/BT.2020 comment clarifications) are the complete set of errors that existed. No 4th error found.

---

## 5. CLAUDE.md Load-Bearing Constants — Verified

| Claim | Verified value | Source / notes |
|-------|---------------|----------------|
| Argon2id memoryCost=65536 (64 MiB) / timeCost=3 / parallelism=4 exceeds OWASP minimums | OWASP minimums: m=19456/t=2/p=1 (Argon2id). 65536 > 19456; 3 > 2; 4 ≥ 1 — all exceed. | OWASP Password Storage Cheat Sheet |
| WCAG 2.5.5 AAA touch-target = 44×44 px | WCAG 2.2 SC 2.5.5 (Enhanced/AAA) requires 44×44 CSS px. SC 2.5.8 (Minimum/AA) requires 24×24 CSS px. | WCAG 2.2 specification |
| Firefox `color-gamut: p3` MQ always returns false (bug 1626624) | Mozilla bug 1626624 remains open. Firefox parses MQ syntax since v110 but wide-gamut rendering is not implemented. | Mozilla Bugzilla 1626624 |
| Sharp `withMetadata()` keeps GPS — "never use for stripping" | Sharp 0.33+ docs: `withMetadata()` retains EXIF/XMP/IPTC including GPS by default. The GPS-strip path uses lossless IFD byte-level neutralisation or metadata-free re-encode, not `withMetadata()`. | Sharp documentation |
| Stripe `async_payment_succeeded` gap documented accurately | Webhook handler gates on `payment_status === 'paid'`; delayed bank-transfer/ACH methods would complete checkout without triggering an entitlement row. Mitigated by `payment_method_types: ['card']` pin until plan-316 CRT-R5C1-04 ships the handler. | Code at `apps/web/src/app/api/stripe/webhook/route.ts` and `checkout/[imageId]/route.ts` |

All five constants verified correct as documented.

---

## 6. Summary

**0 new actionable findings.**

The run-7 cycle-1 through cycle-3 NCLX spec fixes were complete and correct. The code-4 "BT.470M, NTSC 525-line" comment is a verified non-finding: it is an accurate shorthand for H.273 Table 3 code 4 ("Rec. ITU-R BT.470-6 System M (historical)"). All load-bearing CLAUDE.md constants checked against authoritative sources are correctly documented.

No code changes recommended from this pass.
