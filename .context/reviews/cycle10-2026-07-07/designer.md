# Cycle 10 Designer Review - 2026-07-07

## Scope

UI/UX/accessibility review for the Next.js web UI in `/Users/hletrd/flash-shared/gallery`. I did not edit source. I used source inspection, existing tests, and live browser automation against `https://gallery.atik.kr`.

## File Inventory First

- Project guidance: `AGENTS.md`, `CLAUDE.md`.
- Public routes: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`, `p/[id]/page.tsx`, `map/page.tsx`, shared routes `g/[key]` and `s/[key]`, privacy/about pages.
- Admin routes/forms: `apps/web/src/app/[locale]/admin/page.tsx`, `login-form.tsx`, protected dashboard/settings/analytics/tags/categories/tokens/users/db/password pages.
- Core UI components: `nav-client.tsx`, `search.tsx`, `home-client.tsx`, `masonry-card.tsx`, `photo-viewer.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `photo-navigation.tsx`, `image-zoom.tsx`, `tag-filter.tsx`, `load-more.tsx`, `footer.tsx`, `map/*`, `ui/*`.
- Styling/i18n/theme: `apps/web/src/app/[locale]/globals.css`, `components/theme-provider.tsx`, `lib/theme.ts`, `lib/locale-path.ts`, `messages/en.json`, `messages/ko.json`.
- Relevant tests reviewed/run: `touch-target-audit.test.ts`, `i18n-key-parity.test.ts`, `focus-visible-links-scan.test.ts`, `password-form-a11y.test.ts`, plus e2e coverage inventory under `apps/web/e2e/`.

## Findings

### DSGN10-MED-01 - Timeline and year archive photo links have repeated accessible names

- Severity: Medium
- Confidence: High
- Exact region:
  - `apps/web/src/app/[locale]/(public)/timeline/page.tsx:227-252`
  - `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:190-212`
- WCAG 2.2: 2.4.4 Link Purpose, 2.4.6 Headings and Labels, 4.1.2 Name/Role/Value
- Evidence:
  - Browser automation on `https://gallery.atik.kr/en/timeline` found 445 visible photo links. Duplicate accessible names included:
    - `View photo: #Color in Music Festival #JIHOON` repeated 51 times.
    - `View photo: #Color in Music Festival #SHINYU` repeated 71 times.
    - `View photo: #Color in Music Festival #JIHOON #SHINYU` repeated 24 times.
  - Browser automation on `https://gallery.atik.kr/en/year/2025` showed the same duplicate counts.
  - Source builds `displayTitle` from tags/title and passes it directly to `aria-label={tAria('viewPhoto', { title: displayTitle })}` on both archive routes.
  - The home masonry surface has already solved this by adding `#${image.id}` into `accessibleTitle` in `apps/web/src/components/masonry-card.tsx:47-64`; the archive routes use duplicate standalone markup instead of that component.
- Failure scenario:
  - A keyboard or screen-reader user opens Timeline or Year in Review and tabs through a concert set where many photos share the same event/person tags. The user hears the same link label dozens of times and cannot choose, return to, or describe a specific image without opening each repeated link.
- Concrete fix:
  - Reuse `MasonryCard` for timeline/year archive cards, or mirror its accessible-name construction by appending a stable differentiator such as `#${photo.id}` or a localized "photo {id}" suffix to the `aria-label`.
  - Prefer extracting a shared helper, for example `getPhotoCardAccessibleTitle(photo, fallback)`, so home/topic/timeline/year/shared grids cannot drift again.
  - Add a source or DOM test that asserts timeline/year photo link names include a unique ID when titles/tags collide.

## No-Finding Areas With Evidence

- IA and affordances: public home, topic nav, tag filters, timeline/year scrubber, photo viewer, search, footer, and admin login have clear labels and visible primary actions. Admin protected IA was source-reviewed only because credentials were not available.
- Focus/keyboard: skip link targets `main#main-content`; public nav controls, search dialog, lightbox, photo viewer shortcuts, and admin login validation expose focusable controls and focus restoration patterns. Live tab order on `/en` at 390 and 1440 px started with skip link, home, nav controls, filters, then photo cards.
- WCAG touch target/accessibility gates: targeted Vitest run passed `touch-target-audit`, `focus-visible-links-scan`, `password-form-a11y`, and `i18n-key-parity`.
- ARIA: search uses dialog + combobox/listbox, live status messages, IME guards, modal tree isolation, and focus trap. Login errors set `aria-invalid` and `aria-describedby` after validation.
- Responsive breakpoints: live checks at 390x844, 768x1024, and 1440x1000 found no horizontal overflow on home/photo/search/login/Korean home.
- Loading/empty/error states: reviewed `LoadMore`, search no-results/error/rate-limit states, `PhotoViewerLoading`, `OptimisticImage`, route errors, admin login validation, and map no-photo/list fallbacks. Search no-results and login validation were verified live.
- Contrast/dark-light mode: token comments and existing tests cover known contrast risks; live screenshots in light and dark mode did not show obvious failures in primary public surfaces. The automated contrast probe produced false positives on photo-overlay text because it cannot model gradient-over-image backgrounds, so I did not count those as findings.
- i18n/RTL: live `/en` and `/ko` set `lang` correctly and `dir="ltr"`; source uses `getLocaleDirection(locale)` for future RTL locales. Key parity test passed.
- Perceived performance: masonry uses responsive eager/lazy priority, content visibility, intrinsic reservation, blur placeholders, and load-more live status. Live full-page screenshots show below-fold placeholders where lazy loading is expected; first viewport content appears promptly.

## Browser Evidence

- Live routes inspected: `/en`, `/ko`, `/en/admin`, `/en/p/348`, `/en/timeline`, `/en/year/2025`, `/en/map`.
- Interactions exercised: nav tab order, search open/close/no-results, admin login empty-submit validation, theme cycling to dark, photo viewer, lightbox open/close.
- Screenshots captured under `/tmp`: `gallery-cycle10-mobile-home.png`, `gallery-cycle10-mobile-search-click.png`, `gallery-cycle10-mobile-admin-validation.png`, `gallery-cycle10-desktop-photo.png`, `gallery-cycle10-desktop-lightbox.png`, `gallery-cycle10-mobile-theme.png`, timeline/year/map screenshots.
- Console noise: Google Analytics collection failed in headless browser due external request/CSP/environment behavior; no app runtime exceptions were observed.

## Verification

Command run:

```sh
npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/password-form-a11y.test.ts
```

Result: 4 test files passed, 34 tests passed.

## Final Missed-Issues Sweep

After the main pass I specifically checked for drift between home card markup and archive card markup. That sweep found DSGN10-MED-01. I also checked map/list routes for the same duplicate-photo-link issue; `/en/map` did not expose visible `/p/` links in the tested live data, so the confirmed defect is limited to timeline/year archive card markup.
