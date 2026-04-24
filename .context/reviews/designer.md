# UI/UX Designer Review — Cycle 4

**Repository:** `/Users/hletrd/flash-shared/gallery`  
**App:** Next.js App Router web frontend (`apps/web`)  
**Date:** 2026-04-25  
**Commit:** not committed, per prompt.

## Method / inventory

Review focus: public gallery IA, admin IA, keyboard/focus, WCAG 2.2, loading/empty/error states, form validation UX, dark/light mode, i18n/RTL, and perceived performance.

Tracked UI surface reviewed:

- Public routes: `apps/web/src/app/[locale]/(public)/layout.tsx`, `page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`
- App shell/state: `apps/web/src/app/[locale]/layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `global-error.tsx`, `globals.css`
- Public components: `nav.tsx`, `nav-client.tsx`, `footer.tsx`, `home-client.tsx`, `search.tsx`, `tag-filter.tsx`, `load-more.tsx`, `photo-viewer.tsx`, `photo-navigation.tsx`, `image-zoom.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `histogram.tsx`, `optimistic-image.tsx`
- Admin routes/components: admin layouts/pages, `admin-header.tsx`, `admin-nav.tsx`, `admin/login-form.tsx`, `dashboard/dashboard-client.tsx`, `image-manager.tsx`, `upload-dropzone.tsx`, `tag-input.tsx`
- UI primitives: `components/ui/*`, especially `button`, `input`, `dialog`, `sheet`, `alert-dialog`, `sonner`
- i18n/theme/layout: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `components/i18n-provider.tsx`, `components/theme-provider.tsx`, `app/[locale]/layout.tsx`, `app/[locale]/globals.css`

## Runtime blocker

Local browser validation was partially blocked because the public gallery cannot read the database in this environment. A live request to `/en` falls through to the public error boundary after `topics` / image queries fail with `ECONNREFUSED 127.0.0.1:3306`. The admin login shell still renders, so I validated that surface in-browser and relied on source inspection for the rest.

## Findings

### UX-01 — Public gallery data failure still drops the whole shell

- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** confirmed
- **File / region:** `apps/web/src/app/[locale]/(public)/page.tsx:113-130`, `apps/web/src/components/nav.tsx:6-13`, `apps/web/src/app/[locale]/error.tsx:7-35`
- **Failure / user scenario:** When the DB is unavailable, the home page cannot keep the public chrome visible or explain the outage in gallery terms. Browser/curl output for `/en` shows the route failing through the generic error path instead of rendering a branded maintenance or empty state.
- **Suggested fix:** Catch public chrome/data failures separately, keep the shell visible, and render a localized maintenance/empty state with retry guidance. Reserve the generic error boundary for truly fatal conditions.

### UX-02 — Search field hides its focus state

- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** confirmed
- **File / region:** `apps/web/src/components/search.tsx:182-206`
- **Failure / user scenario:** The search input removes its ring/outline (`focus-visible:ring-0 shadow-none outline-none`) and does not replace it on the dialog shell. Keyboard users can land in the field without a visible cue that focus is there.
- **Suggested fix:** Restore a visible focus ring on the input, or move the focus treatment to the surrounding header/container so the active element is obvious at a glance.

### UX-03 — Search results/errors are not announced as state changes

- **Severity:** LOW-MEDIUM
- **Confidence:** High
- **Status:** confirmed
- **File / region:** `apps/web/src/components/search.tsx:52-76, 219-263`
- **Failure / user scenario:** Search updates are silent to assistive tech, and the error path just clears the result list. That makes “no results” indistinguishable from “search failed,” and there is no polite live region like the one used in `load-more.tsx`.
- **Suggested fix:** Add an `aria-live="polite"` status region for “searching,” result counts, and error states. Keep the empty state and failure state visually and semantically distinct.

### UX-04 — Admin dashboard still squeezes upload and management too early

- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** confirmed
- **File / region:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:30-39`
- **Failure / user scenario:** The dashboard stays single-column until `xl`, so common laptop/tablet widths force the upload surface and the dense image manager into a cramped two-pane layout. The table becomes hard to scan and interact with.
- **Suggested fix:** Stack the panes until a wider breakpoint, or let the image manager take the full width on medium screens and demote upload to a secondary panel.

### UX-05 — Login failure feedback is toast-only and not field-linked

- **Severity:** LOW-MEDIUM
- **Confidence:** Medium
- **Status:** likely
- **File / region:** `apps/web/src/app/[locale]/admin/login-form.tsx:21-45`, `apps/web/src/app/actions/auth.ts:70-111, 148-206`
- **Failure / user scenario:** The form has native required fields, but once the request reaches the server the only error path is a toast. There is no inline error region, no `aria-invalid`, and no message tied to the username/password inputs, so keyboard and screen-reader users get little guidance on what to correct.
- **Suggested fix:** Render a form-level error region inside the card and, if field-specific validation is added later, bind it with `aria-describedby` / `aria-invalid` instead of relying on toasts alone.

### UX-06 — Shared overlay close controls still announce English in all locales

- **Severity:** LOW
- **Confidence:** High
- **Status:** confirmed
- **File / region:** `apps/web/src/components/ui/dialog.tsx:69-76`, `apps/web/src/components/ui/sheet.tsx:75-78`
- **Failure / user scenario:** Korean users can open localized dialogs/sheets, but the close button is still announced as “Close” because the primitives hardcode the label.
- **Suggested fix:** Thread localized close labels through the primitives or let each localized call site provide the `sr-only` text.

### UX-07 — RTL is acknowledged but not actually prepared

- **Severity:** LOW
- **Confidence:** High
- **Status:** risk
- **File / region:** `apps/web/src/app/[locale]/layout.tsx:79-84`, plus the many physical `left/right` placements throughout the shell
- **Failure / user scenario:** If an RTL locale is introduced later, the app will need a broad layout pass because the root element is locked to `dir="ltr"` and many components use physical positioning rather than logical start/end.
- **Suggested fix:** Add a locale-to-direction map and migrate the highest-traffic layouts/components to logical spacing/placement before introducing RTL content.

### UX-08 — Photo-viewer shortcuts remain hidden behind titles only

- **Severity:** LOW-MEDIUM
- **Confidence:** High
- **Status:** confirmed
- **File / region:** `apps/web/src/components/lightbox.tsx:38-44, 179-202`; `apps/web/src/components/photo-viewer.tsx:165-177`
- **Failure / user scenario:** The viewer supports `F`, arrow keys, and Escape, but the only discoverability is a `title` attribute and `aria-keyshortcuts`. First-time users do not see a visible keyboard hint, so the richer navigation feels less polished than it is.
- **Suggested fix:** Add a compact on-screen shortcut hint or a help affordance near the toolbar / lightbox trigger.

### UX-09 — The blur placeholder still does almost nothing

- **Severity:** LOW
- **Confidence:** High
- **Status:** confirmed
- **File / region:** `apps/web/src/components/home-client.tsx:219-228`
- **Failure / user scenario:** The fallback uses a 1×1 transparent PNG, so slow-loading cards still pop in abruptly instead of fading from a meaningful blurred preview.
- **Suggested fix:** Generate a real low-res blur or dominant-color placeholder at ingest time and persist it with the image metadata.

## Overall assessment

The UI is structurally strong: the app shell, viewer, and admin toolset are coherent and mostly accessible. The remaining UX debt is concentrated in four places:

1. **Resilience** — the public gallery still collapses to a generic error shell when the DB is unavailable.
2. **Interaction feedback** — search focus, search results, and login failures need clearer state handling.
3. **Responsive admin ergonomics** — the dashboard still compresses too much before it reaches a wide breakpoint.
4. **Polish / internationalization** — close labels, RTL readiness, shortcut discoverability, and blur placeholders still need refinement.

No code was changed in this review pass.
