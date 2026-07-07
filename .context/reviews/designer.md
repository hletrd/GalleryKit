# GalleryKit Designer Review — Cycle 6 Prompt 1

Date: 2026-07-07
Reviewed HEAD: `c5d6b27e`
Lane: designer
Mode: read-only UI/UX review with browser tooling, source inspection, and focused a11y/i18n tests. No source edits, commits, or pushes.

## Inventory

Reviewed UI-relevant surfaces:

- Prompt/docs: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/prompts/common_review_scope.md`, `.context/reviews/prompts/designer.md`, latest `.context/reviews/_aggregate.md`, Cycle 5 plan/deferred register.
- Public routes: home/topic/photo/share/group/smart-collection/map/timeline/year/privacy/error/not-found under `apps/web/src/app/[locale]/(public)/**` plus `apps/web/src/app/[locale]/{layout,error,not-found}.tsx`.
- Admin routes: login and protected admin shell/routes under `apps/web/src/app/[locale]/admin/**`.
- Components: `nav-client.tsx`, `search.tsx`, `home-client.tsx`, `masonry-card.tsx`, `photo-viewer.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `upload-dropzone.tsx`, `admin-nav.tsx`, `admin-header.tsx`, UI primitives.
- Tests/contracts: touch target audit, focus-visible scan, skip-link/a11y contracts, password form a11y, error shell, i18n parity, public/admin Playwright specs.

Browser/runtime evidence:

- `next dev --hostname 127.0.0.1 --port 3000` failed before serving with a Turbopack lockfile I/O error. I used `next start --hostname 127.0.0.1 --port 3000` from the existing build.
- Local MySQL was not reachable (`ECONNREFUSED 127.0.0.1:3306`), so DB-backed public gallery/photo/topic routes rendered the localized error shell. Static/admin-login/privacy surfaces were reachable.
- Agent-browser checks:
  - `/en` desktop light and mobile dark: HTTP 500 error shell with `h1` "Error", `Try again`, `Return to Gallery`; buttons/links measured at 44 px high.
  - `/en/admin` desktop and `/ko/admin` mobile dark: HTTP 200; visible labels, required username/password fields, password reveal button, submit button; inputs/buttons measured at 44 px high.
  - `/en/privacy`: HTTP 200; nav/search/theme/locale/footer controls all 44 px high in DOM measurements.
  - Search dialog from privacy page: `#search-dialog` opened, `#search-input` focused with `role="combobox"` and neutral `Ctrl/⌘ K` copy; Escape closed the dialog and restored focus to the trigger. Filling `test` under DB outage produced the visible/live status "Search is temporarily unavailable. Please try again later."

Focused validation:

- `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/a11y-us-p15.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/password-form-a11y.test.ts src/__tests__/error-shell.test.ts src/__tests__/error-shell-heading.test.ts`
- Result: pass, 7 files / 59 tests.

## Confirmed Issues

No new confirmed UI/UX, WCAG 2.2, keyboard/focus, responsive, dark/light, i18n, loading/empty/error, or form-validation defect was found in this pass.

## Re-Verified Deferred Item

### DES-C6-D1 — Smart collections remain public-readable but not admin-operable

Status: already tracked as `DEF-C5-20`; not a new finding.

Evidence:

- Public smart-collection route renders collections through `HomeClient`: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84-164`.
- Hardened create/update/delete server actions exist: `apps/web/src/app/actions/collections.ts:16-150`.
- Admin navigation still has no Collections entry: `apps/web/src/components/admin-nav.tsx:15-25`.
- Product docs explicitly say no admin UI invokes the actions and rows are authored by direct DB insert: `CLAUDE.md:162`.

Why it matters:

This is a real IA/product gap if smart collections are meant to be admin-operable. An admin can view a public `/c/[slug]` feature only after out-of-band DB authoring; there is no discoverable create/edit/delete or predicate-preview workflow.

Concrete fix:

Either keep smart collections internal in all user-facing docs, or ship an admin Collections section with list/create/edit/delete, localized validation, safe predicate builder, preview count, visibility toggle, and destructive-delete confirmation.

Severity/confidence: Medium product/UX issue, High confidence.

## Risks Requiring Manual Validation

### DES-C6-M1 — Data-backed browser flows could not be fully exercised locally

Evidence:

- Runtime logs showed repeated `ECONNREFUSED 127.0.0.1:3306`.
- `/en` and unknown topic routes rendered the route error shell instead of real gallery/not-found data states.
- The review therefore could not live-exercise representative home masonry, photo viewer/lightbox, topic/share/group, map, timeline/year, or authenticated admin workflows with real data.

Concrete validation:

Run `npm run test:e2e --workspace=apps/web` or a manual browser pass against a seeded local MySQL/production-like staging dataset. Cover desktop/mobile home, topic, photo viewer, lightbox, search results, share/group routes, map, timeline/year, and authenticated admin upload/settings/db flows.

Severity/confidence: Medium validation risk, High confidence.

### DES-C6-M2 — Core Web Vitals/perceived performance still need representative measurement

Evidence:

- Source shows performance-conscious patterns for masonry sizing, image preload selection, blur placeholders, reduced motion, and SW caching, but this lane did not capture LCP/CLS/INP traces.
- The missing local DB prevented representative photo-heavy route measurement.

Concrete validation:

Capture browser performance traces or Lighthouse/Web Vitals on seeded home/topic/photo/share pages and mobile admin. Tie any regression to concrete DOM/code regions such as `home-client.tsx`, `masonry-card.tsx`, `photo-viewer.tsx`, `lightbox.tsx`, or service-worker image caching.

Severity/confidence: Medium manual-validation risk, Medium confidence.

### DES-C6-M3 — Future RTL locale remains unvalidated

Evidence:

- Root layout sets `lang` and `dir`: `apps/web/src/app/[locale]/layout.tsx:103-109`.
- Current locales are English and Korean; both are LTR. Existing parity tests cover key sets, not RTL layout behavior.

Concrete validation:

Before adding an RTL locale, run a full RTL pass over nav, search, photo viewer, lightbox, info sheet, upload/admin forms, map, and timeline. Add representative RTL visual/accessibility tests.

Severity/confidence: Low future-locale risk, Medium confidence.

## Final Sweep

Covered IA, affordances, keyboard/focus restore, WCAG 2.2 target/focus basics, responsive breakpoints, loading/empty/error states, forms, dark/light mode, English/Korean i18n, future RTL, and perceived-performance boundaries. The previous Cycle 5 search-shortcut issue is fixed in current source (`search.tsx:511-517` renders `Ctrl/⌘ K`). No new confirmed designer finding is reported beyond the already-deferred smart-collection authoring gap and the runtime validation limits above.
