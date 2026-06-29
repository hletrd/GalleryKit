# Designer Review - Review-Plan-Fix Cycle 3

Role: designer. Scope: information architecture, affordances, keyboard/focus, WCAG 2.2, contrast, responsive breakpoints, loading/empty/error states, validation UX, dark/light mode, i18n/RTL, and perceived performance. No application code was edited.

## Inventory Coverage

Read `AGENTS.md` and `CLAUDE.md` first, then inventoried the current UI surface under `apps/web/src/app/[locale]`, `apps/web/src/components`, `apps/web/src/i18n`, and `apps/web/messages`. I also read current `.context` review and plan history, including cycle-2 UI findings and run-9/cycle-3 UI plans, to avoid stale claims.

Browser automation evidence:
- Started `npm run dev --workspace=apps/web -- --hostname 127.0.0.1 --port 3013`.
- Inspected `/en/admin`, `/ko/admin`, `/en`, `/ko`, `/en/timeline`, `/ko/timeline`, `/en/map`, `/ko/map`, `/en/year/2024`, and `/ko/year/2024` with Playwright.
- `/en/admin` and `/ko/admin` rendered login forms with one `main`, localized h1s, labelled username/password fields, 44 px password-toggle and submit controls, and task-specific titles (`Admin | GalleryKit`, `관리 | GalleryKit`).
- DB-backed public pages rendered localized error boundaries because local MySQL was unavailable (`ECONNREFUSED 127.0.0.1:3306`), but metadata/title and error-shell evidence was still observable.

## Findings

### DES-C3-01 - Timeline, map, and year pages double-append the site name in document titles

Severity: Medium
Confidence: High

Evidence:
- Browser title checks returned `Timeline | GalleryKit | GalleryKit`, `타임라인 | GalleryKit | GalleryKit`, `Map | GalleryKit | GalleryKit`, `지도 | GalleryKit | GalleryKit`, `2024 in Review | GalleryKit | GalleryKit`, and `2024년 돌아보기 | GalleryKit | GalleryKit`.
- `apps/web/src/app/[locale]/layout.tsx:24-27` sets `title.template` to `%s | ${seo.title}`.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:30-32` returns `title: ${t('title')} | ${seo.title}`.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:18-20` returns `title: ${t('title')} | ${seo.title}`.
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:37-44` builds `title = ${yearInReview} | ${seo.title}` and returns it as page metadata.
- The home page already documents and fixes this class with `title: { absolute: title }` in `apps/web/src/app/[locale]/(public)/page.tsx:38-49`.

Failure scenario: browser tabs, history entries, and screen-reader title announcements stutter the brand name on archive/map pages. This weakens page identity in exactly the information-architecture routes people use to scan time/place context.

Concrete fix: remove the baked-in `| ${seo.title}` from the metadata `title` on timeline/map/year and let the layout template append it, or use `{ absolute }` consistently when a page intentionally owns the full title. Keep OpenGraph/Twitter titles explicit because Next does not apply the document title template to those fields.

### DES-C3-02 - The four-state theme button exposes only a generic accessible name

Severity: Low
Confidence: High

Evidence:
- `apps/web/src/components/nav-client.tsx:155-160` cycles `system -> light -> dark -> oled -> system` via `nextTheme(...)`, but the accessible name is always `aria-label={t('aria.toggleTheme')}`.
- `apps/web/src/lib/theme.ts:39-45` confirms the button is a four-state cycle, not a binary toggle.
- `apps/web/messages/en.json:610` and `apps/web/messages/ko.json:610` translate only `Toggle theme` / `테마 전환`.
- Existing e2e checks query the same static accessible name in `apps/web/e2e/nav-visual-check.spec.ts:74` and `apps/web/e2e/test-fixes.spec.ts:24-40`.

Failure scenario: keyboard or screen-reader users can activate the theme control but cannot tell whether the current state is System, Light, Dark, or OLED, nor what the next press will do. The visual icon changes, but that state is not conveyed through the accessibility tree; the `title` attribute is not a reliable substitute when `aria-label` supplies the accessible name.

Concrete fix: localize a stateful label such as `Theme: {current}. Switch to {next}` and compute it from `theme ?? 'system'` plus `nextTheme(...)`, or replace the cycle button with a small menu/segmented control whose options expose selected state. Add an e2e/source assertion that the theme button name changes after activation.

### DES-C3-03 - The map route has no loading fallback for its client-only map chunk

Severity: Low
Confidence: High

Evidence:
- `apps/web/src/components/map/map-loader.tsx:8-10` uses `dynamic(..., { ssr: false })` with no `loading` component.
- `apps/web/src/components/map/map-client.tsx:108-112` renders the eventual map as a 70vh region.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:51-64` has an empty state for zero markers, but no reserved/status state while the Leaflet client chunk is loading.

Failure scenario: on a slow phone or cold route transition, the map page can show the heading followed by a blank area until Leaflet hydrates. Sighted users get no progress affordance, and assistive technology gets no `status` announcement that the map is loading.

Concrete fix: add a `loading` fallback to `MapLoader` with the same 70vh dimensions, a subdued skeleton/placeholder, and `role="status"` using the localized loading string. This preserves layout stability and makes the client-only chunk delay perceivable.

## Non-Findings Rechecked

- Cycle-2 admin metadata is fixed: admin routes now call `adminRouteMetadata(...)`, and browser checks confirmed `/en/admin` title `Admin | GalleryKit`.
- Cycle-2 timeline/year photo-card accessible names are fixed: both routes now use localized `common.photo` / `common.untitled` fallbacks and `aria.viewPhoto`.
- Login validation controls have visible labels, required attributes, a localized show/hide password toggle, and alert feedback on server errors.
- Touch target conventions remain broadly enforced through `ui/button.tsx`, `ui/switch.tsx`, nav controls, upload controls, timeline/year links, and the documented audit.

## Missed-Issues Sweep

Final sweep covered public/admin metadata, localized fallback strings, focus-visible conventions, role/aria wiring, search dialog behavior, color/HDR audit surfaces, upload/login validation states, map loading/empty states, dark/light/OLED controls, and prior review findings. No additional designer-level blockers were found. Residual risk is loaded gallery/photo/admin-dashboard visual detail that requires a working local DB session; this pass could validate the localized error shell and admin login live, but not real photo grids or authenticated admin screens.
