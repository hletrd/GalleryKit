# GalleryKit Designer UI/UX Review - Cycle 8

Date: 2026-07-07
Workspace: `/Users/hletrd/flash-shared/gallery`
Lane: designer UI/UX
Mode: review-only. No fixes, commits, pushes, deploys, service changes, file removal, or MySQL mutation.

## Inventory

Read first: `AGENTS.md` and `CLAUDE.md`.

Relevant UI surface inventoried:

- `apps/web/src/app/**`: 80 route/layout/action files. Public routes include home, topic, photo, shared link/group, smart collection, map, timeline, year archive, privacy, loading, error, and not-found. Admin routes include login plus dashboard, categories, tags, settings, SEO, DB, password, tokens, users, analytics, and route-level loading/error.
- `apps/web/src/components/**`: 61 UI/component files. Key surfaces reviewed: `nav-client.tsx`, `search.tsx`, `home-client.tsx`, `masonry-card.tsx`, `photo-viewer.tsx`, `image-zoom.tsx`, `photo-navigation.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `map/map-client.tsx`, `upload-dropzone.tsx`, `image-manager.tsx`, `tag-input.tsx`, admin nav/header/user manager, and shadcn/Radix primitives.
- `apps/web/messages/en.json`, `apps/web/messages/ko.json`: current LTR locales and admin/public UI strings.
- `apps/web/e2e/**`: 10 Playwright specs, including public navigation/search/lightbox, focus restore, nav visual target checks, hydration, 404 status, swipe visuals, and opt-in admin flows.
- `apps/web/src/__tests__/**`: 340 top-level Vitest files, including touch target audit, focus-visible rings, password form a11y, map/privacy, info bottom sheet, lightbox, HDR contrast, i18n parity, source contracts, error shell, and public/admin UX regressions.

Browser checks used `agent-browser` against `https://gallery.atik.kr` only. Admin protected routes were credential-gated, so admin findings below are source-backed; the unauthenticated login page was verified live.

## Findings

### DES-C8-01 - Admin category/tag/SEO edit failures are toast-only and do not return focus to fields

Severity: Medium
Confidence: High
Status: confirmed

Evidence:

- Category create/update handlers surface server-action errors only through `toast.error(...)`: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:90-123`.
- The category create form has visible labels but no local error state, `aria-invalid`, `aria-describedby`, submit pending state, or invalid-field focus path: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:204-221`.
- The category edit form repeats the same pattern: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:362-382`.
- Tag edit handler is also toast-only for update errors: `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:52-66`; its edit form has no inline error region or invalid-field focus: `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:168-181`.
- SEO settings save returns errors only through toasts, while fields expose help text but no error state or focus target: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42-72` and `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:98-184`.
- Contrast with better local patterns: login uses field errors, `aria-invalid`, `aria-describedby`, and first-invalid focus in `apps/web/src/app/[locale]/admin/login-form.tsx:31-45` and `apps/web/src/app/[locale]/admin/login-form.tsx:65-128`; settings uses field errors plus `focusFirstInvalidSetting` in `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:148-185`.

Failure scenario:

A keyboard or screen-reader admin submits a duplicate slug, invalid tag, invalid SEO locale, or sanitized rejected string. The only feedback is an ephemeral toast. Focus remains on the submit button or wherever the browser leaves it, the failing field is not marked invalid, and the error is not associated with the control. This fails the app's stronger form pattern and risks WCAG 3.3.1/3.3.3 remediation gaps.

Suggested fix:

Use the login/settings pattern: keep per-field/per-form error state, render persistent `role="alert"` or field-level error text, wire `aria-invalid` and `aria-describedby`, focus the first invalid field, and disable/update submit buttons while a request is pending. For server errors that cannot map cleanly to one field, render a form-level alert inside the dialog/card and focus it with `tabIndex={-1}`.

### DES-C8-02 - Tag autocomplete popovers can be clipped inside the admin image table scroller

Severity: Medium
Confidence: Medium
Status: likely

Evidence:

- The image manager wraps the table in a horizontal overflow container: `apps/web/src/components/image-manager.tsx:424-425`.
- Each image row renders `TagInput` inside that table/scroller: `apps/web/src/components/image-manager.tsx:498-531`.
- `TagInput` renders its suggestion list as an absolutely positioned child of its local container, not a portal: `apps/web/src/components/tag-input.tsx:183-232`.
- The suggestion list depends on `z-50`, but z-index cannot escape clipping by an overflow ancestor: `apps/web/src/components/tag-input.tsx:231-275`.

Failure scenario:

On the admin image table, especially at mobile/tablet widths or near the bottom of the visible scroller, opening tag suggestions can place the list outside the scroll container's content box. The dropdown is then partially hidden or requires awkward table scrolling, making pointer selection unreliable and making the combobox feel broken even though keyboard selection still works.

Suggested fix:

Render tag suggestions through a portal/popover layer, or specialize `TagInput` with a Radix Popover/Command surface whose content escapes overflow containers. Add an e2e or component-level regression that mounts `TagInput` inside an `overflow-x-auto` table wrapper and asserts the suggestion list is fully visible/selectable.

## Verified Strengths / Non-Findings

- Information architecture: public navigation exposes site title, topic links, search, theme, locale, footer links, and admin entry. `nav-client.tsx:91-193`, `footer.tsx`, and live `/en` snapshots confirm landmarks and controls.
- Focus and keyboard: search has dialog semantics, focus trap, Escape close, input autofocus, active-descendant listbox navigation, and trigger focus restoration in `search.tsx:319-349` and `search.tsx:402-563`. Existing e2e covers search, lightbox, and info-sheet focus restore.
- Touch targets: public nav, tag filters, footer, photo controls, upload remove buttons, and admin table controls use 44 px floors. The repo has a blocking `touch-target-audit.test.ts`, and live public nav spot checks measured visible controls at 44 px or larger.
- WCAG/page structure: root layout provides skip link, `lang`, `dir`, color-scheme metadata, and public shell landmarks in `apps/web/src/app/[locale]/layout.tsx:102-154`. 404 pages now set a localized title with `NotFoundDocumentTitle` and live `/en/nonexistent-cycle8-designer-check` reported title `Page not found | ATIK.KR Gallery`, H1 `Page not found.`, and a single `noindex`.
- Contrast/dark mode: design tokens define light/dark/OLED foreground, muted, destructive text, and forced-colors handling in `globals.css:13-181`. Live desktop dark-mode smoke kept nav controls readable and target-sized.
- Reduced motion: global reduced-motion CSS clamps animations/transitions and suppresses hover scale transforms in `globals.css:253-279`; photo viewer and navigation also check reduced motion in `photo-viewer.tsx`, `photo-navigation.tsx`, and `image-zoom.tsx`.
- Responsive breakpoints: home masonry mirrors Tailwind columns in `home-client.tsx:26-79` and reserves card geometry in `home-client.tsx:231-269` plus `masonry-card.tsx:50-75`. Live mobile and desktop public pages were usable.
- Loading/empty/error states: search, load-more, upload, tokens, photo loading, public not-found, restore maintenance, map empty state, and home filtered-empty state have visible copy and status/alert coverage where appropriate.
- i18n/RTL: current locales are `en` and `ko` in `apps/web/src/lib/constants.ts:1-4`; root layout sets `dir={getLocaleDirection(locale)}`. No active RTL locale ships, so RTL is a future-launch review requirement rather than a current defect.
- Perceived performance: public home uses responsive image `srcset`, above-fold priority, content visibility, intrinsic reservation, and no live CLS entries in the browser smoke. LCP was not exposed by the browser CLI run, so no LCP defect is claimed.

## Final Sweep

No fixes were implemented. No tests, builds, services, deployments, commits, pushes, or database/container operations were run. The temporary MySQL container was not touched.

This cycle leaves two UI/UX findings: one confirmed admin form feedback/accessibility gap and one likely autocomplete clipping issue in the admin image table. Everything else reviewed is either covered by existing tests/source contracts or requires authenticated admin browser access for deeper live verification.
