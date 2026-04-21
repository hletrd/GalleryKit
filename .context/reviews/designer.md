# Designer Review — Cycle 1

Scope: repo-wide UI/UX, accessibility, responsive behavior, locale/theme behavior, and perceived performance across the public gallery and admin console.

Methodology:
- Static walkthrough of the routed UI shell, major client components, locale plumbing, and fallback states.
- Chromium inspection on `/en`, `/ko`, and `/en/admin/dashboard`.
- Existing Playwright coverage in `apps/web/e2e/public.spec.ts`, `apps/web/e2e/nav-visual-check.spec.ts`, and `apps/web/e2e/test-fixes.spec.ts` passed locally (9/9), which corroborates the observed focus and responsive flows.

## Executive summary

The app has a strong foundation: localized routing, a real dark/light theme system, landmark-based layout shells, accessible dialogs, and several performance-conscious rendering choices already in place.

The highest-risk UX defects are concentrated in keyboard flow and state semantics rather than in visual polish:

1. A tag-combobox in the admin upload/edit flow traps `Tab` focus.
2. The mobile photo info sheet uses modal dialog semantics even while it behaves like a partially docked sheet.
3. Infinite loading has no visible fallback action if the observer never fires.
4. Loading/error states are accessible but still visually generic.

## Findings

### 1) High — Tag input traps keyboard focus on `Tab`

- **Evidence:** `apps/web/src/components/tag-input.tsx:73-91, 123-203`
- **Verification:** In Chromium on `/en/admin/dashboard`, pressing `Tab` while the tag combobox is open and empty leaves focus on the same input instead of moving to the next control.
- **Failure scenario:** Keyboard users cannot leave the tag field normally in the upload and edit dialogs. This is a hard stop for non-pointer users and makes the admin tagging flow feel broken.
- **Confidence:** High
- **Fix suggestion:** Only intercept `Tab` when a suggestion is actively selected and should be committed. Otherwise allow default tab navigation and close the popup on blur.

### 2) Medium — Mobile info sheet announces itself as a modal even when it is only peeked/docked

- **Evidence:** `apps/web/src/components/info-bottom-sheet.tsx:129-157, 140-157`; usage in `apps/web/src/components/photo-viewer.tsx:548-553`
- **Verification:** On mobile photo pages, the bottom sheet mounts with `role="dialog"` and `aria-modal="true"` while the component supports `collapsed`, `peek`, and `expanded` states.
- **Failure scenario:** Assistive tech can be told “this is a modal dialog” while the page underneath is still partially available and the sheet is not fully modal until the expanded state. That mismatch can confuse screen readers and makes the mobile info experience feel less deterministic.
- **Confidence:** Medium-high
- **Fix suggestion:** Switch semantics by state. Use non-modal sheet semantics for peek/collapsed, and only apply dialog + `aria-modal` when the sheet is truly acting as a blocking modal.

### 3) Medium — Infinite scroll has no explicit fallback control

- **Evidence:** `apps/web/src/components/load-more.tsx:69-96` and `apps/web/src/components/home-client.tsx:313-321`
- **Verification:** The gallery loads the next page only through `IntersectionObserver`; there is no visible “Load more” button or retry action.
- **Failure scenario:** If the observer fails to fire, is unsupported, or a layout change prevents the sentinel from entering view, users have no explicit way to fetch additional photos. This is especially risky for long galleries where the first page is not the full experience.
- **Confidence:** Medium
- **Fix suggestion:** Keep the observer, but add a visible fallback button below the sentinel that calls the same loading path and surfaces retry/error feedback.

### 4) Low — Loading and error states are present but still generic

- **Evidence:** `apps/web/src/app/[locale]/loading.tsx:1-6`, `apps/web/src/app/[locale]/error.tsx:15-35`, `apps/web/src/app/[locale]/not-found.tsx:9-21`, `apps/web/src/app/[locale]/admin/(protected)/loading.tsx:1-7`, `apps/web/src/app/[locale]/admin/(protected)/error.tsx:15-35`
- **Verification:** The route shells render accessible spinners and localized recovery actions, and the app is not missing loading/error boundaries.
- **Failure scenario:** Users know that something is happening, but not which surface is loading or why the fallback appeared. The result is functional, but it reads as default framework chrome rather than a deliberate product experience.
- **Confidence:** Medium
- **Fix suggestion:** Replace the plain spinner with route-specific skeletons or at least contextual headings/subtitles for public gallery vs admin surfaces.

## Strengths worth keeping

- **Clear routed IA and landmarks.** The public shell exposes a skip link and a main landmark in `apps/web/src/app/[locale]/(public)/layout.tsx:10-17`, while the admin shell does the same for `#admin-content` in `apps/web/src/app/[locale]/admin/layout.tsx:12-19`.
- **Locale-aware navigation is coherent.** `apps/web/src/components/nav-client.tsx:44-62` preserves query params on locale switches, and `apps/web/src/i18n/request.ts:4-14` cleanly validates locale selection. In browser checks, `/en` switched to `/ko` and `html[lang]` followed correctly.
- **Theme behavior is real, not cosmetic.** `apps/web/src/app/[locale]/layout.tsx:51-57, 75-93` and `apps/web/src/components/theme-provider.tsx:1-11` wire `next-themes` into the shell; in Chromium the root class toggled from `light` to `dark` when the theme button was pressed.
- **Desktop/mobile behavior is intentionally different.** The public nav collapses to a single expand control on mobile and exposes search/theme/locale buttons on desktop (`apps/web/src/components/nav-client.tsx:65-154`). Playwright checks in `apps/web/e2e/nav-visual-check.spec.ts:4-33` and `apps/web/e2e/test-fixes.spec.ts:15-42` confirm the responsive split.
- **Photo-viewer interaction is thoughtfully built.** `apps/web/src/components/photo-viewer.tsx:53-140, 221-554`, `apps/web/src/components/lightbox.tsx:188-301`, `apps/web/src/components/photo-navigation.tsx:193-224`, and `apps/web/src/components/image-zoom.tsx:116-145` show a layered interaction model with keyboard shortcuts, touch gestures, and accessible labels.
- **Perceived performance is better than average.** `apps/web/src/app/[locale]/(public)/page.tsx:15-70, 116-133` uses `revalidate=3600` and structured data; `apps/web/src/app/[locale]/globals.css:150-165` uses `content-visibility:auto`; `apps/web/src/components/home-client.tsx:228-275` prioritizes above-the-fold images; and `apps/web/src/components/load-more.tsx:73-84` avoids eager pagination work.
- **Locale content is complete.** A key-parity sweep across `apps/web/messages/en.json` and `apps/web/messages/ko.json` found no missing translation keys.

## Final missed-issues sweep

- Rechecked the public shell, photo viewer, admin shell, and admin feature pages (`settings`, `seo`, `password`, `users`, `tags`, `categories`, `database`) for unlabeled controls, missing landmarks, and broken recovery states. The major patterns are consistent and well-labeled.
- Re-ran the i18n path and theme behavior in the browser: locale switching updates the route and `html[lang]`, and the theme toggle updates the root theme class.
- The remaining watch-out is the masonry/gallery ordering strategy in `apps/web/src/components/home-client.tsx:14-77, 209-307`. I did **not** confirm a bug there, but any future keyboard audit should verify that visual scan order and tab order still feel natural as the column count changes.
- No additional high-severity UI/a11y issues surfaced beyond the four findings above.

# Designer Review — Cycle 2 Addendum

Scope: re-audit of the live gallery UI and admin surfaces with a focus on IA, affordances, keyboard/focus navigation, WCAG 2.2, responsive behavior, loading/empty/error states, form validation UX, and mobile/admin ergonomics.

Methodology:
- Reviewed major UI files first: `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/(public)/layout.tsx`, `apps/web/src/app/[locale]/globals.css`, `apps/web/src/components/nav.tsx`, `apps/web/src/components/nav-client.tsx`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/tag-filter.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/topic-empty-state.tsx`, `apps/web/src/components/footer.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/photo-navigation.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`, `apps/web/src/components/admin-header.tsx`, `apps/web/src/components/admin-nav.tsx`, `apps/web/src/app/[locale]/admin/login-form.tsx`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`, `apps/web/src/components/image-manager.tsx`, `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`, `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`, `apps/web/src/components/admin-user-manager.tsx`, and `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`.
- Live browser checks on `https://gallery.atik.kr/en`, `https://gallery.atik.kr/en/p/574`, and the `/en` admin login shell; admin dashboard ergonomics were corroborated from source because the demo admin area is gated.

## Findings

### 1) High — Mobile photo metadata is gesture-only, so keyboard and assistive-tech users can open the sheet but not reliably expand it

- **Evidence:** `apps/web/src/components/photo-viewer.tsx:243-251, 557-562`; `apps/web/src/components/info-bottom-sheet.tsx:129-167`
- **Page / selector:** `/en/p/574`; `button:has-text("Info")`; `[role="dialog"]`
- **Failure scenario:** On a phone or tablet with a keyboard, a screen reader, or reduced dexterity, the user can tap the Info button, but the sheet’s meaningful state changes depend on swipe gestures. There are no explicit expand/collapse controls inside the sheet, so EXIF and description content can remain effectively hidden.
- **Confidence:** Medium-high
- **Suggested fix:** Add explicit buttons for expand/collapse inside the sheet, keep swipe as an enhancement, and only treat the sheet as modal/focus-trapped when it is truly expanded.

### 2) High — The admin dashboard’s recent-uploads table is not mobile-friendly and will be painful on narrow screens

- **Evidence:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:28-37`; `apps/web/src/components/image-manager.tsx:300-400`
- **Page / selector:** `/en/admin/dashboard`; `#admin-content table`
- **Failure scenario:** On a phone or narrow tablet, the dashboard stacks the upload panel and the image manager, but the image manager itself stays a dense multi-column table with no horizontal scroll wrapper or card/list fallback. That makes titles, filenames, tags, and action buttons hard to scan and hard to tap.
- **Confidence:** High
- **Suggested fix:** Convert the dashboard list to a responsive card stack below the breakpoint or wrap the table in an explicit horizontal-scrolling region with prioritized columns and preserved action reachability.

### 3) Medium — Admin settings and SEO forms rely on toast-only validation, so malformed input is hard to diagnose and correct

- **Evidence:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:33-55, 128-137`; `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:39-60, 135-165`
- **Page / selectors:** `/en/admin/settings` and `/en/admin/seo`; `#image-sizes`, `#seo-locale`, `#seo-og-image`
- **Failure scenario:** If an admin enters invalid image sizes or an invalid locale string, the save action fails after submission and only a generic toast explains the problem. The user has no field-level error state, no inline guidance, and no automatic focus on the offending control.
- **Confidence:** Medium
- **Suggested fix:** Validate field-by-field inline, surface errors next to the relevant input, and move focus to the first invalid control after save.

### 4) Low — The footer’s Admin link is too faint to meet WCAG contrast expectations on the light theme

- **Evidence:** `apps/web/src/components/footer.tsx:46-48`
- **Page / selector:** `/en`; `footer a[href$="/admin"]`
- **Failure scenario:** The footer link is rendered at `rgba(113, 113, 122, 0.5)` and 12px. On the light background that reads at roughly 1.98:1 contrast, so it is easy to miss and does not meet normal text contrast guidance.
- **Confidence:** High
- **Suggested fix:** Increase the contrast/opacity or make the admin entry point a clearly visible secondary action instead of a faded footer note.

### 5) Low — Tag chips render slug-form labels verbatim, which weakens IA and makes the filter row harder to scan

- **Evidence:** `apps/web/src/components/tag-filter.tsx:50-87`
- **Page / selector:** `/en`; `div[role="group"][aria-label="Tag filter"] button`
- **Failure scenario:** The live filter chips currently show values like `Color_in_Music_Festival` and `Asia_Top_Artist_Festival`. Users must mentally decode slug-style strings, which slows scanning and makes the filter bar look like internal data rather than a curated navigation aid.
- **Confidence:** Medium
- **Suggested fix:** Humanize the display labels at render time or store separate display names for tags so the chip row reads like product copy instead of slugs.

## Missed-issues sweep

- Rechecked the public loading, error, and not-found boundaries (`apps/web/src/app/[locale]/loading.tsx`, `apps/web/src/app/[locale]/error.tsx`, `apps/web/src/app/[locale]/not-found.tsx`) and the admin equivalents (`apps/web/src/app/[locale]/admin/(protected)/loading.tsx`, `apps/web/src/app/[locale]/admin/(protected)/error.tsx`). They are present, localized, and expose recovery actions.
- Rechecked the public shell keyboard flow on `/en`: the skip link works, the nav order is sensible, and the search dialog behaves like a real modal when opened.
- Rechecked the photo viewer and public gallery for obvious missing empty/loading states; the app has a real loading skeleton strategy and a live-region-backed “load more” flow, so no new state-handling regressions surfaced in this pass.
- No additional high-severity accessibility or mobile-ergonomics defects were found beyond the five findings above.
