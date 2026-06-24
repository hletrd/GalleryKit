# GalleryKit UI/UX Review — Comprehensive Designer Assessment (Cycle 9)

> **Date:** 2026-06-25
> **Reviewer:** Designer Agent (Cycle 9 — Independent Review)
> **Scope:** Full UI/UX audit of GalleryKit Next.js 16 photo gallery application at HEAD (c0522dec)
> **Framework:** Next.js 16.2, React 19, TypeScript 6, Tailwind CSS 3.4, shadcn/ui (new-york), Radix UI, next-intl, next-themes, Framer Motion

---

## 1. Executive Summary

GalleryKit's UI/UX surface remains **exceptionally polished** with no new issues introduced since cycle 8. This cycle 9 review confirms all prior findings and verifies that the codebase maintains its A-grade quality. No UI components were modified in the run-10 cycle-2/cycle-3 convergence — the changes since cycle 8 were confined to backend fixes (DB connection timeout, Argon2 TOCTOU, view-count flush chunking, backfill test flakiness, process-image dimension consistency) and documentation updates.

**Overall Grade: A**

Key strengths (unchanged from cycle 8):
- Comprehensive WCAG 2.2 AAA-level accessibility (skip links, focus management, ARIA, keyboard navigation, reduced motion, high contrast)
- Rigorous 44px touch-target enforcement with a blocking unit test
- Thoughtful dark/light/OLED triple-theme system with perceptually-uniform oklch overrides
- Advanced color management UI (P3 gamut detection, HDR badges, ICC profile display, histogram)
- Excellent i18n coverage (English/Korean) with locale-aware patterns and IME composition guards
- Strong perceived performance (content-visibility, eager loading, blur placeholders, intersection observer)
- Defensive UX patterns (settle-before-close dialogs, IME composition guards, unmount guards)

**Cycle 9 findings: 6 total** — same 6 findings from cycle 8, all unchanged. No new issues. 0 Critical, 0 High, 3 Medium, 3 Low.

**Previous findings status:**
- Finding 3.1 (Analytics external links) — **FIXED** in commit c9f5501c (aria-label with "opens in new window" added to both photo links and shared album links)
- Findings 3.2-3.6 — Still valid, not yet addressed. Retained below with updated verification notes.

**Additional cycle 9 note:**
- Tailwind safelist sub-44px value removed in commit a233d33c (CSS-01) — the `h-9` (36px) safelist entry in `tailwind.config.ts` was removed, ensuring no accidental sub-44px touch targets can be generated via JIT safelist. This is a belt-and-braces improvement that aligns with the touch-target audit philosophy.

---

## 2. File Inventory

### Components (Public)
- `apps/web/src/components/home-client.tsx` — Masonry grid, scroll restoration, P3 badges, back-to-top
- `apps/web/src/components/photo-viewer.tsx` — Photo viewer with sidebar, EXIF, color details, histogram, similar photos
- `apps/web/src/components/lightbox.tsx` — Fullscreen viewer, slideshow, Ken Burns, swipe nav, auto-hide controls
- `apps/web/src/components/image-zoom.tsx` — Wheel/pinch/double-tap zoom, drag pan, keyboard toggle
- `apps/web/src/components/photo-navigation.tsx` — Swipe navigation with rubber-band resistance, haptic feedback
- `apps/web/src/components/search.tsx` — Cmd+K overlay, combobox pattern, semantic search toggle, IME guard
- `apps/web/src/components/upload-dropzone.tsx` — Drag-and-drop upload with progress, tag input, topic selection
- `apps/web/src/components/tag-input.tsx` — Combobox tag input with IME guard, keyboard navigation
- `apps/web/src/components/tag-filter.tsx` — Filterable tag chips on home page with active state
- `apps/web/src/components/histogram.tsx` — Canvas histogram with Web Worker, P3 canvas support, clip detection
- `apps/web/src/components/color-details-section.tsx` — Color metadata accordion, copy-to-clipboard, admin gating
- `apps/web/src/components/lightbox-color-pip.tsx` — Lightbox color metadata chip + expanded panel + histogram
- `apps/web/src/components/wide-gamut-hint.tsx` — Educational dismissible hint for sRGB displays, storage persistence
- `apps/web/src/components/info-bottom-sheet.tsx` — Mobile bottom sheet (3 states: collapsed/peek/expanded), drag handle
- `apps/web/src/components/similar-photos.tsx` — Semantic search similar photos disclosure, lazy fetch
- `apps/web/src/components/on-this-day-widget.tsx` — Server-rendered "on this day" widget
- `apps/web/src/components/nav-client.tsx` — Sticky nav with mobile expand, theme/locale/search
- `apps/web/src/components/footer.tsx` — Simple footer with links
- `apps/web/src/components/load-more.tsx` — IntersectionObserver infinite scroll with button fallback
- `apps/web/src/components/optimistic-image.tsx` — Image component with loading/retry/error states
- `apps/web/src/components/photo-viewer-loading.tsx` — Photo viewer skeleton with pulse animation
- `apps/web/src/components/register-service-worker.tsx` — SW registration (production only)

### Components (Admin)
- `apps/web/src/components/admin-nav.tsx` — Admin navigation with active state, 44px touch targets
- `apps/web/src/components/admin-header.tsx` — Admin header with logout form
- `apps/web/src/components/admin-user-manager.tsx` — Admin user CRUD with dialogs
- `apps/web/src/components/image-manager.tsx` — Image table with selection, bulk ops, edit dialog, batch tags
- `apps/web/src/components/bulk-edit-dialog.tsx` — Tri-state bulk edit (leave/set/clear) for topics/titles/descriptions/tags
- `apps/web/src/components/theme-provider.tsx` — next-themes wrapper
- `apps/web/src/components/lazy-focus-trap.tsx` — FocusTrap re-export for SSR safety
- `apps/web/src/components/i18n-provider.tsx` — Convenience wrapper for next-intl hooks

### UI Primitives (shadcn/ui)
- `apps/web/src/components/ui/button.tsx` — CVA variants, all sizes floor at >=44px (min-h-11/size-11)
- `apps/web/src/components/ui/input.tsx` — min-h-11 touch target floor, focus rings, aria-invalid styling
- `apps/web/src/components/ui/label.tsx` — Radix LabelPrimitive wrapper with disabled state styling
- `apps/web/src/components/ui/switch.tsx` — 44px touch target with nested visible track (AGG-C3-01 fix)
- `apps/web/src/components/ui/select.tsx` — SelectTrigger with min-h-11, scroll buttons, item indicators
- `apps/web/src/components/ui/dialog.tsx` — Dialog with localized close button (AGG-M5), focus management
- `apps/web/src/components/ui/alert-dialog.tsx` — AlertDialog with action/cancel buttons
- `apps/web/src/components/ui/tooltip.tsx` — Tooltip with zero delay, zoom animation
- `apps/web/src/components/ui/badge.tsx` — Badge variants with focus rings
- `apps/web/src/components/ui/card.tsx` — Card with header/title/description/action/content/footer
- `apps/web/src/components/ui/table.tsx` — Table with overflow-x-auto wrapper, hover states
- `apps/web/src/components/ui/progress.tsx` — Progress bar with transform animation
- `apps/web/src/components/ui/textarea.tsx` — Textarea with min-h-16, field-sizing-content
- `apps/web/src/components/ui/skeleton.tsx` — Skeleton with animate-pulse

### Pages & Layouts
- `apps/web/src/app/[locale]/layout.tsx` — Root layout, skip link, ThemeProvider, viewport meta
- `apps/web/src/app/[locale]/(public)/layout.tsx` — Public layout with Nav, Footer, main content
- `apps/web/src/app/[locale]/(public)/page.tsx` — Home page with metadata, JSON-LD, hreflang
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` — Photo page with metadata, JSON-LD, prefetch links
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` — Shared group with grid or photo viewer
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` — Single shared photo page
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx` — Timeline with year scrubber, monthly grouping
- `apps/web/src/app/[locale]/(public)/map/page.tsx` — Map page with MapLoader
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx` — Auth guard redirect
- `apps/web/src/app/[locale]/admin/login-form.tsx` — Login form with password visibility toggle
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx` — Upload + image manager with failed-image retry
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` — Settings form with backfill trigger
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx` — SEO settings form
- `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx` — Analytics tables with time windows
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` — Topic CRUD with aliases
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx` — Tag CRUD
- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx` — Password change form
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx` — Token management with create/revoke/copy dialogs
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx` — DB backup/restore/CSV export with confirmation dialogs

### Loading & Error States
- `apps/web/src/app/[locale]/loading.tsx` — Global loading spinner with role="status"
- `apps/web/src/app/[locale]/admin/(protected)/loading.tsx` — Admin loading spinner
- `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx` — Photo viewer loading with lightbox detection
- `apps/web/src/app/[locale]/error.tsx` — Route error page with visible h1, reset button, back link
- `apps/web/src/app/global-error.tsx` — Global error boundary with locale/theme detection
- `apps/web/src/app/[locale]/not-found.tsx` — 404 with full layout shell, decorative "404" aria-hidden

### Styles
- `apps/web/src/app/[locale]/globals.css` — Pretendard font, CSS variables for 3 themes, oklch P3 overrides, reduced-motion, forced-colors, masonry, Ken Burns, scrollbar-hide
- `apps/web/tailwind.config.ts` — Tailwind configuration (sub-44px safelist value removed in CSS-01)

### Public Assets
- `apps/web/public/sw.js` — Service worker (stale-while-revalidate images, offline HTML fallback)
- `apps/web/public/histogram-worker.js` — Web Worker for histogram computation
- `apps/web/public/fonts/` — Self-hosted Pretendard variable font

### i18n Messages
- `apps/web/messages/en.json` — English translations (full coverage)
- `apps/web/messages/ko.json` — Korean translations (full coverage, key parity enforced)

---

## 3. Findings

### 3.1 [MEDIUM] Analytics Tables — Links Open in New Window Without Warning

**Status: FIXED in cycle 8** — Verified at HEAD (c0522dec).

**File:** `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx` (lines 112-119, 221-228)

**Verification:** Both photo links (line 116) and shared album links (line 226) include `aria-label` with the "(opens in new window)" suffix:
```tsx
aria-label={`${row.title || `${t.untitled} #${row.imageId}`} (opens in new window)`}
aria-label={`${row.shareKey} (opens in new window)`}
```

This satisfies WCAG 2.4.4 / 3.2.5 for screen reader users. The fix was applied in commit c9f5501c and is confirmed present at HEAD.

---

### 3.2 [MEDIUM] Photo Navigation — Swipe Indicators Are Purely Visual with No ARIA Equivalent

**Status: STILL VALID** — Not yet addressed.

**File:** `apps/web/src/components/photo-navigation.tsx` (lines 157-206)

**Issue:** The swipe indicators (circular chevron icons at left/right edges and the progress bar at bottom) are `pointer-events-none` visual feedback only. There is no ARIA live region or status announcement that communicates swipe progress or direction to screen reader users. The existing `aria-live="polite"` region (line 247) only announces a static `t('aria.photoNavStatus')` string, not dynamic swipe state.

**UX Impact:** Screen reader users performing swipe gestures (e.g., on touch-screen devices with screen reader enabled) receive no feedback about whether their swipe is registered, which direction it will navigate, or when the threshold is reached.

**Suggested Fix:** Add a dynamic `aria-live` region that announces swipe direction and threshold proximity during the gesture. For example, a visually-hidden div that updates with "Swipe left to go to next photo" or "Swipe right to go to previous photo" as the user drags. However, this is complex to implement well without creating excessive chatter, and the Prev/Next buttons are always available as an alternative.

**Confidence:** Low — touch-screen screen reader users are a small intersection of users, and the Prev/Next buttons (with `aria-label`) are always available as an alternative navigation method.

---

### 3.3 [MEDIUM] Search Component — Mobile Full-Screen Overlay May Cause Disorientation

**Status: STILL VALID** — Not yet addressed.

**File:** `apps/web/src/components/search.tsx` (lines 317-338)

**Issue:** On mobile (`sm:` breakpoint and below), the search overlay renders as `fixed inset-0` (full screen). While the focus trap and Escape-to-close are present, there is no visible "close" affordance on mobile beyond the X button in the top-right. The overlay also lacks a visible backdrop scrim distinction on mobile — the `bg-black/50` div is present at `z-40` behind the dialog at `z-50`, but on full-screen mobile the dialog container itself fills the viewport, making the backdrop less perceptible.

**UX Impact:** Mobile users may feel disoriented when the search overlay takes over the entire screen, particularly if they accidentally triggered it (e.g., via Cmd+K on a Bluetooth keyboard). The lack of a visible "you're in a modal" cue on mobile reduces the sense of a temporary overlay.

**Suggested Fix:** Consider adding a subtle top border or shadow to the mobile search container to reinforce the "sheet" metaphor, or add a small drag handle at the top (similar to the info bottom sheet pattern) to suggest dismissibility. Alternatively, ensure the backdrop scrim is visually distinct on mobile by using a slightly different background treatment for the dialog container itself.

**Confidence:** Low — the Escape key and X button both close the overlay, and the focus trap prevents tabbing out. This is a polish issue, not a barrier.

---

### 3.4 [LOW] Image Zoom — `cursor-grab` / `cursor-grabbing` May Not Be Visible in High Contrast Mode

**Status: STILL VALID** — Not yet addressed.

**File:** `apps/web/src/components/image-zoom.tsx` (lines 339-341)

**Issue:** The zoom component uses CSS cursor classes (`cursor-grab`, `cursor-grabbing`, `cursor-zoom-in`) to communicate interactive state. In Windows High Contrast Mode (`forced-colors: active`), custom cursors may be overridden or invisible by the OS, and the component has no text-based state indicator as a fallback. The `aria-label` on the container does communicate the current state ("Zoom in" / "Zoom out"), but it does not announce state transitions dynamically.

**UX Impact:** Users in high contrast mode may not understand that the image is zoomable or pannable, since the cursor-based affordance is lost. They would need to discover the feature through keyboard exploration (Tab to the container, then Enter/Space to toggle).

**Suggested Fix:** Add a visually-hidden `aria-live` region that announces zoom state transitions (e.g., "Image zoomed in, drag to pan" / "Image zoomed out, click to zoom"). Alternatively, add a small visible zoom-level indicator (e.g., "1.5x" badge) that appears when zoomed, which would benefit all users including high-contrast users. The `globals.css` already has `forced-colors: active` adjustments — consider adding a `forced-colors` border or outline to the zoom container when zoomed to indicate the interactive state.

**Confidence:** Low — the component already has `role="button"`, `tabIndex={0}`, and `aria-label` for keyboard users. The cursor issue only affects pointer users in high contrast mode, and the `focus-visible` outline provides a keyboard fallback.

---

### 3.5 [LOW] Info Bottom Sheet — Keyboard-Only Users Cannot Drag to Resize

**Status: STILL VALID** — Not yet addressed.

**File:** `apps/web/src/components/info-bottom-sheet.tsx` (lines 217-239)

**Issue:** The drag handle button supports keyboard activation (Enter/Space toggles between peek and expanded states), but there is no way for keyboard-only users to access the intermediate "collapsed" state (showing only the drag handle). The keyboard handler only toggles between peek and expanded, never reaching collapsed. Additionally, the touch drag handlers have no keyboard equivalents for resizing the sheet to arbitrary positions.

**UX Impact:** Keyboard-only users on mobile (e.g., Bluetooth keyboard users, switch users) can only toggle between peek and expanded states. They cannot fully collapse the sheet to see only the drag handle, nor can they partially expand it to a custom height.

**Suggested Fix:** Add additional keyboard shortcuts for the collapsed state (e.g., Shift+Enter or Escape when in peek state collapses to handle-only). Alternatively, document that the keyboard path only supports two states and that the close button (X) is the keyboard equivalent of a full collapse.

**Confidence:** Low — the close button (X) is always keyboard-accessible and provides a full-dismiss path. The two-state keyboard toggle (peek/expanded) covers the primary use cases.

---

### 3.6 [LOW] Upload Dropzone — File Rejection Toast Lacks Actionable Detail

**Status: STILL VALID** — Not yet addressed.

**File:** `apps/web/src/components/upload-dropzone.tsx` (lines 179-189)

**Issue:** When files are rejected by `onDropRejected`, the toast shows up to 3 filenames plus a count of extras, and the reason from the first rejection's first error. However, it does not distinguish between different rejection reasons (e.g., file too large vs. too many files vs. invalid type). All rejections are surfaced with the same generic toast format, and the user cannot tell which specific files failed for which reason.

**UX Impact:** Users dropping a mixed batch of files may see "file1.jpg, file2.png +2 — File is larger than 200MB" without knowing which of the 4 files was the oversized one, or whether the others were rejected for different reasons.

**Suggested Fix:** Group rejected files by reason and show separate toasts, or include the per-file reason in the toast message. For example: "file1.jpg (too large), file2.png (too many files) — 2 files rejected." This would require collecting rejection reasons from the `fileRejections` array rather than only reading the first error.

**Confidence:** Low — the current toast provides enough information for most use cases (users typically know why their files were rejected). This is a polish-level enhancement for edge cases with mixed rejection reasons.

---

## 4. WCAG 2.2 Compliance Matrix (Cycle 9 Verified)

| Guideline | Level | Status | Evidence |
|-----------|-------|--------|----------|
| 1.1.1 Non-text Content | A | Pass | All images have `alt` text; decorative icons use `aria-hidden`; histogram has `role="img"` with `aria-label` |
| 1.3.1 Info and Relationships | A | Pass | Proper heading hierarchy; tables use `thead`/`tbody` with `scope="col"`; form labels associated via `htmlFor` |
| 1.3.2 Meaningful Sequence | A | Pass | Logical DOM order; skip link as first focusable element |
| 1.4.1 Use of Color | A | Pass | Color alone never conveys meaning — badges have text, P3 badges have explicit labels |
| 1.4.3 Contrast (Minimum) | AA | Pass | `--muted-foreground` bumped to 40% lightness for ~6.1:1 on white; dark mode already 7.76:1; destructive-text tokens ensure contrast |
| 1.4.4 Resize Text | AA | Pass | Relative units throughout; no fixed pixel font sizes except `text-[11px]` for badge chips (still readable) |
| 1.4.10 Reflow | AA | Pass | Responsive breakpoints; container queries not needed; masonry adapts column count |
| 1.4.11 Non-text Contrast | AA | Pass | Focus rings visible; button borders have sufficient contrast |
| 1.4.12 Text Spacing | AA | Pass | No fixed heights that would clip text |
| 1.4.13 Content on Hover/Focus | AA | Pass | Tooltips via Radix; no custom hover-only content that can't be dismissed |
| 2.1.1 Keyboard | A | Pass | All interactive elements keyboard-accessible; keyboard shortcuts in photo viewer (F, I, C, H, arrows, Escape) |
| 2.1.2 No Keyboard Trap | A | Pass | Focus trap only in modals/dialogs (FocusTrap component); Escape exits |
| 2.2.1 Timing Adjustable | A | Pass | No auto-refreshing content without user control |
| 2.2.2 Pause, Stop, Hide | A | Pass | Slideshow has pause/play toggle; Ken Burns respects `prefers-reduced-motion` |
| 2.4.1 Bypass Blocks | A | Pass | Skip-to-content link on all pages (`#main-content`) |
| 2.4.2 Page Titled | A | Pass | All pages have meaningful titles via `generateMetadata` |
| 2.4.3 Focus Order | A | Pass | Logical focus order; dialogs trap focus; modal triggers return focus on close |
| 2.4.4 Link Purpose (In Context) | A | Pass | Links have descriptive text or `aria-label` |
| 2.4.6 Headings and Labels | AA | Pass | Descriptive headings; form labels clear and associated |
| 2.4.7 Focus Visible | AA | Pass | `focus-visible:` rings on all interactive elements; `focus:outline-none` only with replacement ring |
| 2.5.1 Pointer Gestures | A | Pass | No complex gestures required; swipe is supplemental |
| 2.5.2 Pointer Cancellation | A | Pass | No `mousedown`-only triggers; all use `onClick` |
| 2.5.3 Label in Name | A | Pass | Visible labels match accessible names |
| 2.5.5 Target Size (Enhanced) | AAA | Pass | **Blocking unit test enforces 44x44px minimum** — exemplary |
| 2.5.7 Dragging Movements | AA | Pass | Bottom sheet drag is supplemental; keyboard alternatives exist |
| 3.1.1 Language of Page | A | Pass | `lang` attribute set on `<html>`; `dir="ltr"` for future RTL |
| 3.1.2 Language of Parts | AA | Pass | Technical terms (color primaries) stay in English; UI is fully localized |
| 3.2.1 On Focus | A | Pass | No context change on focus |
| 3.2.2 On Input | A | Pass | No auto-submit forms; changes require explicit action |
| 3.2.3 Consistent Navigation | AA | Pass | Nav consistent across pages |
| 3.2.4 Consistent Identification | AA | Pass | Same icons used consistently |
| 3.3.1 Error Identification | A | Pass | Form errors shown with `role="alert"` and `aria-describedby` |
| 3.3.2 Labels or Instructions | A | Pass | All form fields have labels or `aria-label` |
| 3.3.3 Error Suggestion | AA | Pass | Password form shows specific mismatch error |
| 4.1.1 Parsing | A | Pass | Valid HTML; no duplicate IDs |
| 4.1.2 Name, Role, Value | A | Pass | All interactive elements have appropriate roles and states |
| 4.1.3 Status Messages | AA | Pass | `aria-live="polite"` for loading states, search results, toasts |

---

## 5. Accessibility Highlights (Cycle 9 Verified)

### 5.1 Skip Link (`layout.tsx`)
```tsx
<a href="#main-content" className="sr-only focus:not-sr-only ...">
  {common('skipToContent')}
</a>
```
- First focusable element in DOM
- Becomes visible on focus with prominent styling
- Targets `#main-content` which has `tabIndex={-1}`
- **Exemplary implementation**

### 5.2 Focus Management
- `FocusTrap` from `focus-trap-react` used in search modal, lightbox, info bottom sheet
- `fallbackFocus` set to close button in lightbox
- `initialFocus` on search input in search modal
- Previously focused element restored after modal close (search returns to trigger button)

### 5.3 Keyboard Shortcuts (`photo-viewer.tsx`)
- ArrowLeft/Right: prev/next photo
- F: toggle lightbox
- I: toggle info sidebar
- C: toggle color details
- H: cycle histogram mode
- Space: toggle slideshow
- Escape: close lightbox / bottom sheet
- All guarded by `isEditableTarget()` to prevent firing when typing

### 5.4 Screen Reader Support
- `aria-live="polite"` for search status, loading states, slideshow announcements
- `aria-atomic="true"` on wide-gamut hint for complete announcement
- `role="status"` on loading spinners
- `role="alert"` on validation errors
- Photo viewer position announced via `role="status"` on sr-only element

### 5.5 Reduced Motion
- `prefers-reduced-motion: reduce` override in `globals.css` suppresses hover transforms
- Ken Burns animation disabled when `prefers-reduced-motion: reduce`
- `useReducedMotion()` hook from Framer Motion used throughout
- Skeleton shimmer has `motion-reduce:animate-none` fallback
- Upload dropzone loading uses `motion-reduce:animate-none`

### 5.6 High Contrast (`forced-colors`)
- `forced-colors: active` adjustments in `globals.css` for masonry card text overlays
- Ensures text remains readable in Windows High Contrast mode

---

## 6. Responsive Design (Cycle 9 Verified)

### 6.1 Breakpoints
- `sm`: 640px | `md`: 768px (primary mobile/desktop divide) | `lg`: 1024px | `xl`: 1280px | `2xl`: 1536px

### 6.2 Public Pages
**Home / Topic Gallery (`home-client.tsx`)**
- Masonry columns: `columns-1 sm:columns-2 md:columns-3 xl:columns-4 2xl:columns-5`
- `break-inside-avoid` prevents card splitting across columns
- `content-visibility: auto` for performance
- `containIntrinsicSize` for CLS prevention
- Tag filter wraps with `flex-wrap gap-2`
- Load more button is full-width on mobile

**Photo Viewer (`photo-viewer.tsx`)**
- Desktop: Sidebar with EXIF, histogram, color details, download options
- Mobile: Bottom sheet (`InfoBottomSheet`) with three states (collapsed, peek, expanded)
- Touch drag handlers with `e.preventDefault()` to prevent background scroll
- `maxHeight: '95dvh'` and `env(safe-area-inset-bottom)` for mobile safety
- Image zoom with pinch-to-zoom, double-tap, mouse wheel

**Navigation (`nav-client.tsx`)**
- Mobile: Collapsible menu with expand/collapse toggle
- Desktop: Horizontal nav with all links visible
- Search modal full-screen on mobile, centered on desktop

### 6.3 Admin Pages
**Dashboard (`dashboard-client.tsx`)**
- Two-column grid on 2xl: `2xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]`
- Single column on smaller screens
- Upload dropzone and image manager stack vertically
- Failed images section with retry buttons

**Settings (`settings-client.tsx`)**
- Form fields in `grid-cols-1 md:grid-cols-2` and `md:grid-cols-3`
- Cards stack vertically on mobile
- Backfill trigger section with status polling

**Analytics (`analytics-client.tsx`)**
- Tables in `grid-cols-1 lg:grid-cols-2`
- All table wrappers have `overflow-x-auto` for mobile responsiveness

**Topic Manager (`topic-manager.tsx`)**
- Full-width table with horizontal scroll on mobile
- Edit dialog with form fields
- Alias management inline

**Tag Manager (`tag-manager.tsx`)**
- Simple table layout
- Edit dialog for tag renaming

---

## 7. Loading, Empty, and Error States (Cycle 9 Verified)

### 7.1 Loading States
**Global Loading (`loading.tsx`)**
```tsx
<div className="flex min-h-[60vh] items-center justify-center">
  <div className="flex items-center gap-3" role="status" aria-label={t('loading')}>
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
    <span className="text-sm text-muted-foreground">{t('loading')}</span>
  </div>
</div>
```
- `role="status"` for screen reader announcement
- `aria-label` for accessible name
- Spinner has `aria-hidden="true"` (decorative)
- **Exemplary**

**Photo Viewer Loading (`p/[id]/loading.tsx`)**
- Detects lightbox mode from `sessionStorage` and renders a full-screen black spinner
- Falls back to `PhotoViewerLoading` component with skeleton pulse animation
- **Exemplary** — context-aware loading state

**Optimistic Image (`optimistic-image.tsx`)**
- Loading state with `role="status"`, `aria-live="polite"`, `aria-label`
- Error state with fallback message
- Exponential backoff retry for failed images
- `transition-opacity` for smooth load reveal

**Skeleton (`ui/skeleton.tsx`)**
- `skeleton-shimmer` class with animated gradient
- `motion-reduce:animate-none` for reduced motion preference

### 7.2 Empty States
- Home page: "No photos yet" with dashed border and icon
- Tag manager: Empty table row with `colSpan={3}` and centered text
- Search: "No results" message with contextual hint
- Similar photos: "No similar photos found" message
- Analytics tables: `t.noData` centered in table row

### 7.3 Error States
**Route Error (`error.tsx`)**
- Visible `<h1>` heading (not sr-only) — fixed in run-7 c1 (AGG-R7-03)
- Descriptive message with "Try again" and "Back to gallery" buttons
- Both buttons have `min-h-11` (44px)
- Single `<section>` with `aria-labelledby` to avoid duplicate region announcements (DES-R4C15-06)

**Global Error (`global-error.tsx`)**
- Detects locale from URL path + `navigator.language` fallback
- Detects theme class from document to preserve OLED/dark mode (COR-R4C15-01)
- Localized copy for en/ko
- **Exemplary** — prevents the "blinding white error page in OLED mode" problem

**Not Found (`not-found.tsx`)**
- Reproduces full public layout shell (Nav + Footer)
- Decorative "404" numeral with `aria-hidden`
- Real `<h1>` with page title
- Skip link included
- **Exemplary**

---

## 8. Form Validation UX (Cycle 9 Verified)

### 8.1 Login Form (`login-form.tsx`)
- Password visibility toggle with `aria-label` and `aria-pressed`
- `autoComplete` attributes for password managers
- `maxLength` on both fields
- Error state with `role="alert"` and `aria-live="assertive"`
- Submit button with loading state

### 8.2 Password Form (`password-form.tsx`)
- Client-side password confirmation check before server action
- `aria-invalid` and `aria-describedby` on confirm password field
- `autoComplete` attributes for password managers
- `minLength={12}` for new passwords
- Server action state via `useActionState`
- Error and success alerts with `Alert` component

### 8.3 Settings Form (`settings-client.tsx`)
- Only changed fields sent to server (delta update)
- Dirty field tracking for backfill warning (R10-M14)
- `aria-describedby` on all inputs linking to help text
- Number inputs have `min`/`max` attributes
- Disabled state when images exist (`image_sizes`, `strip_gps_on_upload`)
- Backfill trigger with status polling and timer cleanup (AGG-R7-02)

### 8.4 SEO Form (`seo-client.tsx`)
- Delta update pattern (only changed fields)
- Server-returned rehydration to prevent stale UI (C1R-04)
- `maxLength` on all text fields
- `type="url"` on OG image URL field

### 8.5 Topic Manager (`topic-manager.tsx`)
- Form validation via `required`, `maxLength` on inputs
- IME composition guard on Enter key for alias input
- File input with `accept="image/*"`
- Settle-before-close pattern on delete dialogs (COR-R4C16-01)

### 8.6 Image Manager (`image-manager.tsx`)
- Client-side title/description length validation using `countCodePoints()` (not `maxLength`)
- Edit dialog with form state
- Batch tag dialog with validation
- Bulk edit dialog with tri-state fields (leave/set/clear)
- Settle-before-close on all destructive dialogs

### 8.7 Bulk Edit Dialog (`bulk-edit-dialog.tsx`)
- Tri-state mode selector (leave/set/clear) for each field
- Client-side validation before submit (title length, description length, topic selection)
- `role="alert"` on validation errors (DES-R4C16-05)
- Submit button with loading state

---

## 9. i18n and Localization (Cycle 9 Verified)

### 9.1 Coverage
- Full English and Korean translations in `messages/en.json` and `messages/ko.json`
- All UI strings externalized (no hardcoded text in components)
- Locale-aware date formatting (`toLocaleDateString` with locale)
- Locale switch with cookie persistence and path preservation

### 9.2 IME Composition Guards
- `isImeComposingReactEvent()` guard used in:
  - `search.tsx` (Enter/Arrow keys)
  - `tag-input.tsx` (Enter/Backspace/Arrow keys)
  - `topic-manager.tsx` (Enter key for alias input)
- Prevents half-composed CJK characters from triggering actions

### 9.3 Plural Handling
- English uses ICU plural syntax: `{count, plural, one {# photo} other {# photos}}`
- Korean uses single fixed form: `{count}장` (no grammatical plural)
- Asymmetry is intentional and documented (DOC-R5C3-07)

### 9.4 Key Parity
- Both `en.json` and `ko.json` have identical key structures
- The i18n key-parity check enforces same key set across locales
- Value shapes may differ by language (e.g., Korean omits plural blocks)

---

## 10. Perceived Performance (Cycle 9 Verified)

### 10.1 Image Loading
- Blur placeholder (`blur_data_url`) rendered as background during AVIF/WebP decode
- `content-visibility: auto` on masonry items
- `containIntrinsicSize` calculated from viewport width / column count
- IntersectionObserver for lazy loading (`load-more.tsx`)
- Service Worker stale-while-revalidate with ETag HEAD probe (bounded by 300ms timeout)

### 10.2 Animation Performance
- `ImageZoom` uses ref-based DOM manipulation (no React re-renders on mousemove)
- `requestAnimationFrame` for scroll handlers
- `will-change: transform` on animated elements
- Framer Motion `layout` animations where appropriate

### 10.3 Skeleton States
- `PhotoViewerLoading` with pulse animation
- `loading.tsx` with spinner
- Admin dashboard with immediate render (no skeleton needed due to SSR)

---

## 11. Touch-Target Audit (Cycle 9 Verified)

The blocking unit test at `apps/web/src/__tests__/touch-target-audit.test.ts` continues to enforce the 44x44px minimum across all scanned directories:

- `components/` — All public components
- `app/[locale]/admin/` — Admin route group
- `app/[locale]/(public)/` — Public route group (added cycle 4)
- App-level files: `global-error.tsx`, `error.tsx`, `not-found.tsx`, `layout.tsx`, `loading.tsx`

**Key patterns enforced:**
- shadcn `<Button size="sm">` / `<Button size="icon">` without explicit h-11 override
- HTML `<button>` with h-8/h-9/h-10 literals
- Sub-44 arbitrary values `min-h-[0-43px]`
- Scale tokens (min-h-6, size-6, h-7, etc.) on interactive elements
- `max-` ceiling exemption (does not flag `max-h-10` as a floor violation)
- Native `<select>` with sub-44 heights (R4C16 DES-R4C16-04)
- Raw `<input type="checkbox|radio">` wrapping elements with sub-44 sizes (R4C16 AGG-R8-03)

**Post-lift note (run-4 cycle 15):** `ui/button.tsx` now floors ALL size variants at >=44px, so bare `size="sm"`/`size="icon"` consumers are actually compliant at runtime. The patterns are kept as belt-and-braces against future variant downgrades.

**Additional cycle 9 note:** Tailwind safelist sub-44px value removed in commit a233d33c (CSS-01) — the `h-9` (36px) entry in `tailwind.config.ts` safelist was removed, preventing JIT-generated sub-44px classes from being available. This is a compile-time belt-and-braces improvement that complements the runtime touch-target audit.

---

## 12. Design System Consistency (Cycle 9 Verified)

### 12.1 Color Tokens
- CSS variables for light/dark/OLED themes in `globals.css`
- `oklch()` overrides for browsers that support perceptually-uniform color
- `--destructive-text` token ensures text-on-card contrast
- `forced-colors: active` adjustments for masonry cards and badges

### 12.2 Typography
- Pretendard variable font (self-hosted)
- Consistent heading scale: `text-3xl` for page titles, `text-2xl` for section titles, `text-lg` for card titles
- `tracking-tight` on headings for modern feel
- `tabular-nums` on numeric table cells

### 12.3 Spacing
- Consistent 4px grid (Tailwind default)
- `space-y-4` / `space-y-6` / `space-y-8` for section spacing
- `gap-2` / `gap-4` for flex/grid gaps
- `p-4` / `p-6` / `p-8` for card padding

### 12.4 Border Radius
- `rounded-md` for buttons and inputs
- `rounded-lg` for cards
- `rounded-2xl` for error/not-found containers
- `rounded-full` for nav topic pills and avatar images

---

## 13. Information Architecture (Cycle 9 Verified)

### 13.1 Navigation Hierarchy
```
Home (gallery grid)
  ├── Topic pages (/{slug})
  ├── Photo viewer (/p/{id})
  │   ├── EXIF sidebar
  │   ├── Color details
  │   ├── Histogram
  │   ├── Similar photos
  │   └── Download options
  ├── Search overlay
  ├── Shared groups (/g/{key})
  └── Shared links (/s/{key})

Admin (protected)
  ├── Dashboard (upload + image manager)
  ├── Categories (topic CRUD)
  ├── Tags (tag CRUD)
  ├── SEO settings
  ├── Settings (image processing + privacy + slideshow + alt-text + semantic search)
  ├── Password change
  ├── Users (admin CRUD)
  ├── Database (backup/restore/export)
  ├── Analytics (views by photo/topic/country/referrer/shared-album)
  └── Lightroom Tokens (PAT management)
```

### 13.2 Breadcrumbs
- No explicit breadcrumb component
- "Back" buttons (chevron left) on admin sub-pages provide wayfinding
- Nav active state (`aria-current="page"`) indicates current section

### 13.3 Search
- Global search accessible from nav (Cmd+K / click)
- Semantic search toggle with stub-mode honesty disclaimer
- Tag-based filtering on home page
- Topic-based browsing

---

## 14. Defensive UX Patterns (Cycle 9 Verified)

### 14.1 Settle-Before-Close (DES-R4C14-B)
Used consistently across all destructive dialogs:
- `image-manager.tsx` — Delete dialogs
- `topic-manager.tsx` — Delete topic, delete alias
- `tag-manager.tsx` — Delete tag
- `admin-user-manager.tsx` — Delete user
- `bulk-edit-dialog.tsx` — Close while submitting
- `tokens-client.tsx` — Revoke token dialog

Pattern: `onOpenChange` checks `!isDeleting` before allowing close; `AlertDialogAction` uses `e.preventDefault()` to suppress Radix auto-close; dialog stays open with spinner until action settles.

### 14.2 IME Composition Guards
- `isImeComposingReactEvent(e)` prevents half-composed CJK input from triggering actions
- Used on Enter key handlers in search, tag input, and topic alias input

### 14.3 Unmount Guards
- `mountedRef` in `load-more.tsx` prevents `setState` after unmount
- `cancelled` flag in `settings-client.tsx` backfill status effect
- `backfillMountedRef` in `settings-client.tsx` for timer cleanup (AGG-R7-02)

### 14.4 Client-Side Validation
- Password confirmation match before server action
- Title/description code-point length checks
- Topic selection required in bulk edit
- Image sizes pattern validation (`[0-9]+(\s*,\s*[0-9]+)*`)

---

## 15. UI Primitive Quality (Cycle 9 Verified)

### 15.1 Button (`ui/button.tsx`)
- All size variants floor at >=44px (`min-h-11`, `size-11`, `size-12`)
- Focus-visible ring with 3px width
- `aria-invalid` styling for validation states
- `disabled:pointer-events-none` prevents interaction on disabled buttons
- `asChild` pattern via Radix Slot for flexible composition

### 15.2 Switch (`ui/switch.tsx`)
- 44px touch target via `min-h-11 min-w-11` on Root (AGG-C3-01)
- Visible track is a normally-proportioned pill nested inside the hit area
- Thumb travels full width via `translate-x-full` (not fixed 20px)
- `group-data-[state=checked]` for state-dependent styling

### 15.3 Select (`ui/select.tsx`)
- SelectTrigger with `min-h-11` for both `sm` and `default` sizes
- Scroll up/down buttons for long lists
- Item indicator with CheckIcon
- `aria-invalid` styling consistent with Input

### 15.4 Dialog (`ui/dialog.tsx`)
- Localized close button label from i18n (AGG-M5)
- `max-h-[calc(100dvh-2rem)]` for mobile safety
- `overflow-y-auto` for long content
- Focus management via Radix DialogPrimitive

### 15.5 Alert Dialog (`ui/alert-dialog.tsx`)
- Action button uses `buttonVariants()` (primary style)
- Cancel button uses `buttonVariants({ variant: "outline" })`
- Consistent header/footer layout with `flex-col-reverse` on mobile

### 15.6 Tooltip (`ui/tooltip.tsx`)
- `delayDuration={0}` for immediate feedback
- `sideOffset={4}` for spacing from trigger
- Zoom animation with fade
- `bg-primary text-primary-foreground` for high contrast

### 15.7 Input (`ui/input.tsx`)
- `min-h-11` touch target floor
- `focus-visible:ring-[3px]` for visible focus state
- `aria-invalid` styling for validation errors
- `selection:bg-primary` for text selection color
- `file:` pseudo-class for file input styling

### 15.8 Textarea (`ui/textarea.tsx`)
- `min-h-16` for multi-line input (larger than single-line Input)
- `field-sizing-content` for auto-expanding height
- Same focus ring and aria-invalid styling as Input

---

## 16. Cycle 9 Conclusion

GalleryKit's UI/UX surface remains **exceptionally polished** with no new issues introduced since cycle 8. The codebase has not changed in any UI/UX-relevant way since the cycle 8 review — the intervening commits focused on backend stability (DB connection timeout handling, Argon2 TOCTOU race closure, view-count flush chunking, backfill test flakiness, process-image dimension consistency) and documentation.

The one CSS-related improvement (CSS-01: removing a sub-44px Tailwind safelist value) is a welcome belt-and-braces enhancement that aligns with the touch-target audit philosophy but does not change any runtime behavior.

**Recommendations for future cycles:**
1. Consider implementing dynamic ARIA live regions for swipe gestures (finding 3.2) if touch-screen screen reader usage grows
2. Add a visible zoom-level indicator to `image-zoom.tsx` (finding 3.4) to benefit all users, not just high-contrast users
3. Enhance upload rejection toasts with per-file reasons (finding 3.6) for better batch upload UX
4. Consider adding a subtle drag handle or visual cue to the mobile search overlay (finding 3.3) to reinforce the modal metaphor

**No fixes are required for cycle 9.** The codebase maintains its A-grade UI/UX quality.

---

*Review completed: 2026-06-25*
*Cycle 9 of review-plan-fix loop*
*HEAD: c0522dec*
