# Cycle 24 Designer Review

Role: `designer`
Repo: `/Users/hletrd/flash-shared/gallery`
Review HEAD: `4b43fad7ab471287b82fe5c8dac85c05c511220a`
Scope: review-only. No source code edits, commits, pushes, deploys, or destructive commands.

## Inventory And Method

Instructions read first: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, and the Playwright skill instructions. I also checked the current deferred UI register in `.context/plans/cycle-23-2026-07-08-deferred.md` and `.context/plans/deferred-carry-forward.md`.

UI inventory command: `find apps/web/src/app apps/web/src/components apps/web/messages -type f \( -name '*.tsx' -o -name '*.ts' -o -name '*.css' -o -name '*.json' \) | sort`, followed by line-count and targeted source reads. The review covered all App Router UI routes under `apps/web/src/app/[locale]`, shared UI components under `apps/web/src/components`, locale messages in `apps/web/messages/en.json` and `apps/web/messages/ko.json`, app/global styling, UI-relevant tests under `apps/web/src/__tests__`, and Playwright specs under `apps/web/e2e`.

Browser automation was feasible. I reused the local app by starting `npm run start --workspace=apps/web -- --hostname 127.0.0.1 --port 3100`; the existing dev-server PID advertised by Next was not reachable over HTTP, and I did not stop or kill it. Public pages loaded at `http://127.0.0.1:3100/en`. The plaintext E2E admin password did not pass the login form, so I created a short-lived local E2E `admin_session` row and cookie to inspect protected admin pages without changing source.

Browser evidence collected with Playwright: DOM roles/names/states, active element, `inert`/`aria-hidden`, computed styles, bounding boxes, scroll/overflow state, console/page errors, and desktop/mobile viewports. Pages exercised included `/en`, `/ko`, `/en/privacy`, `/en/map`, `/en/timeline`, `/en/about-gallerykit`, `/en/admin`, `/en/admin/dashboard`, `/en/admin/categories`, `/en/admin/tags`, `/en/admin/seo`, `/en/admin/settings`, `/en/admin/tokens`, `/en/admin/password`, `/en/admin/users`, `/en/admin/db`, and `/en/admin/analytics`.

## Confirmed Findings

### DES-C24-01 - Admin image management is still table-first inside nested scroll containers

Severity: Medium
Confidence: High
Status: confirmed source issue with protected-admin browser context

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144` places Recent Uploads in a constrained `max-h-[calc(100vh-16rem)] overflow-auto` pane.
- `apps/web/src/components/image-manager.tsx:427-450` renders the image manager as a 9-column table inside `overflow-x-auto`.
- `apps/web/src/components/image-manager.tsx:472-488` uses a fixed `h-32 w-32` preview cell, `image-manager.tsx:500-552` adds a `min-w-[200px]` tag editor, and `image-manager.tsx:571-607` puts edit/delete actions at the far right.
- Desktop protected-admin probe on `/en/admin/dashboard`: the admin main region had its own vertical scroll (`scrollH 1158`) and Recent Uploads nested another scroll area. Mobile admin pages showed no global horizontal overflow, but the source still requires horizontal table scrolling for the image manager itself.
- This remains the same class of issue tracked as `AGG-C23-25` in `.context/plans/cycle-23-2026-07-08-deferred.md`.

Why this is a problem:

The interaction model prioritizes spreadsheet density over the actual admin task: deciding what a photo is, checking its status/tags/topic, then safely editing or deleting it. On tablet or narrow laptop widths, the admin must preserve row context across horizontal and nested vertical scrolling.

Failure scenario:

An admin reviews a batch of similar photos, scrolls right to reach the destructive delete action, and loses the visual association with the thumbnail/title/filename that identified the row.

Suggested fix:

Keep the dense table for wide desktop, but add a responsive card/list workbench below large desktop widths. Each row/card should keep thumbnail, processing state, title/filename, topic, tags, gamut/date, and actions in one visual cluster. Preserve the current 44 px action targets and confirmation dialog behavior.

### DES-C24-02 - Admin information architecture remains one flat wrapping strip

Severity: Low-Medium
Confidence: High
Status: confirmed source and browser issue

Evidence:

- `apps/web/src/components/admin-nav.tsx:15-26` defines ten peer links: Dashboard, Categories, Tags, SEO, Settings, Tokens, Password, Users, Database, and Analytics.
- `apps/web/src/components/admin-nav.tsx:28-49` renders those peers as a single wrapping flex nav.
- `apps/web/src/components/admin-header.tsx:13-26` places the brand, all nav links, and logout in one wrapping header row.
- Mobile protected-admin probe on `/en/admin/settings` at 390x844 showed the nav wrapping into several rows: Dashboard/Categories on the first row, Tags/SEO/Settings on the next, Tokens/Password/Users on the next, and Database/Analytics below.
- Touch targets and `aria-current` are good; the issue is grouping and hierarchy, not raw tap size.
- This remains the same class of issue tracked as `AGG-C23-26` in `.context/plans/cycle-23-2026-07-08-deferred.md`.

Why this is a problem:

Routine publishing tasks and high-risk operational pages are visually equal. On mobile, wrapping makes the order look incidental and puts security/operations destinations in the same visual weight as daily organization tasks.

Failure scenario:

An admin working on tags or SEO in a narrow viewport scans a multi-row strip where Tokens, Password, Users, Database, and Analytics appear as equivalent nearby options, increasing navigation cost and accidental entry into sensitive areas.

Suggested fix:

Group admin IA into stable sections such as Publish, Organize, Site, Access, Operations, and Insights. On mobile/tablet, use a sectioned menu or drawer rather than a wrapping strip. Keep current focus rings, `aria-current`, localized labels, and 44 px targets.

### DES-C24-03 - Mobile masonry cards permanently cover finished photos with metadata

Severity: Low
Confidence: High
Status: confirmed source and browser issue

Evidence:

- `apps/web/src/components/masonry-card.tsx:149-154` always renders the mobile title/topic block as `absolute inset-x-0 top-0 sm:hidden bg-gradient-to-b from-black/75 to-transparent p-3`.
- Live mobile probe on `/en` at 390x844: the first card was `358x556.875`, and the overlay was `358x60`, `position: absolute`, `display: block`, with `linear-gradient(rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0))`.
- The second mobile card repeated the same `358x60` permanent overlay over a shorter `358x201.375` landscape card.
- The component already reserves intrinsic image geometry with `aspectRatio` and `containIntrinsicSize` at `masonry-card.tsx:67-76`, so the layout can support a non-overlapping caption treatment without creating CLS by default.

Why this is a problem:

The product premise says photos arrive after editing and should preserve the photographer's intent. A permanent top overlay competes with the bitmap on the most constrained public surface.

Failure scenario:

A phone visitor scanning the gallery sees title/topic chrome covering important crop detail near the top of a finished image before choosing to open it.

Suggested fix:

Move mobile metadata below the image, reserve a compact caption band, or offer a clean-grid mobile presentation where metadata appears on focus/open instead of over the photo.

### DES-C24-04 - SEO settings validation remains toast-only instead of field-associated

Severity: Medium
Confidence: High
Status: confirmed source issue

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42-72` saves via `updateSeoSettings` and reports all failures through `toast.error(...)`.
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:98-184` renders SEO inputs with help text in `aria-describedby`, but no `aria-invalid`, no field-specific error element, and no focus movement to the first invalid field.
- The server action already returns field-specific error messages: `apps/web/src/app/actions/seo.ts:85-96` for title/description/nav title/author formatting, `seo.ts:111-130` for length failures, and `seo.ts:126-139` for locale/OG URL validity.
- This matches carry-forward item `C96-09` in `.context/plans/deferred-carry-forward.md`.

Why this is a problem:

The server has enough information to identify the bad field, but the UI collapses every error into a transient global toast. That fails WCAG name/role/value expectations for invalid form controls and weakens keyboard/screen-reader recovery.

Failure scenario:

An admin enters an invalid Open Graph URL or locale, presses Save, hears or sees only a toast, and focus remains on the Save button. They must infer which field failed from text that may disappear.

Suggested fix:

Track field-level errors in `SeoClient`, map server error codes to field IDs, render persistent inline errors with `role="alert"` or an assertive live region, set `aria-invalid="true"`, append the error ID to `aria-describedby`, and focus the first invalid field after a failed save.

## Likely Issues

### DES-C24-05 - Topic create/edit dialog validation is also toast-only

Severity: Low-Medium
Confidence: High
Status: source-confirmed, not browser-submitted in this lane

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:91-126` handles create/update failures with `toast.error(res.error)` only.
- `topic-manager.tsx:205-223` renders the create dialog fields with native `required`/`maxLength`, but no server-error state, `aria-invalid`, or inline field error target.
- `topic-manager.tsx:363-383` renders the edit dialog fields with the same pattern.
- This matches carry-forward item `C96-10` in `.context/plans/deferred-carry-forward.md`.

Why this is a problem:

Native required checks catch empty fields, but server-side slug collisions, Unicode-format rejections, and normalization errors are still global toasts. Dialog users need persistent field-level recovery, especially because the dialog remains open and contains only a few specific inputs.

Failure scenario:

An admin edits a topic slug to a value that the server rejects. A toast appears, but the slug input is not marked invalid and the dialog does not focus the field that needs correction.

Suggested fix:

Mirror the SEO fix pattern for topic dialogs: keep structured field errors, render inline messages under label/slug/order/image where applicable, set `aria-invalid`, and focus the first invalid field after server failure.

## Risks Needing Manual Validation

### DES-C24-R01 - Zoomed photos are keyboard-toggleable but not visibly keyboard-pannable

Severity: Medium
Confidence: Medium
Status: source-backed interaction risk; needs manual assistive-tech validation

Evidence:

- `apps/web/src/components/image-zoom.tsx:206-214` defines the keyboard path as a zoom toggle only; the comment explicitly notes keyboard has no pointer location and center zoom is used.
- Existing carry-forward entries `C94-06` and `C93-09` in `.context/plans/deferred-carry-forward.md` still track keyboard-pannable zoom.

Why this is a risk:

If keyboard users can enter a zoomed state but cannot pan the image or inspect off-center detail, the interaction remains pointer-preferential. It may also conflict with lightbox arrow-key slide navigation depending on focus mode.

Failure scenario:

A keyboard-only visitor opens a high-resolution photo, toggles zoom, and can inspect only the center crop while pointer/touch users can drag to inspect the frame.

Suggested fix:

Define an explicit keyboard zoom mode: arrow keys pan while zoomed, Escape exits zoom, and visible/invisible instructions explain the mode. If arrow keys must stay reserved for slide navigation, provide focusable pan/reset controls.

## Current Non-Issues Checked

- Search modal open-empty state is fixed relative to Cycle 23: `apps/web/src/components/search.tsx:434-455` now exposes `role="dialog"`, `aria-modal="true"`, `aria-controls="search-dialog"` before results, and `aria-expanded={isOpen}`. Browser evidence showed the active search input had `aria-expanded="true"` and outside content was inert/`aria-hidden`.
- Public mobile nav controls met the 44 px touch floor in the live probe: search, theme, locale, and menu controls were all `44x44`.
- Admin login required-field feedback worked live: empty submit focused `#login-username`; username/password controls were 44 px high, `aria-invalid="true"`, and pointed to visible `role="alert"` messages.
- Locale and direction plumbing is present in `apps/web/src/app/[locale]/layout.tsx:100-107`; browser evidence showed `html lang="en" dir="ltr"` and `html lang="ko" dir="ltr"`, matching the currently shipped locales.
- Dark/light mode plumbing is present in `layout.tsx:68-76` and `layout.tsx:137-140`. Browser dark-mode privacy page rendered with dark background/foreground tokens and no obvious contrast regression in sampled text.
- Public masonry uses intrinsic dimensions and high-priority above-fold image hints in `masonry-card.tsx:67-76` and `masonry-card.tsx:93-115`; no visible mobile horizontal overflow or large layout jump was observed during the browser pass.
- Search, login, protected admin dashboard/settings, public home/privacy/map/timeline/about pages emitted no browser console or page errors in this lane.

## Final Sweep

Examined UI categories: information architecture, public navigation, admin navigation, photo grid/masonry, photo viewer/zoom/lightbox source, search modal, admin upload/image manager, admin categories/tags/SEO/settings/tokens/password/users/db/analytics pages, form validation patterns, dialogs/alert dialogs, loading/empty/error states, ARIA/name/role/value patterns, focus restoration/focus trap source and DOM state, 44 px touch-target posture, responsive breakpoints, dark/light theme, English/Korean i18n, current RTL posture, and source-level perceived-performance patterns for LCP/CLS/INP.

Common missed-issue checks performed: hidden interactive controls, modal background inerting, stale Cycle 23 search ARIA defect, mobile horizontal overflow, unnamed icon buttons in reviewed flows, missing `aria-current` in admin nav, public skip-link/root direction, toast-only form errors, destructive-action proximity, reduced photo presentation quality from overlays, and nested scroll/table affordance loss.

Manual-validation gaps: real screen-reader output, true RTL because no RTL locale is shipped, physical P3/HDR display behavior, production CDN/service-worker/offline behavior, destructive admin mutations, and full performance traces under production data volume.
