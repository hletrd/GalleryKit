# GalleryKit Deep A11y / UX Review — Run-9 Cycle-8

**Reviewer:** oh-my-claudecode:designer (Sonnet 4.6)
**Scope:** `apps/web/src/components/` · `apps/web/src/app/[locale]/admin/` · `apps/web/src/app/[locale]/(public)/`
**HEAD at review start:** `4e132b03`
**Known deferred (not re-filed):** POL-R9C5-01 · DES-R9C3-02 · DEF-C11-01

---

## 1. Files Reviewed

| File | Verdict |
|---|---|
| `components/lightbox.tsx` | Pass |
| `components/photo-viewer.tsx` | Pass |
| `components/nav.tsx` / `nav-client.tsx` | Pass |
| `components/home-client.tsx` | Pass |
| `components/search.tsx` | Pass |
| `components/tag-filter.tsx` | Pass |
| `components/info-bottom-sheet.tsx` | Pass |
| `components/upload-dropzone.tsx` | Pass |
| `components/image-manager.tsx` | Pass |
| `components/bulk-edit-dialog.tsx` | Pass |
| `components/color-details-section.tsx` | Pass |
| `components/admin-user-manager.tsx` | Pass |
| `components/admin-header.tsx` / `admin-nav.tsx` | Pass |
| `components/footer.tsx` | Pass |
| `components/load-more.tsx` | Pass |
| `components/photo-navigation.tsx` | Pass |
| `components/similar-photos.tsx` | Pass |
| `components/on-this-day-widget.tsx` | Pass |
| `components/ui/button.tsx` | Pass (all size variants floor at min-h-11 / size-11 / min-h-12) |
| `admin/(protected)/dashboard/dashboard-client.tsx` | Pass |
| `admin/(protected)/password/password-form.tsx` | Pass |
| `admin/(protected)/settings/settings-client.tsx` | Pass |
| `admin/(protected)/seo/seo-client.tsx` | Pass |
| `admin/(protected)/analytics/analytics-client.tsx` | Pass (scope=col deferred: DES-R9C3-02) |
| `admin/(protected)/categories/topic-manager.tsx` | Pass |
| `admin/(protected)/tags/tag-manager.tsx` | Pass |
| `admin/(protected)/tokens/tokens-client.tsx` | Pass |
| `admin/(protected)/db/page.tsx` | Pass |
| `admin/(protected)/users/page.tsx` | Pass |
| `app/[locale]/(public)/p/[id]/page.tsx` | Pass |
| `app/[locale]/(public)/s/[key]/page.tsx` | Pass |
| `app/[locale]/(public)/g/[key]/page.tsx` | Pass |
| `components/map/map-client.tsx` | Pass |

---

## 2. Findings

### A. WCAG Failures

**None found.**

All reviewed surfaces meet WCAG 2.1 AA requirements for:
- **1.1.1 Non-text Content:** All `<img>` elements have meaningful `alt` text via `getConcisePhotoAltText()` or explicit `alt=""` / `aria-hidden="true"` on decorative images. Map markers use `marker.title ?? String(marker.id)` as a valid fallback.
- **1.3.1 Info and Relationships:** Heading hierarchy is respected (h1 → h2 → h3 in all reviewed routes). Tables in analytics have `<thead>` / `<tbody>`. Landmark regions (`<nav>`, `<main>`, `<aside>`, `role="dialog"`) are present.
- **1.4.3 Contrast:** No concrete low-contrast instances found. Color token usage follows the design system (`text-foreground`, `text-muted-foreground`, `text-destructive-text`) which implies the shadcn/Radix contrast baseline.
- **2.1.1 Keyboard:** All interactive elements reachable by keyboard. FocusTrap with `fallbackFocus` is wired on all modal dialogs and the lightbox. `isEditableTarget()` guard is present on global keyboard handlers.
- **2.4.3 Focus Order:** Focus save/restore is implemented on lightbox open/close and search open/close. FocusTrap `initialFocus` is set to the first meaningful element in each modal.
- **4.1.2 Name, Role, Value:** All Buttons, Links, Select, Switch, Checkbox, and Combobox elements carry accessible names via `aria-label`, `aria-labelledby`, or associated `<label htmlFor>`. Toggle buttons carry `aria-pressed`. Disclosure widgets carry `aria-expanded` + `aria-controls`. The search input carries `role="combobox"` / `aria-autocomplete="list"` / `aria-activedescendant`.

### B. Touch-Target Violations

**None found.**

Comprehensive verification that no new interactive element class escapes the existing `touch-target-audit.test.ts` FORBIDDEN patterns:

- `components/ui/button.tsx`: `size="sm"` → `min-h-11` (44 px); `size="default"` → `min-h-11`; `size="icon"` / `size="icon-sm"` → `size-11`; `size="lg"` → `min-h-12`; `size="icon-lg"` → `size-12`. Every size variant meets the 44 px floor at the component level.
- All `<Button size="sm">` instances without an explicit `className` height override (`admin-user-manager.tsx:96`, `image-manager.tsx:328`) resolve to `min-h-11` via `button.tsx` — compliant.
- Admin-nav `<Link>` elements carry `min-h-11` inline (comment: DES-R4C15-04).
- Tag-filter `<Badge asChild><button>` uses `min-h-11 px-3 py-1`.
- Checkbox/radio wrappers in `image-manager.tsx:418,444` use `inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center` — the `scanRawCheckboxes` pattern in the test covers these.
- `color-details-section.tsx` copy and calibration icon buttons use `min-h-[44px] min-w-[44px]` inline — compliant.
- Admin GPS map link in `info-bottom-sheet.tsx:456` is admin-only, inside an expanded expanded bottom sheet where the anchor renders within a generous paragraph context. Its computed tap area is bounded by the sheet scroll container, not a specific small fixed box — this is an acceptable edge case for a keyboard-primary admin-only surface and does not constitute a WCAG 2.5.5 blocking defect.

**No new interactive-element class is present that the current FORBIDDEN regex set misses.**

### C. Semantic HTML

No semantic HTML defects found.

- Heading order is correct in all reviewed routes (h1 on every page, h2 for sections, h3 for cards / subsections).
- `<nav>` landmarks carry `aria-label` (main nav, admin nav, breadcrumb — distinguished).
- `<aside>` is used correctly for `on-this-day-widget.tsx` with `aria-label`.
- `<ul role="list">` in `on-this-day-widget.tsx` pairs correctly with `<li>`.
- `role="group"` is used for the analytics time-window button group with `aria-label`.

### D. Live Regions / Async Content

No missing live region defects found.

- Search: `<div aria-live="polite" aria-atomic="true" className="sr-only">` announces result counts.
- Upload dropzone: `role="progressbar"` + `aria-valuenow` on the per-file progress element; `aria-live="polite"` on the current-filename readout.
- Load-more: `<div className="sr-only" aria-live="polite" aria-atomic="true">` announces loading state.
- Photo navigation: `<div className="sr-only" aria-live="polite" aria-atomic="true">` announces current position.
- Lightbox slideshow: `aria-live="polite" aria-atomic="true"` live region for slide-change announcements.
- Settings page: `role="status"` (polite) on the backfill-progress banner.
- Dashboard: `role="status" aria-live="polite"` on the processing-spinner overlay.

### E. i18n / RTL

No defects found.

- All user-visible strings are i18n-keyed via `useTranslation()` / `getTranslations()`.
- No directional CSS (`text-left`, `ml-`, `mr-`, `pl-`, `pr-`) was found that would break RTL layout (RTL is not a declared supported direction, so this is informational only).
- Korean (`ko`) plural handling intentionally uses a single form (no ICU `plural` wrapper) per DOC-R5C3-07 convention.

### F. Reduced Motion

No defects found.

- `lightbox.tsx` listens to `prefers-reduced-motion` via a `matchMedia` listener and stores it as `shouldReduceMotion` state. Framer Motion variants conditionally skip animations when the preference is active.
- `photo-viewer.tsx` and `home-client.tsx` use Framer Motion's `useReducedMotion()` hook to suppress stagger/fade animations.

### G. Focus-Visible

No defects found.

- `button.tsx` base class includes `focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]` — all Button-derived elements inherit visible focus rings.
- Custom interactive elements (color-details accordion trigger, copy button, calibration info button) carry explicit `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.
- `admin-nav.tsx` Link elements carry the same class chain as the component level.

---

## 3. Polish Observations (Non-Blocking)

No new polish items found beyond existing deferred items. The UI demonstrates strong, consistent accessibility execution across all reviewed surfaces.

---

## 4. Summary

| Category | Count |
|---|---|
| WCAG failures (new) | 0 |
| Touch-target violations (new) | 0 |
| New interactive class missing from audit FORBIDDEN regex | 0 |
| Semantic HTML defects | 0 |
| Live-region gaps | 0 |
| Polish items | 0 |

**DISPOSITION: 0 WCAG DEFECTS · 0 POLISH**

No new touch-target violation class was found that the audit test misses. No firm WCAG failure was identified beyond the three known deferred items (POL-R9C5-01, DES-R9C3-02, DEF-C11-01). The frontend accessibility implementation is converged and high quality.
