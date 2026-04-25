# UI/UX Deep Review — Cycle 5

**Repo:** `/Users/hletrd/flash-shared/gallery`
**Scope:** Next.js frontend in `apps/web`
**Outcome:** Review complete; no implementation or commit was performed.

## Method

I reviewed the UI/UX surface statically and then used the local dev server on `http://127.0.0.1:3001` to validate runtime behavior. Where screenshots were captured, I backed the observations with DOM/HTML text, file references, and selector-level evidence instead of relying on images alone.

## Inventory of UI/UX-relevant files

### Routes and shells
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
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/loading.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/error.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`

### Components and primitives
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/topic-empty-state.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/photo-viewer-loading.tsx`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/image-zoom.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/tag-input.tsx`
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/theme-provider.tsx`
- UI primitives under `apps/web/src/components/ui/` including `button.tsx`, `input.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, `select.tsx`, `switch.tsx`, `card.tsx`, `table.tsx`, `alert.tsx`, `textarea.tsx`, `badge.tsx`, `sonner.tsx`

### Messages, config, and tests
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/site-config.json`
- `apps/web/src/lib/constants.ts`
- `apps/web/src/lib/locale-path.ts`
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`
- Key regression tests under `apps/web/src/__tests__/` including `error-shell.test.ts`, `shared-page-title.test.ts`, `upload-dropzone.test.ts`, `tag-input.test.ts`, and related accessibility/data-flow tests

## Findings

### UX-C5-01 — Public gallery chrome is too tightly coupled to DB-backed page data

- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `apps/web/src/components/nav.tsx:6-13`, `apps/web/src/app/[locale]/(public)/page.tsx:18-30,113-173`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:33-56,115-185`
- **Selector / surface:** public chrome under `nav[aria-label="Main navigation"]` and `main#main-content`
- **Evidence:** `Nav()` awaits `getTopicsCached()`, `getSeoSettings()`, and `getGalleryConfig()` in one `Promise.all`. The homepage and topic pages similarly await topics/tags/images before rendering. In the live dev server, `curl http://127.0.0.1:3001/en` returned a Next server error payload showing the failed topics query and MySQL access denial (`Access denied for user ''@'172.17.0.1' (using password: NO)`) instead of a branded gallery shell.
- **Failure scenario:** Any DB outage, credential issue, or temporary data-layer failure collapses the public site into a generic error boundary. Users lose not just content, but also the nav shell and locale controls.
- **Suggested fix:** Split the shell from the data fetches. Keep nav/footer/locale/theme chrome renderable from cached or static inputs, and degrade missing content into a branded empty/maintenance state with a retry path.

### UX-C5-02 — Most admin pages have no route-specific metadata, so tabs and bookmarks are indistinguishable

- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `apps/web/src/app/[locale]/admin/page.tsx:1-16`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:1-38`, `apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx:1-15`, `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx:1-14`, `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx:1-25`, `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx:1-22`, `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx:1-24`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:1-246`, `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx:3-9`
- **Selector / surface:** browser tab title / document metadata
- **Evidence:** Only `password/page.tsx` exports metadata. The other admin pages do not override the root metadata template. Live HTML for `/en/admin` shows `<title>GalleryKit</title>`, which is the same title used across the site rather than a section-specific admin title.
- **Failure scenario:** An operator opens multiple admin tabs or returns to a bookmark later. Without section-specific titles, it is easy to act in the wrong admin area.
- **Suggested fix:** Add a shared admin metadata helper or per-route titles such as `Dashboard | GalleryKit`, `Categories | GalleryKit`, `Settings | GalleryKit`, etc.

### UX-C5-03 — The localized footer still leaks English brand copy on non-English pages

- **Severity:** Low
- **Confidence:** Medium
- **Status:** Likely
- **Files:** `apps/web/src/components/footer.tsx:27-55`, `apps/web/src/site-config.json:10-11`, `apps/web/messages/en.json:572-574`, `apps/web/messages/ko.json:572-574`
- **Selector / surface:** `footer`, `footer p`, and the GitHub anchor text
- **Evidence:** The footer renders `siteConfig.footer_text` verbatim (`Powered by GalleryKit`) and hardcodes the visible `GitHub` label. Only the Admin link label is translated. The KO message file localizes `footer.admin`, but not the footer text itself.
- **Failure scenario:** Korean pages still show mixed-language footer text even though the rest of the shell is localized. It reads as a translation omission rather than an intentional brand choice.
- **Suggested fix:** Either localize the footer copy and labels or explicitly freeze the footer as brand text and make the rest of the footer consistently localized.

### UX-C5-04 — The admin login form is accessible, but the visible labels are hidden behind placeholders

- **Severity:** Low
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `apps/web/src/app/[locale]/admin/login-form.tsx:29-52`
- **Selector / surface:** login inputs `#login-username` and `#login-password`
- **Evidence:** The form has `sr-only` labels and placeholder text only. That preserves accessible names, but users never see persistent field labels in the UI.
- **Failure scenario:** On a small screen or during autofill, users lose the label context once typing begins. That makes the login form slower to scan and a little harder to recover from mistakes.
- **Suggested fix:** Show visible labels or floating labels above the fields. Keep the `sr-only` labels if you want, but do not depend on placeholders as the only visible affordance.

## Missed-issues sweep

I rechecked the areas that previously looked risky and did **not** flag them as current issues:

- Dialog and sheet close labels are localized through `closeLabel`
- Dialog/sheet panels now cap height and allow internal scrolling
- The switch control is no longer undersized on touch screens
- Upload failures are now surfaced inline per file with alert semantics
- `TagInput` accepts contextual accessible labels and callers provide them
- Shared-view photo navigation no longer duplicates the back button in the shared route
- The mobile info sheet now focuses a visible control when opened
- `global-error.tsx` already supports both `en` and `ko` copy, so it is not an English-only fallback
- Reduced-motion support is present in `apps/web/src/app/[locale]/globals.css`
- RTL is not a current product requirement here; the app intentionally ships LTR locales only (`en`, `ko`)

## Files reviewed

### App shell, locale shell, and global styles
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/globals.css`
- `apps/web/src/app/[locale]/loading.tsx`
- `apps/web/src/app/[locale]/error.tsx`
- `apps/web/src/app/[locale]/not-found.tsx`
- `apps/web/src/app/global-error.tsx`

### Public routes and UI
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/topic-empty-state.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/photo-viewer-loading.tsx`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/image-zoom.tsx`

### Admin routes and UI
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/loading.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/error.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx`
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/password-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/tag-input.tsx`

### UI primitives, config, messages, and tests
- `apps/web/src/components/theme-provider.tsx`
- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/input.tsx`
- `apps/web/src/components/ui/badge.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/ui/alert-dialog.tsx`
- `apps/web/src/components/ui/sheet.tsx`
- `apps/web/src/components/ui/select.tsx`
- `apps/web/src/components/ui/switch.tsx`
- `apps/web/src/components/ui/card.tsx`
- `apps/web/src/components/ui/table.tsx`
- `apps/web/src/components/ui/alert.tsx`
- `apps/web/src/components/ui/textarea.tsx`
- `apps/web/src/components/ui/sonner.tsx`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/site-config.json`
- `apps/web/src/lib/constants.ts`
- `apps/web/src/lib/locale-path.ts`
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`
- `apps/web/src/__tests__/error-shell.test.ts`
- `apps/web/src/__tests__/shared-page-title.test.ts`
- `apps/web/src/__tests__/upload-dropzone.test.ts`
- `apps/web/src/__tests__/tag-input.test.ts`
- plus the rest of the existing UI/data regression tests under `apps/web/src/__tests__/`

## Bottom line

The app’s accessible primitives and responsive affordances are in good shape, but the biggest remaining UX risks are still **error resilience**, **wayfinding in admin tabs**, and **localized recovery/brand copy**. The public gallery should not collapse into a generic error shell when the data layer has a bad day.
