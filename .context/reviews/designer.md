# GalleryKit Designer Review - Cycle 21

Repo: `/Users/hletrd/flash-shared/gallery`
HEAD: `45b32d1db373e03d82a29511f53832051c770880`
Lane: `designer`
Date: 2026-07-08

Review-only artifact. I edited only this file and did not commit or push.

## Required Context Read

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`

## UI Inventory

Routes: 36 app route files under `apps/web/src/app`, including public home/topic/photo/shared/smart-collection/map/timeline/year/privacy/about routes, locale error/not-found/loading surfaces, uploads proxy, and protected admin dashboard/categories/tags/SEO/settings/tokens/password/users/database/analytics routes.

Components: 61 component files under `apps/web/src/components`, including public shell, masonry/gallery, search, tag filter, photo viewer/lightbox/color details/histogram, map, admin header/nav, upload dropzone, image manager, bulk edit, tag input, admin user manager, and shadcn/Radix primitives.

Styling/messages/assets/tests/docs: `apps/web/src/app/[locale]/globals.css`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/public` fonts/icons/PWA/SW/resources/uploads, 12 Playwright e2e files under `apps/web/e2e`, `.context/plans`, `.context/reviews`, and design/product notes in `CLAUDE.md`.

## Browser Method

Used direct Playwright CLI/scripts per the `playwright` skill. `next dev` was blocked by a stale Next dev-server mutex: Next reported PID `7042` on port 3000, but `ps` and `lsof` found no live process/listener. I did not remove lock files. I used `npm run start --workspace=apps/web -- --hostname 127.0.0.1 --port 3100`; it served pages and warned that standalone output should normally use `.next/standalone/server.js`.

Pages exercised: `/`, `/en/timeline`, `/en/map`, `/en/privacy`, `/en/this-route-does-not-exist-xyz`, `/admin`, authenticated `/admin/dashboard`, `/admin/settings`, `/admin/categories`, `/admin/tags`, `/admin/seo`, `/admin/db`, and `/admin/tokens`. Admin auth used a local session cookie inserted into the e2e DB; plaintext login was unavailable because `ADMIN_PASSWORD` is an Argon2 hash.

Evidence collected: DOM roles/headings/landmarks, Playwright `ariaSnapshot()`, focus/tab order, dialog focus restore, mobile 390px nav behavior, computed colors/contrast, touch target boxes, console/page errors, and text output. Static source review covered IA, affordances, WCAG 2.2, ARIA, responsive states, loading/empty/error states, validation UX, dark/light mode, i18n/RTL, and perceived performance.

## Findings

### DES-C21-01 - Token/settings dialogs reference missing `common.*` message keys

Severity: Medium
Confidence: High

File and region:

- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:460-482`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:157-169`, `242-248`, `314-317`
- `apps/web/messages/en.json:697-706`, `725-731`
- `apps/web/messages/ko.json:697-706`, `725-731`

Browser/DOM evidence:

- Visiting authenticated `/admin/settings` and `/admin/tokens` emitted repeated console/server errors: `MISSING_MESSAGE: common.cancel (en)`.
- `/admin/tokens` rendered an error state containing literal `common.tryAgain` text in the page body.
- Shutting down the local server also printed `MISSING_MESSAGE: common.cancel (en)` from the settings and token SSR chunks.

Source evidence:

- Settings backfill confirm uses `t('common.cancel')`.
- Token create/revoke dialogs use `t('common.cancel')`; the token load-error retry button uses `t('common.tryAgain')`.
- `common` contains `untitled`, `unknown`, `photo`, `loading`, `imageUnavailable`, `skipToContent`, `close`, and `opensInNewWindow`, but no `cancel` or `tryAgain`.
- `tryAgain` exists under `error.tryAgain`; `cancel` exists under `db.cancel`, `imageManager.cancel`, and other local namespaces.

Failure scenario:

Admins opening token or settings dialogs see fallback translation keys or trigger noisy runtime errors instead of localized button labels. The token load-error state has a visible broken retry affordance, which is a direct form/error-state UX failure.

Suggested fix:

Either add `common.cancel` and `common.tryAgain` to both message files, or switch these call sites to existing scoped keys (`imageManager.cancel`, `db.cancel`, `error.tryAgain`) with parity tests updated to catch client references to missing namespace keys.

### DES-C21-02 - Map markers are announced only as generic "Marker"

Severity: Low-Medium
Confidence: High

File and region:

- `apps/web/src/components/map/map-client.tsx:120-138`

Browser/DOM evidence:

- `/en/map` accessibility snapshot exposed the interactive marker as `button "Marker"`.
- DOM for `.leaflet-marker-icon`: `tag:"IMG"`, `alt:"Marker"`, `role:"button"`, `tabindex:"0"`, box `44x44`, no `title`.
- The route does provide `Skip map to photo list` and `list "Geotagged photo list"`, so there is a fallback.

Source evidence:

- `<Marker position={[marker.latitude, marker.longitude]}>` is rendered without marker-level `title` or `alt`.
- The popup button has `aria-label={`${openPhotoLabel}: ${marker.displayTitle}`}`, but the marker is unnamed until opened.

Failure scenario:

With multiple geotagged photos, keyboard and screen-reader users encounter a sequence of indistinguishable `Marker` controls inside the map. They must open each popup or abandon the map for the list to know which photo each marker represents.

Suggested fix:

Pass a useful marker label through React Leaflet, for example `title={marker.displayTitle}` and `alt={`${openPhotoLabel}: ${marker.displayTitle}`}` on `Marker`. Keep the list fallback; if Leaflet does not propagate names reliably, sync attributes onto `.leaflet-marker-icon` after render or use a custom marker element.

### DES-C21-03 - Dashboard checkbox cells duplicate accessible text

Severity: Low
Confidence: High

File and region:

- `apps/web/src/components/image-manager.tsx:431-442`
- `apps/web/src/components/image-manager.tsx:462-472`

Browser/DOM evidence:

- Authenticated dashboard `ariaSnapshot()` shows the select-all column header as `Select all images Select all images`.
- Row checkbox cells similarly announce `Select image E2E Portrait Select image E2E Portrait` before the checkbox.
- Runtime boxes show the visible checkbox itself is `20x20`, but it is wrapped by a `44x44` label, so this is not a touch-target failure.

Source evidence:

- Each checkbox wrapper includes a hidden `<span className="sr-only">...label...</span>`.
- The nested `<input type="checkbox">` repeats the same label via `aria-label`.

Failure scenario:

Screen-reader users hear duplicated labels in a dense admin table, increasing verbosity and making row scanning slower. This is most noticeable when bulk-selecting many uploaded photos.

Suggested fix:

Keep the 44px wrapper but provide the accessible name once. For example, remove the hidden span and keep `aria-label`, or keep visible/hidden label text and remove `aria-label` from the input if the label association is sufficient.

## Coverage Notes

IA/affordances: Public nav, footer, map/list fallback, admin nav, dashboard table, settings forms, and token page were reviewed. Public IA is coherent; admin remains dense but predictable for repeated operational use.

Keyboard/focus: Public tab order begins with skip link, nav, search/theme/locale, tag chips, then photo links. Search dialog focuses `#search-input`, traps focus, locks body scroll, and restores focus to the trigger on Escape. Login client validation focuses the first invalid field and sets `aria-invalid`.

WCAG/contrast/touch: Body text contrast measured about 19.9:1 in light mode. Runtime touch boxes were 44px+ for nav, search, mobile menu, tag chips, login controls, map controls, and admin action buttons; hidden skip links appear as 1x1 until focused, as expected.

Responsive: Mobile home at 390px collapses topics behind the nav expander and uses a tag-filter disclosure. Admin tables still rely on horizontal overflow, which is acceptable for current admin-operational scope but remains a mobile ergonomics risk for heavy phone use.

Loading/empty/error: Verified localized 404, privacy, map help/list fallback, search empty state, login validation, token load-error state, admin DB danger alert, and upload disabled state. DES-C21-01 affects token/settings error/dialog copy.

Dark/light: Theme control is present and labelled. Starting state resolved to `html.light`; one click from system to light did not visibly change colors, which is expected when system is already light. Tokenized foreground/background contrast was strong.

i18n/RTL: English and Korean catalogs exist and route `lang` is set. Current locales are LTR; no true RTL locale exists, so RTL layout was source-reviewed only and remains unproven for nav, admin tables, map, and photo viewer.

Perceived performance: Masonry uses CSS columns, eager first-column images, width bucketing, and memoized cards. Search debounces and aborts semantic requests. Map chunk isolates Leaflet CSS. No performance trace was run; review was DOM/interaction focused.

## Final Sweep

Could not inspect with a fresh `next dev` runtime because of the stale dev mutex, and did not remove generated lock files. Could not validate physical P3/HDR display behavior, real RTL layout, production CDN/SW behavior, or destructive admin workflows such as DB restore. No relevant UI file category was intentionally skipped; app routes, components, CSS, messages, public assets, e2e tests, and design docs were inventoried.
