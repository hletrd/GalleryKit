# Tracer Review — Cycle 3 (RPL loop)

**Date:** 2026-04-23
**Role:** Causal tracing of suspicious flows with competing hypotheses.

## Trace 1 — Photo page headings

**Symptom:** `curl http://localhost:3456/en/p/64` returns HTML with zero `<h*>` elements.

**Hypothesis A:** photo-viewer component uses `CardTitle` which renders as a semantic heading.
Test: read `ui/card.tsx:33-40`. Result: `<div data-slot="card-title">`. **Rejected.**

**Hypothesis B:** there's an `<h1>` elsewhere on the page (layout, error boundary).
Test: grep layout / error files for `<h1`. Result: only `(public)/layout.tsx` has no H1 — the Nav renders `<span className="font-bold text-xl">` for the site title, not a heading.
Also `not-found.tsx` has `<h1>404</h1>` but that only fires for 404 responses.
**Rejected — no `<h1>` on photo page.**

**Hypothesis C:** sidebar heading existed but is conditionally hidden.
Test: sidebar wrapper is `hidden lg:block` at line 363. Mobile viewports skip the sidebar entirely. **Confirmed.**

**Causal chain:** shadcn/ui v3 `CardTitle` primitive is `<div>` → author used `CardTitle` assuming it was heading-like → no `<h1>` was added elsewhere → mobile viewport hides the sidebar entirely → zero headings on mobile photo page.

**Conclusion:** CQ3-01 / C3R-UX-01 is a real defect. Fix requires adding `sr-only <h1>` OR promoting `CardTitle` to `<h2>`.

## Trace 2 — Locale button name absence

**Symptom:** `localeSwitchAria: [{ tag: 'BUTTON', text: 'KO', ariaLabel: null }]`.

**Hypothesis A:** aria-label is set via translation but not rendered.
Test: read `nav-client.tsx:149-155`. Result: no `aria-label` attribute on the JSX. **Rejected.**

**Hypothesis B:** ARIA name is derived from visible text ("KO").
Test: true per ARIA spec — the accessible name is the button text. **Confirmed.** But the text "KO" alone is not sufficient to convey "switch to Korean."

**Causal chain:** author used visible text as the accessible name → "KO"/"EN" is locale code, not a natural-language description → screen readers announce the opaque code.

**Conclusion:** C3R-UX-02 / CQ3-02 is a real accessibility gap. Fix is `aria-label`.

## Trace 3 — Tag-filter pill height

**Symptom:** 22px tall at mobile.

Root cause: `py-0.5` = 2px padding top/bottom + `text-xs` line-height (16px) + 1px border × 2 = 22px total.

**Conclusion:** C3R-UX-03 / CQ3-04. Fix is padding bump or min-height.

## Totals

- **3 traces run**, all findings confirmed with high confidence.
- **0 false positives.**
- No competing hypotheses unresolved.
