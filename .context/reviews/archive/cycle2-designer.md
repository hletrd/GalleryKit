# Cycle 2 — Designer (UI/UX) Findings

**Date**: 2026-05-05
**Scope**: UI/UX review — accessibility, responsive design, loading states, form validation, i18n
**Method**: Code review of component files (no live server — sub-agent browser not available)

---

## Files Examined

- `src/components/home-client.tsx` — Masonry grid, back-to-top, load-more
- `src/components/photo-viewer.tsx` — Photo viewer, lightbox, EXIF display
- `src/components/search.tsx` — Search overlay, keyboard navigation
- `src/components/info-bottom-sheet.tsx` — Mobile info sheet
- `src/components/load-more.tsx` — Pagination load-more
- `src/components/nav.tsx` / `nav-client.tsx` — Navigation
- `src/components/footer.tsx` — Footer

---

## Findings

**0 new UI/UX findings.**

### Accessibility
- `sr-only` H2 heading in home-client bridges heading-level gap (WCAG 1.3.1 / 2.4.6).
- Photo viewer aria-labels include reaction count when present.
- Alt text derived from tags/title via `getConcisePhotoAltText`.
- Search overlay uses `FocusTrap` for focus management.
- Back-to-top button has `aria-label`, `aria-hidden`, `tabIndex` management.
- Touch-target audit passes (44px minimum enforced in test suite).

### Responsive Design
- `useColumnCount` mirrors Tailwind breakpoints (`columns-1 sm:columns-2 md:columns-3 xl:columns-4 2xl:columns-5`).
- Above-fold priority loading (`loading="eager"`, `fetchPriority="high"`) correctly capped at `columnCount`.
- Mobile/desktop info display adapts (mobile top overlay, desktop bottom hover overlay).

### Loading/Empty/Error States
- Empty state in home-client shows SVG + message + clear filter link.
- Search shows loading spinner (`Loader2`), error states (`rateLimited`, `maintenance`, `error`, `invalid`).
- Photo viewer handles checkout status toast (success/cancel).

### Keyboard Navigation
- Search supports Cmd/Ctrl+K shortcut.
- Search results navigable with arrow keys (activeIndex management).
- Escape closes search overlay.

### i18n
- All user-facing strings use `t()` from `useTranslation` or `getTranslations`.
- Locale-aware routing via `localizePath`.

**Conclusion**: No UI/UX issues found in this cycle.
