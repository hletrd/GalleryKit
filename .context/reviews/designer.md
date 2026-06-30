# Cycle 33 Designer UI/UX Review

Reviewer lane: designer. Product/app source files were not edited.

## Evidence

- Read project guidance from `AGENTS.md` in the prompt and `CLAUDE.md`.
- Loaded agent-browser skills: `agent-browser`, `agent-browser-query`, `agent-browser-visual`, and `agent-browser-config`.
- Inventory sweep covered 135 UI/source files under `apps/web/src/app` and `apps/web/src/components`; 105 files are under localized app routes/components.
- Runtime attempt: `npm run dev --workspace=apps/web -- --port 3023` served Next.js 16.2.9. Local DB was unavailable (`ECONNREFUSED`), so DB-backed happy paths could not render.
- Browser evidence: agent-browser 0.22.2 snapshots at `http://localhost:3023/en` and `/en/admin`. Both rendered the localized route error shell because auth/SEO DB reads failed.
- Static review covered IA, affordances, keyboard/focus, WCAG 2.2 touch/contrast patterns, ARIA, focus traps, responsive breakpoints, loading/empty/error states, forms, dark/light/OLED tokens, i18n/RTL posture, and perceived performance.

## Relevant File Inventory

- Public routes: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`, `c/[slug]/page.tsx`, `map/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`, `privacy/page.tsx`, `layout.tsx`.
- Public UI: `components/nav-client.tsx`, `home-client.tsx`, `tag-filter.tsx`, `search.tsx`, `photo-viewer.tsx`, `photo-navigation.tsx`, `image-zoom.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `color-details-section.tsx`, `lightbox-color-pip.tsx`, `wide-gamut-hint.tsx`, `similar-photos.tsx`, `load-more.tsx`, `map/*`, `footer.tsx`.
- Admin UI: `app/[locale]/admin/page.tsx`, `login-form.tsx`, protected `dashboard`, `categories`, `tags`, `seo`, `settings`, `tokens`, `password`, `users`, `db`, `analytics`, plus `admin-header.tsx`, `admin-nav.tsx`, `upload-dropzone.tsx`, `image-manager.tsx`, `bulk-edit-dialog.tsx`, `admin-user-manager.tsx`.
- Global systems: `app/[locale]/layout.tsx`, `app/[locale]/globals.css`, `app/[locale]/error.tsx`, `app/global-error.tsx`, `app/[locale]/loading.tsx`, `app/[locale]/not-found.tsx`, `components/ui/*`, `messages/en.json`, `messages/ko.json`.

## Findings

### D33-UX-01: Admin login falls to a generic error shell during auth DB outages

- Severity: Medium
- Confidence: High
- Evidence: local `http://localhost:3023/en/admin` with DB unavailable produced an agent-browser snapshot containing `heading "Error"`, "Something went wrong loading this page.", Try Again, and Return to Gallery. The login form never rendered.
- Source: `apps/web/src/app/[locale]/admin/layout.tsx:14` awaits `getCurrentUser()` before rendering every admin child, including the login route. `apps/web/src/app/[locale]/admin/page.tsx:14` also awaits `isAdmin()` before returning `<LoginForm />`. `getCurrentUser()` performs an uncaught DB select at `apps/web/src/app/actions/auth.ts:37-46`.
- Failure scenario: during a DB restart or bad local/prod DB config, an unauthenticated admin sees a generic route error instead of a login surface with a clear "authentication service unavailable" state. That creates ambiguity between wrong URL, app crash, and temporary auth infrastructure outage.
- Suggested fix: keep the login route renderable when the pre-login session/user probe fails. Either move admin chrome probing to the protected layout only, or catch infrastructure errors on the login route and render `LoginForm` with a blocking/unavailable alert. Preserve strict auth checks for protected routes.

### D33-UX-02: Settings validation reports errors but does not move focus or provide an error summary

- Severity: Low
- Confidence: High
- Evidence: `handleSave()` validates, shows a toast, then returns without focusing or scrolling to the first invalid field.
- Source: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:230-235` returns after `toast.error(...)`. Invalid fields are marked in place, e.g. image quality at `settings-client.tsx:424-480`, image sizes at `settings-client.tsx:484-503`, wide-gamut source pixels at `settings-client.tsx:626-645`, and slideshow interval at `settings-client.tsx:696-715`.
- Failure scenario: a keyboard or screen-reader admin edits a long settings page, activates Save from the top action bar, and hears/sees only a transient toast. Focus remains on Save; the actual invalid field may be far below the current viewport.
- Suggested fix: after validation, focus the first invalid input and `scrollIntoView({ block: 'center' })`, or render a persistent error summary near the Save action with links to invalid fields. Keep the existing `aria-invalid`, `aria-describedby`, and field-level `role="alert"` messages.

### D33-UX-03: One-time upload-token copy lacks the clipboard fallback already used elsewhere

- Severity: Low
- Confidence: High
- Evidence: the token plaintext dialog is a one-time reveal, but its copy action calls only the async Clipboard API.
- Source: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:88-95` calls `navigator.clipboard.writeText(text)` directly. The one-time plaintext dialog is at `tokens-client.tsx:187-237`. A reusable fallback helper already exists at `apps/web/src/lib/clipboard.ts:1-43`, and other copy surfaces use/fallback similarly (`photo-viewer.tsx`, `image-manager.tsx`, `color-details-section.tsx`, `lightbox-color-pip.tsx`).
- Failure scenario: on an HTTP LAN install, restricted browser profile, or clipboard permission failure, the admin presses Copy on a token that will never be shown again and gets only a failure toast. The code is selectable, but the primary workflow breaks at the riskiest moment.
- Suggested fix: use `copyToClipboard()` in `TokensClient.handleCopy`, then keep the acknowledgement behavior only after a successful copy or explicit manual acknowledgement.

### D33-UX-04: Mobile photo-first IA still allows the tag filter to consume the first viewport

- Severity: Medium
- Confidence: Medium
- Evidence: source still renders the complete tag filter before the masonry grid, and the filter wraps all chips.
- Source: `apps/web/src/components/home-client.tsx:257-274` places heading and `<TagFilter>` before the photos heading/grid at `home-client.tsx:280-287`. `apps/web/src/components/tag-filter.tsx:63` uses `flex flex-wrap`, with every chip rendered as a 44 px button at `tag-filter.tsx:70` and `tag-filter.tsx:88`.
- Failure scenario: galleries with many tags can show taxonomy controls before enough photography on mobile. For a photo portfolio, this delays the primary content and makes the first viewport feel like a filter panel.
- Suggested fix: on small screens, collapse tags behind a Filters disclosure, cap visible chips to one row with a More control, or switch to horizontal scrolling while keeping active filters visible.

## Positive Coverage / Resolved Prior Issues

- The previous hidden-lightbox-controls issue appears addressed in current source: `controlVisibilityProps` is now empty at `apps/web/src/components/lightbox.tsx:371`, so controls are not removed from the accessibility tree when the visual overlay fades; focus capture at `lightbox.tsx:462` reveals controls for keyboard traversal.
- Search duplicate announcement appears addressed: visible no-result/error copy is `aria-hidden="true"` at `apps/web/src/components/search.tsx:474`, while the single live region remains at `search.tsx:440-449`.
- Modal/focus infrastructure is stronger than average: search, lightbox, and bottom sheet use focus traps plus modal tree isolation (`components/use-modal-tree-isolation.ts:19-65`); Radix dialogs handle the admin dialogs.
- Touch-target coverage is explicit across nav, photo controls, tables, upload, and dialogs; CLAUDE.md documents the 44 px policy, and source comments show many prior fixes.
- Color mode and contrast foundations are documented in tokens: light/dark/OLED variables at `apps/web/src/app/[locale]/globals.css:14-101`, reduced motion at `globals.css:253-279`, and forced-colors support at `globals.css:164-181` and `globals.css:281-300`.
- Map accessibility has a non-map fallback: `/map` provides a skip link and accessible photo list at `apps/web/src/app/[locale]/(public)/map/page.tsx:69-99`, so Leaflet interaction is not the only path.

## Validation Gaps

- DB-backed happy paths were not browser-verified locally because MySQL was not reachable. Static code review was used for admin protected routes, photo detail, gallery grids, and map happy paths.
- No lint/typecheck/test suite was run; this was a read-only designer review except for this review artifact.

## Verdict

The UI system remains mature on touch targets, modal primitives, localization, reduced motion, contrast tokens, and destructive-operation confirmation. Cycle 33 priorities should be: make the admin login outage state intelligible, improve long-form settings error recovery, harden one-time token copy, and keep the mobile home photo-first when tag counts grow.
