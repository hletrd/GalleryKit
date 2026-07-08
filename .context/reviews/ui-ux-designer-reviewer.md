# UI/UX Designer Reviewer - Cycle 36

Repository: `/Users/hletrd/flash-shared/gallery`
Review HEAD: `bc73c02293f2568d23602ab498f12346a37fadf1`
Lane: `ui-ux-designer-reviewer`
Date: 2026-07-08 KST

Review-only lane. I wrote this report only; no production code, commits, pushes, or deploys.

## Evidence Base

- Read `AGENTS.md` instructions and `CLAUDE.md`.
- Used `agent-browser` CLI for runtime snapshots, screenshots, viewport/media changes, and page JS evaluation.
- Local runtime: `npm run start --workspace=apps/web -- -p 3002` from the existing build. `next start` served pages but warned about standalone output.
- `next dev` was blocked by a stale dev-server marker, and I avoided deleting lock files or killing processes.
- Runtime snapshots:
  - `/en` desktop `1440x1000`: named landmarks, visible tag filter, photo links, footer.
  - `/ko` mobile dark `390x844`: localized labels, mobile disclosure, dark theme.
  - `/en/admin`: unauthenticated login form.
  - `/en/map` mobile: map region, skip-to-list link, accessible fallback list.
  - `/en` search dialog open: dialog + focused combobox.
- Browser limitation: protected admin pages were source-reviewed only because no credentials were available.
- Validation: `npm run typecheck --workspace=apps/web` passed.

## Findings

### UIUX-C36-01 - Footer fails 320px reflow

Severity: Medium
Confidence: High
WCAG: 1.4.10 Reflow

Evidence:

- Source: `apps/web/src/components/footer.tsx:41` uses `className="flex items-center gap-4 text-sm text-muted-foreground"` with no wrapping.
- Source: footer links at `footer.tsx:42-65` each enforce a 44px minimum target, and the GitHub link includes visible text.
- Runtime selector evidence: on `http://localhost:3002/ko` at `320x568`, `footer div div` measured `width=380.15625`, `left=-30.078125`, `right=350.078125`; document scroll width was `350` with a `320` viewport.

Failure scenario:

A narrow mobile visitor reaches the footer and the page becomes horizontally scrollable. The first link is partially off-screen and the Admin link extends past the viewport, making footer navigation harder to perceive and operate.

Fix:

Use `flex-wrap justify-center` for the footer link row, reduce narrow-width gaps, or group links into two rows. Add a 320px EN/KO regression check because Korean labels and the GitHub "opens in new window" copy affect width.

### UIUX-C36-02 - SEO settings report every field invalid for one server-side error

Severity: Medium
Confidence: High for source; protected route not live-authenticated
WCAG: 3.3.1 Error Identification, 3.3.3 Error Suggestion

Evidence:

- Source: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:34-42` stores one `formError` and appends the same summary ID to all fields.
- Source: failed save focuses only the form summary: `seo-client.tsx:75-85`.
- Source: every SEO input/textarea sets `aria-invalid={!!formError}`: title `seo-client.tsx:121-128`, nav title `135-142`, description `149-157`, author `164-171`, locale `178-185`, OG image `200-209`.
- Source: server action returns field-specific messages but not field IDs, e.g. title invalid `apps/web/src/app/actions/seo.ts:85-87`, locale invalid `126-128`, OG image invalid `137-140`.

Failure scenario:

An admin enters one invalid Open Graph image URL and saves. The UI marks title, nav title, description, author, locale, and OG image as invalid, then focuses a summary. Screen-reader and keyboard users must inspect every field even though one field caused the failure.

Fix:

Return structured field errors from `updateSeoSettings`, such as `{ field: 'seo_og_image_url', error }`. In `SeoSettingsClient`, keep a field-error map, set `aria-invalid` only on affected fields, render inline errors with specific `aria-describedby`, and focus the first invalid control.

### UIUX-C36-03 - Admin image manager relies on horizontal table scrolling for core actions

Severity: Medium
Confidence: High for source; protected route not live-authenticated
Area: responsive admin workflow, affordances

Evidence:

- Source: `apps/web/src/components/image-manager.tsx:427-620` renders the management UI as a table inside `overflow-x-auto`.
- Source: the table has nine conceptual columns at `image-manager.tsx:431-450`.
- Source: preview is fixed at `h-32 w-32`: `image-manager.tsx:473-488`.
- Source: per-row tags reserve `min-w-[200px]`: `image-manager.tsx:500-552`.
- Source: edit/delete actions are at the far right: `image-manager.tsx:571-607`.

Failure scenario:

On mobile or a small laptop, an admin must scroll sideways to tag, inspect metadata, and reach edit/delete controls. When several images are visually similar, row identity can be lost during horizontal scroll, increasing the chance of wrong-photo edits.

Fix:

Add a responsive card layout below `lg` with preview, title, tags, status, date, and actions in one block. Preserve the dense table only for wide screens.

### UIUX-C36-04 - Primary nav omits non-topic browse routes

Severity: Low-Medium
Confidence: High
Area: IA, wayfinding

Evidence:

- Source: sticky nav topics are generated only from `topics.map(...)`: `apps/web/src/components/nav-client.tsx:106-143`.
- Source: controls beside topics are search, theme, and locale only: `nav-client.tsx:145-168`.
- Source: Timeline, Map, About/GalleryKit, Privacy, GitHub, and Admin live in footer only: `apps/web/src/components/footer.tsx:41-67`.
- Runtime `/en` snapshot confirmed Timeline/Map/Privacy appeared only under `contentinfo`, while sticky nav exposed brand, topic, search, theme, and language.

Failure scenario:

A visitor who scrolls through photos may not discover the date archive or GPS map until the footer. The mobile expander also shows topics only, so the first-screen navigation does not reveal alternate browsing modes.

Fix:

Add "Timeline" and "Map" to the sticky nav or a compact "Browse" menu. On mobile, include those routes in the expanded menu after topics. Keep footer links for secondary/legal routes.

### UIUX-C36-05 - RTL support is source-declared but not component-ready

Severity: Low
Confidence: Medium
Area: i18n/RTL

Evidence:

- Source: layout sets document direction from locale: `apps/web/src/app/[locale]/layout.tsx:101-107`.
- Source: nav uses physical layout utilities, including `mr-3 md:mr-6` at `apps/web/src/components/nav-client.tsx:100`, `ml-auto` at `nav-client.tsx:112` and `148`, and `ml-1/ml-auto` at `180`.
- Current shipped locales are EN/KO, so runtime RTL testing was not applicable.

Failure scenario:

Adding Arabic, Hebrew, or another RTL locale would set `dir="rtl"`, but controls could retain LTR physical spacing and edge alignment. Visual order, focus order, and expected start/end placement may diverge.

Fix:

Before shipping an RTL locale, audit physical `left/right/ml/mr` classes across public/admin shells and convert to logical start/end utilities or direction-aware class composition. Add an RTL visual/browser pass to the locale acceptance checklist.

## Positive Coverage Notes

Runtime public pages had named landmarks, skip links, localized labels, and no missing button names in sampled snapshots. Search modal exposes a dialog, focused combobox, close button, and keyboard instructions. Login form has persistent labels, password visibility toggle, inline required-field errors, and focus restoration source. Map page has skip-to-list, region instructions, marker/popup button, and fallback list. CSS includes reduced-motion and forced-colors handling.

## Final Missed-Issue Sweep

Checked IA, affordances, keyboard/focus, WCAG 2.2, responsive breakpoints, loading/empty/error states, form validation UX, dark/light mode, EN/KO i18n, future RTL, perceived performance, and product/marketing clarity. Revalidated prior-cycle issues: wide-gamut copy is now corrected, search combobox empty-state control relationship is corrected, and current typecheck passes. Unverified live areas: authenticated protected admin pages, production CDN/SW/offline behavior, share links with non-seeded keys, large-gallery stress behavior, physical color/HDR accuracy, and destructive admin flows.
