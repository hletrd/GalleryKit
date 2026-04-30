# Plan 18: UX & Accessibility Polish — Round 5 ✅ DONE

**Priority:** P1 (item 0), P2 (items 1-5), P3 (items 6-12)
**Estimated effort:** 4-5 hours
**Sources:** Comprehensive Review R5 (H-02, H-03, H-04, M-01, M-03, M-05, M-06, L-01–L-04, L-13, L-15), UX Review R4, Plan 13 carried items

---

## 0. Translate all remaining hardcoded English strings (P1)
**Source:** H-02, H-03, H-04 (R5 review)
**Files:**
- `src/components/image-manager.tsx:124,127,145,148,190,193` — 6 toast.error() calls
- `src/components/optimistic-image.tsx:64` — "Image unavailable"
- `src/app/[locale]/s/[key]/page.tsx:67` — `← ` arrow
- `src/app/[locale]/g/[key]/page.tsx:91,109` — `← ` arrow

**Fix:**
- Add translation keys to `en.json`/`ko.json` for all toast fallbacks
- `image-manager.tsx`: replace `'Failed to delete images'` with `t('imageManager.deleteFailed')`, etc.
- `optimistic-image.tsx`: import `useTranslation` and use `t('common.imageUnavailable')` (key already exists)
- Shared pages: replace `← {siteConfig.title}` with `<ArrowLeft className="h-4 w-4" /> {t('shared.viewGallery')}` (key already exists)

**Verification:**
- [ ] Korean admin sees Korean error toasts
- [ ] Korean shared page shows "갤러리로 돌아가기" instead of "← GalleryKit"
- [ ] Image unavailable text shows in Korean

---

## 1. Update document.title on in-page photo navigation (P2)
**Source:** Plan 13 #2 (carried forward), UX R4 open question #2
**File:** `src/components/photo-viewer.tsx`

When prev/next navigation happens via state change (no page reload), the browser `<title>` doesn't update. Screen readers and browser history get no feedback.

**Fix:**
- Add a `useEffect` in `PhotoViewer` that updates `document.title` when the current image changes:
  ```tsx
  useEffect(() => {
      if (image?.title) {
          document.title = `${image.title} — ${siteConfig.title}`;
      }
  }, [image?.id, image?.title]);
  ```
- Import `siteConfig` from `@/site-config.json` for the suffix
- This is a client-side-only effect — no SSR impact

**Verification:**
- [ ] Browser tab title updates when navigating between photos
- [ ] Title reflects the current image, not the initial one

---

## 2. Add aria-live to LoadMore infinite scroll (P2)
**Source:** Plan 13 #3 (carried forward), UX R4 "What's Missing" #6
**File:** `src/components/load-more.tsx`

When new images load via intersection observer, screen readers get no announcement. Users navigating by keyboard don't know new content appeared.

**Fix:**
- Add an `aria-live="polite"` region that announces loaded count:
  ```tsx
  const [announceText, setAnnounceText] = useState('');
  // In the load-more callback:
  setAnnounceText(t('home.newPhotosLoaded', { count: newImages.length }));
  // Render:
  <div className="sr-only" aria-live="polite" aria-atomic="true">{announceText}</div>
  ```
- Add i18n keys:
  - `en.json`: `"newPhotosLoaded": "{count, plural, one {# new photo loaded} other {# new photos loaded}}"`
  - `ko.json`: `"newPhotosLoaded": "새 사진 {count}장 로드됨"`

**Verification:**
- [ ] Screen reader announces when new images load
- [ ] No visual impact on the layout

---

## 3. Fix InfoBottomSheet side effect in setSheetState updater (P2)
**Source:** M-01 (R5 review)
**File:** `src/components/info-bottom-sheet.tsx:62-78`

`onClose()` is called from within the `setSheetState` updater callback. React's documentation warns that updater functions should be pure and not have side effects.

**Fix:** Move `onClose()` outside the updater. Compute the new state first, then call `onClose()` conditionally after.

---

## 4. Fix PhotoViewer stale showLightbox closure in navigate (P2)
**Source:** M-02 (R5 review)
**File:** `src/components/photo-viewer.tsx:55-72`

The `navigate` callback depends on `showLightbox` for the sessionStorage decision, but the closure can hold a stale value.

**Fix:** Use a ref to track `showLightbox`:
```ts
const showLightboxRef = useRef(showLightbox);
useEffect(() => { showLightboxRef.current = showLightbox; }, [showLightbox]);
// In navigate: if (showLightboxRef.current) { sessionStorage.setItem(...); }
```

---

## 5. Fix lightbox backdrop click should close on touch (P2)
**Source:** M-03 (R5 review)
**File:** `src/components/lightbox.tsx:213-284`

On touch devices, tapping the backdrop only re-shows controls. The user must tap twice to close. The standard UX pattern is close-on-backdrop-tap.

**Fix:** Change `handleBackdropClick` to close the lightbox, or add close-on-backdrop-tap for touch events.

---

## 6. Fix lightbox `f` key handler — add input guard (P2)
**Source:** M-06 (R5 review)
**File:** `src/components/lightbox.tsx:107-129`

The `keydown` listener fires on `f`/`F` without checking whether the user is typing in an input field. The pattern already exists in `search.tsx:62`.

**Fix:** Add `if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;`

---

## 7. Extract duplicated shutter speed formatting (P2)
**Source:** M-05 (R5 review)
**Files:** `src/components/photo-viewer.tsx:333-344`, `src/components/info-bottom-sheet.tsx:109-120`

Shutter speed formatting logic is duplicated nearly verbatim in both files.

**Fix:** Extract into a shared utility function in `lib/image-types.ts`.

---

## 8. Fix histogram hardcoded colors for dark mode (P3)
**Source:** Comprehensive Review (histogram.tsx hardcoded colors)
**File:** `src/components/histogram.tsx:109-137`

Canvas colors are hardcoded: `#d4d4d4` (grid), `#ef4444` (red channel), etc. No dark mode adaptation. On dark theme, the grid lines and labels are invisible.

**Fix:**
- Read the current theme from a CSS variable or context:
  ```ts
  const isDark = document.documentElement.classList.contains('dark');
  const gridColor = isDark ? '#404040' : '#d4d4d4';
  const labelColor = isDark ? '#a3a3a3' : '#525252';
  ```
- Apply colors to the canvas rendering
- RGB channel colors (`#ef4444`, `#22c55e`, `#3b82f6`) are visible on both themes — keep as-is

**Verification:**
- [ ] Histogram grid and labels visible in dark mode
- [ ] No change in light mode appearance

---

## 9. Add `aria-label` to public nav landmark (P3)
**Source:** UX R4 "What's Missing" #3
**File:** `src/components/nav-client.tsx`

Multiple `<nav>` landmarks exist (public + admin). Without `aria-label`, screen readers can't distinguish them. This is already fixed for admin nav but verify public nav.

**Fix:**
- Verify `nav-client.tsx` has `aria-label={t('aria.mainNav')}` — if not, add it
- Verify `footer.tsx` doesn't use a `<nav>` element (if it does, add aria-label)

**Verification:**
- [ ] All `<nav>` elements have unique aria-labels

---

## 10. Fix search results ARIA pattern (P3)
**Source:** UX R4 #2 (minor gap noted)
**File:** `src/components/search.tsx:149-178`

Search results lack `role="listbox"`/`role="option"` ARIA pattern. Keyboard mechanics work but the semantic relationship between input and results isn't announced.

**Fix:**
- Add `role="listbox"` to the results container div
- Add `role="option"` to each result link
- Add `aria-selected` based on `activeIndex`
- Add `aria-controls` and `aria-activedescendant` to the input element:
  ```tsx
  <input
      role="combobox"
      aria-expanded={results.length > 0}
      aria-controls="search-results"
      aria-activedescendant={activeIndex >= 0 ? `search-result-${activeIndex}` : undefined}
  />
  <div id="search-results" role="listbox">
      {results.map((image, i) => (
          <div key={image.id} role="option" id={`search-result-${i}`} aria-selected={i === activeIndex}>
              ...
          </div>
      ))}
  </div>
  ```

**Verification:**
- [ ] Screen reader announces search results as a listbox
- [ ] Active result is announced as selected

---

## 11. Fix `nav-client.tsx` locale handling in clear filter link (P3)
**Source:** UX R4 "Ambiguity Risks"
**File:** `src/components/home-client.tsx:318`

Already fixed per the status check. Verify and close.

**Verification:**
- [ ] Clear filter link includes locale prefix

---

## 12. PhotoViewer sidebar info panel scroll on mobile (P3)
**Source:** Comprehensive Review (photo-viewer.tsx)
**File:** `src/components/photo-viewer.tsx`

On mobile, the info panel (bottom sheet) may have long content that doesn't scroll properly. Verify that the bottom sheet handles overflow correctly with `overflow-y-auto`.

**Fix:**
- If the bottom sheet content doesn't scroll, add `overflow-y-auto` or `overflow-y-scroll` to the content container
- Test with a photo that has many tags + long description

**Verification:**
- [ ] Bottom sheet scrolls on mobile with long content

---

## New low-priority items from R5 review

### L-01: load-more.tsx no error feedback to user (P3)
**File:** `src/components/load-more.tsx:39`
When loading more images fails, the error is only logged to console. Add a toast notification with i18n key.

### L-02: nav-client.tsx theme toggle/locale switcher lack focus indicator (P3)
**File:** `src/components/nav-client.tsx:133-146`
No `focus-visible:ring` on raw elements. Add focus-visible ring classes.

### L-03: info-bottom-sheet.tsx drag handle not keyboard-accessible (P3)
**File:** `src/components/info-bottom-sheet.tsx:152`
No `tabIndex`, `role`, or keyboard event handler. Add `tabIndex={0}` and handle Enter/Space to cycle states.

### L-04: search.tsx active result no visible focus ring (P3)
**File:** `src/components/search.tsx:157`
Active item highlighted only via `bg-muted`. Add `ring-2 ring-ring` for keyboard focus.

### L-05: search.tsx resultRefs array never pruned (P3)
**File:** `src/components/search.tsx:23,154`
Old entries remain when results shrink. Add `useEffect` to trim.
