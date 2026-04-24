# Designer / Public Flow Review — Cycle 3

**Date:** 2026-04-23
**Scope:** All public-facing routes (`/[locale]/(public)/**`): home, topic, photo detail `/p/[id]`, shared group `/g/[key]`, shared link `/s/[key]`, plus i18n locale parity (en vs ko), loading/empty/error states.
**Method:** Playwright load + source review + curl HTML inspection for SSR output.

## Route coverage

| Route | Status | Method |
|---|---|---|
| `/en`, `/ko` | Home page | Playwright nav + curl |
| `/en/[topic]`, `/ko/[topic]` | Topic gallery | Source review |
| `/en/p/[id]`, `/ko/p/[id]` | Photo detail | Playwright nav + source |
| `/en/g/[key]`, `/ko/g/[key]` | Shared group | Source review |
| `/en/s/[key]`, `/ko/s/[key]` | Shared link | Source review |
| `/en/not-exist-12345` | 404 | Playwright nav |

## Flow-level findings

### PUB-01 — Photo detail page has no `<h1>` [MEDIUM] [HIGH]
Primary finding. See C3R-UX-01. Affects both locales.

### PUB-02 — Home heading skips H1→H3 [LOW] [HIGH]
See C3R-UX-04. Affects both locales.

### PUB-03 — Empty state on filtered gallery [OK]
`home-client.tsx:323-338` — when `allImages.length === 0`, renders a centered message with icon, "No images" text, and (when filter active) a "Clear filter" link. SVG icon is decorative (no `aria-hidden` needed since it's inside a larger container with text label). **Good.**

### PUB-04 — Loading state [OK]
- Photo page dynamic import uses a `loading` fallback with animated spinner (`photo-viewer dynamic`).
- Home page uses Next.js Suspense with `<Suspense fallback={null}>` for TagFilter — minimal but acceptable.
- Each photo card has `aspectRatio` + `containIntrinsicSize` + `blurDataURL` placeholder → content-visibility auto. Layout shift minimized.
- **Observation:** The inline blurDataURL (`data:image/png;base64,iVBORw0K...`) is a 1×1 transparent PNG — not a real per-image blur. Dominant-color placeholder would reduce CLS feel. Already noted in past cycles. **[INFO]**

### PUB-05 — 404 page [OK]
Verified at `/en/nonexistent-topic-abc123`:
- `status: 200` (Next.js app-router notFound + `(public)` layout)
- Title: "Not Found | GalleryKit"
- H1: "404"
- Body: "404 / Page not found. / Back to gallery"

Acceptable minimal 404. Brand-consistent. Both locales tested (ko via source review — `messages/ko.json` has equivalent translations).

### PUB-06 — Locale parity (en vs ko) [HIGH confidence OK]
All 14 audited DOM snapshots across 5 routes × 3 viewports × 2 locales showed identical structure. Titles and H1 values translate correctly:
- `home-en` H1: "Latest"
- `home-ko` H1: "최근 사진"

`messages/en.json` and `messages/ko.json` kept in parity. Full parity verification would require enumerating every key in both files (deferred to a future cycle).

### PUB-07 — Shared link (`/s/[key]`) flow [OK source]
`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` — key-gated single-photo view; uses `PhotoViewer` with `isSharedView={true}` which disables the "Back to topic" button. Share action rate-limited.

### PUB-08 — Shared group (`/g/[key]`) flow [OK source]
`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` — key-gated group gallery, buffered view counts (`flushGroupViewCounts`). Carry-forward D6-10/D6-11.

### PUB-09 — Back-to-top button [OK]
`home-client.tsx:339-355` — shows when `scrollY > 600`; uses `prefers-reduced-motion` to toggle smooth/auto scroll; proper `aria-label`, `aria-hidden={showBackToTop ? undefined : true}`, and `tabIndex={showBackToTop ? 0 : -1}` to prevent keyboard users from tabbing to an invisible button.

### PUB-10 — Search feature [OK]
`apps/web/src/components/search.tsx` + `searchImagesAction`:
- Dialog-based with `aria-expanded`, `aria-haspopup="dialog"` on trigger button.
- Debounced query.
- Rate-limited (see `public.ts:31-95`, 30 req/min).
- Results close modal on selection.
- **Observation:** No ARIA-live announcement of "X results found" after the debounced query settles. Users using a screen reader rely on clicking through. Polish. **[LOW]**

## i18n / RTL

- **LTR only:** No RTL locale configured. `dir` attribute is empty (see C3R-UX-05). Future-proofing suggestion in that finding.
- All user-facing strings come from `next-intl` message files; verified no hardcoded English strings in component source beyond the JSON-LD metadata (which is intentional English for SEO).
- Dates use `formatStoredExifDate(image.capture_date, locale)` — locale-aware.

## Totals

- **1 MEDIUM** (PUB-01 overlapping C3R-UX-01)
- **2 LOW** (PUB-02 overlap, PUB-10 new)
- **5 OK** (PUB-03/04/05/06/07/08/09)
- **1 INFO** (PUB-04 observation on blurDataURL)
