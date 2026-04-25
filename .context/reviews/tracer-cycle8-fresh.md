# Tracer — Cycle 8 (Fresh, broad sweep)

**Scope:** trace cross-file flows for novel risk patterns identified this cycle.

## Trace 1: A social share unfurl on Twitter for a deep-linked photo

1. Twitterbot fetches `/p/123` → `app/[locale]/(public)/p/[id]/page.tsx` `generateMetadata` runs.
2. Metadata returns `openGraph.images = [{url: "https://gallery.atik.kr/uploads/jpeg/{filename}_1536.jpg", ...}]` (NOT `/api/og`). The OG URL points at the static processed JPEG. **OK — no /api/og hit for photo pages.**
3. Twitterbot fetches the static JPEG → `serve-upload.ts` returns it with `Cache-Control: public, max-age=31536000, immutable`. **Optimal.**

**Result:** The photo page is fine. No /api/og bottleneck.

## Trace 2: A social share unfurl on Twitter for a topic page

1. Twitterbot fetches `/{topic}` → `app/[locale]/(public)/[topic]/page.tsx` `generateMetadata` runs.
2. If `seo.og_image_url` is NOT set (default), metadata sets `openGraph.images = [{url: "${seo.url}/api/og?topic=...&tags=...", ...}]`.
3. Twitterbot fetches `/api/og?topic=...&tags=...`.
4. `app/api/og/route.tsx` GET handler runs:
   - Validates `topic` slug.
   - `getTopicBySlug(topic)` → DB hit.
   - `clampDisplayText(topicLabel, 100)` → CPU.
   - `ImageResponse(<JSX>, {width: 1200, height: 630, headers: {Cache-Control: 'no-store, no-cache, must-revalidate'}})` → React-tree → SVG → PNG via WASM resvg.
5. **Cache-Control is `no-store`.** Twitterbot does not cache. The next user who shares the same topic triggers the same path again.

**Bottleneck:** CPU-bound regeneration on every fetch. Affects topic and gallery-root shares. Personal photos are unaffected (Trace 1).

**Recommendation:** `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` on the success branch.

## Trace 3: A new admin uploads 100 photos in one batch

1. Client sends FormData with 100 files via `uploadImages()` server action.
2. `uploadImages` validates: file count, total bytes, tagsString length, topic format, disk space.
3. `acquireUploadProcessingContractLock()` — process-local mutex, prevents concurrent settings change races.
4. `pruneUploadTracker()` → cleans expired entries.
5. `tracker.bytes += totalSize; tracker.count += files.length` → cumulative budget check.
6. For each file:
   - `saveOriginalAndGetMetadata(file)` — streams to disk (200MB max), reads metadata via Sharp.
   - `extractExifForDb(...)` — parses EXIF, applies GPS strip if configured.
   - `cleanupOriginalIfRestoreMaintenanceBegan(...)` — late maintenance check.
   - `db.insert(images)` — single row.
   - Tag processing — `ensureTagRecord` with collision detection per tag.
   - `enqueueImageProcessing(...)` — fire-and-forget into PQueue.
7. After loop: `settleUploadTrackerClaim` reconciles partial successes.
8. `revalidateLocalizedPaths('/', '/admin/dashboard', '/${topic}')`.

**Observed flows:**

- DB inserts are sequential in the for-loop. With 100 files, that's ~100 sequential round-trips. Could be batched. Personal-scale gallery: not material.
- `enqueueImageProcessing` fires AVIF+WebP+JPEG generation in parallel (Promise.all inside `processImageFormats`) but workers respect Sharp's concurrency cap.
- `settleUploadTrackerClaim` runs in success and failure branches; well-handled.

**No fresh issue surfaced.**

## Trace 4: A crawler hits /sitemap.xml

1. `app/sitemap.ts` runs.
2. `force-dynamic` disables Next caching.
3. `revalidate = 3600` is dead code (overridden by force-dynamic).
4. `getTopics()` → DB.
5. `getImageIdsForSitemap(imageBudget)` → DB scan up to ~24k IDs (50k cap with locale doubling).
6. Build URL list.

**Bottleneck:** Every crawler hit triggers this. Googlebot for a fresh content discovery can hit the sitemap several times per minute.

**Recommendation:** drop `force-dynamic` so the existing `revalidate = 3600` actually takes effect.

## Trace 5: A user changes their password

1. `updatePassword` validates fields BEFORE rate-limit pre-increment (AGG9R-RPL-01).
2. Pre-increments rate-limit (in-mem + DB).
3. `argon2.verify` against current password.
4. `argon2.hash(newPassword)`.
5. Transaction: update password_hash, delete ALL sessions for this user, insert new session for current browser.
6. Set new cookie.
7. Clear rate-limit bucket AFTER transaction commit (C1R-02).

**No fresh issue.** The flow is robust.

## Cross-flow observations

- The `/api/og` flow is the only public unauthenticated CPU-bound flow without rate limiting. Every other public flow has guards.
- The sitemap flow has a stale config that operators will misread.
- All upload, auth, and restore flows are well-guarded with no traceable defects.
