# Cycle 5 RPF — Security & Architecture review (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 5 of 100
**Master HEAD at review time:** `82b3dcfd`.
**Reviewer focus:** privacy, admin-only fields, defense-in-depth, repository structure, gate-script blast radius.

---

## Summary

Privacy guard (`is_hdr` / `transfer_function` / `matrix_coefficients` admin-only) holds. Compile-time `_PrivacySensitiveKeys` / `_MapSensitiveKeys` in `data.ts:336/344` continue to enforce. `__tests__/map-privacy.test.ts` lock unchanged. All four gates pass at cycle-5 baseline:

| Gate | Status |
|---|---|
| eslint | PASS |
| lint:api-auth | PASS |
| lint:action-origin | PASS |
| vitest | PASS — 137 files / 1207 tests |

Cycle 5 sweep finds **no new security issues**. One MED architecture finding remains carry-forward.

---

## Findings

### MED

#### C5-ARCH-MED-1 — Mobile bottom sheet does NOT receive `colorDetailsToggleRef` / `histogramCycleRef` (carry-forward C4-D12 / C3-D1)

**Recommendation:** keep deferred. Architectural refactor — hoist `showColorDetails` + histogram cycle state into `PhotoViewer` parent. M-effort.

---

### LOW

#### C5-ARCH-LOW-1 — `eslint.config.mjs` `varsIgnorePattern` durable (verified)

**Confidence:** HIGH. No action.

---

## Cross-references

- C4-D12 — re-affirmed.
- `__tests__/map-privacy.test.ts` — privacy guard.
- `__tests__/check-api-auth.test.ts` — admin route auth wrapper guard.
- `__tests__/check-action-origin.test.ts` — same-origin admin server-action guard.
