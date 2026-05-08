# Cycle 5 RPF — HDR-workflow review (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 5 of 100
**Master HEAD at review time:** `82b3dcfd`.
**Reviewer focus:** HDR ingest / detection / delivery / badging / downloads / CICP / SDR-display fall-through.

---

## Summary

Cycle 4 closed the HDR-badge gate harmonization (C4-A3 — lightbox pip now uses `transfer_function`-driven gating consistent with the sidebar accordion). All cycle-4 HDR queue items shipped.

Cycle 5 sweep finds:
- **One MED** (residual lightbox pip cosmetics — overlaps with C5-COL-MED-1).
- **One LOW** (hdr-filenames.ts is unused but kept for WI-09; documentation gap).
- **Already-fixed**: C4-HDR-LOW-4 / C4-A4 (HDR upload toast dedup) — `hdrWarningCount` is **already** aggregated per upload session in `upload-dropzone.tsx:199` and only fires ONE toast per session via `if (hdrWarningCount > 0)` at line 291. Cycle 4 plan listed it as planned but the existing code already meets the spec. Treat as already-resolved and archive.

No CRIT, no HIGH HDR-honesty issues found.

---

## Findings

### MED

#### C5-HDR-MED-1 — Lightbox color-pip expanded panel double-renders the HDR badge

**Cross-angle:** same as **C5-COL-MED-1**.

**File:** `apps/web/src/components/lightbox.tsx:120-128, 150-161`.

See `cycle5-rpf-photographer/color-fidelity.md#C5-COL-MED-1` for full spec. Cycle-5 implementation drops the panel-internal HDR row.

---

### LOW

#### C5-HDR-LOW-1 — `hdr-filenames.ts` is dead code currently; preserved for WI-09 but undocumented

**File:** `apps/web/src/lib/hdr-filenames.ts:5`.

**Confidence:** HIGH.

**Photographer impact:** zero today. The file only contains `withHdrSuffix(avifFilename)` which is currently unused (P3-1 removed the HDR download menu). The docstring says "Currently unused in UI after P3-1 removed the HDR download menu item", but no `@deprecated` / `@todo WI-09` JSDoc tag, no link to the WI-09 plan, no fixture test pinning the helper's contract.

**Recommendation:** add a fixture-style test (matching the `__tests__/hdr-filenames.test.ts` already present per the cycle-4 status table) that asserts the suffix contract for `.AVIF`, `.avif`, `.AvIf` casings and the no-extension fallback. Verify whether the test exists today; if not, add it. **Status: needs verification.**

---

#### C5-HDR-LOW-2 — HDR upload toast already deduped per session — close C4-A4 / C4-HDR-LOW-4

**File:** `apps/web/src/components/upload-dropzone.tsx:199-296`.

**Confidence:** HIGH.

**Photographer impact:** zero — the dedup is already in place. The variable `let hdrWarningCount = 0` (line 199) accumulates per-file warning counts (line 228-230) and the toast `if (hdrWarningCount > 0) { toast.warning(t('upload.hdrWarning', { count: hdrWarningCount })) }` (line 291-293) fires exactly ONCE per upload window with the total count. The plural-form locale string `"hdrWarning": "{count, plural, one {1 HDR image uploaded — may not display correctly on all devices.} other {# HDR images uploaded — …}}"` already handles the count.

**Recommendation:** archive `C4-A4 / C4-HDR-LOW-4` as already-resolved. Update plan-43 status table accordingly. No code change required.

---

#### C5-HDR-LOW-3 — `parseCicpFromHeif` `full_range_flag` still unparsed (carry-forward C4-D1 / C3-D7)

**File:** `apps/web/src/lib/color-detection.ts:222-228`.

**Confidence:** HIGH.

**Photographer impact:** zero today. Bound to WI-09 HDR encoder.

**Recommendation:** keep deferred. Exit criterion: WI-09 picked up.

---

#### C5-HDR-LOW-4 — Legacy `is_hdr=true` admin diagnostic surface (carry-forward C4-D2 / C3-D5)

**File:** `apps/web/src/lib/data.ts:217`.

**Recommendation:** keep deferred. Exit criterion: WI-09 ships, OR a photographer reports legacy delivery oddity.

---

#### C5-HDR-LOW-5 — P3-13 ICC TRC-based detection (carry-forward C4-D3)

**File:** `apps/web/src/lib/color-detection.ts:64-90`.

**Recommendation:** keep deferred. Awaits its own dedicated plan (M-XL effort).

---

## Cross-references

- C4-A3 / cycle-4 commit `d093cd23` — lightbox HDR pip gate harmonization (shipped).
- C4-A4 / C4-HDR-LOW-4 — already-implemented as `hdrWarningCount` aggregation; archive.
- C5-HDR-MED-1 ↔ C5-COL-MED-1 (cross-angle).
