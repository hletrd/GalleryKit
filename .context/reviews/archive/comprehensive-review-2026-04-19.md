# Comprehensive Code Review — 2026-04-19

**Scope:** Full repository — apps/web/src, scripts, config, translations, tests
**Methodology:** File-by-file inspection with cross-file interaction analysis
**Reviewer:** Claude Code (automated)

---

## Summary

The codebase is mature and well-structured. Security hardening is thorough (Argon2, HMAC sessions, path traversal prevention, SQL injection guards, rate limiting). However, this review identified **8 confirmed issues**, **5 likely issues**, and **4 risks** across security, correctness, data integrity, and maintainability.

---

## CONFIRMED ISSUES

### C-01: `original_file_size` bigint can overflow JavaScript Number
**File:** `apps/web/src/db/schema.ts:50`
**Confidence:** High

```ts
original_file_size: bigint('original_file_size', { mode: 'number' }),
```

`{ mode: 'number' }` converts MySQL BIGINT to JavaScript `number`, but `number` loses precision above 2^53 (~9 PB). While this is unlikely for a single file, the field represents bytes and Drizzle will silently truncate large values. The display code at `photo-viewer.tsx:405` divides by `1024*1024` and calls `.toFixed(1)`, which can produce incorrect results for files >8 PiB or for values that lost precision during the number conversion.

More practically, `rate-limit.ts:138` has the same issue with `bucketStart`, but since it's a Unix timestamp in seconds, it won't exceed 2^31 until 2038.

**Fix:** For `original_file_size`, either use `{ mode: 'bigint' }` and format as a string, or validate that values fit within `Number.MAX_SAFE_INTEGER` at the application boundary.

---

### C-02: `getImageByShareKey` does not include `tags` in select — tags always empty
**File:** `apps/web/src/lib/data.ts:360-397`
**Confidence:** High

```ts
export async function getImageByShareKey(key: string) {
    // ...
    const result = await db.select({
        ...selectFields,
        blur_data_url: images.blur_data_url,
    })
    // ...
    const [imageTagsResult] = await Promise.all([
        db.select({ slug: tags.slug, name: tags.name })
            .from(imageTags)
            .innerJoin(tags, eq(imageTags.imageId, tags.id))
            .where(eq(imageTags.imageId, image.id)),
    ]);

    return { ...image, tags: imageTagsResult, prevId: null, nextId: null };
}
```

The function queries tags separately and returns them, but `imageTagsResult` is destructured as `[imageTagsResult]` from `Promise.all([...])` — this is the **array** of tag rows, not a single row. So `tags` is correctly set to the array of tag objects. **However**, the shared photo page at `s/[key]/page.tsx:82-84` passes `tags={[]}` to `PhotoViewer`, ignoring the tags entirely:

```tsx
<PhotoViewer images={[image]} initialImageId={image.id} tags={[]} ... />
```

The shared photo page discards tags that are available from `getImageByShareKey`.

**Fix:** Pass `tags={image.tags}` instead of `tags={[]}` in `s/[key]/page.tsx:84`.

---

### C-03: `getSharedGroup` images also have tags discarded
**File:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:103-109`
**Confidence:** High

```tsx
<PhotoViewer
    images={group.images}
    initialImageId={selectedImage.id}
    tags={[]}
    isSharedView
    syncPhotoQueryBasePath={localizePath(locale, `/g/${key}`)}
/>
```

Same issue as C-02: `getSharedGroup` returns images without tag data (only `selectFields`), and the page passes `tags={[]}` to PhotoViewer. Tags are never displayed on shared group photo views.

**Fix:** Either extend `getSharedGroup` to include tag data (scalar subquery like `getImagesLite`), or accept this as a deliberate design choice and document it.

---

### C-04: `searchImages` does not deduplicate within `results` before combining with `tagResults`
**File:** `apps/web/src/lib/data.ts:516-548`
**Confidence:** High

```ts
const results = await db.select(searchFields).from(images)
    .where(...)
    .limit(effectiveLimit);

const tagResults = results.length >= effectiveLimit ? [] : await db.select(searchFields)
    // ...
    .limit(effectiveLimit);

const seen = new Set<number>();
const combined: SearchResult[] = [];
for (const r of [...results, ...tagResults]) {
    if (!seen.has(r.id)) {
        seen.add(r.id);
        combined.push(r);
    }
}
return combined.slice(0, limit);
```

Deduplication across `results` and `tagResults` works correctly. However, within `results` alone, there could be duplicates if a single image matches multiple LIKE conditions (e.g., title and description both match). The `seen` set handles this correctly since it processes both arrays sequentially. **This is actually fine** — reclassifying.

**Reclassification:** Not an issue. The `seen` set handles all deduplication correctly.

---

### C-05: `deleteImage` fetches `image` data but doesn't check if `image` was already deleted from the queue
**File:** `apps/web/src/app/actions/images.ts:183-243`
**Confidence:** Medium

```ts
export async function deleteImage(id: number) {
    // ...
    const [image] = await db.select({...}).from(images).where(eq(images.id, id));
    if (!image) return { error: 'Image not found' };
    // ... filename validation ...
    const queueState = getProcessingQueueState();
    queueState.enqueued.delete(id); // removes from queue
    await db.transaction(async (tx) => {
        await tx.delete(imageTags).where(eq(imageTags.imageId, id));
        await tx.delete(images).where(eq(images.id, id));
    });
    // ... file deletion ...
}
```

If `deleteImage` is called concurrently for the same ID:
1. Both calls pass `if (!image)` check
2. Both validate filenames
3. Both enter the transaction — second transaction's `tx.delete(images)` will affect 0 rows but succeed
4. File deletion runs twice — second `fs.unlink` fails with ENOENT but is caught

The transaction is safe (DELETE is idempotent), and file cleanup handles missing files. **This is actually fine** — the function is idempotent enough. Reclassifying.

**Reclassification:** Low risk. Concurrent deletes are safe due to catch-on-unlink and idempotent DB deletes.

---

### C-06: `viewCountBuffer` in `data.ts` can lose counts on server crash/restart
**File:** `apps/web/src/lib/data.ts:8-28`
**Confidence:** High

```ts
const viewCountBuffer = new Map<number, number>();
let viewCountFlushTimer: ReturnType<typeof setTimeout> | null = null;

function bufferGroupViewCount(groupId: number) {
    viewCountBuffer.set(groupId, (viewCountBuffer.get(groupId) ?? 0) + 1);
    if (!viewCountFlushTimer) {
        viewCountFlushTimer = setTimeout(flushGroupViewCounts, 5000);
    }
}
```

View counts are buffered in-memory with a 5-second flush. On server crash or OOM kill, up to 5 seconds of view counts are lost. The `flushBufferedSharedGroupViewCounts` export exists for graceful shutdown but may not be called in all shutdown scenarios.

**Assessment:** This is a deliberate trade-off (documented in CLAUDE.md as performance optimization). Loss of up to 5 seconds of view counts is acceptable for a personal gallery. The 5-second window is reasonable.

**Reclassification:** Known trade-off, not a bug. Keep as-is.

---

### C-07: OG image route has no authentication — can be used for SSRF-like resource generation
**File:** `apps/web/src/app/api/og/route.tsx:6-14`
**Confidence:** Medium

```ts
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const topic = searchParams.get('topic');
    const tags = searchParams.get('tags');

    if (!topic || topic.length > 200) {
        return new Response('Missing or invalid topic param', { status: 400 });
    }
    const tagList = tags ? tags.split(',').filter(Boolean).slice(0, 20).map(t => t.slice(0, 100)) : [];
```

The OG image endpoint generates PNG images on demand. It:
- Has no rate limiting
- Accepts arbitrary text via `topic` and `tags` parameters
- Uses `ImageResponse` which renders JSX to PNG (CPU-intensive)
- Has caching (`max-age=3600`) but an attacker can vary the topic param to bypass cache

An attacker could generate many unique OG images to consume server CPU. The 200-char topic limit and 20-tag limit help, but this is still a potential DoS vector.

**Fix:** Add rate limiting to the OG endpoint (reuse the search rate limit infrastructure), or make it admin-only and pre-generate OG images.

---

### C-08: `escapeCsvField` strips `\r\n` but the regex check for formula injection includes `\r`
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:19-28`
**Confidence:** Medium

```ts
function escapeCsvField(value: string): string {
    value = value.replace(/[\r\n]/g, ' ');
    if (value.match(/^[=+\-@\t\r]/)) {  // <-- \r can never match here since it was just stripped
        value = "'" + value;
    }
    return '"' + value.replace(/"/g, '""') + '"';
}
```

The `\r` in the formula injection regex is dead code — it was already replaced by a space on line 21. This is not a bug (the replacement happens first, so `\r` is handled), but it's misleading. The regex should be `/^[=+\-@\t]/` for clarity.

**Fix:** Remove `\r` from the regex: `/^[=+\-@\t]/`.

---

## LIKELY ISSUES

### L-01: `getImageCached` uses React `cache()` but prev/next queries are not cached
**File:** `apps/web/src/lib/data.ts:564`
**Confidence:** Medium

```ts
export const getImageCached = cache(getImage);
```

`getImage` runs 3 parallel queries (tags, prev, next) every time it's called. React `cache()` deduplicates within a single render pass, but if `getImageCached` is called from both `generateMetadata` and the page component (which it is in `p/[id]/page.tsx`), the cache should prevent the second call. However, if the render pass boundary differs (e.g., metadata generation vs. page rendering), the full query runs again.

This works correctly for the current use case but could become a performance concern if the photo page is accessed frequently, as the prev/next subqueries involve multi-column comparisons with OR conditions.

**Assessment:** Acceptable for current scale. The 1-week ISR cache (`revalidate = 604800`) means this only runs on cache misses.

---

### L-02: `topic-manager.tsx` optimistic alias update can go out of sync with server
**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:90`
**Confidence:** Medium

```ts
setEditingTopic(prev => prev ? ({ ...prev, aliases: [...prev.aliases, newAlias.trim()] }) : null);
router.refresh();
```

When adding an alias, the client optimistically updates `editingTopic.aliases` and calls `router.refresh()`. But `editingTopic` is a detached copy — `router.refresh()` re-fetches `initialTopics` from the server, but `editingTopic` state won't reflect the server response. If the server-side alias creation has different normalization (e.g., trimming, case folding), the optimistic UI will show the wrong value until the dialog is closed and reopened.

Similarly, deleting an alias at line 101:
```ts
setEditingTopic(prev => prev ? ({ ...prev, aliases: prev.aliases.filter(a => a !== alias) }) : null);
```

**Fix:** After `router.refresh()`, also re-derive `editingTopic` from the updated `initialTopics` to stay in sync. Or skip the optimistic update and rely on `router.refresh()` alone.

---

### L-03: `searchImagesAction` in-memory rate limit pruning has a race condition
**File:** `apps/web/src/app/actions/public.ts:33-37`
**Confidence:** Medium

```ts
if (searchRateLimit.size > 50) {
    for (const [key, val] of searchRateLimit) {
        if (val.resetAt <= now) searchRateLimit.delete(key);
    }
}
```

Modifying a `Map` while iterating it is safe in JavaScript (the spec guarantees no infinite loop for `delete` during `for...of`), but concurrent server actions in Node.js could interleave:
1. Request A starts pruning, finds expired entry for IP "X"
2. Request B increments IP "X"'s count
3. Request A deletes IP "X"'s entry, losing B's increment

In practice, Node.js is single-threaded for JavaScript execution, so this interleaving can't happen within a single `for...of` iteration. **Reclassification:** Not an issue in Node.js's single-threaded event loop.

---

### L-04: `statfs` check for disk space may not work on all platforms
**File:** `apps/web/src/app/actions/images.ts:42-51`
**Confidence:** Low

```ts
try {
    const { statfs } = await import('fs/promises');
    const stats = await statfs(UPLOAD_DIR_ORIGINAL);
    const freeBytes = stats.bfree * stats.bsize;
    if (freeBytes < 1024 * 1024 * 1024) {
        return { error: 'Insufficient disk space for upload' };
    }
} catch {
    // statfs may fail on some platforms; proceed anyway
}
```

The `statfs` function was added in Node.js 18.15 but is not available on all platforms (notably Windows). The catch block handles this gracefully, so uploads proceed without the check on unsupported platforms. This is correct behavior.

**Reclassification:** Not an issue — handled correctly.

---

### L-05: `sharedGroup` page `notFound()` is called after `getSharedGroup` increments view count
**File:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:62-66`
**Confidence:** Medium

```ts
const group = await getSharedGroup(key); // default: incrementViewCount = true

if (!group) {
    notFound();
}
```

When `getSharedGroup` returns `null` (expired or invalid key), the function already ran the query and returned null. But since the group was not found, no view count was buffered (the buffering only happens when a group is found). This is correct.

However, `generateMetadata` at line 20 calls `getSharedGroup(key, { incrementViewCount: false })` to avoid double-counting during metadata generation, and the page component at line 62 calls it again with default (true). This means two DB queries for the same group per page load. Could be optimized with `cache()`.

**Assessment:** Minor performance concern, not a bug.

---

## RISKS (Needing Manual Validation)

### R-01: `adminExtraFields` exported but never imported
**File:** `apps/web/src/lib/data.ts:562`
**Confidence:** High

```ts
export { adminExtraFields };
```

`adminExtraFields` includes `latitude`, `longitude`, and `user_filename` (PII). It's exported but never imported anywhere. This is dead code but could become a security risk if someone imports it into a public query. The CLAUDE.md correctly documents that GPS coordinates are excluded from public responses, but the export creates an attractive nuisance.

**Recommendation:** Either use `adminExtraFields` in admin-specific queries (its intended purpose) or remove the export. Keeping it exported without any usage is a maintenance risk.

---

### R-02: SQL restore scanning can be bypassed with multi-byte encodings
**File:** `apps/web/src/lib/sql-restore-scan.ts:46-49`
**Confidence:** Low

```ts
export function containsDangerousSql(input: string): boolean {
    const sanitized = stripSqlCommentsAndLiterals(input);
    return DANGEROUS_SQL_PATTERNS.some((pattern) => pattern.test(sanitized));
}
```

The scanning reads the SQL file as UTF-8 and applies regex patterns. The `stripSqlCommentsAndLiterals` function handles string literals, but MySQL's `mysql` CLI interprets the file with the connection character set. If a restore file uses a different encoding (e.g., GBK, Big5), multi-byte sequences could theoretically split a dangerous keyword across byte boundaries to evade detection.

The header validation and `--one-database` flag provide defense-in-depth. This is a low-probability attack that requires a specifically crafted file from an authenticated admin.

**Assessment:** Acceptable risk for a self-hosted personal gallery with admin-only restore access.

---

### R-03: `serveUploadFile` returns `application/octet-stream` for unknown extensions
**File:** `apps/web/src/lib/serve-upload.ts:69`
**Confidence:** Low

```ts
const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
```

If a file with an unexpected extension somehow ends up in the upload directories, it will be served as `application/octet-stream` with `X-Content-Type-Options: nosniff`. Browsers won't execute octet-stream content, so this is safe. However, it would be more defensive to return 404 for unknown extensions instead.

**Recommendation:** Return 404 for extensions not in `CONTENT_TYPES` instead of serving as `application/octet-stream`.

---

### R-04: Session cleanup relies on hourly GC — expired sessions remain valid until purged
**File:** `apps/web/src/lib/session.ts` (inferred)
**Confidence:** Low

Sessions are checked for expiry on each request, but the `sessions` table rows persist until the hourly cleanup job purges them. This is correct behavior (expired sessions are rejected at validation time) but means the table can grow if many sessions are created and not cleaned up promptly.

**Assessment:** Standard practice. The hourly purge is sufficient.

---

## FINAL SWEEP — Commonly Missed Issues

### FS-01: No CSRF protection on state-changing server actions
**Confidence:** Medium

Server actions that mutate state (`deleteImage`, `createTopic`, `restoreDatabase`, etc.) are called via POST from the client. Next.js server actions include an origin check by default, but custom headers and cookie-based session tokens could be vulnerable to CSRF in certain browser configurations. The `sameSite: lax` cookie attribute mitigates most CSRF risks for GET-initiated requests, but doesn't protect against POST-based CSRF from subdomains.

**Assessment:** Acceptable for a self-hosted personal gallery. The admin auth guard + sameSite cookie is sufficient.

---

### FS-02: `revalidateLocalizedPaths` called with potentially unbounded number of paths
**File:** `apps/web/src/app/actions/images.ts:332-337`
**Confidence:** Medium

```ts
revalidateLocalizedPaths(
    '/',
    '/admin/dashboard',
    ...foundIds.map(id => `/p/${id}`),
    ...[...affectedTopics].map(topic => `/${topic}`)
);
```

For bulk delete of 100 images, this could revalidate up to 100+ paths. Next.js's `revalidatePath` makes an internal call for each path, which could be slow with many paths.

**Recommendation:** Consider using `revalidatePath('/', 'layout')` for a single top-level revalidation instead of enumerating all affected paths.

---

### FS-03: `home-client.tsx` and `load-more.tsx` — no error boundary for failed load-more
**File:** `apps/web/src/components/load-more.tsx` (inferred from `home-client.tsx`)
**Confidence:** Low

If `loadMoreImages` server action fails, the user sees the error message from `t('home.loadMoreFailed')` but has no way to retry. A retry button would improve UX.

**Assessment:** Minor UX issue, not a bug.

---

## CHANGED FILES (from i18n slop cleanup)

- `apps/web/messages/en.json` — removed 8 keys, shortened 5 descriptions
- `apps/web/messages/ko.json` — removed 8 keys, shortened 5 descriptions
- `apps/web/src/components/image-manager.tsx` — removed `batchAddDesc` AlertDialogDescription
- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx` — use label keys as placeholders
- `apps/web/src/components/admin-user-manager.tsx` — use label key as placeholder

**Build verification:** `npm run build` passes with zero errors.

---

## ISSUE SUMMARY TABLE

| ID | Severity | File | Description | Status |
|----|----------|------|-------------|--------|
| C-01 | Low | `db/schema.ts:50` | `bigint mode: 'number'` precision loss | Confirmed |
| C-02 | Medium | `s/[key]/page.tsx:84` | Tags discarded on shared photo page | Confirmed |
| C-03 | Medium | `g/[key]/page.tsx:107` | Tags discarded on shared group page | Confirmed |
| C-07 | Medium | `api/og/route.tsx` | No rate limiting on OG image generation | Confirmed |
| C-08 | Low | `db-actions.ts:23` | Dead `\r` in CSV injection regex | Confirmed |
| L-02 | Low | `topic-manager.tsx:90` | Optimistic alias update can desync | Likely |
| L-05 | Low | `g/[key]/page.tsx:20,62` | Double query for shared group | Likely |
| R-01 | Low | `data.ts:562` | `adminExtraFields` exported but unused | Risk |
| R-03 | Low | `serve-upload.ts:69` | Octet-stream fallback instead of 404 | Risk |
| FS-02 | Low | `images.ts:332` | Unbounded revalidatePath calls | Risk |

**Actionable fixes (recommended):**
1. C-02/C-03: Pass tags to PhotoViewer in shared pages
2. C-08: Remove dead `\r` from CSV regex
3. C-01: Consider `mode: 'bigint'` for `original_file_size` or validate at boundary
4. R-03: Return 404 for unknown file extensions in serve-upload
5. R-01: Either use or remove `adminExtraFields` export

---

## SUPPLEMENT: Image Pipeline & UI Deep Review

*Parallel agent review of 32 files: process-image, image-queue, upload-dropzone, home-client, photo-viewer, histogram, lightbox, image-zoom, info-bottom-sheet, tag-input, search, nav, admin components, and more.*

### HIGH Severity

#### S-01: EXIF GPS coordinate validation allows out-of-range decimal degrees
**File:** `apps/web/src/lib/process-image.ts:429-437`
**Confidence:** High

`convertDMSToDD` validates each DMS component individually but never validates the final decimal degrees. `[90, 1, 0]` passes component checks (degrees=90 <= 90) but converts to `dd = 90.0167`, exceeding valid latitude range [-90, 90].

**Fix:** Add `if (Math.abs(dd) > maxDegrees) return null;` after computing `dd`.

---

#### S-02: Object URL recreation on every file addition causes preview re-render
**File:** `apps/web/src/components/upload-dropzone.tsx:43-57`
**Confidence:** High

`previewUrls` useMemo creates new `URL.createObjectURL` calls for ALL files on every change. Adding 1 file to 50 existing causes all 51 previews to re-render. Cleanup revokes old URLs, causing a flash.

**Fix:** Use a ref-based map that only creates/revoke URLs for added/removed files.

---

### MEDIUM Severity

#### S-03: Infinite retry loop on claim acquisition failure with no escalation
**File:** `apps/web/src/lib/image-queue.ts:111-118`

When a job cannot acquire a MySQL lock, it re-enqueues itself indefinitely every 5 seconds. `MAX_RETRIES = 3` only applies to processing errors, not claim failures.

**Fix:** Track claim-retry attempts separately with escalating backoff or cap.

---

#### S-04: Bottom sheet has no live touch-drag tracking
**File:** `apps/web/src/components/info-bottom-sheet.tsx:47-84`

Only handles `onTouchStart`/`onTouchEnd` — no `onTouchMove`. Sheet snaps between discrete states instead of following the finger, causing janky mobile UX and potential double-scroll with the browser.

**Fix:** Add `onTouchMove` handler with `e.preventDefault()` and optional live `translateY` tracking.

---

#### S-05: `document.title` not restored when leaving photo viewer
**File:** `apps/web/src/components/photo-viewer.tsx:57-61`

The `useEffect` that sets `document.title` has no cleanup function. Navigating away leaves the tab title stuck on the last photo's title.

**Fix:** Add `return () => { document.title = siteConfig.nav_title; };` to the effect.

---

#### S-06: Admin user manager uses native `confirm()` inconsistent with rest of app
**File:** `apps/web/src/components/admin-user-manager.tsx:47`

Every other delete confirmation uses shadcn `AlertDialog`. `confirm()` is blocking, unstyled, and breaks dark mode visual consistency.

**Fix:** Replace with `AlertDialog` pattern from image-manager.tsx.

---

#### S-07: Temp file in process-topic-image written without restrictive permissions
**File:** `apps/web/src/lib/process-topic-image.ts:73`

`createWriteStream(tempPath)` uses default permissions, while `process-image.ts:216` uses `{ mode: 0o600 }`. If server crashes before cleanup, temp files remain world-readable.

**Fix:** Use `createWriteStream(tempPath, { mode: 0o600 })`.

---

#### S-08: Duplicated `maxInputPixels` parsing with inconsistent defaults
**Files:** `process-image.ts:20-24` (256M) vs `process-topic-image.ts:11-14` (64M)

Both parse `IMAGE_MAX_INPUT_PIXELS` independently with different fallback defaults. Setting the env var overrides both, eliminating the intentional lower limit for topic images.

**Fix:** Use separate env vars or a shared config module with per-context defaults.

---

### LOW Severity

| ID | File | Description |
|----|------|-------------|
| S-09 | `histogram.tsx:86,107` | `Math.max(...bins)` spreads 256-768 args; `reduce` is safer |
| S-10 | `clipboard.ts:13-27` | `execCommand('copy')` fallback is deprecated |
| S-11 | `search.tsx:24` | `resultRefs` array accumulates stale refs across searches |
| S-12 | `lightbox.tsx:101-103` | Fullscreen errors silently swallowed, no user feedback |
| S-13 | `load-more.tsx:69-84` | IntersectionObserver recreated unnecessarily on `hasMore` change |
| S-14 | `photo-viewer.tsx:46-48` | `sessionStorage` read in `useState` causes hydration mismatch |
| S-15 | `image-zoom.tsx:41-51` | `preventDefault()` on all clicks could suppress future interactive children |

---

### Positive Observations (from image pipeline review)

- **Excellent security in serve-upload.ts**: Triple-layer path traversal defense + symlink rejection
- **Robust queue architecture**: MySQL advisory lock, conditional UPDATE, triple format verification
- **Well-designed base56.ts**: Rejection sampling, pool pre-generation, 1000-attempt safety valve
- **Good accessibility in search.tsx**: Proper WAI-ARIA combobox pattern
- **Performance-conscious histogram**: Web Worker, zero-copy ArrayBuffer transfer, 256x256 canvas cap
- **Consistent event listener cleanup**: All components properly clean up in `useEffect` returns

---

## SUPPLEMENT: Data Layer & Actions Deep Review

*Parallel agent review of 17 files: schema, data.ts, all server actions, db-actions, sharing, revalidation, upload-limits, and more.*

### CRITICAL Severity

#### D-01: SQL restore scan bypass via MySQL conditional comments
**File:** `apps/web/src/lib/sql-restore-scan.ts:37` + `apps/web/src/app/[locale]/admin/db-actions.ts:213-231`
**Confidence:** High

`stripSqlCommentsAndLiterals` removes ALL `/* ... */` blocks including MySQL conditional execution comments (`/*!ddddd ... */`). These are specifically designed to be parsed and **executed** by MySQL when the server version >= the embedded version number. The scan operates on stripped text, but the restore pipes the **original** file to `mysql`. Dangerous SQL inside a conditional comment is invisible to the scan but executed during restore.

**Concrete attack:** Upload a crafted SQL file:
```sql
-- MySQL dump 10.13  Distrib 8.0.36
/*!50000 GRANT ALL PRIVILEGES ON *.* TO 'attacker'@'%' WITH GRANT OPTION */;
```
Header check passes (starts with `--`). Scan strips `/*!50000 GRANT ALL...*/` as a comment. Restore executes the `GRANT` on MySQL 5.0+.

**Fix:** Before stripping comments, detect `/*!` patterns. Either reject files containing conditional comments outright, or extract the inner statement text and include it in the scan input.

---

### HIGH Severity

#### D-02: Advisory lock (GET_LOCK) unreliable due to pooled connections
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:160-172`
**Confidence:** High

MySQL advisory locks are session-scoped (bound to a specific connection). `db.execute(GET_LOCK)` borrows a connection from the Drizzle pool, executes, and returns it. The lock is held on connection A. Later, `RELEASE_LOCK` in the `finally` block may run on connection B where the lock is not held, silently failing (`.catch(() => {})` swallows it). The lock remains on connection A until recycled.

Contrast with `image-queue.ts:56-83` which correctly acquires a dedicated connection via `connection.getConnection()` and holds it for the lock's lifetime.

**Fix:** Follow the pattern from `image-queue.ts` — acquire a dedicated connection with `connection.getConnection()`, execute both `GET_LOCK` and `RELEASE_LOCK` on that same connection.

---

#### D-03: viewCountBuffer loses counts on process crash/restart
**File:** `apps/web/src/lib/data.ts:8-28`
**Confidence:** High (previously identified as C-06, now upgraded based on deeper analysis)

If the process crashes between 5-second flushes, all buffered view counts are permanently lost. For a viral shared link, this could represent hundreds of lost views.

**Fix:** Register `process.on('SIGTERM', ...)` to call `flushBufferedSharedGroupViewCounts()`. Consider reducing flush interval or using a write-ahead pattern for durability-critical counters.

---

### MEDIUM Severity

#### D-04: updateTag returns success when tag no longer exists
**File:** `apps/web/src/app/actions/tags.ts:58-67`

`UPDATE` returns `{ success: true }` regardless of `affectedRows`. If tag was deleted between form load and submit, 0 rows are affected but UI shows success.

**Fix:** Check `result.affectedRows`. If 0, return `{ error: 'Tag not found' }`.

---

#### D-05: deleteTopicAlias has no error handling
**File:** `apps/web/src/app/actions/topics.ts:265-273`

`db.delete()` is not wrapped in try/catch. Unhandled exception causes 500 instead of graceful error. Every other mutation function consistently wraps DB operations.

**Fix:** Add try/catch, consistent with `deleteTopic`, `deleteTag`, etc.

---

#### D-06: flushGroupViewCounts performs sequential DB updates
**File:** `apps/web/src/lib/data.ts:18-28`

Sequential `await` per group in the batch. With 20 groups, this takes 200-400ms instead of 10-20ms for parallel execution.

**Fix:** Use `Promise.all(batch.map(...))` or batch into a single `CASE` expression.

---

#### D-07: batchUpdateImageTags lacks transactional consistency
**File:** `apps/web/src/app/actions/tags.ts:209-263`

Each tag add/remove is an independent query. Partial failures leave image in partially-tagged state with no rollback.

**Fix:** Wrap the add+remove sequence in `db.transaction()`.

---

#### D-08: exportImagesCsv silently truncates at 50,000 rows
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:50`

`.limit(50000)` prevents OOM, but there is no indication to the admin that data was truncated. A 75K-image gallery exports an incomplete CSV silently.

**Fix:** Check if result count equals the limit. If so, include a warning in the response.

---

#### D-09: revokePhotoShareLink returns success even if image was deleted
**File:** `apps/web/src/app/actions/sharing.ts:126-142`

`UPDATE` affects 0 rows if image is deleted between select and update, but function returns `{ success: true }`.

**Fix:** Check `result.affectedRows`. If 0, return error.

---

### LOW Severity

| ID | File | Description |
|----|------|-------------|
| D-10 | `db/index.ts:18` | `connectionLimit: 10` doesn't match CLAUDE.md's "8 connections" |
| D-11 | `topics.ts:82-84` | Orphaned topic image file if both insert and cleanup fail |
| D-12 | `data.ts:516-547` | searchImages two-query approach has timing inconsistency (known trade-off) |

---

## CONSOLIDATED ISSUE TABLE (All Reviews)

| ID | Severity | File | Description | Source |
|----|----------|------|-------------|--------|
| D-01 | **CRITICAL** | `sql-restore-scan.ts` | Conditional comment bypass allows SQL injection during restore | Data |
| D-02 | HIGH | `db-actions.ts:160` | Advisory lock unreliable with pooled connections | Data |
| D-03 | HIGH | `data.ts:8` | viewCountBuffer loses counts on crash | Data |
| S-01 | HIGH | `process-image.ts:429` | GPS validation allows out-of-range decimal degrees | UI |
| S-02 | HIGH | `upload-dropzone.tsx:43` | Object URL recreation causes preview flicker | UI |
| C-02 | MED | `s/[key]/page.tsx:84` | Tags discarded on shared photo page | Main |
| C-03 | MED | `g/[key]/page.tsx:107` | Tags discarded on shared group page | Main |
| C-07 | MED | `api/og/route.tsx` | No rate limiting on OG image generation | Main |
| D-04 | MED | `tags.ts:58` | updateTag returns success on 0 rows affected | Data |
| D-05 | MED | `topics.ts:265` | deleteTopicAlias lacks error handling | Data |
| D-06 | MED | `data.ts:18` | Sequential view count flush instead of parallel | Data |
| D-07 | MED | `tags.ts:209` | batchUpdateImageTags non-transactional | Data |
| D-08 | MED | `db-actions.ts:50` | CSV export silently truncates at 50K rows | Data |
| D-09 | MED | `sharing.ts:126` | revokePhotoShareLink returns success on 0 rows | Data |
| S-03 | MED | `image-queue.ts:111` | Infinite claim retry with no escalation | UI |
| S-04 | MED | `info-bottom-sheet.tsx:47` | No live touch-drag tracking on bottom sheet | UI |
| S-05 | MED | `photo-viewer.tsx:57` | document.title not restored on navigation | UI |
| S-06 | MED | `admin-user-manager.tsx:47` | Native confirm() breaks dark mode consistency | UI |
| S-07 | MED | `process-topic-image.ts:73` | Temp file without restrictive permissions | UI |
| S-08 | MED | `process-topic-image.ts:11` | Duplicated maxInputPixels with inconsistent defaults | UI |
| C-01 | LOW | `db/schema.ts:50` | bigint mode:'number' precision loss | Main |
| C-08 | LOW | `db-actions.ts:23` | Dead \r in CSV injection regex | Main |
| R-01 | LOW | `data.ts:562` | adminExtraFields exported but unused | Main |
| R-03 | LOW | `serve-upload.ts:69` | Octet-stream fallback instead of 404 | Main |
| FS-02 | LOW | `images.ts:332` | Unbounded revalidatePath calls | Main |
| S-09–S-15 | LOW | Various | 7 low-severity UI issues (see supplement) | UI |
| D-10–D-12 | LOW | Various | 3 low-severity data issues (see supplement) | Data |

**1 CRITICAL, 4 HIGH, 14 MEDIUM, 12 LOW** — Total: 31 findings

---

## SUPPLEMENT: Auth & Security Deep Review

*Parallel agent review of 8 core files + 5 supporting modules: auth-rate-limit, session, api-auth, actions/auth, proxy, validation, safe-json-ld, audit.*

### HIGH Severity

#### A-01: Rate Limit TOCTOU — Concurrent login requests bypass rate limiting
**File:** `apps/web/src/app/actions/auth.ts:87-121`
**Confidence:** High

Rate limit check and increment are separated by multiple `await` points (DB check, user lookup, Argon2 verify ~100ms). Between check and increment, Node.js yields the event loop, allowing concurrent requests from the same IP to read the same pre-increment count and pass the check. With `LOGIN_MAX_ATTEMPTS=5`, an attacker sending 10 simultaneous requests can get ~2x the allowed attempts.

**Fix:** Increment the rate limit counter *before* the expensive credential check. Roll back on success:
```typescript
await recordFailedLoginAttempt(ip, now); // increment immediately
// ... verify credentials ...
if (verified) { await clearSuccessfulLoginAttempts(ip); }
```

---

### MEDIUM Severity

#### A-02: Error message confirms valid credentials
**File:** `apps/web/src/app/actions/auth.ts:168-170`
**Confidence:** High

When credentials verify but session creation fails (DB unavailable), the error `'Login succeeded but session creation failed. Please try again.'` explicitly confirms the password was correct — an oracle for credential stuffing.

**Fix:** Change to `'Login failed. Please try again.'` and log the real error server-side.

---

#### A-03: Rate limiting collapses when TRUST_PROXY is unset behind reverse proxy
**File:** `apps/web/src/lib/rate-limit.ts:60-64`
**Confidence:** High

Without `TRUST_PROXY=true`, `getClientIp` returns `'unknown'` for all requests. Behind a reverse proxy, all users share one rate limit bucket — a single attacker can exhaust it for everyone, or make 5 attempts from each of many IPs.

**Fix:** Add a startup guard: if `NODE_ENV=production` and `X-Forwarded-For` header is present but `TRUST_PROXY` is not set, throw a clear configuration error.

---

#### A-04: No rate limiting on password change
**File:** `apps/web/src/app/actions/auth.ts:194-256`
**Confidence:** High

`updatePassword` has no rate limiting. An attacker with a stolen session cookie can attempt unlimited `currentPassword` values. Argon2's ~100ms/attempt limits speed to ~10/s, but over hours allows thousands of attempts.

**Fix:** Apply the same IP-based rate limiting used for login.

---

#### A-05: Audit events may be lost due to fire-and-forget pattern
**File:** `apps/web/src/app/actions/auth.ts:125, 134`
**Confidence:** High

`logAuditEvent(...).catch(console.debug)` is fire-and-forget. In serverless/containerized environments, the process can freeze/kill before the DB insert completes. Security-critical events (login failures) could be absent from audit logs during an attack.

**Fix:** `await logAuditEvent(...)` for security-critical events (login_failure, login_success).

---

### LOW Severity

| ID | File | Description |
|----|------|-------------|
| A-06 | `proxy.ts:40` | Middleware cookie format check allows crafted cookies through to admin layout (minimal disclosure) |
| A-07 | `p/[id]/page.tsx:93` | `parseInt` parses partial numeric IDs — `parseInt("42;alert(1)")` returns 42 |
| A-08 | `api/health/route.ts` | Unauthenticated health endpoint reveals DB connectivity status |
| A-09 | `validation.ts:44-46` | `isValidTopicAlias` allows HTML-significant characters (`<`, `>`, `"`, `'`, `&`) |
| A-10 | `validation.ts:48-51` | `isValidTagName` allows HTML-significant characters without length normalization |

---

## FINAL CONSOLIDATED ISSUE TABLE (All Reviews)

| ID | Severity | File | Description | Source |
|----|----------|------|-------------|--------|
| D-01 | **CRITICAL** | `sql-restore-scan.ts` | Conditional comment bypass allows SQL injection during restore | Data |
| A-01 | HIGH | `actions/auth.ts:87` | Rate limit TOCTOU — concurrent logins bypass limit | Auth |
| D-02 | HIGH | `db-actions.ts:160` | Advisory lock unreliable with pooled connections | Data |
| D-03 | HIGH | `data.ts:8` | viewCountBuffer loses counts on crash | Data |
| S-01 | HIGH | `process-image.ts:429` | GPS validation allows out-of-range decimal degrees | UI |
| S-02 | HIGH | `upload-dropzone.tsx:43` | Object URL recreation causes preview flicker | UI |
| A-02 | MED | `actions/auth.ts:168` | Error message confirms valid credentials | Auth |
| A-03 | MED | `rate-limit.ts:60` | TRUST_PROXY unset behind proxy collapses rate limiting | Auth |
| A-04 | MED | `actions/auth.ts:194` | No rate limiting on password change | Auth |
| A-05 | MED | `actions/auth.ts:125` | Audit events fire-and-forget may lose security events | Auth |
| C-02 | MED | `s/[key]/page.tsx:84` | Tags discarded on shared photo page | Main |
| C-03 | MED | `g/[key]/page.tsx:107` | Tags discarded on shared group page | Main |
| C-07 | MED | `api/og/route.tsx` | No rate limiting on OG image generation | Main |
| D-04 | MED | `tags.ts:58` | updateTag returns success on 0 rows affected | Data |
| D-05 | MED | `topics.ts:265` | deleteTopicAlias lacks error handling | Data |
| D-06 | MED | `data.ts:18` | Sequential view count flush instead of parallel | Data |
| D-07 | MED | `tags.ts:209` | batchUpdateImageTags non-transactional | Data |
| D-08 | MED | `db-actions.ts:50` | CSV export silently truncates at 50K rows | Data |
| D-09 | MED | `sharing.ts:126` | revokePhotoShareLink returns success on 0 rows | Data |
| S-03 | MED | `image-queue.ts:111` | Infinite claim retry with no escalation | UI |
| S-04 | MED | `info-bottom-sheet.tsx:47` | No live touch-drag tracking on bottom sheet | UI |
| S-05 | MED | `photo-viewer.tsx:57` | document.title not restored on navigation | UI |
| S-06 | MED | `admin-user-manager.tsx:47` | Native confirm() breaks dark mode consistency | UI |
| S-07 | MED | `process-topic-image.ts:73` | Temp file without restrictive permissions | UI |
| S-08 | MED | `process-topic-image.ts:11` | Duplicated maxInputPixels with inconsistent defaults | UI |
| C-01 | LOW | `db/schema.ts:50` | bigint mode:'number' precision loss | Main |
| C-08 | LOW | `db-actions.ts:23` | Dead \r in CSV injection regex | Main |
| R-01 | LOW | `data.ts:562` | adminExtraFields exported but unused | Main |
| R-03 | LOW | `serve-upload.ts:69` | Octet-stream fallback instead of 404 | Main |
| FS-02 | LOW | `images.ts:332` | Unbounded revalidatePath calls | Main |
| A-06 | LOW | `proxy.ts:40` | Cookie format check too permissive | Auth |
| A-07 | LOW | `p/[id]/page.tsx:93` | parseInt parses partial numeric IDs | Auth |
| A-08 | LOW | `api/health/route.ts` | Health endpoint reveals DB status | Auth |
| A-09 | LOW | `validation.ts:44` | isValidTopicAlias allows HTML-significant chars | Auth |
| A-10 | LOW | `validation.ts:48` | isValidTagName allows HTML-significant chars | Auth |
| S-09–S-15 | LOW | Various | 7 low-severity UI issues (see supplement) | UI |
| D-10–D-12 | LOW | Various | 3 low-severity data issues (see supplement) | Data |

**1 CRITICAL, 5 HIGH, 19 MEDIUM, 17 LOW** — Total: 42 findings

---

## PRIORITY REMEDIATION ORDER

1. **D-01 (CRITICAL):** Fix SQL restore scan to handle `/*!` conditional comments
2. **A-01 (HIGH):** Restructure login to increment-before-verify
3. **A-02 (MEDIUM):** Change error message to not confirm credentials — one-line fix
4. **D-02 (HIGH):** Use dedicated connection for advisory lock in db-actions.ts
5. **S-07 (MEDIUM):** Add `{ mode: 0o600 }` to process-topic-image temp file
6. **S-05 (MEDIUM):** Add document.title cleanup to photo-viewer useEffect
7. **C-02/C-03 (MEDIUM):** Pass tags to PhotoViewer on shared pages
8. **D-05 (MEDIUM):** Add try/catch to deleteTopicAlias
9. **A-04 (MEDIUM):** Add rate limiting to password change
10. **A-05 (MEDIUM):** Await audit events for login_failure/login_success
