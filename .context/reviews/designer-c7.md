# UI/UX & Design Review — Cycle 7

## Summary

The public gallery presents a clean, accessible masonry grid with thoughtful loading states. A few UX gaps remain in admin surfaces and edge-case handling.

---

## C7-UI-01: `image-manager.tsx` edit dialog `maxLength` discrepancy for emoji — Medium

**File:** `apps/web/src/components/image-manager.tsx`
**Lines:** 496-500

**Finding:** As noted in C7-MED-03, the browser's `maxLength` attribute counts UTF-16 code units while server-side validation counts Unicode code points. Users pasting emoji into the title field see premature truncation/blocking. For a photo gallery where titles might legitimately contain emoji (camera icons, flags), this is a real UX friction.

**Fix:** Replace native `maxLength` with a custom `onChange` handler that counts code points using `countCodePoints` (already in `lib/utils.ts`) and shows a character counter. This also improves UX by making the limit visible.

**Confidence:** Medium

---

## C7-UI-02: OG image fallback redirects to homepage instead of showing a branded placeholder — Low

**File:** `apps/web/src/app/api/og/photo/[id]/route.tsx`
**Lines:** 188-212

**Finding:** When an OG image cannot be generated (photo missing, not processed, fetch failure), the response is a 302 redirect to the site root or the configured fallback OG image. This means social platforms receive NO image for that URL, which looks broken in share previews. A branded "image unavailable" placeholder would be better UX.

**Fix:** Generate a static fallback OG image (site logo + "Photo unavailable" text) and return it as a 200 with the same cache headers, instead of 302-redirecting.

**Confidence:** Low

---

## C7-UI-03: Service Worker stale-while-revalidate for images may show outdated EXIF-derived metadata — Low

**File:** `apps/web/src/public/sw.js`
**Lines:** 110-136

**Finding:** The SW serves cached image derivatives immediately while revalidating in the background. If an admin updates an image's EXIF data (re-processing with different settings), the browser still shows the old derivative from cache. The user must hard-refresh or wait for the LRU eviction. There is no cache-busting mechanism tied to the image pipeline version.

**Fix:** Include the `IMAGE_PIPELINE_VERSION` (from `process-image.ts`) in the derivative URL or as a query parameter, so pipeline changes invalidate the SW cache automatically. Alternatively, purge the image cache for specific URLs after re-processing.

**Confidence:** Low

---

## C7-UI-04: Health endpoint JSON lacks human-readable status field — Low

**File:** `apps/web/src/app/api/health/route.ts`

**Finding:** The health endpoint returns structured JSON but the status is implicit from HTTP code and individual boolean flags. A monitoring dashboard or load balancer might want a single `"status": "healthy" | "degraded" | "unhealthy"` field.

**Fix:** Add a top-level `status` string derived from the component health checks.

**Confidence:** Low
