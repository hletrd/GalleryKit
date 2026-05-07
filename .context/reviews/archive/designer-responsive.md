# Designer / Responsive Audit — Cycle 3

**Date:** 2026-04-23
**Viewports tested:** 375×812 (mobile portrait), 768×1024 (tablet), 1280×800 (desktop), 1920×1080 (large — via CSS review only). Orientation-aware rules (`@media (orientation: landscape)`) also reviewed.
**Method:** Playwright viewport emulation, live CSS inspection, source review of all Tailwind breakpoint usage.

## Responsive Architecture Overview

Tailwind breakpoints in use (standard shadcn config):
- `sm:` ≥640px
- `md:` ≥768px
- `lg:` ≥1024px
- `xl:` ≥1280px
- `2xl:` ≥1536px

Key layout patterns:
- **Masonry grid:** `columns-1 sm:columns-2 md:columns-3 xl:columns-4` (`home-client.tsx:209`) — JS-backed column count (`useColumnCount`) also updates image `srcSet` sizing.
- **Navigation:** Desktop shows all utility buttons inline; mobile hides utilities behind a chevron toggle (`isExpanded` state in `nav-client.tsx:33`).
- **Photo viewer:** Info sidebar is `hidden lg:block` (lg ≥ 1024px) — mobile uses a bottom-sheet modal instead.
- **Admin nav:** `flex-nowrap overflow-x-auto scrollbar-hide` (`admin-nav.tsx:27`) — horizontal scroll on mobile.

## Findings

### RESP-01 — Admin mobile nav lacks scroll affordance / chevron [LOW] (carry-forward from D1-03/D2-01)
Already deferred in `plan/cycle2-rpl-deferred.md` (D2-01). Pre-existing decision; re-confirmed still applicable. No new action this cycle.

### RESP-02 — Tag-filter pills 22px tall at 375px (WCAG 2.5.8 AA) [LOW]
See C3R-UX-03 / A11Y-03. 22px < 24px minimum on pointer targets. Applies across all mobile viewports.

### RESP-03 — Orientation-aware landscape layout verified [OK]
`globals.css:113-135` adjusts `.photo-viewer-image`, `.photo-viewer-toolbar`, `.photo-viewer-container`, and `.masonry-grid` for `orientation: landscape and max-width: 767px`. Source review confirms the rule set is reasonable: sticky toolbar, 2-column masonry, 100vh image cap. No findings.

### RESP-04 — Nav expansion on tablet/desktop automatic collapse [OK]
`nav-client.tsx:36-43` — `matchMedia('(min-width: 768px)')` listener auto-collapses the mobile expand state when the viewport crosses into desktop. Good behavior; prevents stale expand state after rotation.

### RESP-05 — Photo viewer info transfer between sidebar ↔ bottom-sheet [OK]
`photo-viewer.tsx:151-171` — crossing viewport at 1024px transfers info panel state: open bottom-sheet → pinned sidebar, pinned sidebar → closed (users re-open via button). This is well-engineered; no findings.

### RESP-06 — Touch-target audit at 375px (mobile primary) [INFO]
Targets below 24×24 on mobile:

| Element | Size (px) | WCAG | Notes |
|---|---|---|---|
| `A` Skip-to-content (unfocused) | 1×1 | N/A | Intentional via `sr-only` — reveals to 141×40 on focus. |
| `BUTTON` "All" tag | 33×22 | FAIL 2.5.8 | See A11Y-03. |
| `BUTTON` "e2e(2)" tag | 58×22 | FAIL 2.5.8 | See A11Y-03. |
| `BUTTON` "landscape(1)" tag | 94×22 | FAIL 2.5.8 | See A11Y-03. |
| `BUTTON` "portrait(1)" tag | 78×22 | FAIL 2.5.8 | See A11Y-03. |
| `A` "GitHub" footer link | 69×20 | FAIL 2.5.8 | Icon+text anchor; icon h-4 (16px) + text 14px line-height. |
| `A` "Admin" footer link | 36×16 | FAIL 2.5.8 | Footer corner. |

**Note:** WCAG 2.5.8 has multiple exceptions — **inline** exception (text link within running text), **user-agent** exception (native UI), **essential** exception (e.g. precise drawing). The footer GitHub/Admin and the tag pills are **not** inline in running text; they are standalone interactive affordances. The WCAG 2.5.8 note allows the spacing exception: if there is 24×24 CSS pixels of unobstructed space around the target, the rule is met. Let me verify:

- Tag filter pills have `gap-2` (8px gap between pills) + full-row positioning → effective 30+ px clear space below (down to image grid). **May qualify for spacing exception.** Still recommend increasing to `min-h-[24px]` for defense-in-depth.
- Footer GitHub/Admin links: `gap-4` (16px) between them, nothing below (page bottom). Links are in `<p>` adjacent to other links — could argue inline exception. The 16×16 Admin link is small enough that mistouch is a real concern on small phones.

### RESP-07 — `overflow-hidden` on collapsed nav clips focus ring [LOW] [MEDIUM confidence]
`nav-client.tsx:69`: when not expanded, nav root has `h-16 overflow-hidden`. If a user Tabs into one of the topic links that is scrolled off-canvas (due to `overflow-x-auto scrollbar-hide`), the focus ring may be clipped at the edges.

**Mitigation:** the nav uses `mask-gradient-right` (`globals.css:74-77`) for fade-out — so there's partial visual cue. But the focus ring still needs to remain visible for keyboard-only users. Consider removing `overflow-hidden` or using `overflow-clip` only on y-axis with `overflow-x-auto scrollbar-hide` remaining for x.

Worth verifying in a real a11y sweep (currently only text-extractable evidence suggests a risk, not a confirmed bug — marking LOW confidence).

## Breakpoint Summary

| Breakpoint | Tested viewport | Masonry cols | Nav mode | Photo sidebar | Notes |
|---|---|---|---|---|---|
| < 640px (sm) | 375×812 | 1 | Collapsed + hamburger | Bottom sheet | RESP-02, RESP-06 |
| 640-767px (md) | n/a via playwright; verified source | 2 | Collapsed + hamburger | Bottom sheet | |
| 768-1023px (lg) | 768×1024 | 3 | Inline (no hamburger) | Bottom sheet | |
| 1024-1279px (xl) | n/a | 3 | Inline | Sidebar available (lg:) | |
| ≥ 1280px | 1280×800 | 4 | Inline | Sidebar available | |
| ≥ 1920px | source-only (CSS verified) | 4 (no further expansion) | Inline | Sidebar | Could add `2xl:columns-5` if large-display usage warrants. |

## Totals

- **0 CRITICAL/HIGH**
- **0 MEDIUM**
- **2 LOW** (RESP-02 overlapping A11Y-03, RESP-07 new)
- **5 INFO/OK** (RESP-01 carry-forward, RESP-03/04/05 healthy, RESP-06 categorization)
