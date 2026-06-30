# Cycle 22 Designer / UI-UX Review

Date: 2026-06-30
Role: designer / UI-UX reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
Output constraint: review artifact only; no source-code edits, no commit, no push.

## Method and Runtime Evidence

I read the workspace instructions from `AGENTS.md`, the project context in `CLAUDE.md`, and the agent-browser CLI skill instructions before reviewing. I used the app where feasible and fell back to source, DOM, computed-state, accessibility-snapshot, and test review for DB-backed surfaces.

Local server command and output:

```text
npm run dev --workspace=apps/web

> web@0.1.0 dev
> next dev

 ⚠ Port 3000 is in use by process 9985, using available port 3001 instead.
   ▲ Next.js 16.2.9 (Turbopack)
   - Local:         http://localhost:3001
   - Network:       http://172.30.62.1:3001
   - Environments: .env.local

 ✓ Ready in 1626ms
Could not connect to database to bootstrap queue (ECONNREFUSED). Retrying image queue bootstrap in 30s.
```

Agent-browser routes exercised:

- `http://localhost:3001/en`: rendered the localized error boundary because the home route tried to query MySQL. Accessibility snapshot exposed `link "Skip to content"`, `main`, `region "Error"`, heading `Error`, button `Try again`, and link `Return to Gallery`. Console included `Error: Failed query: select slug, label, order, image_filename, map_visible ... from topics ...` plus settings/config DB fallback warnings.
- `http://localhost:3001/en/privacy`: loaded the public shell. Snapshot exposed `Main navigation`, GalleryKit home link, `Search photos` button, theme button, Korean language switch, `main` privacy content, and footer links.
- `http://localhost:3001/en/admin`: loaded the login form. Snapshot exposed heading `Admin`, labels `Username` and `Password`, required textboxes, `Show password`, and `Sign in`.

Agent-browser interaction evidence:

- Search dialog: clicking `Search photos` on `/en/privacy` focused `#search-input` with role `combobox`, `aria-expanded="false"`, and a dialog present. Pressing Escape removed the dialog and restored focus to the `Search photos` trigger.
- Mobile nav at `390x844`: clicking `Expand menu` set `aria-expanded="true"`, produced a visible controls box of `358x44`, and computed horizontal overflow was `0`.
- Admin login at `390x844`: username, password, password-toggle, and submit controls were all at least `44px` high/wide. `Show password` changed the input type to `text`, set `aria-pressed="true"`, and changed the label to `Hide password`. Wrong credentials produced an `alert` with `Authentication failed. Please try again.`

Targeted validation run:

```text
npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/a11y-us-p15.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/hdr-badge-contrast.test.ts

Test Files  5 passed (5)
Tests       55 passed (55)
```

## UI Inventory Examined

Documentation and product constraints:

- `CLAUDE.md:267-270` - photographer intent, no edit/culling/scoring product boundary.
- `CLAUDE.md:302-306` - derivative output is static and settings-hash based.
- `CLAUDE.md:331-341` - byte-affecting color/HDR setting changes require re-encoding and can run through an in-app backfill button with DB connection limits.
- `AGENTS.md` from the prompt - review scope, quality gates, deploy/schema/security conventions.

Public routes and shells:

- `apps/web/src/app/[locale]/layout.tsx:61-138` - viewport color-scheme, `lang`/`dir`, skip link, theme provider.
- `apps/web/src/app/[locale]/error.tsx:1-55` - localized public error boundary.
- `apps/web/src/app/[locale]/not-found.tsx:1-50` - localized not-found page with nav/footer shell.
- `apps/web/src/app/[locale]/(public)/page.tsx` and `apps/web/src/components/home-client.tsx:255-453` - home IA, LCP reservation, masonry/grid loading, reduced-motion back-to-top.
- `apps/web/src/app/[locale]/(public)/privacy/page.tsx` - static privacy route used for browser interaction.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`, `c/[slug]/page.tsx`, `[topic]/page.tsx`, `map/page.tsx`, `timeline/page.tsx`, and `year/[year]/page.tsx` - DB-backed public IA inspected by source, not fully exercised because MySQL was unavailable.

Admin routes and forms:

- `apps/web/src/app/[locale]/admin/login-form.tsx:26-100` - login form labels, password reveal, alert behavior.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:172-320` - settings save and backfill controls.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:187-238` - Lightroom token plaintext dialog.
- `apps/web/src/components/upload-dropzone.tsx:352-537` - upload empty states, GPS warning, progress, errors, dropzone roles.
- `apps/web/src/components/tag-input.tsx:208-275` - combobox/listbox tagging pattern.

Shared components and primitives:

- `apps/web/src/components/nav-client.tsx:83-181` - public nav, mobile expansion, language/theme/search controls.
- `apps/web/src/components/search.tsx:313-517` - search focus restore, dialog, combobox/listbox, live region, semantic toggles.
- `apps/web/src/components/lightbox.tsx:92-681` - reduced motion, dialog roles, controls, status.
- `apps/web/src/components/photo-viewer.tsx:355-704` - keyboard shortcuts, screen-reader headings/hints, reduced motion.
- `apps/web/src/components/ui/button.tsx:23-29` - 44px minimum button variants.
- `apps/web/src/components/ui/dialog.tsx:50-89` - dialog content and default close button.
- `apps/web/src/components/ui/table.tsx:7-19` - responsive horizontal table overflow.
- `apps/web/src/app/[locale]/globals.css:14-181` and `:253-279` - light/dark/oled tokens, HDR/P3 badge colors, forced-colors support, reduced-motion suppression.

Tests and verification references:

- `apps/web/src/__tests__/touch-target-audit.test.ts:1-245`
- `apps/web/src/__tests__/focus-visible-links-scan.test.ts:1-77`
- `apps/web/src/__tests__/a11y-us-p15.test.ts:25-112`
- `apps/web/src/__tests__/i18n-key-parity.test.ts:43-72`
- `apps/web/src/__tests__/hdr-badge-contrast.test.ts:58-83`
- `apps/web/e2e/public.spec.ts:21-123`
- `apps/web/e2e/admin.spec.ts:11-160`
- `apps/web/e2e/nav-visual-check.spec.ts:40-79`

## Findings

### 1. Public error boundary drops the site shell and can strand users on a failing home route

Severity: Medium
Confidence: High
Status: Confirmed by browser and source
Areas: information architecture, error state UX, keyboard recovery, i18n shell consistency

Evidence:

- Browser selector/evidence: `http://localhost:3001/en` rendered only `link "Skip to content"`, `main`, `region "Error"`, heading `Error`, paragraph `Something went wrong loading this page.`, button `Try again`, and link `Return to Gallery`.
- Browser console evidence: the page failed from a DB-backed home query, `Failed query: select slug, label, order, image_filename, map_visible ... from topics ...`.
- `apps/web/src/app/[locale]/error.tsx:22-53` renders a standalone `<main>` with the error copy and two actions, but no `Nav` or `Footer`.
- `apps/web/src/app/[locale]/not-found.tsx:7-11` explicitly documents that stripping the public shell was previously a UX problem, and `apps/web/src/app/[locale]/not-found.tsx:20` plus `:47` include `Nav` and `Footer`.

Failure scenario:

A transient DB outage or route-loader exception on the public home page leaves visitors in a generic error state with no visible search, topics, language switch, theme control, footer links, or admin/privacy escape hatch. On the home route, `Return to Gallery` points back to the same failing IA entry point, so the main recovery path can loop.

Suggested fix:

Mirror the not-found shell in the localized error boundary: render `Nav`, keep the `main`/skip-link target, and render `Footer`. If the current route is already the localized home path, avoid presenting `Return to Gallery` as the primary recovery action; use `Try again` plus stable fallback links such as Privacy/Admin or a route-safe home link only when it changes location. Add a source or e2e assertion that localized error pages preserve the public shell.

### 2. Settings can trigger a site-wide derivative re-encode with one click and no confirmation

Severity: High
Confidence: High
Status: Confirmed by source
Areas: affordance safety, admin workflow, perceived performance, photographer-output trust

Evidence:

- `CLAUDE.md:302-306` states derivative output is static and tied to image settings hashes.
- `CLAUDE.md:331-337` states flipping color/quality/size settings requires a backfill pass to re-encode existing photos, and that the in-app Settings page has a `Re-encode existing photos` button.
- `CLAUDE.md:339-341` notes the in-app backfill can use up to five DB connections at the shipped pool size.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:172-183` defines `handleBackfill`, which immediately calls `triggerBackfill()` and queues the background runner.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:297-305` says the button is visible whenever the gallery has photos.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:315-320` wires the visible button directly to `onClick={handleBackfill}`; it is disabled only while `isBackfilling`.

Failure scenario:

An admin scanning the settings page taps `Re-encode now` by mistake on a production gallery. The action can enqueue a CPU/IO/DB-heavy derivative rewrite and alter photo delivery bytes/cache state, while the UI offers no confirmation, no estimate, and no explicit warning that this is a broad background operation.

Suggested fix:

Wrap this action in an explicit confirmation flow before `triggerBackfill()` runs. The dialog should include the approximate photo count, what will be regenerated, whether originals are untouched, expected resource impact, and whether the job can be cancelled. For stronger protection, require typing a short confirmation phrase such as `RE-ENCODE` when the affected count is non-trivial, and keep the button disabled while settings are dirty unless the user first saves the new settings.

### 3. Token plaintext dialog shows a close affordance that intentionally does nothing before acknowledgment

Severity: Medium
Confidence: High
Status: Confirmed by source
Areas: modal affordances, focus trap behavior, keyboard expectations, screen-reader feedback

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:187-195` keeps the dialog open unless `plaintextAcknowledged` is true.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:197` renders `DialogContent` without overriding its close-button behavior.
- `apps/web/src/components/ui/dialog.tsx:50-89` defaults `showCloseButton = true` and renders a `DialogPrimitive.Close` button.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:216-235` requires the acknowledgment checkbox before the `Done` button is enabled.

Failure scenario:

After generating a token, an admin clicks the visible `X`, presses Escape, or clicks outside the modal before checking the acknowledgment box. The dialog remains open because the state handler refuses to close it, but the visible close affordance gave the opposite expectation. Keyboard and screen-reader users get no inline explanation that the close attempt was blocked by the acknowledgment requirement.

Suggested fix:

Make the modal visibly non-dismissable until acknowledgment is complete. Pass `showCloseButton={false}` to `DialogContent` while `plaintextAcknowledged` is false, prevent outside/Escape dismiss with a short inline explanation, and keep `Done` as the only closing affordance. Alternatively, allow close attempts to focus the checkbox and announce an inline error such as `Acknowledge that the token has been saved before closing.`

## Verified Controls and Non-Findings

- Search modal focus management is strong in the tested static route: the trigger moved focus into `#search-input`, Escape closed the dialog, and focus returned to the trigger. Source support: `apps/web/src/components/search.tsx:313-324`, `:370-383`, and `:391-449`.
- Mobile public nav met the 44px target and did not horizontally overflow in the tested `390x844` viewport. Source support: `apps/web/src/components/nav-client.tsx:99-179` and `apps/web/src/components/ui/button.tsx:23-29`.
- Admin login labels, required controls, password reveal state, and alert feedback were confirmed by browser interaction. Source support: `apps/web/src/app/[locale]/admin/login-form.tsx:45-96`.
- Global reduced-motion handling is present for CSS transitions/animations and component-level scroll behavior. Source support: `apps/web/src/app/[locale]/globals.css:253-279`, `apps/web/src/components/lightbox.tsx:92-109`, and `apps/web/src/components/photo-viewer.tsx:681-688`.
- Dark/light/oled themes and forced-colors tokens are implemented in CSS and theme provider setup. Source support: `apps/web/src/app/[locale]/layout.tsx:119-138` and `apps/web/src/app/[locale]/globals.css:14-181`.
- i18n key parity is covered by tests and passed in the targeted run. Source support: `apps/web/src/__tests__/i18n-key-parity.test.ts:43-72`.
- RTL is not currently a runtime locale in the inspected app surface; `layout.tsx:93-111` does set `dir` from locale metadata, so future RTL support has a central hook but was not browser-verified.

## Coverage by Requested Area

- Information architecture: reviewed public shell, localized error/not-found, privacy, home source, topic/search/map/timeline/year/share source, admin route map, and footer/nav behavior.
- Affordances: reviewed public search/nav controls, admin login, settings backfill, token dialog, upload empty/error/progress states.
- Focus and keyboard navigation: exercised search dialog, admin password toggle, mobile menu; reviewed lightbox/photo-viewer keyboard code and focus-visible tests.
- WCAG 2.2 accessibility: checked skip link, 44px target tests, focus-visible tests, ARIA dialog/combobox/listbox patterns, alerts, live regions, forced-colors CSS, reduced-motion CSS.
- Contrast: relied on source token review and passed HDR badge contrast tests; no raw screenshot-only contrast claims were made.
- Responsive breakpoints: exercised mobile nav/login at `390x844`; reviewed home stable card dimensions and table horizontal scroll source.
- Loading/empty/error states: reviewed route error boundary, home loading/CLS reservation, upload empty state, login error, and source-level public loading surfaces.
- Form validation UX: reviewed login and settings; finding 2 covers destructive admin action safety, and earlier validation work remains relevant but was not re-raised because this cycle focused on newly confirmed issues.
- Dark/light mode: reviewed provider/CSS; browser state was theme-pinned to `light`, so no dark-mode browser finding is claimed.
- i18n/RTL: reviewed locale messages parity and `lang`/`dir`; RTL was source-reviewed only.
- Perceived performance/LCP/CLS/INP risks: reviewed home LCP/CLS reservation, backfill resource impact, DB-failure behavior, and search/admin interaction responsiveness in browser.

## Final Sweep and Skipped Files

Skipped from browser execution because MySQL was unavailable: DB-backed home content, topic/category/tag/year/timeline/map result states, photo detail pages, shared gallery/photo routes, protected admin dashboards, upload flows, and token generation. These were inspected by source where relevant.

Skipped from source review: generated `.next`, `node_modules`, static image assets, uploaded media, and unrelated non-UI scripts. I did not run the Playwright e2e suite because the local DB/admin seed was unavailable; the relevant e2e files were read for coverage expectations instead.
