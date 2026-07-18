# Cycle 7 Test Engineer Review

Date: 2026-07-18 KST
Review HEAD: `ec7fc46f`

## Inventory

I inventoried all 370 maintained Vitest files and 14 Playwright files, mapped
them to public/admin routes and core libraries, reviewed the configured gate
scripts, and inspected the Cycle 6 responsive test additions plus their
source boundary. I then performed live 320 px and 2,560 px counterexample
checks.

## Finding

### TEST-01 — Responsive masonry geometry coverage tests the estimator only where viewport and container nearly coincide

- Severity / confidence / status: **Medium / High / Confirmed coverage gap**
- Regions: `apps/web/e2e/responsive-masonry.spec.ts:11-49`;
  `apps/web/src/__tests__/responsive-masonry.test.ts:9-53`;
  `apps/web/src/components/home-client.tsx:22-79,231-249`
- Problem: the focused E2E proves intrinsic geometry only at 1,536 px and
  allows ±15%. The unit suite covers the effective column helper but exposes
  no pure card-width estimator boundary. Nothing covers 320 px padding and
  quantization together or a viewport above the container's 1,536 px cap.
- Concrete failure: production at 320 px reports 224 px intrinsic versus 192
  px rendered for 3:2 cards (16.7% high). At 2,560 px, two 744x496 cards
  report 843 px intrinsic height (70% high); all current focused tests pass.
- Fix: extract the container-width/column/gap arithmetic into a client-safe
  helper with invalid-input and quantization cases, and add a 320 px seeded
  browser tests at 320 and 2,560 px comparing the real card box and computed
  intrinsic height. Retain the 1,536 px sparse case because it protects a
  different item-count invariant.

## Coverage sweep

The suite otherwise has explicit coverage for action origin/mutation barrier,
admin API auth, public route rate limiting, privacy projections, migrations,
uploads/restores/deletes, PWA contracts, touch targets, focus rings, i18n
parity, nav/search/lightbox browser flows, and the recently changed responsive
source/scheduling behavior. No other new missing test was both concrete and
unrepresented by the carry-forward register.
