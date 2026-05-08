# Cycle 5 RPF — Internal-formats review (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 5 of 100
**Master HEAD at review time:** `82b3dcfd`.
**Reviewer focus:** AVIF/WebP/JPEG fidelity end-to-end, ICC carriage, chroma subsampling, encoder defaults, encoder fallback safety.

---

## Summary

Cycle 4 fixed the obvious test-coverage gaps (C4-A5 delivered/source row wiring, C4-A6 `primariesMatchIcc` dedup contract, C4-A8 Latinate primaries lock). The end-to-end pipeline including CICP → ICC → AVIF/WebP/JPEG carriage is already audited via cycle-3 work.

Cycle-5 sweep finds:
- **No new CRIT or HIGH issues**.
- The carried-forward MED items (`validatedNumber` silent clamp; encoder-side fixture for `wide_gamut_jpeg_chroma`) remain deferred to plan-44.
- One LOW: `hdr-filenames.ts` test-existence verification (cross-angle with C5-HDR-LOW-1).

---

## Findings

### LOW

#### C5-INT-LOW-1 — `hdr-filenames.ts` test verification (cross-angle with C5-HDR-LOW-1)

**File:** `apps/web/src/lib/hdr-filenames.ts:9`; potentially `apps/web/src/__tests__/hdr-filenames.test.ts`.

**Confidence:** MEDIUM.

See `hdr-workflow.md#C5-HDR-LOW-1`. Verify the fixture test exists; add it if not.

---

#### C5-INT-LOW-2 — `validatedNumber` silent clamp (carry-forward C4-D4 / C3-D8)

**File:** `apps/web/src/lib/gallery-config.ts:163`.

**Recommendation:** keep deferred.

---

#### C5-INT-LOW-3 — 10-bit AVIF probe never reset on encode failure (carry-forward C4-D5 / C3-D9)

**File:** `apps/web/src/lib/process-image.ts:48-78`.

**Recommendation:** keep deferred.

---

#### C5-INT-LOW-4 — `.wi15.tmp` cleanup race (carry-forward C4-D6 / C2-D6 / C3-D10)

**File:** `apps/web/src/lib/process-image.ts:702-720`.

**Recommendation:** keep deferred.

---

#### C5-INT-LOW-5 — Real HEIF + ICC fixtures (carry-forward C4-D7 / C3-D14 / P3-12)

**Recommendation:** keep deferred. Awaits P3-12 fixture infra plan.

---

#### C5-INT-LOW-6 — Encoder-side fixture for `wide_gamut_jpeg_chroma` end-to-end (carry-forward C4-D13)

**Recommendation:** keep deferred. Couples to P3-12 fixture infra.

---

## Cross-references

- Plan-43 (cycle 4) — fully shipped.
- C4-D4..C4-D7, C4-D13 — carry-forwards re-affirmed.
- C5-HDR-LOW-1 — `hdr-filenames.ts` documentation / test-existence verification.
