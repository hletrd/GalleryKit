# Plan 121 — Cycle 12 Round 2 Fixes (C12R2-01, C12R2-04)

**Created:** 2026-04-19 (Cycle 12, Round 2)
**Status:** IN PROGRESS

---

## C12R2-01: Hardcoded image sizes in client components diverge from admin-configured sizes [MEDIUM]

### Problem
Client components hardcode `[640, 1536, 2048, 4096]` for srcSet generation and `_1536` for OG images. If admin changes `image_sizes` setting, all frontend image requests will 404 because the generated variants use different size suffixes.

### Implementation

#### Step 1: Export `imageSizes` from gallery-config-shared.ts
- Add a `GALLERY_IMAGE_SIZES` constant to `gallery-config-shared.ts` that matches the default `"640,1536,2048,4096"` string
- This gives client components a safe default without DB access

#### Step 2: Pass configured imageSizes to client components via page props
- In each page component that renders image-displaying components, read `getGalleryConfig().imageSizes` on the server and pass as a prop
- Pages: `page.tsx` (home), `p/[id]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`

#### Step 3: Update client components to use dynamic sizes
- `photo-viewer.tsx`: Accept `imageSizes` prop, use it instead of hardcoded `[640, 1536, 2048, 4096]`
- `lightbox.tsx`: Accept `imageSizes` prop, use it instead of hardcoded array
- `home-client.tsx`: Accept `imageSizes` prop, use it for srcSet generation
- For the "small image" srcSet (home-client masonry grid), use the two smallest sizes from the config

#### Step 4: Fix OG metadata to use dynamic sizes
- In server-side `generateMetadata` functions, read `getGalleryConfig().imageSizes` and pick the size closest to 1536 for OG images
- Use a helper like `findNearestSize(sizes, targetSize)` to find the best match

#### Step 5: Update the `g/[key]/page.tsx` gallery grid image
- The `Image` component in the gallery grid view uses hardcoded `_1536.webp` — change to use nearest configured size

### Files to modify
- `apps/web/src/lib/gallery-config-shared.ts` — add default sizes constant
- `apps/web/src/components/photo-viewer.tsx` — accept imageSizes prop
- `apps/web/src/components/lightbox.tsx` — accept imageSizes prop
- `apps/web/src/components/home-client.tsx` — accept imageSizes prop
- `apps/web/src/app/[locale]/(public)/page.tsx` — pass imageSizes
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` — pass imageSizes
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` — pass imageSizes, fix OG
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` — pass imageSizes, fix OG

---

## C12R2-04: Share rate limit TOCTOU [MEDIUM]

### Problem
`checkShareRateLimit` in `sharing.ts` uses in-memory-only rate limiting with no DB-backed persistence. Concurrent requests from the same IP can both pass the in-memory check before either increments, allowing burst share creation that exceeds the limit. This is the same TOCTOU pattern fixed for login (A-01) and createAdminUser (C11R2-02).

### Implementation

#### Step 1: Add DB-backed rate limiting to `createPhotoShareLink`
- Before the share creation logic, call `incrementRateLimit(ip, 'share_photo', SHARE_RATE_LIMIT_WINDOW_MS)` (pre-increment)
- Then call `checkRateLimit(ip, 'share_photo', SHARE_MAX_PER_WINDOW, SHARE_RATE_LIMIT_WINDOW_MS)`
- If DB-limited, return error
- Wrap in try-catch so DB unavailability falls back to in-memory check

#### Step 2: Add DB-backed rate limiting to `createGroupShareLink`
- Same pattern as Step 1, using `'share_group'` bucket type

#### Step 3: Keep in-memory `checkShareRateLimit` as fast-path cache
- The in-memory Map serves as a fast-path cache (same as login pattern)
- Keep the existing `checkShareRateLimit` function but restructure to pre-increment before checking
- The DB is the source of truth for accuracy across restarts

### Files to modify
- `apps/web/src/app/actions/sharing.ts` — add DB-backed rate limiting with pre-increment

---

## Deferred This Cycle

### C12R2-03: dumpDatabase stderr may leak credentials in logs [LOW] [MEDIUM confidence]
- **File+line:** `apps/web/src/app/[locale]/admin/db-actions.ts:142,331`
- **Original severity:** LOW, confidence MEDIUM
- **Reason for deferral:** Requires a MySQL misconfiguration to trigger. The admin is already authenticated. Log sanitization would reduce diagnostic value. Low risk since production MySQL errors rarely include passwords in stderr.
- **Exit criterion:** If DB credentials are ever found in production logs, this must be re-opened.

### C12R2-06: shareRateLimit has no DB persistence [LOW] [LOW confidence]
- **File+line:** `apps/web/src/app/actions/sharing.ts:22`
- **Original severity:** LOW, confidence LOW
- **Reason for deferral:** Share creation requires admin auth. The rate limit is defense-in-depth against accidental bulk creation, not security-critical. C12R2-04 addresses the TOCTOU issue which is more impactful. Adding full DB persistence for share rate limits adds complexity without proportional benefit.
- **Exit criterion:** If share operations become available to non-admin users, this must be re-opened.
