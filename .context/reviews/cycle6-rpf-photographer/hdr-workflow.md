# Cycle 6 RPF — HDR-workflow review (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 6 of 100
**Master HEAD at review time:** `b93af71a`.
**Reviewer focus:** HDR ingest / detection / delivery / badging / downloads / CICP / SDR-display fall-through.

---

## Summary

Cycle 5 closed the lightbox HDR pip dedup (C5-A1) and added the lock test (C5-A2). The HDR-badge surface is now:

- desktop sidebar Color Details accordion: HDR badge in `col-span-2` block — unchanged.
- mobile bottom-sheet Color Details accordion: HDR badge inside same accordion (shared component) — unchanged.
- lightbox color pip: HDR badge ONLY inside the closed-pip chip; expanded panel does not duplicate (C5-A1 dropped the redundant row).

All three surfaces gate on `transfer_function === 'pq' || 'hlg'`. The cycle-5 lock test fixates this for the lightbox pip; the sidebar accordion gate still relies on the cycle-3 invariant comment.

Cycle 6 sweep finds **no new HDR-honesty issues**. The deferred set (`full_range_flag`, legacy `is_hdr=true` admin diagnostic, P3-13 ICC TRC parsing, `hdr-filenames.ts` for WI-09) all carry forward as before. **No CRIT, no HIGH, no new MED.**

---

## Findings

### LOW (carry-forwards only)

#### C6-HDR-LOW-1 — `parseCicpFromHeif` `full_range_flag` still unparsed (carry-forward C5-D1 / C4-D1 / C3-D7)

**File:** `apps/web/src/lib/color-detection.ts:222-228`.

**Recommendation:** keep deferred. Exit criterion: WI-09 picks up.

---

#### C6-HDR-LOW-2 — Legacy `is_hdr=true` admin diagnostic surface (carry-forward C5-D2 / C4-D2 / C3-D5)

**File:** `apps/web/src/lib/data.ts:217`.

**Recommendation:** keep deferred. Exit criterion: WI-09 ships, OR a photographer reports legacy delivery oddity.

---

#### C6-HDR-LOW-3 — P3-13 ICC TRC-based detection (carry-forward C5-D3 / C4-D3)

**File:** `apps/web/src/lib/color-detection.ts:64-90`.

**Recommendation:** keep deferred. Awaits its own dedicated plan (M-XL effort).

---

## Cross-references

- C5-A1 / C5-A2 — cycle 5 lightbox HDR pip dedup + lock (shipped).
- C4-A3 — cycle 4 transfer-function-driven gate harmonization.
- No new HDR findings this cycle.
