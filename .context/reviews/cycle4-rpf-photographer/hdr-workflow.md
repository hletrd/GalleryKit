# Cycle 4 RPF — HDR-workflow review (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 4 of 100
**Master HEAD at review time:** `ad981085`.
**Reviewer focus:** HDR honesty, ingest / detection / delivery, badge surfaces, downloads, CICP.

---

## Summary

Plan-38 HDR work has fully shipped to master:
- P3-1 (HDR download menu landmine deleted; lock test in place at `__tests__/photo-viewer-no-hdr-download.test.ts`).
- P3-2 (HDR ingest rejection with `allow_hdr_ingest` admin opt-in; locked at `images.ts:289` and `:473`).
- P3-3 (`is_hdr` / `transfer_function` / `matrix_coefficients` admin-only; compile-time guard at `data.ts:336/344`).
- P3-14 (HDR upload warning toast in `upload-dropzone.tsx:290`).
- P3-15 (HDR badge contrast bump — gradient amber-to-orange).
- P3-17 (drop `!important` on `.hdr-badge`).
- P3-18 — partially shipped: `ColorDetailsSection` already gates HDR badge on `transfer_function === 'pq' || 'hlg'` (`color-details-section.tsx:88`) instead of `image.is_hdr`. Future-proof.

Cycle 4 finds **no new CRIT or HIGH HDR-honesty issues**. The residual gaps are deferred items (P3-13 ICC TRC-based detection; awaits its own plan due to scope) and test-fixture coverage for the shipped HDR-rejection / HDR-warning paths.

---

## Findings

### MED

#### C4-HDR-MED-1 — HDR rejection upload path not covered by integration test

**File:** `apps/web/src/app/actions/images.ts:289` (rejection branch); missing test.

**Confidence:** HIGH.

**Photographer impact:** the rejection of PQ / HLG uploads with `allow_hdr_ingest=false` is a user-visible behavior with i18n error message. A future refactor could silently swap the rejection condition (e.g. accidental NOT inversion) and break the UX.

**Recommendation:** add an integration test that mocks the upload action with a synthetic PQ-detected `colorSignals` and asserts the action returns the localized error. Effort: S.

---

#### C4-HDR-MED-2 — `transfer_function`-driven HDR badge in lightbox / sidebar not locked

**File:** `apps/web/src/components/color-details-section.tsx:88` (`isHdr`); `apps/web/src/components/lightbox.tsx`.

**Confidence:** HIGH.

**Photographer impact:** the cycle-3 commit `8b9e961f` added the HDR badge to the lightbox color pip. The badge gates on `image.is_hdr`, but as of P3-18 the sidebar accordion has switched to `transfer_function === 'pq' || 'hlg'`. The lightbox code still gates on `image.is_hdr`. Inconsistent gating means the sidebar will render the badge for any HDR row but the lightbox only when `is_hdr=true` is set explicitly (which it is for the same data — but only consistent by accident).

**Recommendation:** harmonize the gate. Either:
- Change lightbox pip to gate on `transfer_function`, OR
- Document the convention (accordion = transfer-function-driven; pip = is_hdr-driven; both produce the same result given the schema invariant `is_hdr === (transfer_function === 'pq' || 'hlg')`).

The schema invariant holds (`image-queue.ts:121` and `process-image.ts` both compute `is_hdr` from `transfer_function`). So the badges will agree in practice. But the inconsistency is a smell.

---

### LOW

#### C4-HDR-LOW-1 — `parseCicpFromHeif` `full_range_flag` still unparsed

**File:** `apps/web/src/lib/color-detection.ts` `parseCicpFromHeif` (carry-forward from cycle 3 C3-D7).

**Confidence:** HIGH.

**Photographer impact:** the field has no consumer today. Will be needed for WI-09 (HDR encoder).

**Recommendation:** keep deferred; carry-forward as `C4-D1`. Exit criterion: WI-09 picked up.

---

#### C4-HDR-LOW-2 — Legacy `is_hdr=true` admin diagnostic surface

**File:** `apps/web/src/lib/data.ts:217`; admin views.

**Confidence:** HIGH.

**Photographer impact:** rows uploaded before P3-2 (HDR rejection) carry `is_hdr=true` with malformed SDR pixels. Today admin sees the badge for these legacy rows. There is no "re-process" affordance.

**Recommendation:** keep deferred; carry-forward as `C4-D2`. Exit criterion: WI-09 ships, OR a photographer reports legacy delivery oddity.

---

#### C4-HDR-LOW-3 — `inferTransferFunction` 8-bit unknown ICC returns `'unknown'` (not tested for ICC TRC fallback)

**File:** `apps/web/src/lib/color-detection.ts:64-90` (`inferTransferFunction`).

**Confidence:** MEDIUM.

**Photographer impact:** cycle-3 C3-A7 already changed the 8-bit fall-through from `'srgb'` to `'unknown'`. P3-13 (large) would replace the heuristic with full ICC TRC parsing.

**Recommendation:** keep deferred; track `C4-D3` for P3-13 implementation.

---

#### C4-HDR-LOW-4 — HDR upload toast not deduped across upload window

**File:** `apps/web/src/components/upload-dropzone.tsx:290`.

**Confidence:** MEDIUM.

**Photographer impact:** uploading a batch of 10 HDR files with `allow_hdr_ingest=true` shows 10 separate "HDR will be displayed as SDR approximation" toasts (one per accepted file). Cosmetic noise.

**Recommendation:** dedupe within an upload session by tracking a per-session `hdrWarningSurfaced` boolean. Effort: XS.

---

## Cross-references

- Plan-38 §HDR — fully shipped except P3-13 (deferred).
- Plan-42 (cycle 3) — fully shipped.
- Cycle-3 review — `.context/reviews/cycle3-rpf-photographer/hdr-workflow.md`.
- WI-09 (HDR encoder) — separate plan when scheduled.
