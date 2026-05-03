# designer — Cycle 6 RPF (end-only)

## Method

UX/a11y pass over admin /sales, refund flow, error toasts. Carry-forward
verification of cycle 4 P264-08 and P264-09.

## Findings

### UX-01 — Confirm dialog state-drift (cycle 5 D04 carry-forward)
- **File:** `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:127-148`
- **Severity:** Low | Confidence: Medium
- **What:** carry-forward C5-RPF-D04. Edge case: closing the dialog
  mid-API and opening a different row could in principle desynchronize
  `confirmTarget` and `refundingId`. AlertDialog `disabled` at line 307
  protects the primary path.
- **Status:** carry-forward; deferred again.

### UX-02 — Error toast "Refund failed" is the catch-all default
- **File:** `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:128`
- **Severity:** Informational | Confidence: High
- **What:** The default branch in `mapErrorCode` returns
  `t.refundError` ("Refund failed"). After cycle 4 added explicit
  branches for not-found / invalid-id / no-payment-intent and cycle 5
  added auth-error, the default is reached only on the 'unknown' code.
  When 'unknown' fires, "Refund failed" is the right text — not very
  actionable, but truthful. No fix.
- **Status:** good.

### UX-03 — Sales table mobile responsiveness (cycle 5 D06 carry-forward)
- **Severity:** Low | Confidence: Medium
- **Status:** carry-forward.

### UX-04 — Refund button has h-11 (44px) tap target — meets WCAG 2.5.5 minimum
- **File:** `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:249`
- **Severity:** Informational | Confidence: High
- **What:** good.

### UX-05 — Status badge uses icon + color + text (WCAG 1.4.1 triple-encode)
- **File:** `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:88-102`
- **Severity:** Informational | Confidence: High
- **What:** good (cycle 2 verified).

### UX-06 — `aria-hidden` on icon, label as text in span — sound.
- **File:** sales-client.tsx:98-99.

### UX-07 — Error load surface uses `role="alert"` (cycle 4 P264-09).
- **File:** sales-client.tsx:191. Verified.

## No new UX defects this cycle.

All UX claims from cycles 2-5 hold.
