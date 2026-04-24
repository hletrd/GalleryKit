# Designer Review — Cycle 1 (2026-04-24)

## Scope and inventory covered
Reviewed the full UI surface of the Next.js app: app shell, public routes, admin routes, shared interaction components, and the shadcn/Radix primitives that shape focus, loading, empty, and error states.

### Inventory
- App shell / route chrome: `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/globals.css`, `apps/web/src/app/[locale]/loading.tsx`, `apps/web/src/app/[locale]/error.tsx`, `apps/web/src/app/[locale]/not-found.tsx`, `apps/web/src/app/global-error.tsx`
- Public routes: `apps/web/src/app/[locale]/(public)/layout.tsx`, `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- Admin routes: `apps/web/src/app/[locale]/admin/layout.tsx`, `apps/web/src/app/[locale]/admin/page.tsx`, `apps/web/src/app/[locale]/admin/login-form.tsx`, `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`, `apps/web/src/app/[locale]/admin/(protected)/loading.tsx`, `apps/web/src/app/[locale]/admin/(protected)/error.tsx`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`, `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`, `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/password/password-client.tsx`, `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`, `apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`, `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx`
- Shared components: `apps/web/src/components/nav.tsx`, `apps/web/src/components/nav-client.tsx`, `apps/web/src/components/footer.tsx`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/tag-filter.tsx`, `apps/web/src/components/tag-input.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/photo-navigation.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/components/image-manager.tsx`, `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/components/admin-header.tsx`, `apps/web/src/components/admin-nav.tsx`, `apps/web/src/components/admin-user-manager.tsx`, `apps/web/src/components/theme-provider.tsx`, `apps/web/src/components/i18n-provider.tsx`, `apps/web/src/components/topic-empty-state.tsx`, `apps/web/src/components/optimistic-image.tsx`, `apps/web/src/components/image-zoom.tsx`, `apps/web/src/components/lazy-focus-trap.tsx`
- UI primitives: `apps/web/src/components/ui/button.tsx`, `input.tsx`, `label.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `dropdown-menu.tsx`, `select.tsx`, `sheet.tsx`, `switch.tsx`, `progress.tsx`, `badge.tsx`, `card.tsx`, `table.tsx`, `textarea.tsx`, `alert.tsx`, `sonner.tsx`, `separator.tsx`, `scroll-area.tsx`, `skeleton.tsx`, `aspect-ratio.tsx`

Browser verification was used where the app would render; code review was used for the remaining surfaces, with screenshots in `.context/*.png` as visual references.

## Findings summary
- Confirmed issues: 6
- Likely issues: 0
- Manual re-check needed: 0

## Confirmed issues

### DES1 — The footer’s admin link is below WCAG contrast at rest
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Evidence:** `apps/web/src/components/footer.tsx:46-48`
  Selector: `footer a[rel="nofollow"]`
- **Why it is a problem:** the admin link is styled as `text-muted-foreground/50`, which produces roughly a 2:1 contrast ratio on the light background. It is visually easy to miss and fails WCAG 1.4.3 for normal-size text.
- **Scenario:** a low-vision or distracted user scans the footer for “Admin” and cannot reliably distinguish it from the rest of the footer copy.
- **Fix:** raise the resting contrast to at least `text-muted-foreground` or `text-foreground/70`, and keep the hover state as the emphasis state instead of the default state.

### DES2 — The tag picker’s keyboard focus is not exposed to assistive tech
- **Severity:** HIGH
- **Confidence:** HIGH
- **Evidence:** `apps/web/src/components/tag-input.tsx:159-217`
  Selectors: `input[role="combobox"][aria-controls="tag-suggestions"]`, `#tag-suggestions [role="option"]`
- **Why it is a problem:** the combobox updates a visual highlight with arrow keys, but the input never gets `aria-activedescendant`, and the highlighted option has no stable id. Screen readers therefore stay on the text box and do not receive the currently highlighted suggestion.
- **Scenario:** an admin uses the arrow keys to choose an existing tag; the UI highlight moves, but VoiceOver/NVDA users get no reliable announcement of the active option and must guess which tag will be inserted.
- **Fix:** assign ids to each suggestion, wire `aria-activedescendant` on the input, and keep the listbox/option pattern fully synchronized with the highlighted row.

### DES3 — Search results mix listbox semantics with link semantics
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Evidence:** `apps/web/src/components/search.tsx:169-231`
  Selector: `#search-results [role="option"]`
- **Why it is a problem:** the search overlay presents a `role="listbox"` of results, but each option is a `Link`. That mixes two interaction models: a listbox expects non-interactive options controlled by the combobox, while a link list expects normal tab stops and link navigation.
- **Scenario:** a keyboard or screen-reader user opens search and hears link semantics inside an option list, which makes the arrow-key and Enter behavior feel inconsistent and harder to predict.
- **Fix:** choose one pattern and commit to it. Either render a true combobox/listbox with non-link options and navigate on selection, or drop the listbox roles and present a standard searchable link list.

### DES4 — Password confirmation errors are not tied to the offending field
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Evidence:** `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:30-99`
  Selector: `input[name="confirmPassword"]`
- **Why it is a problem:** when the confirmation check fails, the form shows a generic alert above the fields, but the confirm input is not marked invalid and the message is not associated with that field. The user gets the error, but not the correction point.
- **Scenario:** an admin mistypes the new password twice, sees an error, and still has to infer which field needs to be fixed. Screen-reader users hear the alert without a clear field-level relationship.
- **Fix:** set `aria-invalid` on the confirm field, connect it to an inline help/error node with `aria-describedby`, and keep the summary alert only as a top-level recap.

### DES5 — Settings and SEO pages silently fall back to blank editors when loading fails
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Evidence:** `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx:6-10`, `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx:6-17`
  Related client shells: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:22-179`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:29-178`
- **Why it is a problem:** both pages convert a failed fetch into a normal-looking editor with blank values/default placeholders. That hides the fact that the data load failed and makes the page look like “empty settings” instead of a recoverable error state.
- **Scenario:** if the settings read is temporarily broken, an admin sees a form that appears valid and may try to save without realizing the page is showing defaults rather than actual persisted values.
- **Fix:** render a visible error/retry state when the read fails, or disable editing until the server confirms the settings payload has loaded successfully.

### DES6 — Infinite scroll has no explicit keyboard or fallback trigger
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Evidence:** `apps/web/src/components/load-more.tsx:67-94`
  Selector: the sentinel container and live region inside `LoadMore` (`div[aria-live="polite"]`)
- **Why it is a problem:** the gallery relies entirely on an `IntersectionObserver` sentinel to fetch more content. That is fine as a progressive enhancement, but there is no visible button or link for users who do not get the sentinel into view or for browsers that do not behave well with the observer.
- **Scenario:** a keyboard-only user reaches the end of the grid and has no deterministic way to request the next page of images, so the gallery appears to stop early even though more content exists.
- **Fix:** keep the sentinel for auto-loading, but add a real “Load more” button/link as a fallback and wire it to the same action.

## Final sweep
No additional UI/UX, accessibility, responsive, loading/empty/error-state, i18n/RTL, or perceived-performance issues were strong enough to report beyond the six above.

---

# Designer Review — Cycle 2 (2026-04-24)

## Scope and inventory covered
I re-reviewed the full UI surface after the earlier cycle, with emphasis on the current Next.js frontend implementation:

- App shell / route chrome: `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/globals.css`, `apps/web/src/app/[locale]/loading.tsx`, `apps/web/src/app/[locale]/error.tsx`, `apps/web/src/app/[locale]/not-found.tsx`, `apps/web/src/app/global-error.tsx`
- Public routes: `apps/web/src/app/[locale]/(public)/layout.tsx`, `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- Admin routes: `apps/web/src/app/[locale]/admin/layout.tsx`, `apps/web/src/app/[locale]/admin/page.tsx`, `apps/web/src/app/[locale]/admin/login-form.tsx`, `apps/web/src/app/[locale]/admin/(protected)/*`
- Shared components: navigation, search, gallery grid, lightbox, photo viewer/navigation, upload dropzone, tag controls, admin managers, error/loading shells, and shadcn/Radix primitives
- Supporting UX helpers: `apps/web/src/lib/locale-path.ts`, `apps/web/src/lib/photo-title.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/image-url.ts`, `apps/web/src/lib/error-shell.ts`, `apps/web/src/lib/clipboard.ts`
- Tests and E2E: `apps/web/src/__tests__/*` and `apps/web/e2e/*` relevant to search, lightbox, nav, tag input, and UI states

Browser verification was attempted against the running dev server. The live gallery route could not fully render because the local database was unavailable in this environment, so the app fell back to the generic error shell. That still confirmed the app boots and that the error boundary copy is active, but it limited runtime inspection of the gallery itself.

## Findings summary
- Confirmed issues: 3
- Likely issues: 0
- Manual re-check needed: 0

## Confirmed issues

### DES7 — The search dialog’s primary input removes its visible focus indicator
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Evidence:** `apps/web/src/components/search.tsx:182-202`
  Selector: `#search-input`
- **Why it is a problem:** the shared `Input` primitive already removes the default outline, and the search overlay then overrides the focus ring with `focus-visible:ring-0`. That leaves the modal’s first focus target with no visible focus affordance beyond the text caret.
- **Scenario:** a keyboard user presses Cmd/Ctrl+K, the dialog opens, and focus lands in the search field. Because the field has no visible ring or border change, it is easy to miss where typing will go.
- **Fix:** restore a visible focus treatment for the search input. A 2px ring or accent border on focus is enough; keep the modal layout but do not zero out the focus ring.

### DES8 — Search results mix listbox semantics with link navigation, so Enter on a typed query does not navigate
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Evidence:** `apps/web/src/components/search.tsx:169-245`
  Selectors: `#search-dialog`, `#search-results [href]`
- **Why it is a problem:** the overlay advertises a `role="listbox"` but each row is a link, not a true option. The keyboard model is also incomplete: pressing Enter only works when a result is arrow-selected; typing a query and pressing Enter does nothing.
- **Scenario:** a user opens search, types a title, and presses Enter expecting the first match to open. Nothing happens unless they first use the arrow keys, which is a poor affordance for a primary navigation tool.
- **Fix:** choose one interaction model and finish it. Either:
  - render a standard searchable link list and let Enter activate the first visible result, or
  - implement a proper combobox/listbox with selectable options and `aria-selected`/`aria-activedescendant` kept in sync.

### DES9 — Upload previews claim support for file types the browser image element cannot reliably display
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Evidence:** `apps/web/src/components/upload-dropzone.tsx:100-102, 321-327`
  Selector: the preview `<img>` inside each file card
- **Why it is a problem:** the dropzone accepts `.arw`, `.heic`, `.heif`, `.tiff`, `.tif`, and other formats, but the preview grid uses a plain `<img src={previewUrl}>`. Many of those formats are not natively renderable in common browsers, so the preview area can be blank or broken even though the file was accepted.
- **Scenario:** a photographer drops a HEIC or RAW file, sees it accepted, and then gets an empty preview tile. The user cannot tell whether the file was imported correctly or whether the preview system failed.
- **Fix:** either narrow the accepted previewable formats, or add a fallback presentation for unsupported types (file badge, icon, dimensions, or server-generated preview) so the UI never shows a broken image tile.

## Final sweep
- I did not find any additional high-confidence issues that were strong enough to report after re-checking the remaining UI files and tests.
- RTL is not currently a shipped concern because the locale set is `en`/`ko`, but the root layout still hard-codes `dir="ltr"` in `apps/web/src/app/[locale]/layout.tsx:79-85`; revisit that if an RTL locale is ever introduced.
