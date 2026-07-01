# Cycle 92 Designer Review

Start HEAD reviewed: `508d35572563705008693da2dbff3e5d85442cdd` (`master`, `origin/master`).
Scope: Next.js web UI review for UI/UX, information architecture, affordances, keyboard/focus navigation, WCAG 2.2 accessibility, contrast, ARIA, focus traps, reduced motion, responsive breakpoints, loading/empty/error states, form validation UX, dark/light mode, i18n/RTL, and perceived performance.

## Inventory Built First

- Canonical instructions and product constraints: `AGENTS.md`, `CLAUDE.md`.
- Public route surfaces: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `p/[id]/loading.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`, `c/[slug]/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`, `map/page.tsx`, `privacy/page.tsx`, and `(public)/layout.tsx`.
- Admin route surfaces: `apps/web/src/app/[locale]/admin/page.tsx`, `admin/login-form.tsx`, `admin/layout.tsx`, and protected pages under `dashboard`, `categories`, `tags`, `settings`, `seo`, `db`, `users`, `password`, `tokens`, `analytics`, plus protected `layout.tsx`, `loading.tsx`, and `error.tsx`.
- Global shells and error/loading states: `apps/web/src/app/[locale]/layout.tsx`, `globals.css`, `loading.tsx`, `error.tsx`, `not-found.tsx`.
- Core public components: `nav-client.tsx`, `search.tsx`, `home-client.tsx`, `grid-picture.tsx`, `photo-viewer.tsx`, `photo-navigation.tsx`, `image-zoom.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `color-details-section.tsx`, `wide-gamut-hint.tsx`, `similar-photos.tsx`, `load-more.tsx`, `topic-empty-state.tsx`, `map/map-client.tsx`, `map/map-loader.tsx`, `footer.tsx`, `on-this-day-widget.tsx`.
- Core admin/form components: `upload-dropzone.tsx`, `image-manager.tsx`, `bulk-edit-dialog.tsx`, `tag-input.tsx`, `admin-header.tsx`, `admin-nav.tsx`, `admin-user-manager.tsx`, `tokens-client.tsx`, `settings-client.tsx`, `password-form.tsx`, `topic-manager.tsx`, `tag-manager.tsx`, `seo-client.tsx`, `analytics-client.tsx`, `db/page.tsx`.
- UI primitives and modal/focus helpers: `components/ui/button.tsx`, `input.tsx`, `textarea.tsx`, `select.tsx`, `switch.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `dropdown-menu.tsx`, `sheet.tsx`, `tooltip.tsx`, `sonner.tsx`, `lazy-focus-trap.tsx`, `use-modal-tree-isolation.ts`.
- i18n/theme/config/test inventory: `apps/web/messages/en.json`, `ko.json`, `src/lib/locale-path.ts`, `src/lib/constants.ts`, `src/proxy.ts`, `tailwind.config.ts`, and UI/a11y tests including `touch-target-audit.test.ts`, `select-item-touch-target.test.ts`, `focus-visible-*`, `a11y-us-p15.test.ts`, `hdr-badge-contrast.test.ts`, `password-form-a11y.test.ts`, `i18n-key-parity.test.ts`, and Playwright specs in `apps/web/e2e/`.

## Automation / Validation Performed

- `omx explore --prompt ...` was attempted first for inventory, but this sandbox rejected the in-process OMX app-server client with `Operation not permitted`; I used read-only shell inspection instead.
- Focused touch-target validation passed: `npm test --workspace=apps/web -- touch-target-audit.test.ts select-item-touch-target.test.ts analytics-link-touch-targets.test.ts gps-map-link-touch-targets.test.ts` → 4 files, 22 tests passed.
- Focused a11y/i18n/contrast/focus validation passed: `npm test --workspace=apps/web -- a11y-us-p15.test.ts focus-visible-links-scan.test.ts focus-visible-rings-cycle17.test.ts focus-visible-rings-cycle19.test.ts focus-visible-rings-cycle20.test.ts hdr-badge-contrast.test.ts i18n-key-parity.test.ts password-form-a11y.test.ts error-shell.test.ts error-shell-heading.test.ts` → 10 files, 78 tests passed.
- ESLint passed: `npm run lint --workspace=apps/web`.
- Browser automation/local server was not run. Safe local E2E requires a repo-local app env/DB or an explicitly authorized test DB; `apps/web/.env.local` is absent, and the E2E server script runs `npm run init`, `npm run e2e:seed`, and `npm run build` against the resolved env before starting the server (`apps/web/scripts/run-e2e-server.mjs:54`-`71`). An external default env exists, but running it would mutate whichever DB that secret points to, so I did not use it from this designer lane.

## Confirmed Issues

### C92-DES-01 — Zoomed photo can be toggled by keyboard but cannot be panned by keyboard

- Severity: Medium.
- Confidence: High.
- Area: Keyboard navigation / WCAG 2.1.1 Keyboard / photo-viewer affordance.
- Evidence:
  - `ImageZoom` exposes the viewer as a keyboard-focusable `role="button"` with `tabIndex={0}` and `aria-label`: `apps/web/src/components/image-zoom.tsx:347`-`365`.
  - Its keyboard handler only handles `Enter` and `Space` by calling `handleKeyboardToggle()`: `apps/web/src/components/image-zoom.tsx:365`.
  - Pointer users can zoom with wheel anchored to cursor position: `apps/web/src/components/image-zoom.tsx:83`-`111`.
  - Pointer users can pan a zoomed image by mouse drag: `apps/web/src/components/image-zoom.tsx:118`-`142`.
  - Touch users can pinch/drag pan while zoomed: `apps/web/src/components/image-zoom.tsx:232`-`303`.
  - No Arrow-key or other keyboard pan/zoom-step branch exists in the rendered key handler: `apps/web/src/components/image-zoom.tsx:339`-`365`.
- Impact: Keyboard-only users can enter the zoom state, but if the zoomed viewport hides off-center image details, they cannot pan to inspect them. That makes part of the zoom feature pointer-only.
- Recommended fix: When `zoomLevelRef.current > MIN_ZOOM`, support Arrow-key panning (with Shift for larger steps), `+`/`-` zoom adjustment, and `Home`/`Escape` reset. Advertise shortcuts via `aria-keyshortcuts` and/or the existing viewer shortcut hint.

### C92-DES-02 — Lightroom token create dialog uses toast-only empty-label validation

- Severity: Medium.
- Confidence: High.
- Area: Form validation UX / ARIA error association / admin tokens.
- Evidence:
  - The create handler rejects an empty label with only `toast.error(...)` and returns: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:47`-`58`.
  - The label input has a visible `<Label>`, but no `required`, `aria-invalid`, `aria-describedby`, inline error element, or focus recovery on validation failure: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:165`-`176`.
  - The Create button remains enabled when the label is empty; it only disables on `isPending`: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:182`-`185`.
- Impact: Sighted users get a transient toast, but the field itself is not marked invalid and assistive-tech users do not get a field-associated error or focus correction. This is weaker than nearby forms such as login/settings that use `aria-invalid`, `aria-describedby`, `role="alert"`, and first-invalid focus.
- Recommended fix: Track `labelError`, focus `#token-label` on empty submit, add `required`, `aria-invalid`, `aria-describedby="token-label-error"`, and render an inline `role="alert"` error under the input. Optionally disable Create until `newLabel.trim()` is non-empty.

### C92-DES-03 — Load-more failure states leave the live region stale and provide no persistent inline error

- Severity: Low.
- Confidence: High.
- Area: Loading/error states / screen-reader feedback / public gallery pagination.
- Evidence:
  - Loading starts by setting the polite status region to the loading copy: `apps/web/src/components/load-more.tsx:43`-`50`.
  - Successful pages update the same status region with loaded/no-more copy: `apps/web/src/components/load-more.tsx:56`-`74`.
  - Rate-limit, maintenance, error, invalid, and thrown-error branches only emit toasts; they do not call `setStatusMessage(...)`: `apps/web/src/components/load-more.tsx:77`-`98`.
  - The only persistent screen-reader status is the `sr-only` live region bound to `statusMessage`: `apps/web/src/components/load-more.tsx:155`-`167`.
- Impact: After a failed load-more attempt, the live region can remain at “loading more” while the visible button returns to “Load more.” Users who miss or cannot perceive the toast do not get a persistent, localized error/retry state at the pagination control.
- Recommended fix: Set `statusMessage` in each non-ok and catch branch (`loadMoreRateLimited`, `loadMoreMaintenance`, `loadMoreFailed`) and consider rendering a small inline retry/error text near the button until the next successful load or query reset.

## Likely Issues

### C92-DES-L01 — Batch-add-tag dialog lacks an explicit `DialogDescription`

- Severity: Low.
- Confidence: Medium.
- Area: Modal context / ARIA dialog description / admin image manager.
- Evidence:
  - The batch-add dialog renders `DialogContent` and `DialogTitle`, then places the input block inside `DialogHeader`, but does not render a `DialogDescription`: `apps/web/src/components/image-manager.tsx:337`-`367`.
  - The shared dialog primitive exposes a `DialogDescription` wrapper for Radix dialog descriptions: `apps/web/src/components/ui/dialog.tsx:129`-`139`.
  - Most sibling dialogs include descriptions, e.g. bulk edit has `DialogDescription`: `apps/web/src/components/bulk-edit-dialog.tsx:168`-`171`; admin-user create has one: `apps/web/src/components/admin-user-manager.tsx:100`-`105`.
- Risk: The dialog is still titled and its single input is labeled, so this is not a confirmed blocker. However, Radix dialogs without a description can produce a11y warnings and leave screen-reader users with less context about the effect of adding a tag to the selected image set.
- Recommended fix: Add a short `DialogDescription` explaining that the tag will be applied to the selected photos, and move the input block out of `DialogHeader` into normal dialog body content.

## Manual-Validation Risks

### MV-C92-DES-01 — Browser/axe/Playwright flows were not safely runnable in this lane

- Severity: Medium.
- Confidence: High that validation is missing; no claim of live failure.
- Evidence:
  - Playwright defaults to a local server: `apps/web/playwright.config.ts:16`-`28`, `apps/web/playwright.config.ts:70`-`78`.
  - The E2E server mutates the configured DB before serving (`npm run init`, `npm run e2e:seed`) and builds the app: `apps/web/scripts/run-e2e-server.mjs:54`-`71`.
  - Repo-local `apps/web/.env.local` is absent in this sandbox; using the external default env would not be a safe read-only UI review action.
- Validation needed: Run Playwright/axe against an explicitly disposable local DB or approved review environment, especially for keyboard traversal through search, lightbox, bottom sheet, admin dialogs, token flows, upload, map popups, and load-more error branches.

### MV-C92-DES-02 — RTL is structurally future-proofed but not actually shipped/tested

- Severity: Low.
- Confidence: High.
- Evidence:
  - Only `en` and `ko` are supported locales: `apps/web/src/lib/constants.ts:1`-`4`.
  - `RTL_LOCALES` is currently an empty set: `apps/web/src/lib/locale-path.ts:37`-`40`.
  - The root layout correctly stamps `lang` and `dir={getLocaleDirection(locale)}`: `apps/web/src/app/[locale]/layout.tsx:93`-`100`.
  - User/photo text is rendered in LTR containers on cards/overlays, e.g. home card title/topic overlays: `apps/web/src/components/home-client.tsx:399`-`409`.
- Risk: No shipped RTL locale is broken, but adding Arabic/Hebrew/Persian/etc. would need real RTL QA and likely `dir="auto"` on user-generated titles/descriptions/tags.
- Validation needed: Add an RTL locale fixture or pseudo-RTL pass before claiming RTL support.

### MV-C92-DES-03 — Photo-overlay text contrast remains image-dependent despite dark gradients

- Severity: Low.
- Confidence: Medium.
- Evidence:
  - Home masonry overlays render white text over photo-dependent black gradients: `apps/web/src/components/home-client.tsx:399`-`409`.
  - Shared-group cards use top `from-black/65` and bottom `from-black/60` overlays: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:210`-`238`.
  - Timeline/year cards use bottom `from-black/70` overlays: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:275`-`277`; `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:233`-`235`.
  - Forced-colors mode has a dedicated fallback for masonry card text/gradients: `apps/web/src/app/[locale]/globals.css:281`-`300`.
- Risk: The source shows deliberate gradients and forced-colors support, but actual WCAG contrast for overlay text over arbitrary bright/complex photos is visual-data-dependent and was not browser-sampled here.
- Validation needed: Visual/contrast spot-check with bright snow/sky/wedding-dress images and hover/focus states in light, dark, OLED, and forced-colors modes.

### MV-C92-DES-04 — Auto-hidden lightbox controls need assistive-tech confirmation

- Severity: Low.
- Confidence: Medium.
- Evidence:
  - Lightbox controls are visually hidden via wrapper opacity and pointer-events classes: `apps/web/src/components/lightbox.tsx:545`-`551`; `apps/web/src/components/lightbox.tsx:372`-`374`.
  - Focus capture re-shows controls for keyboard traversal: `apps/web/src/components/lightbox.tsx:463`.
  - The close/fullscreen/slideshow/prev/next buttons remain mounted with labels and shortcuts: `apps/web/src/components/lightbox.tsx:554`-`659`.
- Risk: Keyboard behavior is likely intentional because focus capture restores visibility, but screen-reader virtual navigation may encounter controls while they are visually hidden. This needs real SR/browser confirmation rather than source inference.
- Validation needed: VoiceOver/Safari and NVDA/Firefox or NVDA/Chrome pass through hidden/visible lightbox chrome, including after the 3-second auto-hide timer.

## Positive Evidence / Good Coverage

- Root layout sets `lang`, `dir`, a skip link, theme provider, and localized metadata: `apps/web/src/app/[locale]/layout.tsx:93`-`128`.
- Reduced motion has a global mitigation that compresses animations/transitions and suppresses hover scale transforms: `apps/web/src/app/[locale]/globals.css:253`-`279`; photo-viewer Framer transitions also use `useReducedMotion`: `apps/web/src/components/photo-viewer.tsx:683`-`699`.
- Color/contrast tokens are documented and tuned for light/dark/OLED, including muted and destructive text contrast: `apps/web/src/app/[locale]/globals.css:18`-`47`, `apps/web/src/app/[locale]/globals.css:50`-`101`.
- Touch-target primitives are ≥44 px by default for shadcn buttons and selects: `apps/web/src/components/ui/button.tsx:23`-`29`; `apps/web/src/components/ui/select.tsx:39`-`40`, `apps/web/src/components/ui/select.tsx:109`-`113`. Focused touch-target tests passed.
- Modal/focus isolation has explicit FocusTrap/inert handling: `apps/web/src/components/use-modal-tree-isolation.ts:19`-`43`; lightbox dialog uses `aria-modal`, focus trap, initial/fallback focus: `apps/web/src/components/lightbox.tsx:452`-`459`; search dialog does the same: `apps/web/src/components/search.tsx:407`-`426`; bottom sheet does the same: `apps/web/src/components/info-bottom-sheet.tsx:195`-`208`.
- Search has labeled combobox/listbox behavior, active descendant, result live counts, keyboard instructions, and visible/AT empty/error states: `apps/web/src/components/search.tsx:435`-`491`, `apps/web/src/components/search.tsx:507`-`514`.
- Settings form has first-invalid focus/scroll, `aria-invalid`, `aria-describedby`, alert errors, and status banners: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:145`-`182`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:447`-`530`.
- Login/password forms include visible labels, inline errors, `aria-invalid`, `aria-describedby`, and alert regions: `apps/web/src/app/[locale]/admin/login-form.tsx:58`-`127`; `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:45`-`118`.
- Public galleries reserve aspect ratio, eager-load above-fold cards, use responsive AVIF/WebP/JPEG sources, expose descriptive link labels, and include empty states: `apps/web/src/components/home-client.tsx:286`-`416`, `apps/web/src/components/home-client.tsx:430`-`446`.
- Map page provides a non-map photo list and skip link fallback for keyboard users: `apps/web/src/app/[locale]/(public)/map/page.tsx:75`-`105`.
- Error/not-found shells have visible headings, landmarks, focusable actions, and nav/footer wayfinding: `apps/web/src/app/[locale]/error.tsx:22`-`57`; `apps/web/src/app/[locale]/not-found.tsx:18`-`48`; `apps/web/src/app/[locale]/admin/(protected)/error.tsx:15`-`50`.

## Final Missed-Issue Sweep

- Re-read `AGENTS.md` and `CLAUDE.md`, including touch-target, i18n, color/HDR, deployment/e2e, and no-edit/culling/scoring constraints.
- Built the UI inventory before findings; inspected app route files, shared components, admin clients, primitives, CSS, locale utilities, messages, tests, and E2E config.
- Ran source searches for ARIA/roles/tabIndex/focus traps/dialogs, forms/validation/errors/loading/empty states, reduced-motion/transitions/dark/responsive/RTL patterns, and dialog title/description coverage.
- Rechecked suspected issues before promoting them: an apparent `TagInput` accessible-name gap was cleared because image-manager passes both `placeholder` and `ariaLabel` at `apps/web/src/components/image-manager.tsx:500`-`530`.
- Ran focused touch-target/a11y/i18n/focus/contrast tests and ESLint; all passed as listed above.
- Did not modify source code, tests, configuration, plans, or existing review files. This report is the only file written by this designer lane.
