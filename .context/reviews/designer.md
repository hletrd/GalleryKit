# GalleryKit Designer UI/UX Review - Cycle 9

Date: 2026-07-07
Workspace: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `ff0c79d6`
Lane: designer / UI-UX reviewer
Mode: review-only. No application code changes, commits, pushes, deploys, service changes, file removals, or data mutations.

## Scope And Inventory

Read first: `AGENTS.md` and `CLAUDE.md`.

Review-relevant frontend inventory:

- `apps/web/src/app/[locale]/**`: 51 route, layout, loading, error, not-found, public, and protected admin TSX files. Covered public home/topic/photo/search-adjacent pages, timeline/year archive, map, smart collections, shared links/groups, privacy, login, and protected admin dashboard/settings/categories/tags/SEO/analytics/password/tokens/users/DB surfaces.
- `apps/web/src/components/**`: 61 UI component files. Key reviewed components include `nav-client.tsx`, `search.tsx`, `home-client.tsx`, `masonry-card.tsx`, `grid-picture.tsx`, `optimistic-image.tsx`, `photo-viewer.tsx`, `photo-viewer-loading.tsx`, `photo-navigation.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `map/map-client.tsx`, `upload-dropzone.tsx`, `image-manager.tsx`, `tag-input.tsx`, `load-more.tsx`, `tag-filter.tsx`, `footer.tsx`, admin nav/header/user manager, and shadcn/Radix primitives.
- `apps/web/messages/en.json` and `apps/web/messages/ko.json`: current locale strings and public/admin labels.
- `apps/web/src/__tests__/**`: 342 Vitest files. Review-relevant tests checked include touch target audit, focus-visible scans, focus ring regressions, i18n key parity, password form a11y, HDR badge contrast, analytics layout/touch targets, error shell, not-found restore maintenance, select-item targets, and tag input tests.
- `apps/web/e2e/**`: public, focus restore, nav visual, hydration, swipe visual, 404, and opt-in admin browser specs.
- Excluded generated/build/vendor outputs such as `.next/` and `node_modules/`.

Browser evidence:

- Used `agent-browser` against `https://gallery.atik.kr/ko` because no local authenticated admin runtime/database session was available in this review lane.
- Desktop public page accessibility snapshot confirmed skip link, main navigation, localized nav controls, `main`, H1/H2 structure, photo links with image alt text, load-more control, footer links, and notification region.
- Mobile viewport `390x844` confirmed collapsed menu semantics, expanded mobile nav, search/theme/locale controls, photo grid, and footer structure.
- Search dialog was opened through the browser and confirmed as a modal dialog with labelled combobox, close control, visible status/help text, and semantic-search switch.
- DOM metric checks on the live public page found no active visible controls below the 44 px target floor; only the intentionally offscreen skip link and hidden mobile/desktop alternate controls measured below that threshold.
- No raw screenshots were used as evidence.

## Findings

### DES-C9-01 - Admin category, tag, and SEO save failures are still toast-only

Severity: Medium
Confidence: High
Status: confirmed

Evidence:

- Category create/update server-action errors only call `toast.error(...)` and do not set local error state: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:90-124`.
- The category create form has labels and required fields, but no persistent form alert, `aria-invalid`, error `aria-describedby`, pending submit state, or invalid-field focus target: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:204-222`.
- The category edit form repeats the same pattern: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:362-383`.
- Tag update failures are toast-only: `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:52-66`; the tag edit form has no inline error region or invalid-field focus path: `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:168-181`.
- SEO save failures are also toast-only while fields expose only help text, not error text or invalid state: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42-72` and `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:98-184`.
- Better local pattern exists in login/password/settings forms: login field errors use `aria-invalid`, `aria-describedby`, alert text, and focus recovery in `apps/web/src/app/[locale]/admin/login-form.tsx:48-137`; settings uses field error state and first-invalid focus in `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:65-252`, with field-level `aria-invalid`/alert wiring such as `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:477-543`.

Why it matters:

Ephemeral toast feedback is easy to miss for keyboard, screen-reader, zoomed, or distracted admin users. It also leaves focus on the submit button or a stale field with no association between the failing input and the error, weakening WCAG 2.2 error identification and suggestion behavior for a form-heavy admin workflow.

Concrete failure scenario:

An admin submits a duplicate topic slug, invalid alias-derived topic, invalid tag name, or rejected SEO locale/URL. The save fails, a toast appears briefly, the dialog remains open, and the offending field is not marked invalid or focused. A screen-reader user has to manually rediscover what failed and where to fix it.

Suggested fix:

Reuse the login/settings form pattern. Keep per-form or per-field error state, render persistent `role="alert"` text inside the dialog/card, wire `aria-invalid` and `aria-describedby` to the failing controls, focus the first invalid field or a form-level alert with `tabIndex={-1}`, and reflect pending state on submit buttons.

### DES-C9-02 - Tag autocomplete popovers can be clipped inside the admin image table scroller

Severity: Medium
Confidence: Medium
Status: likely

Evidence:

- The admin image manager wraps the image table in a horizontally scrollable overflow container: `apps/web/src/components/image-manager.tsx:424-425`.
- Each table row renders `TagInput` inside that table cell: `apps/web/src/components/image-manager.tsx:498-531`.
- `TagInput` positions suggestions as an absolutely positioned child of its local container: `apps/web/src/components/tag-input.tsx:183-232`.
- The suggestion list relies on `z-50`, but z-index cannot escape clipping from an overflow ancestor: `apps/web/src/components/tag-input.tsx:231-275`.

Why it matters:

The combobox may be technically keyboard-operable, but pointer and touch users can see a partially hidden suggestion list when the row is near the edge of the scrollport. That makes tag assignment feel unreliable in the image-management workflow.

Concrete failure scenario:

On a tablet-width admin screen, an image row's tag input is inside the horizontally scrollable table. The admin types a tag, the dropdown opens below the row, and the lower suggestions are clipped by the scroller or require awkward table scrolling before they can be clicked.

Suggested fix:

Render suggestions through a portal/popover layer that escapes overflow containers, or use a Radix Popover/Command-style content surface for `TagInput`. Add a regression that mounts `TagInput` inside an `overflow-x-auto` table wrapper and asserts the list remains visible and selectable.

## Verified Non-Findings

- Information architecture: public shell exposes skip link, nav, main, footer, locale/theme/search controls, topic navigation, photo sections, and footer links. Source: `apps/web/src/app/[locale]/layout.tsx:100-156`, `apps/web/src/app/[locale]/(public)/layout.tsx:10-38`, `apps/web/src/components/nav-client.tsx:91-193`, and `apps/web/src/components/footer.tsx:32-65`. Agent-browser snapshots confirmed the same landmarks and labels on desktop/mobile.
- Affordances and keyboard navigation: search uses dialog semantics, focus trap, Escape close, active-descendant listbox navigation, live status text, and focus restoration in `apps/web/src/components/search.tsx:319-563`. Lightbox uses modal dialog semantics, focus trap, live region, keyboard handlers, and 44 px controls in `apps/web/src/components/lightbox.tsx:477-713`.
- WCAG 2.2 touch target floor: public runtime checks and static tests support the 44 px policy. Source evidence includes `apps/web/src/components/nav-client.tsx:112-190`, `apps/web/src/components/tag-filter.tsx:62-123`, `apps/web/src/components/footer.tsx:32-65`, `apps/web/src/__tests__/touch-target-audit.test.ts:42-204`, and `apps/web/e2e/nav-visual-check.spec.ts:6-87`.
- Responsive layout: home masonry tracks Tailwind breakpoints through measured columns and reserved card geometry in `apps/web/src/components/home-client.tsx:26-79` and `apps/web/src/components/home-client.tsx:217-260`; `apps/web/src/components/masonry-card.tsx:67-160` preserves aspect ratios and touchable overlays. Mobile nav was verified live.
- Loading, empty, and error states: route and component states are present for photo loading, load-more, upload progress, filtered empty topics, map loading/empty/truncated lists, timeline empty years, public error, and not-found recovery. Source: `apps/web/src/components/photo-viewer-loading.tsx:8-25`, `apps/web/src/components/load-more.tsx:43-174`, `apps/web/src/components/upload-dropzone.tsx:373-522`, `apps/web/src/app/[locale]/(public)/map/page.tsx:68-113`, `apps/web/src/components/map/map-loader.tsx:24-36`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:139-207`, `apps/web/src/app/[locale]/(public)/error.tsx:22-58`, and `apps/web/src/app/[locale]/(public)/not-found.tsx:22-55`.
- Form validation UX where already hardened: login and password forms have labels, inline alerts, `aria-invalid`, described-by wiring, password visibility controls, pending submit text, and focus recovery in `apps/web/src/app/[locale]/admin/login-form.tsx:48-137` and `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:25-123`.
- Dark, light, OLED, forced-colors, and reduced-motion support: theme tokens, destructive foreground tokens, P3/HDR badge gating, forced-colors overrides, image rendering rules, landscape mobile accommodations, and reduced-motion suppression are centralized in `apps/web/src/app/globals.css:13-300`.
- i18n and RTL: root layout sets `lang` and `dir` in `apps/web/src/app/[locale]/layout.tsx:100-156`, locale routing is constrained to current `en`/`ko` locales, and key parity is tested in `apps/web/src/__tests__/i18n-key-parity.test.ts:1-169`. No RTL locale currently ships, so broad RTL mirroring remains a future-locale review requirement rather than a current defect.
- Perceived performance / LCP / CLS / INP risk: public photo cards use responsive AVIF/WebP/JPEG sources, size hints, above-fold eager/high priority, aspect-ratio reservation, and content-visibility/intrinsic-size in `apps/web/src/components/masonry-card.tsx:67-160`. Photo viewer uses source fallback and eager/high loading for the primary image in `apps/web/src/components/photo-viewer.tsx:440-563`. Home resize work is requestAnimationFrame/debounced in `apps/web/src/components/home-client.tsx:26-79`.

## Prior Items Rechecked

- Cycle-8 `DES-C8-01` remains present and is carried as `DES-C9-01`.
- Cycle-8 `DES-C8-02` remains likely and is carried as `DES-C9-02`.
- Prior analytics table header concern is fixed: protected analytics tables now use scoped headers in `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:99-101`, `145-146`, `176-177`, `210-211`, and `251-252`.
- Prior public search trigger target concern is fixed: `apps/web/src/components/search.tsx:369-384` and `apps/web/src/components/search.tsx:430-462` use 44 px controls/inputs.
- The year-page back arrow is not a current accessible-name failure because it is paired with visible link text in `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:146-154`.
- The password confirmation summary ID remains a non-finding because the input is described by the actual inline error ID in `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:59-113`.

## Final Sweep

Commonly missed areas checked: landmarks, heading order, skip links, touch targets, focus-visible coverage, modal focus traps, focus restoration, active-descendant comboboxes, admin table actions, file upload progress, empty states, destructive/error colors, forced-colors mode, reduced motion, mobile nav, horizontal overflow tables, image CLS reservation, semantic loading/error states, locale key parity, and current RTL exposure.

No new actionable UI/UX defects were found beyond the two carried current findings above. Authenticated protected admin pages were not loaded through a live browser because credentials/runtime state were unavailable; those surfaces were reviewed through source and tests instead.
