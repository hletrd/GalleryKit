# Cycle 72 Designer / Accessibility Review

Scope: static source inspection; no files edited and no browser run.

## Inventory

- Public gallery layout/navigation, home masonry, search modal, photo viewer, lightbox, zoom, bottom sheet, map, similar photos, wide-gamut/HDR affordances.
- Admin dashboard/settings/uploads/image manager/categories/tags/users/tokens.
- i18n messages, UI primitives, touch-target and reduced-motion source contracts.

## Findings

### C72-07 - Settings validation ignores reduced-motion preference and the test suite locks it

- Severity/confidence: Medium / High.
- File/line: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:167`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:171`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:174`, `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:15`, `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:23`, existing good pattern `apps/web/src/components/home-client.tsx:448`.
- Evidence: `focusFirstInvalidSetting()` always calls `scrollIntoView({ behavior: 'smooth' })`. The source contract currently requires that literal call.
- Failure scenario: admins who prefer reduced motion still receive smooth animated scrolling when invalid settings are focused.
- Suggested fix: gate smooth scrolling through `window.matchMedia('(prefers-reduced-motion: reduce)')` and update the source contract to require the branch.

### C72-08 - Swipe navigation haptics do not respect reduced-motion preference

- Severity/confidence: Low / Medium.
- File/line: `apps/web/src/components/photo-navigation.tsx:28`, `apps/web/src/components/photo-navigation.tsx:127`, `apps/web/src/components/photo-navigation.tsx:129`, `apps/web/src/components/photo-navigation.tsx:135`.
- Evidence: the component tracks `shouldReduceMotion`, but `navigator.vibrate()` calls do not use it.
- Failure scenario: devices that support vibration can trigger haptics during swipe navigation even when reduced motion is enabled.
- Suggested fix: skip haptics when `shouldReduceMotion` is true.

## Final Sweep

No new actionable findings in keyboard focus trapping, modal restoration, public navigation touch targets, i18n key coverage, empty/loading states, forced-colors handling, or photographer-facing color/HDR labeling.
