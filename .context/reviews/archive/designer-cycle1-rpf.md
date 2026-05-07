# Designer UI/UX Review — Cycle 1, Prompt 1

**Repo:** `/Users/hletrd/flash-shared/gallery`

## Method
- Reviewed the frontend as a Next.js app-router UI (`apps/web`).
- Inspected the full set of UI-relevant routes, shared components, primitives, styles, public assets, translations, design/config docs, and UI-facing tests listed in the inventory below — no sampling.
- Loaded the live app in a browser at `http://127.0.0.1:3456/en` and `http://127.0.0.1:3456/en/p/111` on desktop and mobile viewport sizes, then cross-checked rendered controls, titles, button labels, and responsive affordances via DOM/text evidence.
- Focused on IA, affordances, keyboard/focus, WCAG 2.2, responsive behavior, loading/empty/error states, validation UX, dark/light mode, i18n/RTL, and perceived performance.

## Inventory of UI-relevant files examined

### App shell and routes
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/globals.css`
- `apps/web/src/app/[locale]/loading.tsx`
- `apps/web/src/app/[locale]/error.tsx`
- `apps/web/src/app/[locale]/not-found.tsx`
- `apps/web/src/app/global-error.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/loading.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/error.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/password-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`

### Shared UI components
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/topic-empty-state.tsx`
- `apps/web/src/components/optimistic-image.tsx`
- `apps/web/src/components/image-zoom.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/histogram.tsx`
- `apps/web/src/components/tag-input.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/i18n-provider.tsx`
- `apps/web/src/components/theme-provider.tsx`
- `apps/web/src/components/lazy-focus-trap.tsx`

### UI primitives
- `apps/web/src/components/ui/alert-dialog.tsx`
- `apps/web/src/components/ui/alert.tsx`
- `apps/web/src/components/ui/aspect-ratio.tsx`
- `apps/web/src/components/ui/badge.tsx`
- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/card.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/ui/dropdown-menu.tsx`
- `apps/web/src/components/ui/input.tsx`
- `apps/web/src/components/ui/label.tsx`
- `apps/web/src/components/ui/progress.tsx`
- `apps/web/src/components/ui/scroll-area.tsx`
- `apps/web/src/components/ui/select.tsx`
- `apps/web/src/components/ui/separator.tsx`
- `apps/web/src/components/ui/sheet.tsx`
- `apps/web/src/components/ui/skeleton.tsx`
- `apps/web/src/components/ui/sonner.tsx`
- `apps/web/src/components/ui/switch.tsx`
- `apps/web/src/components/ui/table.tsx`
- `apps/web/src/components/ui/textarea.tsx`

### Public assets, styling, and docs
- `apps/web/public/fonts/PretendardVariable.woff2`
- `apps/web/public/histogram-worker.js`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/README.md`
- `apps/web/components.json`
- `apps/web/next.config.ts`
- `apps/web/tailwind.config.ts`
- `apps/web/playwright.config.ts`
- `apps/web/vitest.config.ts`
- `apps/web/eslint.config.mjs`
- `apps/web/src/site-config.example.json`

### UI-facing tests reviewed
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/e2e/origin-guard.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`
- `apps/web/src/__tests__/lightbox.test.ts`
- `apps/web/src/__tests__/tag-input.test.ts`
- `apps/web/src/__tests__/upload-dropzone.test.ts`
- `apps/web/src/__tests__/error-shell.test.ts`
- `apps/web/src/__tests__/shared-page-title.test.ts`
- `apps/web/src/__tests__/gallery-config-shared.test.ts`
- `apps/web/src/__tests__/photo-title.test.ts`
- `apps/web/src/__tests__/clipboard.test.ts`
- `apps/web/src/__tests__/validation.test.ts`
- `apps/web/src/__tests__/session.test.ts`
- `apps/web/src/__tests__/public-actions.test.ts`

## Findings

### 1) Mobile info sheet is modal, but its touch handling blocks normal scrolling and it has no explicit close control
**Severity:** Medium
**Confidence:** High
**Status:** Confirmed

**Files / regions:**
- `apps/web/src/components/info-bottom-sheet.tsx:54-64` — `handleTouchMove` calls `e.preventDefault()` for every touch move once a touch starts in the sheet.
- `apps/web/src/components/info-bottom-sheet.tsx:141-157` — the sheet becomes focus-trapped and `aria-modal="true"` when expanded, with `overflowY: 'auto'`.
- `apps/web/src/components/info-bottom-sheet.tsx:190-217` — the expanded content is the only path to the detailed EXIF/info view, but there is no visible close button in the sheet chrome.

**User failure scenario:**
On a phone, a user opens the info panel to read metadata. Any attempt to scroll the sheet content starts a touch sequence that prevents default scrolling, so the panel can feel frozen or partially inaccessible. Keyboard and screen-reader users also get a modal dialog without an obvious close affordance, relying on Escape, backdrop clicks, or a drag gesture that is not discoverable.

**Suggested fix:**
Use a dedicated drag handle for swipe-dismiss only, and let normal content scrolling pass through. Add an explicit close button in the sheet header or use the built-in `SheetClose` primitive so the dismissal path is obvious and keyboard reachable.

---

### 2) Admin taxonomy/tag dialogs rely on placeholder-only fields, which leaves several important inputs effectively unlabeled
**Severity:** Medium
**Confidence:** High
**Status:** Confirmed

**Files / regions:**
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:168-176` — create-topic dialog uses `Input` controls for label/slug/order with placeholders only.
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:243-253` — edit-topic dialog repeats the same pattern.
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:147-155` — edit-tag dialog uses a placeholder-only text field.
- `apps/web/src/components/image-manager.tsx:273-287` — batch-add tag dialog also uses a placeholder-only text field.

**User failure scenario:**
Screen reader users, speech-control users, and anyone coming back to a partially completed modal can’t rely on a persistent label to understand what each field does. Once text is typed, the placeholder disappears entirely, so the purpose of the field becomes ambiguous. This is especially costly in destructive or taxonomy-editing workflows where one wrong value can affect many images.

**Suggested fix:**
Add `<Label htmlFor=...>` for every text input, or at minimum supply `aria-label`/`aria-describedby` where layout is too compact. Keep the placeholder as a hint, not the only label.

---

### 3) Infinite scroll has no manual fallback, so loading more content depends entirely on the IntersectionObserver firing
**Severity:** Low
**Confidence:** Medium
**Status:** Likely risk

**Files / regions:**
- `apps/web/src/components/load-more.tsx:20-94` — the component only exposes a sentinel `div`, spinner, and aria-live region; there is no button or link fallback.
- `apps/web/src/components/home-client.tsx:318-325` — the homepage wires the gallery only to this auto-loading mechanism.

**User failure scenario:**
If the observer doesn’t fire reliably, if scrolling behavior is atypical, or if a user navigates primarily by keyboard/screen reader, the gallery may appear to stop after the first page with no obvious way to request more images.

**Suggested fix:**
Keep the auto-load behavior, but add a visible “Load more” button that triggers the same action. Use it as a fallback when the observer fails or when the user prefers explicit pagination.

## Browser evidence and rendered-state checks
- The live app loaded successfully at `/en` and `/en/p/111`.
- Desktop `/en/p/111` rendered a single H1 (`E2E Portrait`), nav controls, theme/language toggles, fullscreen entry, and next-image navigation.
- Mobile `/en/p/111` exposed the expected mobile controls, including the info affordance and next navigation.
- The home page rendered with the site title, main navigation, and a labeled photo card link (`View photo: E2E Portrait`).
- I did not observe any obvious contrast regression, focus trap failure, or RTL issue in the inspected desktop/mobile states; the app is currently LTR-only and the theme system uses CSS variables plus `next-themes`.

## Missed-issues sweep
Checked and did not flag the following as problems in the current codebase:
- Skip links exist for both public and admin shells.
- Search/lightbox/dialog primitives use focus trapping and ARIA roles appropriately.
- Reduced-motion styles are present in `globals.css` and motion-heavy components consult `prefers-reduced-motion`.
- Dark/light mode is wired through CSS variables and `next-themes`.
- English/Korean localization coverage looked complete in the inspected UI surface.
- Error, loading, and empty states are present for the main public/admin routes.

## Conclusion
The UI is generally well-structured and accessible, but there are a few concrete UX gaps that deserve fixes before the next review cycle: the mobile info sheet needs a real dismissal/scroll model, and several admin modal inputs need explicit labels. The infinite-scroll fallback is a lower-confidence usability risk worth hardening.

No source files were modified; this review artifact is the only file written.
