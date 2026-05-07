# Perf Reviewer — Cycle 2 review-plan-fix loop (2026-04-25)

## Lens

Verify perf-related plan-301 fixes (especially `useColumnCount` 2xl mirror and the React/SSR cost of the cycle-1 commits) and look for any new perf regressions.

## Findings

### P2L-INFO-01 — `useColumnCount` correctly mirrors the masonry breakpoints

- **File:** `apps/web/src/components/home-client.tsx:28-35`
- **Severity / Confidence:** INFO / High
- **Status:** Plan-301-B implemented correctly. Thresholds `<640 → 1`, `<768 → 2`, `<1280 → 3`, `<1536 → 4`, `≥1536 → 5` mirror the Tailwind classes `columns-1 sm:columns-2 md:columns-3 xl:columns-4 2xl:columns-5`. The 5th above-the-fold card now gets `loading="eager"` + `fetchPriority="high"` on widescreen.
- **Action:** None — keeping for record. Note: `xl` Tailwind breakpoint is 1280px, `2xl` is 1536px; the JS mirror uses those exact pixel values.

### P2L-LOW-01 — Bundle/SSR work doubled by manual humanization in chip render paths

- **Files:**
  - `apps/web/src/components/photo-viewer.tsx:393-397`
  - `apps/web/src/components/info-bottom-sheet.tsx:241-245`
- **Severity / Confidence:** LOW / Low (perf impact)
- **Why:** Same finding as CR2L-LOW-02 / A2L-LOW-02 from the perf lens — though impact is negligible (one regex per tag chip), the missing call to `humanizeTagLabel` means the photo viewer renders an inconsistent label compared to the gallery card. Once we wrap `humanizeTagLabel(tag.name)` inside the chip, the cost is one `String.prototype.replace` per tag — basically free.
- **Action:** Already covered by CR2L-LOW-02 fix. No standalone perf plan.

### P2L-LOW-02 — `localizeUrl(seo.url, 'en', '/')` resolved twice in root layout vs helper

- **File:** `apps/web/src/app/[locale]/layout.tsx:30-32`
- **Severity / Confidence:** LOW / Low
- **Why:** Currently builds two URLs (`localizeUrl(seo.url, 'en', '/')` and `localizeUrl(seo.url, 'ko', '/')`) plus a string for `x-default`. Switching to `buildHreflangAlternates` adds a third URL build (the `x-default` route now resolves through `localizeUrl` too). One additional `new URL(...)` allocation per request — negligible. Cited only because the helper is the architecturally correct replacement.

## Performance gate evidence

- vitest: 60 files / 402 tests passed
- e2e: 20 passed / 1 skipped (37.5s)
- build: routes compiled cleanly

No regressions detected; plan-301 perf intent is correctly delivered.
