# Cycle 4 RPF — internal-formats review (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 4 of 100
**Master HEAD at review time:** `ad981085`.
**Reviewer focus:** AVIF / WebP / JPEG bit depth, ICC tagging, encoder paths, admin tunables.

---

## Summary

Plan-38 / plan-42 internal-format work shipped:
- P3-19 (`hdr-filenames.ts` helper + tests at `__tests__/hdr-filenames.test.ts`).
- P3-20 (`wide_gamut_jpeg_chroma` admin setting).
- P3-21 (`avif_effort` admin setting).
- P3-23 (pipeline version history docstring).
- P3-24 (50 MP downscale warning toast).
- C2-A5 (`sdr_jpeg_chroma`).
- C2-A6 (`wide_gamut_max_source_pixels`).
- C3-A6 (chroma-subsampling type narrowed end-to-end; runtime cast removed).
- C3-A7 (`inferTransferFunction` honest unknown fallback).

Cycle 4 sweep finds **no new CRIT / HIGH internal-format issues**. The remaining MED / LOW items are admin observability polish and one carry-forward.

---

## Findings

### MED

#### C4-INT-MED-1 — `validatedNumber` silent clamp in admin settings

**File:** `apps/web/src/lib/gallery-config.ts:163` (carry-forward from cycle 3 C3-D8).

**Confidence:** MEDIUM.

**Photographer impact:** if an admin pastes an out-of-range value (e.g. `avif_effort=15`), the validator silently clamps to the in-range default rather than rejecting. Operator gets no feedback.

**Recommendation:** carry-forward as `C4-D4`. Exit criterion: ops report stale-config drift, OR admin telemetry flags rejected values.

---

#### C4-INT-MED-2 — No fixture test for `wide_gamut_jpeg_chroma` end-to-end pipeline behavior

**File:** missing.

**Confidence:** MEDIUM.

**Photographer impact:** P3-20 shipped the admin setting and the encode-path consumer, but there's no fixture test that:
1. Sets `wide_gamut_jpeg_chroma=4:4:4` and confirms a wide-gamut source is encoded with 4:4:4 in the output JPEG.
2. Sets `wide_gamut_jpeg_chroma=4:2:0` and confirms 4:2:0.

Without that, a future encoder refactor could silently break the chroma-subsampling contract.

**Recommendation:** add a fixture test using a small synthetic wide-gamut JPEG. Effort: S. Already covered partially by `gallery-config-shared.test.ts` for the validator side; missing the encoder-side contract.

---

### LOW

#### C4-INT-LOW-1 — 10-bit AVIF probe not reset on encode failure

**File:** `apps/web/src/lib/process-image.ts:48-78` (carry-forward from cycle 3 C3-D9).

**Confidence:** MEDIUM.

**Recommendation:** keep deferred; carry-forward as `C4-D5`.

---

#### C4-INT-LOW-2 — `.wi15.tmp` cleanup race window if SIGKILL mid-upload

**File:** `apps/web/src/lib/process-image.ts:702-720` (carry-forward C2-D6 → C3-D10).

**Confidence:** HIGH.

**Recommendation:** keep deferred; carry-forward as `C4-D6`. Exit criterion: filesystem hygiene becomes a reported concern.

---

#### C4-INT-LOW-3 — No real HEIF fixture test for `parseCicpFromHeif`

**File:** missing (carry-forward from cycle 2/3 — C3-D14).

**Confidence:** HIGH.

**Recommendation:** keep deferred; carry-forward as `C4-D7`. Exit criterion: P3-12 fixture infra lands.

---

#### C4-INT-LOW-4 — `hdr-filenames.ts` exists but is unused in source code

**File:** `apps/web/src/lib/hdr-filenames.ts`; tests at `__tests__/hdr-filenames.test.ts`.

**Confidence:** HIGH.

**Photographer impact:** dead code today. Documented as "future WI-09 will import this." Helper is harmless; only adds 12 lines.

**Recommendation:** keep as-is. The helper is a deliberate placeholder. No action.

---

## Cross-references

- Plan-38 §internal-formats — items closed.
- Plan-42 — closed.
- Cycle-3 review — `.context/reviews/cycle3-rpf-photographer/internal-formats.md`.
