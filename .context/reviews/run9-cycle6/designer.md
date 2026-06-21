# Run-9 Cycle-6 Designer Accessibility Audit

**Date:** 2026-06-21
**HEAD:** ba3277da
**Scope:** WCAG Level A/AA audit of PUBLIC interactive surfaces
**Bar:** HIGH — deeply-converged repo. Truthful "ZERO new firm DEFECTS" is the success condition.

---

## Audit Coverage

### Components examined

| File | Lines | Verdict |
|---|---|---|
| `components/photo-viewer.tsx` | 1015 | CLEAN |
| `components/lightbox.tsx` | 680 | CLEAN |
| `components/lightbox-color-pip.tsx` | 288 | CLEAN |
| `components/search.tsx` | 474 | CLEAN |
| `components/similar-photos.tsx` | 212 | CLEAN |
| `components/color-details-section.tsx` | 564 | CLEAN |
| `components/home-client.tsx` | 460 | CLEAN |
| `components/photo-navigation.tsx` | 252 | CLEAN |
| `components/info-bottom-sheet.tsx` | 547 | CLEAN |
| `components/wide-gamut-hint.tsx` | 209 | CLEAN |
| `components/histogram.tsx` | 714 | CLEAN |
| `components/nav.tsx` | 14 | CLEAN |
| `components/nav-client.tsx` | 177 | CLEAN |
| `components/footer.tsx` | — | CLEAN |
| `components/on-this-day-widget.tsx` | — | CLEAN |

### Public page routes examined

| File | Verdict |
|---|---|
| `app/[locale]/layout.tsx` | CLEAN |
| `app/[locale]/(public)/layout.tsx` | CLEAN |
| `app/[locale]/(public)/page.tsx` | CLEAN |
| `app/[locale]/(public)/p/[id]/page.tsx` | CLEAN |
| `app/[locale]/(public)/g/[key]/page.tsx` | CLEAN |
| `app/[locale]/(public)/s/[key]/page.tsx` | CLEAN |
| `app/[locale]/(public)/year/[year]/page.tsx` | CLEAN |
| `app/[locale]/(public)/timeline/page.tsx` | CLEAN |
| `app/[locale]/(public)/[topic]/page.tsx` (partial read — metadata block) | CLEAN |
| `app/[locale]/(public)/c/[slug]/page.tsx` | CLEAN |

---

## WCAG Criterion Checks

### 3.1.1 Language of Page (Level A)
`app/[locale]/layout.tsx:94-95`: `<html lang={locale} dir="ltr">` — locale-derived `lang` attribute present on every rendered page. PASS.

### 2.4.1 Bypass Blocks (Level A)
`app/[locale]/layout.tsx:123-128`: Skip-to-main-content link is the first focusable element in the document. It becomes visible on focus via `focus:not-sr-only`. Target `id="main-content"` is set on `<main tabIndex={-1}>` in `app/[locale]/(public)/layout.tsx:12`. PASS.

### 1.3.1 Info and Relationships / 2.4.6 Headings and Labels (Level A/AA)

- **Home page (`home-client.tsx:253`):** `<h2 className="sr-only">{t('home.photosHeading')}</h2>` provides a labelled heading for the masonry section.
- **Timeline page:** `<section aria-labelledby="month-{month}">` with matching `<h2 id="month-{month}">` present. PASS.
- **Year-in-review page:** `<section aria-labelledby="month-section-{month}">` with matching `<h2 id="month-section-{month}">`. PASS.
- **Photo viewer (`photo-viewer.tsx`):** sr-only `<h1>` for the displayed photo title. PASS.
- **Info bottom sheet:** `<h2>` for the photo title within the sheet. PASS.

### 4.1.2 Name, Role, Value (Level A)

All interactive controls on public surfaces carry non-empty accessible names. Sampling below:

- **Nav hamburger toggle (`nav-client.tsx:96-108`):** `aria-label` dynamic (expand/collapse), `aria-expanded`, `aria-controls="primary-nav-topics primary-nav-controls"`. PASS.
- **Nav topic links (`nav-client.tsx:122-144`):** Link text from `{topic.label}` span; decorative thumbnail image carries `alt="" aria-hidden="true"`. `aria-current="page"` for active topic. PASS.
- **Theme toggle (`nav-client.tsx:155-165`):** `aria-label={t('aria.toggleTheme')}` + `title` attribute. PASS.
- **Locale switch (`nav-client.tsx:166-172`):** `aria-label={t('aria.switchLocale', { language: ... })}`. PASS.
- **Search trigger (`search.tsx`):** `aria-label`, `aria-haspopup="dialog"`, `aria-expanded`. PASS.
- **Search dialog:** `role="dialog"`, `aria-modal="true"`, `aria-label`. PASS.
- **Search input:** `<label htmlFor="search-input" className="sr-only">` + `role="combobox"` with full ARIA combobox pattern. PASS.
- **Lightbox (`lightbox.tsx`):** `role="dialog"`, `aria-modal="true"`, `aria-label`. All controls have `aria-label`. Hidden controls get `{ tabIndex: -1, 'aria-hidden': true }` via `controlVisibilityProps`. PASS.
- **Color pip toggle (`lightbox-color-pip.tsx`):** `aria-expanded`, dynamic `aria-label` with color info concatenated. `min-h-11`. PASS.
- **Histogram controls:** `role="img"` on canvas with `aria-label`, collapse/mode-cycle buttons have `aria-label`. PASS.
- **Color details section:** `aria-expanded`, `aria-controls`, info/copy buttons `min-h-[44px] min-w-[44px]`. HDR badge `role="img" aria-label`. PASS.
- **Similar photos toggle:** `aria-expanded`, `aria-controls`, `min-h-11`. PASS.
- **Wide-gamut hint dismiss:** `aria-label`, `min-h-11 min-w-11`. Container has `role="status" aria-live="polite" aria-atomic="true"`. PASS.
- **Info bottom sheet drag handle:** `aria-expanded`, dynamic `aria-label`. `min-h-11`. PASS.
- **Prefetch links in `p/[id]/page.tsx:295-302`:** `aria-hidden="true"` + `tabIndex={-1}` + `className="hidden"`. Not exposed to AT. PASS.

### 1.1.1 Non-text Content (Level A)

- **Masonry grid cards (`home-client.tsx`):** `alt={altText}` via `getConcisePhotoAltText()` which falls back to `t('common.photo')`. Non-empty guaranteed. PASS.
- **Shared group grid (`g/[key]/page.tsx:225-233`):** `alt={altText}` derived from `getPhotoDisplayTitle`. PASS.
- **Year/timeline photos:** `alt={altText}` via `getConcisePhotoAltText`. PASS.
- **Nav topic thumbnail (`nav-client.tsx:134-141`):** `alt=""` + `aria-hidden="true"` — decorative, correct. PASS.
- **On-this-day widget photo links:** `aria-label` on link, `alt` on image (confirmed via grep). PASS.

### 2.4.4 Link Purpose (Level A)

- **Masonry card links:** `aria-label={t('aria.viewPhoto', { title: displayTitle })}` — purpose clear without context. PASS.
- **Year/timeline photo links:** `aria-label={displayTitle}`. PASS.
- **Back navigation links (s/key, g/key, year/year):** Visible text "View gallery" / "Back to timeline" with `min-h-11`. `<ArrowLeft>` icons are decorative (no `aria-label` override needed; link text provides the purpose). PASS.
- **Footer admin link (`footer.tsx:52`):** Visible text content inside `<Link>`. `min-h-11`. PASS.

### 2.1.1 Keyboard / 2.1.2 No Keyboard Trap (Level A)

- **Lightbox:** FocusTrap present with `previouslyFocusedRef.current?.focus()` on close. Escape key handled. PASS.
- **Info bottom sheet:** FocusTrap with `initialFocus` option. Escape on `window`. PASS.
- **Search dialog:** Focus restored to `triggerRef.current?.focus()` on close. Escape handled. PASS.
- **Lightbox hidden controls:** `controlVisibilityProps = { tabIndex: -1, 'aria-hidden': true }` removed from tab order when controls not visible. No keyboard trap. PASS.

### 2.4.3 Focus Order (Level A)

- Public layout places skip link first, then `<Nav>`, then `<main>` with `tabIndex={-1}` target. Logical document order. PASS.

### 1.4.x Color Contrast (Level AA)

No custom colour values are hardcoded on interactive text in these components — all use Tailwind semantic tokens (`text-foreground`, `text-muted-foreground`, `text-primary`, `text-primary-foreground`, `bg-primary`, etc.) resolved by the theme. These are defined in the project's CSS variables and reviewed in prior cycles. No new hardcoded low-contrast text was introduced on any public surface examined. Not re-audited pixel-for-pixel (out of scope for this structural pass), but no new custom hex values are introduced. PASS for structural check.

### 2.5.5 Target Size (Level AAA / practical compliance)

See touch-target audit results below.

---

## Prior Fix Confirmation

### DES-R9C3-01 — Similar-photos toggle accessible name
**File:** `components/similar-photos.tsx`
**Status: CONFIRMED STILL HOLDS**

Toggle button at line ~140: `aria-expanded={open}`, `aria-controls="similar-photos-results"`, `aria-label` provided via `t()`. `min-h-11`.

### DES-R9C4-01 — SimilarThumb link/image accessible name
**File:** `components/similar-photos.tsx:146`
**Status: CONFIRMED STILL HOLDS**

```tsx
const label = item.title ?? item.description ?? tCommon('photo');
```

Line 193-196: `<Link ... title={label} aria-label={label}>` with `<img alt={label}>`. Non-empty accessible name guaranteed for all paths. No regression.

---

## Touch-Target Audit

**Command:** `npm test --workspace=apps/web -- touch-target-audit --reporter=verbose`
**Result:** ALL 15 TESTS PASSED (exit code 0)

```
✓ matches the documented per-file violation count across all SCAN_ROOTS      97ms
✓ finds no < 44 px touch targets in admin login form                          1ms
✓ FORBIDDEN regex catches HTML <button>, size="icon", and cn() composites     1ms
✓ scanSource catches multi-line <Button size="icon"> with sub-44px className  0ms
✓ scanSource catches multi-line <Button size="sm"> without h-11 override      0ms
✓ scanSource catches multi-line native <select> with sub-44px className       0ms
✓ scanSource catches a raw <input type="checkbox"> with sub-44 wrapper        0ms
✓ scanSource accepts multi-line <Button size="icon"> with h-11 override       0ms
✓ scanSource accepts multi-line <Button size="sm"> with h-11 override         0ms
✓ FORBIDDEN regex does not flag valid h-11 / size-11 / overridden size="icon" 1ms
✓ scanSource catches multi-line <Badge asChild> with sub-44 min-h composite   0ms
✓ scanSource accepts multi-line <Badge asChild> with min-h-11 chip sizing     0ms
✓ public inline recovery <Link>s keep their min-h-11 tap area (AGG-C5-03)    2ms
✓ public back-nav <Link>s keep their min-h-11 tap area (AGG-C6-03)           1ms
✓ admin-header brand <Link> keeps its min-h-11 tap area (AGG-C7-01)          1ms

Test Files  1 passed (1)
     Tests  15 passed (15)
  Duration  235ms
```

No new interactive element slipped below 44 px. KNOWN_VIOLATIONS budget is accurate and unmodified from the prior cycle.

---

## Previously Adjudicated Items (Not Re-Filed)

| ID | Status |
|---|---|
| POL-R9C5-01 | DEFERRED — decorative back-arrow SVG without `aria-hidden` in `year/[year]/page.tsx:111`. Consistent with decision in prior cycle. |
| DES-R9C3-02 | DEFERRED — analytics `<th>` lack `scope="col"`. Admin-only surface. |
| DEF-C11-01 | DEFERRED — search dialog `<Input>` 32px. Deliberately out of scope. |

---

## Findings

No new WCAG Level A or AA firm defects were found on any public interactive surface in this cycle.

---

**VERDICT: ZERO new firm DEFECTS**
