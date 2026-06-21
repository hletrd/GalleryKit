# GalleryKit Designer A11y Review — Run 9 Cycle 5

**Reviewer:** Designer agent (oh-my-claudecode:designer)
**Date:** 2026-06-21
**HEAD:** e34c04cf (as dispatched)
**Scope:** Full frontend sweep — `apps/web/src/components/` + `app/[locale]/(public)/` + `app/[locale]/admin/`
**Bar:** WCAG 2.1 Level A/AA. DEFECT = firm, fixable violation. POLISH = advisory.
**Do-not-refile list:** DES-R9C3-01 (bulk-edit, FIXED), DES-R9C4-01 (similar-photos, FIXED), DES-R9C3-02 (analytics th scope, DEFERRED), DEF-C11-01 (search Input h-8, DEFERRED).

---

## Component Inventory

### Public components reviewed

| Component | File | Status |
|---|---|---|
| Nav (client) | `components/nav-client.tsx` | CLEAN |
| Footer | `components/footer.tsx` | CLEAN |
| Lightbox | `components/lightbox.tsx` | CLEAN |
| LightboxColorPip | `components/lightbox-color-pip.tsx` | CLEAN |
| PhotoViewer | `components/photo-viewer.tsx` | CLEAN |
| HomeClient (masonry) | `components/home-client.tsx` | CLEAN |
| Search | `components/search.tsx` | CLEAN (DEF-C11-01 known/deferred) |
| PhotoNavigation | `components/photo-navigation.tsx` | CLEAN |
| SimilarPhotos | `components/similar-photos.tsx` | CLEAN (DES-R9C4-01 fix confirmed) |
| TagFilter | `components/tag-filter.tsx` | CLEAN |
| LoadMore | `components/load-more.tsx` | CLEAN |
| TopicEmptyState | `components/topic-empty-state.tsx` | CLEAN |
| OnThisDayWidget | `components/on-this-day-widget.tsx` | CLEAN |
| ColorDetailsSection | `components/color-details-section.tsx` | CLEAN |
| InfoBottomSheet | `components/info-bottom-sheet.tsx` | CLEAN |
| MapClient | `components/map/map-client.tsx` | CLEAN |
| MapLoader | `components/map/map-loader.tsx` | CLEAN |

### Public page routes reviewed

| Route | File | Status |
|---|---|---|
| Home | `app/[locale]/(public)/page.tsx` | CLEAN |
| Topic | `app/[locale]/(public)/[topic]/page.tsx` | CLEAN |
| Photo viewer | `app/[locale]/(public)/p/[id]/page.tsx` | CLEAN |
| Shared group | `app/[locale]/(public)/g/[key]/page.tsx` | CLEAN |
| Shared photo | `app/[locale]/(public)/s/[key]/page.tsx` | CLEAN |
| Smart collection | `app/[locale]/(public)/c/[slug]/page.tsx` | CLEAN |
| Timeline | `app/[locale]/(public)/timeline/page.tsx` | CLEAN |
| Year in review | `app/[locale]/(public)/year/[year]/page.tsx` | CLEAN |
| Map | `app/[locale]/(public)/map/page.tsx` | CLEAN |

### Admin components reviewed

| Component | File | Status |
|---|---|---|
| Admin nav | `components/admin-nav.tsx` | CLEAN |
| Admin header | `components/admin-header.tsx` | CLEAN |
| Admin user manager | `components/admin-user-manager.tsx` | CLEAN |
| Login form | `app/[locale]/admin/login-form.tsx` | CLEAN |
| Dashboard client | `app/.../dashboard/dashboard-client.tsx` | CLEAN |
| Image manager | `components/image-manager.tsx` | CLEAN |
| Bulk-edit dialog | `components/bulk-edit-dialog.tsx` | CLEAN (DES-R9C3-01 fix confirmed) |
| Topic manager | `app/.../categories/topic-manager.tsx` | CLEAN |
| Tag manager | `app/.../tags/tag-manager.tsx` | CLEAN |
| Settings client | `app/.../settings/settings-client.tsx` | CLEAN |
| SEO client | `app/.../seo/seo-client.tsx` | CLEAN |
| Tokens client | `app/.../tokens/tokens-client.tsx` | CLEAN |
| Analytics client | `app/.../analytics/analytics-client.tsx` | CLEAN |
| Password form | `app/.../password/password-form.tsx` | CLEAN |
| DB page | `app/.../db/page.tsx` | CLEAN |

---

## Findings

### Defects (WCAG Level A/AA violations)

**NONE.** No new firm WCAG violations found.

### Previously filed — status

- **DES-R9C3-01** (bulk-edit dialog unlabelled controls) — FIXED. Confirmed at `bulk-edit-dialog.tsx:46,184,214,235,248` — all `SelectTrigger` and input elements have `aria-label`.
- **DES-R9C4-01** (similar-photos empty accessible name on `SimilarThumb`) — FIXED. Confirmed at `similar-photos.tsx` — label is `item.title ?? item.description ?? tCommon('photo')`, guaranteed non-empty; applied to `aria-label`, `title`, and `alt`.
- **DES-R9C3-02** (analytics `<th>` missing `scope`) — DEFERRED. Exit criterion (mobile-priority admin or fresh violation) not met. Not re-raised.
- **DEF-C11-01** (search `<Input>` h-8, 32 px) — DEFERRED (out-of-scope admin-primary surface). Not re-raised.

### Polish / advisory observations (non-blocking)

**POL-R9C5-01 — Decorative inline SVGs without `aria-hidden` in link text context**
- File: `app/[locale]/(public)/year/[year]/page.tsx:111`
- The back-arrow SVG (`<svg className="h-4 w-4" ...>`) has no `aria-hidden="true"`. The containing `<Link>` has adjacent visible text (`{t('backToTimeline')}`), so the link's accessible name comes from the text node and the SVG content is ignored in practice. This is not a WCAG failure (the link has a non-empty accessible name), but adding `aria-hidden="true"` to the SVG is project-consistent hygiene matching the pattern used throughout the codebase.
- Impact: cosmetic; screen readers may announce the SVG path data in some implementations. Low risk.
- Fix: `<svg ... aria-hidden="true">` — one-liner, zero risk.
- Confidence: HIGH (advisory, not a defect).
- WCAG: N/A (no failure). Advisory only.

---

## Summary

All 35 components and page routes reviewed. Zero new firm WCAG Level A/AA defects found on any public-facing or admin surface. The two previously filed DEFECTS (DES-R9C3-01, DES-R9C4-01) are confirmed fixed. One advisory polish item (POL-R9C5-01) noted but not filed as a defect — it is a cosmetic consistency item with no user impact.

**Verdict: ZERO new firm DEFECTS. Convergence on the designer/a11y angle.**
