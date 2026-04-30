# Plan 17: Performance Fixes — Round 5 ✅ PARTIAL (batch tag action deferred)

**Priority:** P1 (item 1), P2 (items 2-3), P3 (items 4-5)
**Estimated effort:** 3-4 hours
**Sources:** Performance R5 (P1-001, P1-003, P2-006, P3-004), Comprehensive Review 2026-04-17

---

## 1. Create batch tag update server action (P1)
**Source:** Performance P1-001
**File:** `src/components/image-manager.tsx:328-352`

Tag add/remove runs N serial server action round-trips. Each is: auth check → DB query → revalidation → response. 4 tag changes = 200-400ms blocking UI.

**Fix:**
- Create `batchUpdateImageTags(imageId: string, addTagNames: string[], removeTagNames: string[])` in `actions/tags.ts`
- Single auth check, single revalidation at the end
- Process adds and removes in a transaction:
  ```ts
  export async function batchUpdateImageTags(
      imageId: string,
      addTagNames: string[],
      removeTagNames: string[],
  ): Promise<ActionResult<{ added: number; removed: number; warnings: string[] }>> {
          if (!(await isAdmin())) return { success: false, error: 'Unauthorized' };

          const added = [];
          const warnings = [];
          for (const name of addTagNames) {
              // reuse existing addTagToImage logic but without individual auth/revalidation
              const result = await addTagToImageInternal(imageId, name);
              if (result.success) added.push(result.tagId);
              else warnings.push(result.warning ?? result.error);
          }

          for (const name of removeTagNames) {
              await removeTagFromImageInternal(imageId, name);
          }

          revalidateLocalizedPaths(`/p/${imageId}`, '/admin/dashboard');
          return { success: true, data: { added: added.length, removed: removeTagNames.length, warnings } };
      }
  ```
- Refactor existing `addTagToImage`/`removeTagFromImage` to delegate to internal functions
- Update `image-manager.tsx` to call the batch action once instead of looping

**Verification:**
- [ ] 4 tag changes complete in ~50-100ms (single round-trip)
- [ ] Existing tag add/remove behavior unchanged
- [ ] Build passes

---

## 2. Fix ImageZoom transition lag during pan (P2)
**Source:** Performance P3-004
**File:** `src/components/image-zoom.tsx:132-133`

CSS `transition-transform duration-300 ease-out` is conditionally removed when zoomed, but the initial zoom activation still animates through the 300ms transition. During pan, the image "floats" behind the cursor.

**Fix:**
- Ensure transition is disabled immediately on zoom activation:
  ```tsx
  className={cn(
      "w-full h-full",
      isZoomed ? "" : "transition-transform duration-300 ease-out"
  )}
  style={{
      transform: `scale(${zoomLevel}) translate(${x / zoomLevel}%, ${y / zoomLevel}%)`,
      transition: isZoomed ? 'none' : undefined,
  }}
  ```
- The inline `style.transition: 'none'` overrides the CSS class transition immediately
- When not zoomed, `undefined` lets the CSS class control the transition

**Verification:**
- [ ] Zoom toggle still has smooth transition
- [ ] Panning while zoomed is instant (no 300ms lag)
- [ ] No visual glitches on zoom in/out

---

## 3. Self-host Pretendard font (P2)
**Source:** Performance P2-006
**File:** `src/app/[locale]/layout.tsx:99-109`

Font loads from CDN (cdn.jsdelivr.net). Render-blocking even with the media hack. CDN outage causes FOIT.

**Fix:**
- Download Pretendard WOFF2 subset files to `public/fonts/`
- Add `@font-face` declarations in `globals.css`:
  ```css
  @font-face {
      font-family: 'Pretendard';
      src: url('/fonts/PretendardVariable.woff2') format('woff2');
      font-weight: 45 920;
      font-style: normal;
      font-display: swap;
  }
  ```
- Remove both `<link>` tags from `layout.tsx`
- Update CSP `font-src` to remove `cdn.jsdelivr.net`, add `'self'`
- `font-display: swap` eliminates render-blocking entirely

**Verification:**
- [ ] No external font requests on page load
- [ ] FCP improved (no CDN latency)
- [ ] Korean text renders correctly with self-hosted font
- [ ] CSP font-src is `'self'` only

---

## 4. Fix admin loading.tsx accessibility (P3)
**Source:** Plan 11 #12 (carried forward)
**File:** `src/app/[locale]/admin/(protected)/loading.tsx`

Admin loading spinner has no `role` or `aria-label`. Screen readers see nothing.

**Fix:**
- Add `role="status"` and `aria-label` to the spinner div:
  ```tsx
  <div role="status" aria-label={t('common.loading')} className="...">
  ```
- Match the public `loading.tsx` pattern which already has these attributes

**Verification:**
- [ ] Screen readers announce "Loading" on admin page transitions

---

## 5. Fix SSR column count flash (P3)
**Source:** Plan 13 #4 (carried forward)
**File:** `src/components/home-client.tsx:83`

`useState(4)` as default column count causes layout shift on mobile (4 → 1 after hydration).

**Fix:**
- Change default from 4 to 2 as a compromise:
  ```ts
  const [columnCount, setColumnCount] = useState(2);
  ```
- 2 columns is closer to the median viewport and produces less CLS
- The `useEffect` quickly corrects to the actual count on mount
- Alternative: use CSS `@container` queries (if browser support is sufficient) to avoid JS-based column counting entirely

**Verification:**
- [ ] Mobile page shows ~2 columns on first render (no 4→1 flash)
- [ ] Desktop still shows 4 columns after hydration
