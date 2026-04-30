# Plan 06: Accessibility & Internationalization

**Priority:** P1 (items 1-3 — WCAG failures), P2 (items 4-12)  
**Estimated effort:** 6-8 hours  
**Sources:** UX C1/C2/C3/M1/M2/M3/M5/M6/m1-m13

---

## P1 — Critical (WCAG 2.1 AA Failures)

### 1. Tag filter badges keyboard accessible
**Source:** UX C1  
**File:** `apps/web/src/components/tag-filter.tsx:47-68`
- Replace `<Badge>` (renders as `<span>`) with `<button>` for clickable tags
- Or add `role="button"`, `tabIndex={0}`, `onKeyDown` handler:
```tsx
<Badge
    role="button"
    tabIndex={0}
    onClick={() => toggleTag(tag.slug)}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTag(tag.slug); } }}
>
```

### 2. Search dialog focus trap
**Source:** UX C2  
**File:** `apps/web/src/components/search.tsx:99-176`
- Add `focus-trap-react` dependency
- Wrap search panel content in `<FocusTrap active={isOpen}>`
- Restore focus to trigger button on close:
```tsx
const triggerRef = useRef<HTMLButtonElement>(null);
// on close: triggerRef.current?.focus();
```

### 3. Lightbox focus trap
**Source:** UX C3  
**File:** `apps/web/src/components/lightbox.tsx:142-250`
- Wrap lightbox content in `<FocusTrap>`
- Or use Radix Dialog which has built-in focus management

---

## P2 — Major / Minor

### 4. Internationalize 30+ hardcoded English strings
**Source:** UX M1  
**Files:** Multiple components and pages (see UX review for full list)
- Add all missing keys to `messages/en.json` and `messages/ko.json`
- Replace hardcoded strings with `t()` calls
- Key areas:
  - `photo-viewer.tsx` — 'Photo', 'Unknown' fallbacks
  - `home-client.tsx` — 'Photo', 'Untitled' fallbacks
  - `info-bottom-sheet.tsx` — 'Unknown' fallback
  - `optimistic-image.tsx` — 'Image unavailable'
  - `histogram.tsx` — 'Histogram', 'Loading...', 'Expand/Collapse'
  - `image-manager.tsx` — error messages, placeholders
  - `g/[key]/page.tsx` — entire page (zero i18n currently)
  - `p/[id]/page.tsx` — 'Photo Not Found', 'Untitled'
  - `s/[key]/page.tsx` — 'Photo Not Found', 'Shared Photo'

### 5. Internationalize all aria-labels
**Source:** UX M2  
**Files:** 13+ components with hardcoded English aria-labels
- Replace all `aria-label="Search photos"` etc. with `aria-label={t('aria.searchPhotos')}`
- Add corresponding keys to both message files

### 6. Fix scrollbar-hide CSS class mismatch
**Source:** UX M3, Code M-04  
**Files:**
- `apps/web/src/app/[locale]/globals.css` — add:
```css
@layer utilities {
    .scrollbar-hide::-webkit-scrollbar { display: none; }
    .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
}
```
- `apps/web/src/components/nav-client.tsx` — remove `<style jsx global>` block

### 7. Shared group page i18n (`/g/[key]`)
**Source:** UX M5  
**File:** `apps/web/src/app/[locale]/g/[key]/page.tsx`
- Import `getTranslations` from `next-intl/server`
- Replace all hardcoded strings: 'Shared Photos', 'No images in this group.', etc.
- Add keys to both message files

### 8. Hide pin button on mobile
**Source:** UX M6  
**File:** `apps/web/src/components/photo-viewer.tsx:131-146`
- Add `hidden lg:flex` to the pin/unpin button so it's only visible on desktop where the sidebar renders

### 9. Add `aria-expanded` to nav expand button
**Source:** UX m8  
**File:** `apps/web/src/components/nav-client.tsx:104-117`
- Add `aria-expanded={isExpanded}` to the expand/collapse button

### 10. Fix `bg-gray-100` in shared group grid
**Source:** UX m9  
**File:** `apps/web/src/app/[locale]/g/[key]/page.tsx:125`
- Replace `bg-gray-100` with `bg-muted/20` for dark mode compatibility

### 11. Fix Korean `backTo` translation missing `{topic}` variable
**Source:** UX m11  
**File:** `apps/web/messages/ko.json`
- Change `"backTo": "돌아가기"` to `"backTo": "{topic}(으)로 돌아가기"`

### 12. Increase touch target sizes
**Source:** UX accessibility  
**Files:**
- Theme toggle button — increase from `p-2` (32px) to `p-2.5` or `min-w-[44px] min-h-[44px]`
- Locale switcher — increase padding
- Histogram cycle button — increase text size and padding
- Nav expand chevron — increase from `p-2` to larger target

---

## Verification
- [ ] Tab through tag filter — all tags reachable and activatable with Enter/Space
- [ ] Tab through search overlay — focus stays trapped within dialog
- [ ] Tab through lightbox — focus stays trapped within dialog
- [ ] Switch to Korean locale — no English strings visible in UI
- [ ] Screen reader (VoiceOver) — all aria-labels announced in Korean on /ko pages
- [ ] Horizontal scrollbar hidden on mobile nav
- [ ] Shared group page fully translated at `/ko/g/[key]`
- [ ] Dark mode: no light-gray patches on shared group page
