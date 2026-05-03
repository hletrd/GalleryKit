# Cycle 4 RPF (end-only) — Designer (UI/UX)

## Method
Reviewed sales-client.tsx and photo-viewer.tsx (paid-photo flow) for IA, focus
flow, keyboard nav, ARIA, dark/light mode, i18n adequacy. No new screen builds
this cycle; cycle 3 RPF closed the major sales-client UI work (P262-08 button
variant + P262-10 errorLoad i18n).

## Findings

### LOW

#### C4-RPF-UX-01 — Refund AlertDialog confirm button shows `t.refunding` while in-flight, but row button shows `t.refunding` too

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:226, 268`
- Both the row button and the AlertDialog confirm button toggle to `t.refunding` simultaneously. The visual feedback is duplicated. Per shadcn convention, only the dialog confirm button should show in-flight state.
- Severity: **Low** | Confidence: **Medium**
- **In-cycle fix:** keep row button at `t.refundButton` text + `disabled` while refunding (the disabled state communicates in-flight); only the AlertDialog confirm rotates text.

#### C4-RPF-UX-02 — `errorLoad` div above the table is not announced to screen readers

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:163-165`
- `<div className="text-destructive text-sm">{t.errorLoad}</div>` lacks `role="alert"` or `aria-live="polite"`. Screen-reader users miss the error.
- Severity: **Low** | Confidence: **High**
- **In-cycle fix:** add `role="alert"` so the live region announces.

#### C4-RPF-UX-03 — Status badge icons are `aria-hidden="true"` (correct); text label provides accessible name

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:91-93`
- Verified. Correct.
- **No action needed.**

#### C4-RPF-UX-04 — Sales table has `<caption className="sr-only">` (correct)

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:172`
- Caption is screen-reader-only and reads `t.title` ("Sales"). Provides table context for AT users.
- **No action needed.**

#### C4-RPF-UX-05 — Refund row button height is `h-11` (44px) — meets WCAG 2.5.5 AAA target size

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:222`
- 44×44 minimum is recommended. Current value 44px height ✓. Width depends on text; "Refund" text is short.
- **No action needed.**

#### C4-RPF-UX-06 — Sales table mobile responsiveness still pending (D04 carry-forward)

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:170-235`
- 7 columns + horizontal scroll. Cycle 2 added `overflow-x-auto`. Mobile users still get a horizontal-scroll table. Not blocking; admin /sales is desktop-primary per defer rationale.
- **Defer (D04 carry-forward).**

#### C4-RPF-UX-07 — Customer email cell needs `break-all` for very long emails

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:199`
- Cosmetic only; cycle 3 deferred (D06).
- **Defer (D06 carry-forward).**

## Aggregate severity

- HIGH: 0
- MEDIUM: 0
- LOW: 2 in-cycle (UX-01, UX-02)
- INFO: 0

## In-cycle scheduling proposal

- C4-RPF-UX-01 — pin row button text while in-flight (only AlertDialog rotates).
- C4-RPF-UX-02 — `role="alert"` on errorLoad div.
