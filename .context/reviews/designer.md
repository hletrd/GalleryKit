# UI/UX + Accessibility Review — Cycle 3

## Scope / inventory
Reviewed the repository’s public and admin UI surface area, with emphasis on:

- Public routes: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `s/[key]/page.tsx`, `g/[key]/page.tsx`
- Layout/navigation: `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/(public)/layout.tsx`, `apps/web/src/components/nav.tsx`, `nav-client.tsx`, `footer.tsx`
- Core gallery interactions: `home-client.tsx`, `photo-viewer.tsx`, `lightbox.tsx`, `photo-navigation.tsx`, `image-zoom.tsx`, `info-bottom-sheet.tsx`, `search.tsx`, `tag-filter.tsx`, `load-more.tsx`
- Admin surface: `admin/layout.tsx`, `admin/login-form.tsx`, dashboard, categories, tags, SEO, settings, password, DB pages and managers
- Shared a11y/i18n infrastructure: `globals.css`, `theme-provider.tsx`, `i18n/request.ts`, `lib/constants.ts`, `locale-path.ts`

Browser check on the local app was successful at `/en`: the page rendered with `lang="en"`, the theme class was `light`, the gallery content loaded, and the main navigation had an accessible name. I used DOM/role/focus evidence because `page.accessibility.snapshot()` was not available in the installed Playwright build.

## Confirmed issues

### 1) Invalid nested interactive control in the photo download action
- **Location:** `apps/web/src/components/photo-viewer.tsx:528-538`
- **Selector / region:** `CardFooter > a[href] > Button`
- **Why it matters:** This nests a button inside a link. That is invalid HTML and can confuse keyboard users and assistive tech because there are two interactive semantics competing for the same control.
- **Failure scenario:** A screen reader user may hear inconsistent roles/names, and a keyboard user may get unexpected click behavior depending on how the browser resolves the nested interactive elements.
- **Suggested fix:** Make the link the only interactive element. The cleanest option is `Button asChild` with the anchor inside it, or style the `<a>` directly as a button.
- **Confidence:** High

### 2) Mobile info bottom sheet claims modal semantics without modal behavior in peek/collapsed states
- **Location:** `apps/web/src/components/info-bottom-sheet.tsx:140-188` and `:31-39`
- **Selector / region:** `FocusTrap active={isOpen && sheetState === 'expanded'}` combined with `role="dialog" aria-modal="true"`
- **Why it matters:** In `peek` state, the sheet is exposed as a modal dialog but the focus trap is disabled until the user expands it. There is also no explicit close button visible in the peek state, so the only dismissal paths are gesture-based or Escape/backdrop interactions.
- **Failure scenario:** On smaller screens, keyboard users can tab out into the underlying page while the screen reader is told a modal dialog is open. That mismatch is a real WCAG/ARIA problem and makes the sheet harder to dismiss or understand.
- **Suggested fix:** Either:
  1. remove modal semantics until the sheet is fully expanded, or
  2. keep it modal at all times and provide an explicit close button plus always-on focus containment.
- **Confidence:** High

### 3) Alias delete icon in the category editor has no accessible name
- **Location:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:261-269`
- **Selector / region:** inline `<button>` containing only the `X` icon
- **Why it matters:** This is an icon-only control with no `aria-label`, no visible text, and no title. Screen reader users will encounter an unnamed button and keyboard users will not know what it does.
- **Failure scenario:** In the topic editor, each alias chip shows a small X button. Without an accessible name, the user cannot tell whether it deletes the alias, removes the chip, or closes the dialog.
- **Suggested fix:** Add a localized label such as `aria-label={t('categories.deleteAlias', { alias })}` and keep the button `type="button"`.
- **Confidence:** High

### 4) Loading states are hardcoded in English
- **Location:** `apps/web/src/app/[locale]/loading.tsx:1-7` and `apps/web/src/app/[locale]/admin/(protected)/loading.tsx:1-7`
- **Selector / region:** `aria-label="Loading"`
- **Why it matters:** The app supports English and Korean, but the route-transition loading announcements are hardcoded to English.
- **Failure scenario:** Korean users navigating between routes will hear an English loading announcement from assistive tech even though the rest of the interface is localized.
- **Suggested fix:** Localize the loading label with `next-intl` or a shared translated loading component.
- **Confidence:** Medium-High

## Risks / watch items

### 1) Search overlay combobox semantics are a little mismatched
- **Location:** `apps/web/src/components/search.tsx:136-165`
- **Why it matters:** The input is declared as a combobox, but `aria-expanded` is tied to `results.length > 0`, not to the actual open state of the overlay/dialog. When the dialog is open but the query is empty or still loading, AT may hear a collapsed combobox inside an open modal.
- **Risk level:** Moderate
- **Suggested improvement:** Consider using `aria-expanded={isOpen}` on the trigger/popup model, or simplify the pattern to a modal search dialog with a plain text input and a results list.

### 2) RTL is not currently supported by the locale model
- **Location:** `apps/web/src/lib/constants.ts:1-4`, `apps/web/src/i18n/request.ts`
- **Why it matters:** The app only ships `en` and `ko`, and there is no `dir` management. That is fine for the current locale set, but it means the layout is not future-ready for Arabic/Hebrew or other RTL locales.
- **Risk level:** Low for current release, higher if internationalization expands.
- **Suggested improvement:** If RTL becomes a roadmap item, add locale-driven `dir` handling and verify nav, dialogs, and masonry layout under RTL.

## Positive findings
- Skip links are present for both public and admin layouts.
- The main nav, search button, lightbox, and navigation controls have accessible names.
- The homepage and admin loading states exist, and the public gallery uses reduced-motion handling in CSS.
- Existing Playwright coverage already checks key a11y behaviors like search autofocus/focus trap and lightbox Escape handling (`apps/web/e2e/public.spec.ts`).

## Missed-issues sweep
I re-checked for the most common failure classes before finishing: unlabeled icon buttons, nested interactive controls, modal/dialog focus traps, localized loading strings, and locale/RTL gaps. The four confirmed issues above are the clearest ones I found; the remaining items are risk flags rather than confirmed defects.

## Overall confidence
**High** that the confirmed issues are real, because they are directly visible in the rendered code paths and align with the browser/DOM evidence gathered from the local app.
