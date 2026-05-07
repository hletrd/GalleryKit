# Designer — Cycle 14 (current run)

**Reviewer:** designer (UI/UX, WCAG 2.2 accessibility, responsive, perceived performance)
**Scope:** All client components — masonry grid, photo viewer, lightbox, info bottom sheet, tag filter, nav, admin dashboard.

## Methodology

This is a Next.js web app, so designer review applies. Static review of the components, message catalogs (`en.json`, `ko.json`), and the previously-captured screenshot evidence in `.context/`. Re-confirmed:
- Heading hierarchy (H1 → H2 → H3) on the photo page (cycle 3 fix C3R-RPL-01).
- `dir="ltr"` on `<html>` (C3R-RPL-05).
- Locale switch button has accessible name (C3R-RPL-02).
- Tag-filter pills meet WCAG 2.5.8 AA touch target (C3R-RPL-03).
- Bidi character defenses in CSV export (C7R-RPL-11 / C8R-RPL-01).
- Reduced-motion respected in `<motion.div>` transitions in `photo-viewer.tsx` via `useReducedMotion`.
- `suppressHydrationWarning` only used on date/time strings where the server-side and client-side locale formatting may differ.

## Findings

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| (none new) | UI/UX surface is unchanged since cycle 13 (only doc commits). All previously-fixed accessibility findings remain in effect. | — | — | — |

### Re-evaluation of historical UX-leaning findings

- **CRI-14-05 (`getImageByShareKey` missing `blur_data_url`).** Verified — `/s/[key]` share view skips the blur placeholder shown by `/p/[id]` and `/g/[key]`. LOW UX inconsistency. DEFER (C14-DEFER-10).

### Re-checks

- **Photo viewer `aria-live` for image position.** `apps/web/src/components/photo-viewer.tsx:361` — `role="status" aria-live="polite"` announces "current / total" when navigating.
- **Loading / empty / error states.** Home page shows `t('home.noImages')` when no images; admin shows skeleton states; toast errors via Sonner.
- **i18n parity.** Both `en.json` and `ko.json` include the same keys.
- **Dark mode.** Tailwind `dark:` variants present on info card, badges, photo viewer chrome.

## Verdict

No new UI/UX findings. Convergence holds.
