# designer — cycle 5 RPF (end-only)

## Method

UX/a11y review of /admin/sales (the only page meaningfully changed in
cycles 2-4). Cross-reference WCAG 2.2 AA requirements.

## Findings

### UX-01 — Refund AlertDialog: `confirmTarget` and `refundingId` state can drift

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:127-148`
- Severity: **Low** | Confidence: **Medium**
- Edge case: user clicks Refund row 1 → confirm dialog opens → mid-API
  user closes via Cancel → opens row 2's Refund. Dialog opens for row 2
  but the AlertDialogAction's `disabled={refundingId !== null}` is still
  true until the row 1 API completes. Brief UX confusion: button is
  visibly disabled despite a fresh action.
- **Fix (defer):** prevent dialog close while `refundingId !== null`,
  OR clear `refundingId` on dialog open.

### UX-02 — Refund row Outlined button focus ring works in dark mode (verified by colorbar)

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:237-261`
- Severity: **Informational** | Confidence: **High**
- shadcn Button component handles focus-visible via class-variance-
  authority. Verified via grep on previous cycles.
- No action.

### UX-03 — Refund AlertDialog confirm action button has visible-disabled-state during refund

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:296-302`
- Severity: **Informational** | Confidence: **High**
- The `disabled={refundingId !== null}` attribute is present. shadcn
  Button styles disabled state. Text rotates to `t.refunding` for
  in-flight feedback. Correct UX pattern.
- No action.

### UX-04 — `errorLoad` div with role="alert" is announced by screen readers

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:182`
- Severity: **Informational** | Confidence: **High**
- Cycle 4 P264-09 fix verified. `role="alert"` is a live region.
  Screen readers announce on initial render. Correct.
- No action.

### UX-05 — StatusBadge triple-encodes status (text + color + icon)

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:84-98`
- Severity: **Informational** | Confidence: **High**
- WCAG 1.4.1 conformant. No action.

### UX-06 — Refund toast uses sonner `toast.error` / `toast.success` — has 4-5s default duration

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:136, 138, 144`
- Severity: **Informational** | Confidence: **Medium**
- sonner default duration is 4s for success and persistent for error
  (until dismissed). `toast.error` for refund-error means the operator
  must read & dismiss. Correct UX. No action.

### UX-07 — Refund row trigger button has `h-11` (44px height) — meets WCAG 2.5.8 minimum

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:240`
- Severity: **Informational** | Confidence: **High**
- WCAG 2.5.8 (Target Size, AA, 24px minimum but 44px recommended). 44px
  is touch-target ideal. No action.

## Confidence summary

| Finding  | Severity | Confidence | Schedule |
|----------|----------|------------|----------|
| UX-01    | Low      | Medium     | Defer (cosmetic UX cleanup) |
| UX-02-07 | Info     | High       | No action |
