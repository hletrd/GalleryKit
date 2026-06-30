# Cycle 21 Designer Review

Date: 2026-06-30
Role: designer
Scope: Next.js GalleryKit frontend in `/Users/hletrd/flash-shared/gallery`

## Method

- Read `AGENTS.md` and `CLAUDE.md` first, including the repo-specific deploy, schema, privacy, color/HDR, touch-target, i18n, and review-history rules.
- Inventoried the UI surface before findings: public routes under `apps/web/src/app/[locale]/(public)`, admin routes under `apps/web/src/app/[locale]/admin`, shared components under `apps/web/src/components`, messages in `apps/web/messages/{en,ko}.json`, e2e flows in `apps/web/e2e`, and UI/a11y tests in `apps/web/src/__tests__`.
- Used the agent-browser skills where feasible. Port 3000 was already serving an unrelated `ccusage` app, so I started GalleryKit on port 3001. The local GalleryKit route loaded, but the dev server could not connect to MySQL (`ECONNREFUSED 127.0.0.1:3306`), so browser interaction was limited to the localized route error boundary. The error page exposed skip link, main region, `Error` heading, retry button, and return link; screenshot captured at `/tmp/gallerykit-3001-error.png`. The temporary dev server was stopped after inspection.
- Final missed-issues sweep compared current source against previous review themes: nav/focus rings, home card prefetch, empty states, lightbox focus hiding, settings backfill, settings validation, i18n messages, and touch-target/focus tests.

## UI Inventory

- Public information architecture: localized public layout, home grid/masonry, topic pages, tag/category pages, search page, map, timeline, year archive, shared photo routes, privacy page, error/not-found boundaries.
- Admin information architecture: dashboard, upload/dropzone, image manager, categories, tags, SEO, settings, tokens, password/users, DB maintenance, analytics, login.
- Shared UI and interaction surfaces: `nav-client`, `search`, `home-client`, `photo-viewer`, `lightbox`, `lightbox-color-pip`, `info-bottom-sheet`, `load-more`, `tag-filter`, `upload-dropzone`, `image-manager`, `tag-input`, Radix-style UI primitives, theme/locale plumbing.
- Validation surfaces checked: touch-target audit, focus-visible contracts, i18n parity, settings server action validators, admin API/action-origin/rate-limit lint contracts where relevant.

## Findings

### 1. Invisible keyboard stop remains in the lightbox color pip when controls auto-hide

Severity: High
Confidence: High
Areas: focus/keyboard navigation, WCAG 2.2, affordances, modal behavior

Evidence:
- `apps/web/src/components/lightbox.tsx:368-370` derives `controlVisibilityProps` as `{ tabIndex: -1, 'aria-hidden': true }` when the overlay controls are hidden.
- `apps/web/src/components/lightbox.tsx:551-656` applies those hidden-state props to close, fullscreen, play/pause, previous, and next controls.
- `apps/web/src/components/lightbox.tsx:659-669` renders `LightboxColorPip` inside the same opacity-hidden overlay but does not pass the hidden-state props or `controlsVisible`.
- `apps/web/src/components/lightbox-color-pip.tsx:160-191` renders the pip trigger as an independent focusable `<button>`.
- `apps/web/src/__tests__/lightbox-controls-contract.test.ts:23-44` covers the shared hide timer and blur behavior, but it only reads `lightbox.tsx`; it does not assert that the nested color-pip trigger leaves the tab order when the overlay is hidden.

Failure scenario:
On a fine-pointer desktop, the lightbox overlay fades to `opacity: 0` after the hide timer. Keyboard users tab within the focus trap. The main controls are removed from tab order, but the color-pip trigger can still receive focus inside an invisible, pointer-events-disabled overlay. The user gets an unannounced focus stop with no visible target or focus ring, and activating it can open a panel the user did not see.

Suggested fix:
Thread the lightbox hidden state into `LightboxColorPip`. When controls are hidden and the pip is closed, set the pip trigger to `tabIndex={-1}` and `aria-hidden`, or move the pip out of the hidden overlay and make focus reveal visible controls first. Add a contract test that asserts `.lightbox-color-pip` is also excluded from the tab order when `controlsVisible` is false.

### 2. The settings backfill CTA promises re-encoding next to a state it cannot actually process

Severity: High
Confidence: High
Areas: affordances, form outcome clarity, color/HDR workflow, perceived trust

Evidence:
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:253-263` shows a "Backfill required" status when existing photos are present and a color/HDR-impacting setting is dirty.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:274-296` immediately renders "Re-encode existing photos" with a `Re-encode now` button that calls `handleBackfill`.
- `apps/web/src/app/actions/admin-backfill.ts:32-49` exposes `triggerBackfill()` with no `forceReencode` or settings-change mode.
- `apps/web/src/lib/admin-backfill-runner.ts:383-388` counts only rows where `pipeline_version` is null or below `IMAGE_PIPELINE_VERSION`; `apps/web/src/lib/admin-backfill-runner.ts:413-420` fetches the same restricted candidate set.
- The messages acknowledge the mismatch: `apps/web/messages/en.json:762-769` and `apps/web/messages/ko.json:762-769` say settings-only changes need the sidecar `--force-reencode`, while the same card still presents a primary in-app re-encode CTA.
- The sidecar path can do the missing operation: `apps/web/scripts/backfill-color-pipeline.ts:331-340` switches to all processed images when `--force-reencode` is set.

Failure scenario:
An admin changes JPEG/AVIF quality, chroma subsampling, forced sRGB derivatives, or another byte-affecting color/HDR setting on a gallery whose photos already have the current pipeline version. The warning says existing photos need new bytes, and the adjacent button says "Re-encode now." The in-app runner sees zero stale-version rows and returns "All photos are already at the current pipeline version. Nothing to re-encode." The stale derivatives remain in place, but the UI has taught the admin that the requested re-encode was handled.

Suggested fix:
Split the card into two explicit paths: "Apply current pipeline version" for stale-version rows, and "Force re-encode for changed settings" for settings-only byte changes. The second path should either call a guarded in-app `forceReencode` action with an explicit confirmation and progress copy, or disable the in-app button and show the exact operator command/runbook for the sidecar path. Do not show a primary "Re-encode now" affordance in the settings-only state unless it can actually re-encode current-version rows.

### 3. Settings validation errors are toast-only and not associated with the invalid field

Severity: Medium
Confidence: High
Areas: form validation UX, WCAG 2.2 error identification, keyboard/screen-reader recovery

Evidence:
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:186-217` saves changed settings via a button handler and maps server failures to `toast.error(result.error || saveFailed)`; no field error state, focus movement, or inline recovery target is set.
- Numeric and patterned inputs such as WebP/AVIF/JPEG quality at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:347-388`, image sizes at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:391-404`, wide-gamut pixel cap at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:527-540`, and slideshow interval at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:591-603` have help text but no `aria-invalid`, no error text node, and no error-specific `aria-describedby`.
- `apps/web/src/app/actions/settings.ts:60-65` rejects invalid values with a generic translated `invalidSettingValue` keyed by setting name.
- `apps/web/src/lib/gallery-config-shared.ts:147-191` has precise validators for quality ranges, image sizes, slideshow interval, AVIF effort, chroma options, and pixel caps, but those constraints are not reflected as client-side field-level validation state.

Failure scenario:
A keyboard or screen-reader admin enters `999` for AVIF quality or a malformed image-size list, then activates Save. Because this is not a native form submit flow, the browser's constraint UI is not the recovery path. The user only gets a transient toast such as "Invalid setting value: image_quality_avif"; focus remains on the Save button, and the offending input is not marked or described as invalid.

Suggested fix:
Add field-level validation using the existing shared validators before calling `updateGallerySettings`. Store errors by setting key, set `aria-invalid="true"` on invalid controls, append error text to each control's `aria-describedby`, and move focus to the first invalid field after Save. Keep the server validation as the source of truth, but map server errors back to the relevant field when the key is known.

## Coverage Notes

- Information architecture: public and admin route grouping is clear and consistent with `localizePath`; no new IA blocker found beyond the settings/backfill mismatch above.
- Affordances: the strongest affordance issue is the backfill CTA promising a settings-only re-encode it cannot perform.
- Focus and keyboard navigation: previous nav/footer/search focus-ring gaps appear addressed in current source/tests; the remaining source-confirmed defect is the hidden lightbox color-pip tab stop.
- WCAG 2.2 accessibility: touch-target contracts are present, skip link/error boundary are present, and current findings map to visible focus/error identification concerns.
- Responsive breakpoints: inspected mobile nav, home grid, lightbox, info bottom sheet, upload dropzone, and image manager patterns. Runtime responsive browser verification was limited by the missing local DB.
- Loading, empty, and error states: home/load-more/search/error boundary states exist in source; local browser smoke reached the error boundary due DB unavailability and it rendered a retry/back path.
- Form validation UX: settings page has the field-level validation gap above; login/upload/tag surfaces have clearer labels and status affordances in source.
- Dark/light mode: theme options and tokenized colors are present; no source-confirmed dark/light-only blocker found in this pass.
- i18n: English and Korean messages cover the reviewed settings/backfill copy; the mismatch exists in both locales rather than being a translation gap.
- Perceived performance: home cards now use disabled prefetch for photo links, image components use responsive sizing/blur where expected, and no new source-confirmed perceived-performance issue was found.

## Missed-Issues Sweep

- Rechecked old cycle themes: home card `prefetch={false}`, mobile nav focus rings, footer/year/search focus rings, empty-state actions, lightbox hide-timer focus behavior, and touch-target audit coverage.
- Looked for hidden interactive controls inside opacity-hidden overlays; only `LightboxColorPip` remained source-confirmed.
- Looked for user-facing settings states where copy and action semantics diverge; the settings-only backfill path remained source-confirmed.
- Looked for validation that could strand keyboard users after Save; settings remained source-confirmed because save errors are toast-only.

Finding count: 3
