# Cycle 24 UI/UX Designer Reviewer - GalleryKit

Date: 2026-06-30
Reviewer surface: `ui-ux-designer-reviewer`
Repo: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `7ff1eeec`

## Scope And Inventory

I loaded `AGENTS.md`, `CLAUDE.md`, the repo-local Gallery rules, the installed role prompt at `~/.codex/agents/ui-ux-designer-reviewer.md`, and the code-review skill guidance. The installed reviewer prompt is still product-specific to a different SwiftUI app, so I used it only as role posture and reviewed the actual GalleryKit web UI.

Inventory was completed before findings. Candidate files covered:

- Public routes: `apps/web/src/app/[locale]/(public)/**`, including home, topic, photo, shared links, smart collections, map, timeline, year, privacy, loading, error, and not-found surfaces.
- Admin routes: `apps/web/src/app/[locale]/admin/**`, including login, dashboard, categories, tags, SEO, settings, tokens, password, users, DB, analytics, layouts, and protected wrappers.
- Components and styles: `apps/web/src/components/**`, shadcn primitives, navigation, search, home grid, photo viewer, lightbox, info sheet, image manager, upload dropzone, map, histogram, color details, global CSS/theme tokens.
- Localization: `apps/web/messages/en.json` and `apps/web/messages/ko.json`.
- Browser/e2e/static UI evidence: `apps/web/e2e/*.ts` and UI/a11y tests under `apps/web/src/__tests__`, especially touch target, focus-visible, i18n parity, lightbox, info-sheet, and source-contract tests.

Skipped-file confirmation: no UI-relevant route, component, style, message, or e2e group from the inventory was skipped. I did not line-review backend-only tests or non-UI library internals except where they directly explained a UI failure path.

## Evidence And Constraints

- Agent-browser was feasible for the unauthenticated admin login surface. `http://localhost:3001/en/admin` rendered `Skip to content`, `Admin`, username/password fields, and sign-in. Screenshot: `/tmp/gallery-admin-login-1280.png`.
- Public DB-backed pages could not be visually exercised past the loading shell on the existing dev server. `agent-browser` at `http://127.0.0.1:3001/en` returned body text `Skip to content\nLoading...`, no `<main>`, and `document.readyState === "complete"`. The dev log showed repeated database `ECONNREFUSED` and failed `topics` / `images` queries.
- Starting a separate dev server on port 3100 was blocked by Next's running-server lock: another dev server was already active for this repo on `localhost:3001` (PID 33356). I did not stop or kill it.
- Focused validation passed: `npm run test --workspace=apps/web -- touch-target-audit.test.ts focus-visible-links-scan.test.ts focus-visible-rings-cycle20.test.ts i18n-key-parity.test.ts lightbox-controls-contract.test.ts info-bottom-sheet-ia.test.ts` -> 6 files, 48 tests passed.
- Existing unrelated review files were already dirty before this pass. This report is the only file I changed.

## Confirmed Issues

### 1. Public DB outage leaves visitors on an indefinite loading shell

Severity: High
Confidence: High
Area: availability UX, accessibility, recovery IA

Evidence:
- Browser evidence on current HEAD/server: `/en` completed document load with body text only `Skip to content\nLoading...`, no `main`, and no visible localized error or recovery action.
- Server log evidence: repeated `ECONNREFUSED`, failed `select ... from topics`, and failed `select id, title from images`.
- `apps/web/src/app/[locale]/(public)/page.tsx:151-166` awaits `getSeoSettings()`, `getGalleryConfig()`, `getTagsCached()`, `getTopicsCached()`, then `getImagesLitePage(...)` without a degraded public fallback.
- `apps/web/src/lib/data.ts:509-529` and `apps/web/src/lib/data.ts:878-906` show the DB-backed topic/image queries that fail in this state.
- `apps/web/src/app/[locale]/loading.tsx:7-10` provides only a spinner/status label while the failed route never reaches a usable shell.

User failure scenario:
A visitor, client, or screen-reader user reaches the gallery during a DB outage or local misconfiguration and hears/sees only "Loading..." indefinitely. The skip link points to no rendered `main`, there is no retry/back-to-gallery action, and no explanation that the gallery is temporarily unavailable.

Fix:
Add a public degraded state for DB-backed listing failures. Either catch expected DB-unavailable failures around the home/listing data loads and render a localized maintenance/error section inside `main#main-content`, or make sure the route reliably transitions into the localized error boundary with retry and navigation. Keep `Nav`'s existing defensive fallbacks, but do not let the page body stay as a perpetual loading status.

### 2. Mobile screen-reader users get desktop keyboard shortcut instructions in the photo viewer

Severity: Medium
Confidence: High
Area: accessibility, mobile ergonomics, photographer viewer fit

Evidence:
- `apps/web/src/components/photo-viewer.tsx:525` attaches `aria-describedby="photo-viewer-shortcuts"` to the viewer container.
- `apps/web/src/components/photo-viewer.tsx:534-545` explicitly says the shortcut hint is irrelevant on touch devices but keeps it in the accessibility tree with `sr-only md:not-sr-only`.
- The described text in `apps/web/messages/en.json:356` and `apps/web/messages/ko.json:356` is desktop-keyboard-specific: arrows, `F`, `I`, `C`, `H`, and Space.

User failure scenario:
On a phone, a screen-reader user opens a photo detail page and gets announced keyboard-only controls that are not available in the touch workflow. That adds cognitive noise before the actual viewer controls and is especially awkward for the photographer audience, where the viewer should foreground image inspection and metadata access.

Fix:
Split the descriptions. Use a concise always-available SR description for the viewer, such as "Photo viewer. Use the buttons to open fullscreen, share, and view info." Keep the desktop shortcut hint visible and described only for keyboard-capable layouts, or attach it to a desktop-only help element rather than the root viewer on mobile.

### 3. Admin settings copy exposes operator/runbook detail directly in the form

Severity: Medium
Confidence: High for source/rendered copy, Medium for protected-browser impact
Area: information architecture, localization, photographer audience fit

Evidence:
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:307-329` renders backfill warnings and trigger hints inline in a status/banner block.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:557-560` renders a Firefox display-detection note inline.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:741-789` renders the semantic-search card and warnings.
- English strings such as `settings.semanticSearchDesc`, `settings.backfillRequiredHint`, `settings.backfillTriggerHint`, and `settings.backfillConfirmDesc` in `apps/web/messages/en.json:745-779` include implementation terms like stub embeddings, operator-gated production, env flags, sidecar backfill, `--force-reencode`, live host, pipeline version, and CPU/disk-heavy processing.
- Korean equivalents in `apps/web/messages/ko.json:745-779` preserve the same dense operator terminology, making the localized UI long and difficult to scan.

User failure scenario:
A photographer-admin trying to make a practical choice about color/HDR derivatives or semantic search has to parse deployment/runbook concepts in the main form before understanding the action. On mobile or in Korean, the long explanatory blocks become dense paragraphs and push the actual controls farther down the page.

Fix:
Separate task copy from operator copy. Keep the form labels and help text outcome-oriented, for example "Existing photos need re-encoding before this change appears publicly." Move sidecar/env/force-reencode details into a collapsible "operator details" section or linked runbook. For Korean, rewrite as shorter native UI text rather than a direct technical translation.

## Likely Issues

### 4. Protected admin navigation is likely too heavy on small screens

Severity: Medium
Confidence: Medium
Area: responsive layout, admin IA, keyboard/touch ergonomics

Evidence:
- `apps/web/src/components/admin-header.tsx:13-27` renders the admin header as a wrapping flex row.
- `apps/web/src/components/admin-nav.tsx:15-29` always renders ten top-level admin links: dashboard, categories, tags, SEO, settings, tokens, password, users, DB, analytics.
- `apps/web/src/app/[locale]/admin/layout.tsx:17-27` puts this header above an overflowed `main`.
- Admin e2e is opt-in behind credentials in `apps/web/e2e/admin.spec.ts:11-12` and exercises navigation clicks, but not responsive header density.

User failure scenario:
On a phone or narrow tablet, an authenticated admin likely sees a multi-row header before every page and must tab through ten nav links plus logout before content. That slows repeated upload/settings work and makes the operational admin feel less like a focused photographer tool.

Fix:
Use a responsive admin navigation pattern: keep the full link strip on desktop, but collapse to a menu/sheet or segmented high-level groups on small screens. Preserve `aria-current`, 44 px targets, and keyboard focus order. Consider grouping less-frequent operational pages such as tokens, password, users, DB, and analytics under an "Admin" or "System" menu.

## Risks Needing Manual Validation

- Public gallery, photo, topic, map, timeline, search, and shared-link visual behavior could not be manually validated with agent-browser because the current dev server lacked a reachable DB and stayed on the loading shell. Source and tests were reviewed instead.
- Protected admin pages beyond login could not be browser-validated because no admin credentials were available and the prompt did not authorize credential use. Source and opt-in e2e coverage were reviewed instead.
- Visual polish of real photo color/HDR presentation still needs a seeded browser pass on a machine with a working DB and representative images. The source has strong color/HDR intent, but this cycle could not inspect actual rendered imagery.

## Missed-Issue Sweep

- Touch targets: focused audit passed; reviewed button/link target patterns in nav, search, photo viewer, lightbox, info sheet, upload, admin nav, and table actions.
- Focus-visible and keyboard: focused focus-visible scans passed; source shows focus traps/restoration in search/lightbox/info sheet and IME guards in search.
- Localization: `i18n-key-parity.test.ts` passed; the remaining localization concern is quality/density of specific admin technical strings, not missing keys.
- Responsive layout: reviewed public nav, masonry home, photo viewer, bottom sheet, lightbox, admin header/nav, image manager, upload staging, and settings form. Manual responsive validation remains blocked for DB-backed pages.
- Information architecture: reviewed public navigation/search/topic flows, photo detail metadata hierarchy, admin workflow grouping, settings copy, and recovery routes.
- Prior-cycle assumptions were not reused as findings without current source evidence.
