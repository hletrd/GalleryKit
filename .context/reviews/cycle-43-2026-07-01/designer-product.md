# Cycle 43 Designer + Photographer-Facing Product Review

Reviewed HEAD `82a21b82` (`fix(cycle-42): 🐛 harden review-cycle guardrails`) as the UI/UX, accessibility, responsive, i18n, loading/empty/error-state, perceived-performance, and photographer-facing product-risk lane. This was review-only: no application source changes, no commit, no push, no deploy.

Baseline not re-raised: Cycle 42 scheduled UX/A11Y items (`UX-C42-01`, `A11Y-C42-02`) are fixed in current source; Cycle 42 deferred `PA-42-02` and carried deferred `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08` remain outside this lane unless new UI evidence changes severity.

## Confirmed Issues

None found.

## Likely Issues

None found.

## Risks Requiring Manual Validation

None newly identified. Populated gallery/photo/admin-dashboard browser flows could not be exercised end-to-end locally because the dev server could not connect to MySQL (`ECONNREFUSED 127.0.0.1:3306`), so live browser evidence is limited to routes/components that render without DB data plus source-level review for DB-backed populated states.

## Evidence

- Required context read: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/prompts/common_review_scope.md`, `.context/reviews/prompts/designer.md`, latest `.context/reviews/_aggregate.md`, `.context/reviews/cycle-42-2026-07-01/_aggregate.md`, `.context/reviews/cycle-42-2026-07-01/designer.md`, `.context/plans/cycle-42-2026-07-01-plan.md`, and `.context/plans/cycle-42-2026-07-01-deferred.md`.
- Current Cycle 43 peer artifacts checked: `.context/reviews/cycle-43-2026-07-01/code-reviewer-critic.md`, `.context/reviews/cycle-43-2026-07-01/debugger-tracer.md`, and `.context/reviews/cycle-43-2026-07-01/test-verifier.md`.
- Built a UI inventory of 105 relevant route/component TS/TSX files under `apps/web/src/components` and `apps/web/src/app/[locale]`, plus reviewed messages, e2e/test inventory, and focused source surfaces.
- Source reviewed with line-grounded checks across public gallery routes/components, photo viewer/lightbox/color audit, search, navigation, map/privacy/shared routes, upload and admin management surfaces, settings/backfill, analytics, login, tokens, categories, tags, dialogs, form validation, loading/empty/error shells, and i18n-driven copy.
- Rechecked Cycle 42 UX fixes in current source:
  - Shared-group selected-photo back affordance now links to ``localizePath(locale, `/g/${key}`)`` with `backToSharedPhotos`: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:150-153`.
  - Shared viewer photo navigation remains scoped to the share URL through `syncPhotoQueryBasePath`: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:159-174` and `apps/web/src/components/photo-viewer.tsx:214-219`, `apps/web/src/components/photo-viewer.tsx:324-327`.
  - Hidden lightbox color pip now follows `interactive` for pointer events, click handling, focusability, and `aria-hidden`: `apps/web/src/components/lightbox.tsx:661-672` and `apps/web/src/components/lightbox-color-pip.tsx:161-170`.
- Browser/runtime checks:
  - `http://127.0.0.1:3000` was not GalleryKit in this environment; it redirected to `/auth/device-login`.
  - Started GalleryKit locally at `http://localhost:3001`; Next became ready, but DB-backed routes logged MySQL `ECONNREFUSED`.
  - `http://localhost:3001/en/admin` rendered the login page; Playwright mobile snapshot found username/password inputs, password-toggle, and submit controls at 44 px height with no page errors.
  - `http://localhost:3001/en/privacy` rendered nav/content/footer; Playwright mobile snapshot found nav/footer controls meeting 44 px touch targets and no page errors.
  - Search dialog on `http://localhost:3001/en/privacy` opened with focus on the combobox, body scroll locked, outside siblings set `inert`/`aria-hidden`, and dialog focusables at 44 px minimum height; no console or page errors were emitted.
  - `http://localhost:3001/en` could not be product-reviewed in browser because DB-backed server components errored and the page remained on the loading/error boundary in local dev.
- Focused regression slice passed: `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/privacy-page-landmark.test.ts src/__tests__/lightbox-controls-contract.test.ts` reported 5 files passed, 42 tests passed.

Not run: full build or Playwright e2e. This lane did not modify app source.
