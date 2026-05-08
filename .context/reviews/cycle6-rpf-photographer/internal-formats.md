# Cycle 6 RPF — Internal-formats review (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 6 of 100
**Master HEAD at review time:** `b93af71a`.
**Reviewer focus:** AVIF/WebP/JPEG fidelity end-to-end, ICC carriage, chroma subsampling, encoder defaults, encoder fallback safety.

---

## Summary

Cycle 5 added no encoder-side changes. The end-to-end pipeline (CICP → ICC → AVIF/WebP/JPEG carriage) is unchanged.

Cycle-6 sweep finds **no new internal-format issues**. The cycle-5 deferred set (validatedNumber silent clamp, encoder-side fixture for `wide_gamut_jpeg_chroma`, real HEIF + ICC fixtures) carries forward unchanged.

**No CRIT, no HIGH, no new MED.**

---

## Findings

### LOW (carry-forwards only)

#### C6-INT-LOW-1 — `validatedNumber` silent clamp (carry-forward C5-D4 / C4-D4 / C3-D8)

**File:** `apps/web/src/lib/gallery-config.ts:163`.

**Recommendation:** keep deferred.

---

#### C6-INT-LOW-2 — 10-bit AVIF probe never reset on encode failure (carry-forward C5-D5 / C4-D5 / C3-D9)

**File:** `apps/web/src/lib/process-image.ts:48-78`.

**Recommendation:** keep deferred.

---

#### C6-INT-LOW-3 — `.wi15.tmp` cleanup race (carry-forward C5-D6 / C4-D6)

**Recommendation:** keep deferred.

---

#### C6-INT-LOW-4 — Real HEIF + ICC fixtures (carry-forward C5-D7 / P3-12)

**Recommendation:** keep deferred. Awaits P3-12 fixture infra.

---

#### C6-INT-LOW-5 — Encoder-side fixture for `wide_gamut_jpeg_chroma` (carry-forward C5-D13 / C4-D13)

**Recommendation:** keep deferred. Couples to P3-12 fixture infra.

---

## Cross-references

- All cycle-5 deferred internal-format LOWs persist.
- No new internal-format findings this cycle.
