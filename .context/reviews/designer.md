# GalleryKit Designer Review — Cycle 5 Prompt 1

Date: 2026-07-07
Lane: designer
Mode: source-backed UI/UX review, except this artifact.

## Inventory

Examined UI-relevant groups:

- Public routes: home, topic, photo detail, smart collection, share/group, map, timeline, year/archive pages under `apps/web/src/app/[locale]/(public)/**`.
- Admin routes and navigation under `apps/web/src/app/[locale]/admin/**` and `apps/web/src/components/admin-nav.tsx`.
- Components: nav/search/photo-viewer/home-client/upload/settings/admin UI primitives under `apps/web/src/components/**`.
- Styling/accessibility contracts: `apps/web/src/app/globals.css`, UI primitives, touch-target tests, i18n catalogs.
- Browser-flow test evidence: `apps/web/e2e/public.spec.ts`, `apps/web/e2e/focus-restore.spec.ts`, `apps/web/e2e/nav-visual-check.spec.ts`.

No dev server/browser automation was run in this lane because the prompt permits writing only the review artifacts, while local browser validation would create runtime/test artifacts. Findings are therefore code-backed, and live LCP/CLS/INP are listed as manual validation.

## Confirmed Issues

No new confirmed UI blocker was found in this pass. The current source has explicit regression coverage for the highest-risk accessibility areas:

- Search dialog autofocus, focus trap, and focus restore: `apps/web/e2e/public.spec.ts:21-40`.
- Photo page heading hierarchy and lightbox open/close: `apps/web/e2e/public.spec.ts:61-95`.
- Lightbox and mobile info-sheet focus return: `apps/web/e2e/focus-restore.spec.ts:10-75`.
- i18n key parity for English/Korean: `apps/web/src/__tests__/i18n-key-parity.test.ts:1-24` and `apps/web/src/__tests__/i18n-key-parity.test.ts:135-158`.

## Likely Issues

### DES-C5-01 — Search footer shortcut label can be wrong on non-Mac platforms until verified

Evidence:

- `apps/web/src/components/search.tsx:138-142` initializes `isMac` from `navigator.userAgentData?.platform ?? navigator.platform`, but returns `true` when `navigator` is unavailable.
- `apps/web/src/components/search.tsx:516-522` renders the footer shortcut as either `⌘K` or `Ctrl+K`.
- Existing search e2e coverage asserts focus, trap, restore, and results behavior (`apps/web/e2e/public.spec.ts:21-59`), but does not assert the platform-specific footer copy.

Concrete failure scenario:

On Windows/Linux, hydration or test environment differences could leave the footer showing `⌘K` even though users expect `Ctrl+K`. The keyboard handler may still work, but the visible affordance is misleading and reduces discoverability.

Suggested fix:

Move platform detection into a mount-time effect with an explicit default that does not over-promise, or render a neutral "Ctrl/⌘ K" label. Add a browser test that emulates a non-Mac platform and asserts the footer copy.

Confidence: Medium. The source pattern is real; this pass did not run a Windows/Linux browser to prove the UI state.

## Manual-Validation Risks

### DES-C5-M01 — Live Core Web Vitals were not measured in this lane

Evidence:

- The source has performance-conscious patterns and tests, but this lane did not run Lighthouse, Playwright tracing, or Chrome performance capture.
- Public route tests cover behavior and heading/focus contracts, not LCP/CLS/INP metrics.

Risk scenario:

Photo-heavy gallery pages can regress LCP or INP through image sizing, masonry layout, search hydration, or service-worker behavior without being caught by static review alone.

Suggested validation:

Run a local or staging browser pass with representative photo data and measure LCP, CLS, and INP on home, photo detail, topic, and mobile admin routes. Keep findings tied to DOM/code regions, not screenshots alone.

Confidence: Medium.

### DES-C5-M02 — RTL support is structural but not product-ready for a future RTL locale

Evidence:

- `apps/web/src/app/[locale]/layout.tsx:103-109` sets the HTML `lang` and `dir`.
- `apps/web/src/lib/locale-path.ts:37-40` currently has an empty RTL locale set, and the shipped locales are English/Korean.
- Many layouts are written for LTR expectations; current tests validate English/Korean parity, not RTL rendering.

Risk scenario:

If an RTL locale is added, directional spacing, icon direction, focus movement expectations, and gallery/sidebar composition may read wrong even though the root `dir` attribute exists.

Suggested validation/fix:

Before adding an RTL locale, run an RTL design pass over nav, search dialog, photo viewer, admin forms, and masonry controls. Add representative RTL visual/accessibility tests at that time.

Confidence: Medium.

### DES-C5-M03 — Smart collections are not discoverable or authorable from admin UI

Evidence:

- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84-164` renders public smart collections.
- `apps/web/src/app/actions/collections.ts:16-150` provides hardened create/update/delete server actions.
- `apps/web/src/components/admin-nav.tsx:15-25` has dashboard/categories/tags/seo/settings/tokens/password/users/db/analytics links, but no Collections navigation.
- `CLAUDE.md:162` states rows are currently authored by direct DB INSERT and no admin UI invokes these actions.

Risk scenario:

From an information-architecture perspective, a feature exists in route/action code but has no discoverable workflow. Admin users cannot safely create or maintain the public collection surface without direct DB access.

Suggested fix:

Either ship a collections admin section with list/create/edit/delete, validation feedback, and a safe predicate builder, or keep smart collections clearly internal and avoid exposing them as a user-facing capability.

Confidence: High for current UX gap; product priority remains a decision.

## Final Sweep

Covered affordances, keyboard/focus, WCAG 2.2 basics, responsive/mobile risks, loading/error/empty state patterns, dark/light source surfaces, English/Korean i18n, future RTL, and performance validation boundaries. No screenshot-only findings are reported.
