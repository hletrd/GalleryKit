# Run-4 Cycle 11 — designer (UI/UX + a11y) angle

## Inventory
- `photo-navigation.tsx` (swipe + prev/next buttons, aria-live region),
  touch-target floor on the nav buttons (`h-12 w-12` = 48px ✓).
- Confirmed the c10 admin-delete `failedToDeleteUser` toast is no longer
  reachable for the audit-FK case (DES-R4C10-01 resolved by COR-R4C10-01).

## Observation — DES-R4C11-A (LOW / Medium, deferred candidate)
`photo-navigation.tsx:247-249` renders an `aria-live="polite"` region whose
content is a single constant string `t('aria.photoNavStatus')`:

```jsx
<div className="sr-only" aria-live="polite" aria-atomic="true">
    {prevId !== null || nextId !== null ? t('aria.photoNavStatus') : ''}
</div>
```

An `aria-live` region only announces when its text content *changes*. Because
the string is identical for every photo, navigating prev/next does not change
the node's text, so most screen readers announce nothing on navigation — the
live region is effectively inert for its apparent purpose (announcing the new
photo position). This is a pre-existing minor a11y gap, NOT a regression this
cycle. A real fix would interpolate a changing value (e.g. the photo title or
an index) so each navigation produces a distinct announcement. Deferring:
it is out of this cycle's HARD-SCOPE single-fix budget, requires an i18n
string contract change (new placeholder), and carries no privacy/correctness
risk. Exit criterion: a screen-reader-user report, or a dedicated a11y pass
on the photo viewer.

## No other UI/UX findings
Touch targets on the nav buttons and swipe indicators meet the 44px floor;
focus-within reveals desktop nav buttons; reduced-motion is respected by the
snap transition gating. No contrast or focus-trap issues surfaced on the
nav surface this cycle.
