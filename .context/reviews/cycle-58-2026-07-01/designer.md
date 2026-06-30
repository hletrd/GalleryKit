# Cycle 58 Designer / UI/UX Accessibility Review

HEAD reviewed: `51bca78933a702e237853a509ddce10f13f9ed6b`.

Mode: read-only static inspection. No browser run; no files edited by this lane.

## Finding

### C58-04 - Histogram key-type tooltip trigger is a tiny text-only touch target

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/components/histogram.tsx:704`, `apps/web/src/components/histogram.tsx:706`, `apps/web/src/components/histogram.tsx:717`, `apps/web/src/__tests__/touch-target-audit.test.ts:205`
- User-visible scenario: A mobile visitor or photographer opens photo details, expands the histogram, and tries to tap the "High-key / Low-key / Balanced" explanation. The trigger is a `text-xs` underlined text button with no `min-h-11`, `min-w-11`, padding, or equivalent hit-area class, unlike the adjacent collapse and cycle-mode histogram buttons. This falls below the project's 44 px touch target policy and risks missing WCAG 2.2 target-size expectations on a photographer-facing color/tonal audit surface.
- Suggested fix: Make the tooltip trigger an `inline-flex min-h-11 min-w-11 items-center rounded px-2` target, or add a 44 px info-icon button beside the label while keeping the text visible. Also update the touch-target audit coverage/comment for `histogram.tsx`.

## Inspected Surfaces

- Public gallery/photo flows: home masonry, photo viewer, lightbox, bottom sheet, search dialog, similar photos, map, timeline/year pages, shared photo/group pages, not-found/error states.
- Photographer-facing fidelity surfaces: wide-gamut hint, color details, HDR/P3 badges, histogram, EXIF/admin metadata gating, download menus.
- Admin workflows: login, dashboard, upload dropzone, image manager, category/tag/user managers, settings, SEO, DB backup/restore, token management, analytics.
- Semantics/accessibility checks: skip link/main landmarks, focus-visible rings, dialog/focus traps, keyboard shortcuts, ARIA labels/live regions, empty/loading/error states, touch-target classes, Korean/i18n key parity.

## Validation Evidence

```text
npm test --workspace=apps/web -- src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-rings-cycle17.test.ts src/__tests__/a11y-us-p15.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/color-pipeline-decision-i18n.test.ts src/__tests__/alt-text-fallback.test.ts
Result: 6 files passed, 64 tests passed.
```
