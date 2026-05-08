# Cycle 6 RPF — Security & Architecture review (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 6 of 100
**Master HEAD at review time:** `b93af71a`.

---

## Summary

Cycle 5 made no security-surface changes. All gates green; no new admin-API routes, no new mutating server actions.

Cycle-6 sweep finds **no new security or architectural findings.** The cycle-5 architecture deferral (`C5-ARCH-MED-1` / hoist `colorDetailsToggleRef` and `histogramCycleRef` to PhotoViewer parent) carries forward unchanged.

**No CRIT, no HIGH, no new MED.**

---

## Findings

### MED (carry-forward)

#### C6-ARCH-MED-1 — `colorDetailsToggleRef` / `histogramCycleRef` not hoisted to PhotoViewer parent (carry-forward C5-D12 / C5-ARCH-MED-1)

**File:** `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/components/photo-viewer.tsx`.

**Recommendation:** keep deferred. Couples to mobile bottom-sheet IA refactor.

---

## Cross-references

- All admin-API routes still wrapped in `withAdminAuth` (verified by `lint:api-auth`).
- All mutating server actions still return-early on `requireSameOriginAdmin` (verified by `lint:action-origin`).
- Touch targets on the gamut-aware download dropdown still ≥ 44 px (`min-h-11`).
- No new security findings this cycle.
