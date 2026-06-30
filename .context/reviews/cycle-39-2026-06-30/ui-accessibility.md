# Cycle 39 UI / Accessibility Review

Scope: visitor search modal at `addf64ac`.

## UI-C39-01 - Search empty/error status is visible but hidden from assistive tech

Severity: medium.

Evidence:
- `apps/web/src/components/search.tsx:473-476` renders visible no-results/error text with `aria-hidden="true"`.
- `apps/web/src/components/search.tsx:440-449` separately announces transient changes through an `sr-only` live region.

Impact: screen reader users may hear the initial live-region announcement, but the persistent visible empty/error message is not discoverable when navigating the dialog afterward.

Recommendation: keep the live-region announcement and remove `aria-hidden` from the persistent visible status text.
