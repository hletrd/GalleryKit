# Cycle 4 RPF — Security & Architecture review (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 4 of 100
**Master HEAD at review time:** `ad981085`.
**Reviewer focus:** privacy, admin-only fields, defense-in-depth, repository structure.

---

## Summary

The privacy guard for `is_hdr` / `transfer_function` / `matrix_coefficients` continues to hold (verified at `data.ts:336/344` compile-time `_PrivacySensitiveKeys` / `_MapSensitiveKeys`). The fixture test at `__tests__/map-privacy.test.ts` enforces the omission set. The settings file `gallery-config-shared.ts` gracefully exposes admin-only flags via the `GalleryConfig` interface — public consumers receive only the publicly-shaped subset through `publicSelectFields`.

Cycle 4 sweep finds **no new security issues**. One MED architecture finding remains carry-forward: bottom-sheet ↔ sidebar ref binding for `c`/`h` shortcuts (C3-D1, large refactor).

All gates baseline at start of cycle 4:

| Gate | Status |
|---|---|
| eslint | PASS — exit 0 |
| lint:api-auth | PASS |
| lint:action-origin | PASS |
| vitest | PASS — 133 files / 1158 tests |

---

## Findings

### MED

#### C4-ARCH-MED-1 — Mobile bottom sheet does NOT receive `colorDetailsToggleRef` / `histogramCycleRef` (carry-forward C3-D1)

**File:** `apps/web/src/components/info-bottom-sheet.tsx`; `apps/web/src/components/photo-viewer.tsx:343-351, 668, 807`.

**Confidence:** HIGH.

**Recommendation:** keep deferred; carry-forward as `C4-D12`. Architectural refactor — hoist `showColorDetails` + histogram cycle state into `PhotoViewer` parent. M-effort.

---

### LOW

#### C4-ARCH-LOW-1 — `eslint.config.mjs` `varsIgnorePattern: '^_'` covers `_omit*` discards in `data.ts`

**File:** verified. Cycle 3 C3-A5 confirmed.

**Confidence:** HIGH.

**Recommendation:** no action. (Confirms the cycle-3 fix is durable.)

---

## Cross-references

- Plan-38 — fully shipped (security/privacy items).
- Plan-42 — fully shipped.
- Cycle-3 security review — `.context/reviews/cycle3-rpf-photographer/security-and-architecture.md`.
- `__tests__/map-privacy.test.ts` — privacy guard.
- `__tests__/check-api-auth.test.ts` — admin route auth wrapper guard.
- `__tests__/check-action-origin.test.ts` — same-origin admin server-action guard.
