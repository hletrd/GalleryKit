# Cycle 32 Designer / UI-UX Review

Review lane: designer + local ui-ux-designer-reviewer  
Repository: `/Users/hletrd/flash-shared/gallery`  
Reviewed HEAD: `4a728335ada304371743689de7f5bbf8670985b5`  
Date: 2026-07-08 KST

## Constraints Honored

- Read-only review of source, docs, tests, and prior review/plan history.
- Wrote exactly this provenance file: `.context/reviews/cycle32-designer-ui-ux.md`.
- Did not modify source files, plans, tests, package files, build outputs, or commits.
- Did not run `npm run build`, `npm run dev`, Playwright, or browser automation because those paths can create artifacts and/or require credentials. Evidence below is static source and committed test inventory.
- Existing unrelated untracked file observed before this write: `.context/reviews/cycle32-critic-verifier-test.md`. Left untouched.

## UI Inventory

Current UI surface inspected:

- Localized app routes under `apps/web/src/app/[locale]`: public home/topic/photo/shared-group/shared-link/smart-collection/map/timeline/year/privacy/about and protected admin dashboard/categories/tags/SEO/settings/tokens/password/users/DB/analytics.
- Component layer: `apps/web/src/components/*` plus shadcn/Radix primitives under `apps/web/src/components/ui/*`.
- Styling/theme/a11y base: `apps/web/src/app/[locale]/globals.css`, `apps/web/src/app/[locale]/layout.tsx`, theme provider, nav/header/footer.
- Localization: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- UI/a11y tests and e2e inventory: 142 app/component TS/TSX/CSS files, 363 unit/source-contract test files, and 10 Playwright e2e files.
- Prior/current review history: recent designer/UI reports and `.context/plans/deferred-carry-forward.md`, especially known-open admin responsive IA, mobile admin nav, SEO/DB field-level polish, and keyboard-pannable zoom rows.

## Static Validation Evidence

Key source checks:

- Root semantics and locale direction are present: `apps/web/src/app/[locale]/layout.tsx:101-107` sets `lang` and `dir`; `layout.tsx:126-135` provides a skip link.
- Global theme/contrast/reduced-motion support is explicit: `apps/web/src/app/[locale]/globals.css:14-101`, `globals.css:164-181`, `globals.css:276-302`.
- Public nav focus order and touch targets are current: controls render before mobile expand toggle at `apps/web/src/components/nav-client.tsx:145-184`; controls carry 44px/focus classes at `nav-client.tsx:151-184`.
- Mobile tag filters are no longer a pre-photo wall: `apps/web/src/components/tag-filter.tsx:143-160` uses mobile `<details>` and desktop inline chips; chip targets are 44px at `tag-filter.tsx:79-135`.
- Home/gallery empty and clear-filter states exist: `apps/web/src/components/home-client.tsx:344-360`; first visual grid follows heading/filter at `home-client.tsx:318-330`.
- Masonry cards include unique accessible photo labels with IDs and P3 context: `apps/web/src/components/masonry-card.tsx:47-65`, `masonry-card.tsx:78-82`.
- Timeline/year archive cards also include IDs in accessible names: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:230-255`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:192-214`.
- Search dialog has dialog/combobox/listbox semantics, focus trap, live result counts, IME guards, and 44px controls: `apps/web/src/components/search.tsx:321-360`, `search.tsx:422-576`.
- Search result labels include unique IDs: `apps/web/src/components/search.tsx:71-85`.
- Map page has skip-to-list, map instructions, localized fallback list labels, and topic labels: `apps/web/src/app/[locale]/(public)/map/page.tsx:81-111`; popup controls are 44px and named at `apps/web/src/components/map/map-client.tsx:121-140`.
- Photo viewer info trigger exposes disclosure state: `apps/web/src/components/photo-viewer.tsx:602-617`; lightbox/focus restoration is wired through explicit trigger refs at `photo-viewer.tsx:104-110`.
- Image zoom remains keyboard-toggleable but not keyboard-pannable: `apps/web/src/components/image-zoom.tsx:206-214`, `image-zoom.tsx:354-394`. This is not re-filed because it is already tracked as `C94-06/C93-09` in the carry-forward register.
- Admin primitive buttons enforce 44px by default, small, and icon variants: `apps/web/src/components/ui/button.tsx:23-29`.
- Admin tokens load/error/empty states and target-specific revoke confirmation are present: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:152-175`, `tokens-client.tsx:307-326`; messages interpolate `{label}` in both locales.
- Topic/tag destructive confirmations now name the target and hold in-flight state: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:370-392`, `topic-manager.tsx:497-527`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:151-173`.
- Settings has top and bottom save controls with focus restoration to the activated button: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:76-89`, `settings-client.tsx:328-354`, `settings-client.tsx:878-891`.
- Settings numeric fields expose inline errors with `aria-invalid` and `aria-describedby`: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:160-197`, `settings-client.tsx:496-562`, `settings-client.tsx:691-710`, `settings-client.tsx:761-779`.
- Upload workflow has no-topic, locked-setting, progress, skipped-file, per-file error, and disabled/dropzone states: `apps/web/src/components/upload-dropzone.tsx:374-388`, `upload-dropzone.tsx:438-485`, `upload-dropzone.tsx:568-583`.
- Existing committed tests cover the relevant a11y/UI gates, including `touch-target-audit.test.ts`, `focus-visible-links-scan.test.ts`, `focus-visible-rings-cycle17/19/20.test.ts`, `a11y-us-p15.test.ts`, `password-form-a11y.test.ts`, `lightbox-controls-contract.test.ts`, `info-bottom-sheet-ia.test.ts`, `select-item-touch-target.test.ts`, `gps-map-link-touch-targets.test.ts`, `hdr-badge-contrast.test.ts`, and `error-shell-heading.test.ts`.

Static scan notes:

- `rg` found no positive `tabIndex` usage.
- `rg` found no raw `<div onClick>` / `<span onClick>` interactive controls in `apps/web/src/app` or `apps/web/src/components`.
- Raw `<img>` usages inspected have explicit `alt`: OG image route, grid picture, map thumbnails, photo fallbacks, upload previews, lightbox.
- The only `autoFocus` in UI source is the dedicated admin login username field at `apps/web/src/app/[locale]/admin/login-form.tsx:73`, which is an acceptable single-purpose login-page pattern.

## Findings

No new current-HEAD UI/UX/accessibility findings were confirmed in this Cycle 32 lane.

## Known Open Items Not Re-Filed

These are real or plausible UX debts but already tracked in committed carry-forward history, so re-filing them here would duplicate the backlog rather than add evidence:

- Keyboard-pannable zoom: `C94-06/C93-09`; current source still only toggles zoom/reset via keyboard (`image-zoom.tsx:206-214`, `image-zoom.tsx:354-394`).
- Mobile admin navigation grouping/redesign: `C94-07/C93-10`, `C18-17`; current admin nav is still a flat ten-link wrap at `apps/web/src/components/admin-nav.tsx:15-49`.
- Mobile-first admin image/workbench redesign: `C94-08/C93-11`, `C18-16`, `AGG-C21-24`; current image manager remains a wide table at `apps/web/src/components/image-manager.tsx:427-579`.
- SEO field-level validation polish: `C96-09`; current SEO client still uses a form-level error associated to all fields at `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:107-210`.
- DB restore oversize inline recovery polish: `C96-11`; current DB UI clears an oversize selected file and reports by toast at `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:76-84`, `db/page.tsx:197-206`.

## Requested Area Coverage

- IA: public nav/home/timeline/map/admin nav reviewed; no new IA defect beyond tracked admin nav/workbench debt.
- Affordances: search, map popup, photo viewer, admin destructive dialogs, settings/backfill, upload states reviewed.
- Focus/keyboard: skip link, nav, search focus trap, dialog focus restoration, focus-visible source tests, and known zoom gap reviewed.
- WCAG 2.2: touch target, focus visible, focus order, status/alert, name/role/value, reduced motion, and error-prevention patterns reviewed.
- Contrast/dark/light/forced-colors: theme tokens and forced-colors/reduced-motion CSS reviewed.
- ARIA: dialog, combobox/listbox, live regions, map/list fallback, disclosure controls, destructive dialogs reviewed.
- Responsive breakpoints: public nav/tag filter/masonry/photo viewer and admin table wrappers reviewed; no new untracked issue.
- Loading/empty/error states: search, map, home, shared group, upload, tokens, settings, DB, and route error/loading shells reviewed.
- Forms: login/password/admin users/SEO/settings/tokens/topics/tags/DB reviewed.
- i18n/RTL: English/Korean message interpolation spot-checked; root `dir` is locale-derived. RTL remains a future-locale risk only, not current with shipped `en`/`ko`.
- Perceived performance: static evidence shows lazy/eager image loading, reduced masonry re-render work, sized thumbnails for search/map, and content-visibility for masonry; no new UI-perf defect confirmed.

## Validation Gap

No local browser or build smoke was run because the task explicitly limited writes to one provenance file. A credentialed local/admin Playwright pass would still be useful for visual confirmation of protected admin pages, but static source did not reveal a new current defect.
