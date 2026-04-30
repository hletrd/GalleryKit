# Plan 23: Performance Fixes — Round 6 ✅ DONE (font subsetting deferred)

**Priority:** P1 (item 0), P2 (items 1-3), P3 (items 4-6)
**Estimated effort:** 3-4 hours
**Sources:** Comprehensive Review R6 (H-08, M-14, M-15, M-16, M-17, M-18, L-02, L-10, L-11)

---

## 0. Remove full node_modules copy from Docker image (P1)
**Source:** H-08 (R6 review)
**File:** `Dockerfile:57`
**Confidence:** HIGH

The standalone output already bundles dependencies, but the full `node_modules` is also copied. Duplicate packages add 150-250MB to the image.

**Fix:**
- Remove the full `node_modules` copy line
- Only copy specific packages needed for `migrate.js` (drizzle-orm, mysql2):
  ```dockerfile
  COPY --from=builder /app/apps/web/node_modules/.package-lock.json ./node_modules/ 2>/dev/null || true
  # Copy only required packages for migration
  COPY --from=builder /app/apps/web/node_modules/drizzle-orm ./node_modules/drizzle-orm/
  COPY --from=builder /app/apps/web/node_modules/mysql2 ./node_modules/mysql2/
  COPY --from=builder /app/apps/web/node_modules/drizzle-orm/node_modules ./node_modules/drizzle-orm/node_modules/ 2>/dev/null || true
  ```
- Or use a separate migration stage that includes only what's needed
- Test that `migrate.js` still runs correctly in the container

**Verification:**
- [ ] Docker image size reduced by 150-250MB
- [ ] `docker compose up` still starts correctly
- [ ] DB migrations still run on container start
- [ ] Build passes

---

## 1. Subset Pretendard font to Korean + Latin (P2)
**Source:** M-14 (R6 review)
**File:** `public/fonts/PretendardVariable.woff2`
**Confidence:** HIGH

Pretendard Variable font is 2.0MB — no subsetting applied. Korean-only gallery only needs Hangul + Latin (~400-600KB). Also lacks cache-busting query parameter.

**Fix:**
- Use `pyftsubset` to subset to Korean + Latin:
  ```bash
  pyftsubset PretendardVariable.woff2 \
      --output-file=PretendardVariable.woff2 \
      --layout-features='*' \
      --unicodes='U+0000-00FF,U+1100-11FF,U+3130-318F,U+A960-A97F,U+AC00-D7AF,U+D7B0-D7FF' \
      --flavor=woff2
  ```
- Add `?v=1` cache-bust query to the `@font-face` src URL in `globals.css`:
  ```css
  src: url('/fonts/PretendardVariable.woff2?v=1') format('woff2');
  ```
- Update `?v` on any future font changes

**Verification:**
- [ ] Font file size reduced to ~400-600KB
- [ ] Korean and Latin characters render correctly
- [ ] No missing glyphs
- [ ] Cache-bust query parameter present

---

## 2. Memoize displayTags computation in home-client.tsx (P2)
**Source:** M-15 (R6 review)
**File:** `src/components/home-client.tsx:175-178`
**Confidence:** LOW

O(N*M) without `useMemo`. Negligible at current scale but worth fixing.

**Fix:**
```tsx
const displayTags = useMemo(() => {
    if (!tags?.length) return [];
    return tags.filter(tag => tag.image_count > 0);
}, [tags]);
```

**Verification:**
- [ ] Tags computed only when `tags` reference changes
- [ ] No visual change
- [ ] Build passes

---

## 3. Fix getSharedGroup fire-and-forget view count pool exhaustion (P2)
**Source:** M-16 (R6 review)
**File:** `src/lib/data.ts:379-383`
**Confidence:** MEDIUM

Under load, concurrent `view_count` updates could exhaust the 10-connection pool.

**Fix:**
- Batch/debounce view count updates:
  ```ts
  // Simple debounce: accumulate updates and flush periodically
  let viewCountBuffer = new Map<number, number>(); // imageId -> count
  let flushTimeout: NodeJS.Timeout | null = null;

  function bufferViewCount(id: number) {
      viewCountBuffer.set(id, (viewCountBuffer.get(id) ?? 0) + 1);
      if (!flushTimeout) {
          flushTimeout = setTimeout(flushViewCounts, 5000);
      }
  }

  async function flushViewCounts() {
      flushTimeout = null;
      const batch = new Map(viewCountBuffer);
      viewCountBuffer.clear();
      for (const [id, count] of batch) {
          await db.update(images)
              .set({ view_count: sql`${images.view_count} + ${count}` })
              .where(eq(images.id, id))
              .catch(console.debug);
      }
  }
  ```
- Or simpler: use a single connection from the pool with `Promise.resolve().then()` to avoid concurrent queries

**Verification:**
- [ ] View count still increments correctly
- [ ] No connection pool exhaustion under load
- [ ] Build passes

---

## 4. Reduce revalidateLocalizedPaths O(N) locale duplication (P3)
**Source:** M-17 (R6 review)
**File:** `src/lib/revalidation.ts:28-38`
**Confidence:** MEDIUM

Every mutation invalidates 2x ISR entries (en + ko). With 2 locales this is manageable but pattern is O(N) in locale count.

**Fix:**
- Low priority with only 2 locales. No action needed unless more locales are added.
- If scaling is needed: use `revalidatePath()` without locale prefix and let Next.js handle locale variants, or batch revalidations.

**Verification:**
- [ ] Document the O(N) behavior with a comment
- [ ] No regression in cache invalidation

---

## 5. Parallelize sequential awaits in topic page (P3)
**Source:** M-18 (R6 review)
**File:** `src/app/[locale]/[topic]/page.tsx:86-98`
**Confidence:** MEDIUM

3 sequential async barriers when 2 would suffice. Adds ~5-15ms latency per topic page.

**Fix:**
- Identify which queries are independent and wrap them in `Promise.all`:
  ```ts
  const [images, topic] = await Promise.all([
      getImagesByTopic(slug, page),
      getTopicBySlug(slug),
  ]);
  // Then the dependent query:
  const tags = await getTagsForTopic(topic.id);
  ```

**Verification:**
- [ ] Topic page renders correctly
- [ ] Latency reduced by ~5-15ms
- [ ] Build passes

---

## 6. Extract inline srcSet computations into useMemo (P3)
**Source:** L-02 (R6 review)
**Files:** `photo-viewer.tsx:219-267`, `lightbox.tsx:140-153`
**Confidence:** LOW

srcSet string construction recomputed on every render.

**Fix:**
```tsx
const srcSet = useMemo(() => buildSrcSet(image), [image.id, image.filename_webp]);
```

**Verification:**
- [ ] No recomputation on unrelated re-renders
- [ ] Image display unchanged
- [ ] Build passes

---

## 7. Consider lazy-loading focus-trap-react (P3)
**Source:** L-10 (R6 review)
**Files:** `search.tsx:6`, `lightbox.tsx:4`, `info-bottom-sheet.tsx:4`
**Confidence:** MEDIUM

`focus-trap-react` imported unconditionally in 3 components — ~15KB to client bundle.

**Fix:**
- Create a shared lazy wrapper:
  ```tsx
  // components/focus-trap-lazy.tsx
  import dynamic from 'next/dynamic';
  export const FocusTrap = dynamic(() => import('focus-trap-react'), { ssr: false });
  ```
- Or use a lightweight custom implementation for simple cases

**Verification:**
- [ ] Client bundle size reduced by ~15KB
- [ ] Focus trap still works in all 3 components
- [ ] No layout shift on lazy load

---

## 8. Throttle HomeClient scroll handler (P3)
**Source:** L-11 (R6 review)
**File:** `src/components/home-client.tsx:161-166`
**Confidence:** LOW

Scroll handler fires on every scroll event without throttle.

**Fix:**
- Add threshold check to avoid unnecessary state updates:
  ```ts
  setShowBackToTop(prev => prev === shouldShow ? prev : shouldShow);
  ```
- This avoids re-renders when state hasn't actually changed

**Verification:**
- [ ] Back-to-top button appears/disappears correctly
- [ ] No unnecessary re-renders during scroll
- [ ] Build passes

---

## Priority Order

1. Item 0 — Docker image bloat (150-250MB waste)
2. Item 1 — Font subsetting (2MB → ~500KB)
3. Item 2 — displayTags memoization
4. Item 3 — View count pool protection
5. Items 4-8 — Lower priority performance items
