# Perf Reviewer — Cycle 1 (review-plan-fix loop, 2026-04-25)

## Lens

CSS specificity, layout/paint cost, query plans, render tree size, hydration cost, CLS.

**HEAD:** `8d351f5`
**Cycle:** 1/100

## Findings

### P1-LOW-01 — `skeleton-shimmer` always animates, even with fully-loaded image (LOW, High confidence)

**File/region:** `apps/web/src/components/photo-viewer.tsx:346`, `apps/web/src/app/[locale]/globals.css:88-106`.

**Why a problem:** `skeleton-shimmer::after` runs an infinite `shimmer 1.5s ease-in-out infinite` animation on a 1px-thick gradient layered over the photo container. There is no mechanism to stop the animation once the image has decoded — the pseudo-element keeps scheduling repaints (gradient `background-position` change) for the entire time the photo viewer is open. On mid-tier mobile this causes a small but persistent compositor cost.

**Failure scenario:** On an iPhone SE / Pixel 6a, opening a photo viewer and leaving it idle keeps the GPU compositor warm because the `background-position` keyframes shift every 1500ms. Battery impact is not measurable in casual use, but the animation defeats the loading-affordance purpose because it never completes — the user can't use it as a "loading is done" cue.

The global `prefers-reduced-motion` rule reduces *duration* to 0.01ms but keeps the animation infinite, so the shimmer collapses into a single static frame for users who need reduced motion — that means the loading affordance also disappears for them.

**Suggested fix:** Either:
1. Constrain shimmer to the unloaded state via state-driven className toggle (drop `skeleton-shimmer` when image's `onLoad` fires); or
2. Use `aria-busy` toggle as a CSS hook so shimmer disappears when the photo has loaded.

**Confidence:** High that the persistent animation runs; Medium on actual battery impact.

### P1-LOW-02 — `2xl:columns-5` may overflow card width budget on ultrawide; JS column-count out of sync (LOW, High confidence)

**File/region:** `apps/web/src/components/home-client.tsx:18-43,109,155`.

**Why a problem:** `useColumnCount()` (line 18-39) hard-codes the column count breakpoints: `<1280 → 3`, `≥1280 → 4`. The CSS now has a 5-column variant at `2xl` (`≥1536px`), but the JS column-count *for above-the-fold image priority* still says 4. Result: at 2560px width, the gallery has 5 visual columns but only the first 4 photos are flagged `fetchPriority="high"` / `loading="eager"`. The 5th visible above-the-fold photo loads lazily and pops in, undoing the optimization.

**Failure scenario:** First-paint LCP on widescreen is the 5th photo, but it loads `loading="lazy"` so it shows blur first → measurable CLS jitter and slower LCP on a 2xl viewport.

**Suggested fix:** Update `useColumnCount` to mirror Tailwind:

```ts
if (w < 640) setCount(1);
else if (w < 768) setCount(2);
else if (w < 1280) setCount(3);
else if (w < 1536) setCount(4);
else setCount(5);
```

**Confidence:** High that the JS/CSS mismatch exists; Medium on user-impact frequency.

### P1-INFO-01 — `displayTags` and `displayTitle` recompute `.replace(/_/g, ' ')` on every render (informational)

**File/region:** `apps/web/src/components/home-client.tsx:122,160`.

**Why informational:** The replacement is a single short regex on a short string. Calling it inside the `.map` over `orderedImages` adds N regex evaluations per render where N = `images.length`. For a 30-image first page that's 30 regex calls per re-render. Negligible cost.

If the underscore normalization is folded into the `getPhotoDisplayTitleFromTagNames` helper, the single-source-of-truth refactor is also a slight perf win because each helper call is one regex pass instead of two chained calls in the consumer.

**Confidence:** High that the cost is negligible.

### P1-INFO-02 — Login form re-renders on `showPassword` toggle (informational)

**File/region:** `apps/web/src/app/[locale]/admin/login-form.tsx:26`.

**Why informational:** Toggling `showPassword` re-renders the form, including the `<Input>`. Native browsers preserve the value across `type` flips (verified). React `Input` does not unmount; only the `type` attribute changes. No measurable cost.

**Confidence:** High.

### P1-INFO-03 — `Promise.all` in `not-found.tsx` parallelizes three async calls (informational)

**File/region:** `apps/web/src/app/[locale]/not-found.tsx:13-17`.

**Why informational:** Net-new wins of ~2-3ms per 404. Good change.

**Confidence:** High.

### P1-INFO-04 — `<Nav />` and `<Footer />` add cached DB queries to 404 path (informational)

**File/region:** `apps/web/src/app/[locale]/not-found.tsx:24,51`.

**Why informational:** `<Nav />` calls `getTopicsCached()`, `getSeoSettings()`, `getGalleryConfig()`. `<Footer />` calls `getLocale()`, `getTranslations`. All cached via `React.cache()`. On a per-request basis these are single-DB-hit-then-cached. On a 404-storm scenario (broken-link crawler), each request is a fresh cache miss → a real DB query.

In practice the cache misses hit MySQL with simple indexed queries that complete in ms. Worth monitoring but not blocking.

**Confidence:** High.

## Regression scan

- **Hydration cost:** Login form gains 1 piece of state and 1 button. Negligible. Search/Nav buttons gain only width/height utilities. Negligible.
- **CSS bundle size:** New utility classes (`focus-visible:outline-blue-500`, `dark:focus-visible:outline-blue-400`, `min-w-[44px]`, etc.) are emitted once; Tailwind JIT pruning ensures bundle growth is constant. Negligible.
- **JSON-LD payload size:** Unchanged.
- **Skeleton shimmer cost:** see P1-LOW-01.

## Confidence

High overall.

## Recommendation

P1-LOW-01 (shimmer never stops) and P1-LOW-02 (column-count mismatch) are worth scheduling. Both are mechanical, low-risk fixes.
