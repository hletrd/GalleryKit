# Run-10 Cycle 34 Designer UI/UX Review

Role: `designer`
Repo: `/Users/hletrd/flash-shared/gallery`
Review HEAD: `e94455d372daf74d8de9c909558ad7173b6cc864`
Date: 2026-07-08 KST

Scope: review-only. I modified only this artifact. No source edits, commits, pushes, deploys, destructive commands, or production access.

## Method

Instructions read: `AGENTS.md`, `CLAUDE.md`, and agent-browser skill docs for core navigation, query/snapshot, interaction, wait, visual capture, and viewport configuration.

UI inventory covered `apps/web/src/app/[locale]`, `apps/web/src/components`, shared UI primitives, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, and Playwright/admin E2E helpers for route and auth context. I inspected public IA, admin IA, modal/focus helpers, form validation, loading/error states, map/archive pages, photo surfaces, reduced-motion hooks, touch-target patterns, i18n, and responsive layout code.

Browser automation was feasible. `npm run dev --workspace=apps/web -- --hostname 127.0.0.1 --port 3100` failed before serving because Turbopack could not acquire its lockfile (`os error 72`). I used the existing built app with `npm run start --workspace=apps/web -- --hostname 127.0.0.1 --port 3100`; `/en` returned 200. Agent-browser was available (`0.22.2`) and used for page loads, viewport changes, accessibility snapshots, interactions, and screenshots. Because this lane is review-only, I did not create an authenticated DB session; protected-admin findings below are source-backed rather than live-authenticated.

Browser evidence collected:

- Desktop `/en`: accessibility snapshot showed skip link, main nav, tag filter group, named search/theme/locale controls, photo links, footer links, and no console/page errors in the later Playwright probe.
- Mobile `/en`: accessibility snapshot stayed landmarked; screenshot `/tmp/gallery-mobile-home.png` showed the metadata overlay covering the top of each photo.
- Search modal: agent-browser snapshot after opening showed only `dialog "Search photos"` with expanded combobox and close button; `#search-input` had `aria-expanded="true"` and `aria-controls="search-dialog"`.
- `/en/admin`: empty submit produced visible `role="alert"` messages; Playwright confirmed focus returned to `#login-username`, username/password had `aria-invalid="true"`, and username described `login-username-error`.
- `/ko`: `html lang="ko" dir="ltr"` and localized nav/search/footer labels.
- `/en/map`: snapshot showed a `Photo map` region, skip link to the accessible list, Leaflet zoom buttons, and the fallback photo list. Playwright measured the zoom buttons at `44x44`.
- `/en/timeline` and `/en/privacy`: heading/landmark snapshots were coherent.

## Confirmed Findings

### DES-C34-01 - Mobile public photo grids still cover delivered photos with permanent metadata overlays

Severity: Low-Medium
Confidence: High

Evidence:

- `apps/web/src/components/masonry-card.tsx:155-160` renders mobile-only metadata as `absolute inset-x-0 top-0 sm:hidden bg-gradient-to-b from-black/75 to-transparent p-3` over the image.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:285-287` renders archive-card metadata as `absolute inset-x-0 bottom-0 bg-gradient-to-t...`; the hover/focus opacity behavior only starts at `sm:`, so mobile gets a permanent overlay.
- Live mobile browser probe on `/en`: first card box was `358x556.875`; overlay box was `358x60`, `position: absolute`, `display: block`, with `linear-gradient(rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0))`. Screenshot: `/tmp/gallery-mobile-home.png`.

Failure scenario:

A phone visitor scans a portrait or landscape where important crop detail sits near the top or bottom edge. The gallery permanently paints title/topic chrome over the finished photograph before the visitor chooses to open it.

Fix:

Move mobile metadata outside the bitmap into a reserved caption band, or show it on focus/open instead of continuously over the photo. Apply the same rule to masonry, timeline, year archive, and share-grid cards so the public photo surfaces preserve photographer intent consistently.

### DES-C34-02 - SEO form marks every field invalid for one server-side field error

Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:75-85` stores one `formError`, toasts it, and focuses the summary.
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:127`, `141`, `156`, `170`, `184`, and `208` set `aria-invalid={!!formError}` on all SEO controls.
- `apps/web/src/app/actions/seo.ts:85-139` returns specific failures such as `seoTitleInvalid`, `seoLocaleInvalid`, and `seoOgImageUrlInvalid`, but the client receives only a generic string and cannot associate it with the failing control.

Failure scenario:

An admin enters an invalid Open Graph image URL, presses Save, then screen-reader output and visual styling imply that title, nav title, description, author, locale, and URL are all invalid. Keyboard focus lands on the summary, not the actual URL field that needs correction.

Fix:

Return structured field errors from `updateSeoSettings`, for example `{ field: 'seo_og_image_url', error }`. In `SeoSettingsClient`, set `aria-invalid` only on affected controls, append field-specific error IDs to `aria-describedby`, render inline persistent errors, and focus the first invalid field after save failure.

## Likely Issues

### DES-C34-03 - Protected admin photo management remains table-first with nested scrolling

Severity: Medium
Confidence: High source confidence; live protected-admin DOM not validated in this lane

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144` places Recent Uploads inside `max-h-[calc(100vh-16rem)] overflow-auto`.
- `apps/web/src/components/image-manager.tsx:427-450` renders a nine-column table inside `overflow-x-auto`.
- `apps/web/src/components/image-manager.tsx:472-488` uses a fixed `h-32 w-32` preview, `image-manager.tsx:500-552` requires a `min-w-[200px]` tag editor, and `image-manager.tsx:571-607` puts edit/delete actions at the far right.

Failure scenario:

On a tablet or narrow laptop, an admin scrolls horizontally to reach edit/delete actions and loses row context for the thumbnail/title/filename that identified the photo. The nested vertical pane also competes with the page scroll during batch review.

Fix:

Keep the dense table for wide desktop, but add a responsive list/card workbench below large desktop widths. Each item should keep thumbnail, processing state, title/filename, topic, tags, gamut/date, and actions in one visual cluster with the existing 44 px target floor and confirmation dialogs.

### DES-C34-04 - Admin taxonomy dialogs still expose one summary error across multiple editable fields

Severity: Low-Medium
Confidence: High source confidence; not submitted live in this lane

Evidence:

- Topic create/update handlers store one `createError`/`editError` at `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:101-149`.
- The create dialog applies that same error to label and slug via `aria-invalid={!!createError}` and `aria-describedby="create-topic-error"` at `topic-manager.tsx:248-255`; the edit dialog does the same at `topic-manager.tsx:420-427`.
- Tag edit has the same one-error pattern at `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:55-76` and `tag-manager.tsx:193-202`.

Failure scenario:

An admin edits a topic slug to one that collides with a route or enters a rejected tag value. The dialog shows a persistent summary, but multiple controls may be marked invalid from one failure, and focus goes to the summary rather than the exact control.

Fix:

Use structured field errors for topic/tag mutations. Mark only the failing label/slug/name/order/image/alias control invalid, place inline `role="alert"` text under that control, and move focus to the first invalid field. Keep the current summary only for non-field failures.

## Manual-Validation Risks

### DES-C34-R01 - Reduced-motion coverage is uneven across CSS-only animations

Severity: Low-Medium
Confidence: Medium

Evidence:

- Motion-aware code exists in `apps/web/src/components/photo-viewer.tsx:74`, `apps/web/src/components/lightbox.tsx:101-114`, `apps/web/src/components/image-zoom.tsx:52`, `apps/web/src/components/photo-navigation.tsx:27-102`, and `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:188-192`.
- CSS-only primitives still apply animation classes without a visible `motion-reduce` guard, including `apps/web/src/components/ui/dialog.tsx:42` and `73`, `apps/web/src/components/ui/alert-dialog.tsx:39` and `57`, dropdown/select/tooltip primitives, and photo-card hover transforms such as `apps/web/src/components/masonry-card.tsx:117`.

Failure scenario:

A user with `prefers-reduced-motion: reduce` still receives modal zoom/fade animations, dropdown entrance animations, or thumbnail scale transitions. These are short, but they are broad UI primitives.

Fix:

Add global or primitive-level `motion-reduce:animate-none motion-reduce:transition-none` guards for Radix overlays/content and nonessential hover transforms. Manually validate with a reduced-motion browser context because several components already have JS-level motion gates that should remain intact.

### DES-C34-R02 - Protected admin flows need live authenticated assistive-tech validation

Severity: Medium
Confidence: Medium

Evidence:

- This lane intentionally did not insert a session row or use plaintext admin credentials. Protected-admin pages were reviewed from source and unauthenticated redirect/login behavior only.
- The highest-risk protected surfaces are dashboard image management, taxonomy dialogs, SEO/settings saves, token plaintext flow, DB restore confirmation, and bulk edit dialogs.

Failure scenario:

Source-backed ARIA and focus patterns can still diverge once Radix portals, real table width, real data, toasts, and server-action pending states run under an authenticated session.

Fix:

Run an authenticated admin browser pass in a disposable local/e2e DB using the existing E2E helper path, then capture keyboard traversal, focus return, screen-reader announcements, and mobile/tablet screenshots for the protected pages.

## Current Non-Issues Checked

- Public home desktop/mobile had coherent landmarks, headings, named controls, tag filter grouping, and no observed horizontal overflow.
- Search modal isolation is working from the accessibility-tree perspective: agent-browser snapshot while open exposed only the search dialog, expanded combobox, close button, and hint text.
- Login empty-submit validation is field-associated and persistent: `#login-username` and `#login-password` receive `aria-invalid`, visible `role="alert"` errors, and focus returns to the first invalid field.
- Korean locale renders translated UI labels with `lang="ko"` and currently expected `dir="ltr"`.
- Map route provides a skip path around the map, a labelled map region, 44 px Leaflet zoom controls, and a list fallback.
- Timeline and privacy route snapshots showed coherent heading hierarchy and landmarks.
- Browser probe across `/en`, search, `/en/admin`, and `/en/map` recorded zero console warnings/errors/page errors.

## Final Sweep

Reviewed categories: information architecture, public/admin navigation, affordances, keyboard/focus paths, WCAG 2.2 target size posture, ARIA/name/role/value, focus traps and modal isolation, contrast token comments, reduced motion, responsive breakpoints, loading/empty/error states, form validation UX, English/Korean i18n, current RTL posture, and perceived-performance patterns for image loading and map chunks.

Skipped or limited: live authenticated protected-admin DOM, destructive admin mutations, real screen-reader output, true RTL rendering because no RTL locale ships, physical P3/HDR display behavior, production CDN/service-worker/offline behavior, and full performance traces under production data volume.
