# Cycle 68 UI / Accessibility Review

Reviewer: Cycle 68 UI/accessibility
Date: 2026-07-01
Scope: Next.js gallery web UI, WCAG 2.2 accessibility, keyboard/focus behavior, touch targets, responsive layout, loading/empty/error states, i18n, photographer-facing product honesty, and perceived performance.

## Result

No new actionable UI/accessibility findings.

Confidence: medium-high. This was a source-backed review with focused regression tests. I did not start a browser/dev server in this pass; the inspected code and existing tests cover the highest-risk public/admin interaction surfaces, and no source-backed user failure was found.

## Required Context Read

- `AGENTS.md`: git/deploy/schema/quality-gate and review constraints.
- `CLAUDE.md`: architecture, public/admin route model, color/HDR policy, search/product-honesty rules, operation constraints, and quality gates.
- `.context/plans/README.md`: plan/review artifact conventions.
- `.context/reviews/cycle-67-2026-07-01/_aggregate.md`: prior-cycle aggregate. I avoided re-raising deferred or carry-forward items unless current source evidence changed severity.

## Inventory Inspected

Public route and state surfaces:

- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/photos/page.tsx`
- `apps/web/src/app/[locale]/(public)/photos/[slug]/page.tsx`
- `apps/web/src/app/[locale]/(public)/topics/page.tsx`
- `apps/web/src/app/[locale]/(public)/topics/[slug]/page.tsx`
- `apps/web/src/app/[locale]/(public)/tags/[tag]/page.tsx`
- `apps/web/src/app/[locale]/(public)/map/page.tsx`
- `apps/web/src/app/[locale]/loading.tsx`
- `apps/web/src/app/[locale]/error.tsx`
- `apps/web/src/app/[locale]/not-found.tsx`

Admin route and workflow surfaces:

- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx`
- `apps/web/src/app/[locale]/admin/login/login-form.tsx`

Shared UI/component surfaces:

- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/tag-input.tsx`
- `apps/web/src/components/image-zoom.tsx`
- `apps/web/src/components/similar-photos.tsx`
- `apps/web/src/components/map/map-client.tsx`
- `apps/web/src/components/use-modal-tree-isolation.ts`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- Relevant accessibility/i18n/UI tests under `apps/web/src/__tests__/` and browser-flow tests under `apps/web/e2e/`.

## Evidence

Focused checks passed:

```text
npm test --workspace=apps/web -- --run \
  src/__tests__/touch-target-audit.test.ts \
  src/__tests__/focus-visible-links-scan.test.ts \
  src/__tests__/a11y-us-p15.test.ts \
  src/__tests__/i18n-key-parity.test.ts \
  src/__tests__/search-status-source.test.ts \
  src/__tests__/settings-backfill-warning.test.ts \
  src/__tests__/settings-backfill-warning-source.test.ts \
  src/__tests__/semantic-search-settings-ui.test.ts

Test Files 8 passed
Tests 54 passed
```

Source-backed coverage notes:

- Touch target regression coverage scans component, admin, and public app surfaces in `apps/web/src/__tests__/touch-target-audit.test.ts:44-94`.
- Focus-visible regression coverage scans links/buttons and preserves explicit exceptions in `apps/web/src/__tests__/focus-visible-links-scan.test.ts:55-64` and `apps/web/src/__tests__/focus-visible-links-scan.test.ts:214-247`.
- Navigation exposes labeled 44 px-class controls, mobile expansion, topic overflow, search, theme, and locale controls in `apps/web/src/components/nav-client.tsx:101-190`.
- Search modal keeps a combobox/listbox pattern, live result status, IME-aware keyboard handling, and production-vs-stub semantic-search honesty copy in `apps/web/src/components/search.tsx:148-222`, `apps/web/src/components/search.tsx:394-403`, and `apps/web/src/components/search.tsx:479-557`.
- Public gallery cards and empty/back-to-top states keep visible focus treatment and meaningful image links in `apps/web/src/components/home-client.tsx:276-280`, `apps/web/src/components/home-client.tsx:316-413`, and `apps/web/src/components/home-client.tsx:430-464`.
- Photo viewer keyboard repeat guarding is present in `apps/web/src/components/photo-viewer.tsx:371-376`; viewer controls, EXIF/color disclosure, mobile sheet entry, and download semantics are covered across `apps/web/src/components/photo-viewer.tsx:541-555`, `apps/web/src/components/photo-viewer.tsx:667-770`, and `apps/web/src/components/photo-viewer.tsx:935-980`.
- Lightbox keyboard repeat guarding is present in `apps/web/src/components/lightbox.tsx:309-311`; dialog/focus-trap controls and toolbar affordances are present in `apps/web/src/components/lightbox.tsx:452-688`.
- Mobile info bottom sheet uses a dialog/focus-trap pattern with close, drag, metadata, color, and download controls in `apps/web/src/components/info-bottom-sheet.tsx:188-239` and `apps/web/src/components/info-bottom-sheet.tsx:290-541`.
- Modal tree isolation restores prior `aria-hidden` and `inert` state on cleanup in `apps/web/src/components/use-modal-tree-isolation.ts:19-65`.
- Upload workflow exposes disabled/drop states, progress status, per-file status, and keyboard-reachable remove controls in `apps/web/src/components/upload-dropzone.tsx:373-454`, `apps/web/src/components/upload-dropzone.tsx:456-489`, and `apps/web/src/components/upload-dropzone.tsx:493-590`.
- Admin image management exposes bulk actions, selection controls, edit/delete dialogs, and accessible table actions in `apps/web/src/components/image-manager.tsx:321-430`, `apps/web/src/components/image-manager.tsx:424-600`, and `apps/web/src/components/image-manager.tsx:611-666`.
- Settings backfill warnings now use the shared warning helper/key set and expose warning/status text before destructive save flow in `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:13-15`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:180-185`, and `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:319-437`.
- Map page provides a non-map photo list fallback and keyboard-oriented helper copy in `apps/web/src/app/[locale]/(public)/map/page.tsx:62-103`; marker popup controls are labeled in `apps/web/src/components/map/map-client.tsx:107-141`.
- Tag input follows combobox/listbox conventions with active descendant, IME-aware keyboard handling, and removable chips in `apps/web/src/components/tag-input.tsx:183-277`.

## Missed-Issue Sweep

I swept current route/component/message/test surfaces for custom interactive controls, `role`, `tabIndex`, `aria-*`, focus-visible styling, `sr-only` status text, loading/empty/error language, and button/link sizing patterns. The candidate areas that historically produce WCAG 2.2 failures - modal focus isolation, listbox/combobox active descendant behavior, media viewer keyboard shortcuts, admin bulk actions, upload progress, semantic-search honesty labels, and responsive public gallery controls - had current source-backed coverage or explicit implementation safeguards.

The Cycle 67 lightbox keyboard-repeat finding is not re-raised because the current implementation contains repeat guards in both viewer layers: `apps/web/src/components/lightbox.tsx:309-311` and `apps/web/src/components/photo-viewer.tsx:371-376`.
