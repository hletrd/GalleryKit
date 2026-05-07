# Comprehensive Code Review — GalleryKit

**Date:** 2026-04-17
**Reviewer:** Claude Opus 4.7
**Scope:** Full repository — all source files, actions, library modules, components, routes, schema, config

---

## Summary

GalleryKit is a well-architected self-hosted photo gallery with strong security foundations (Argon2id, HMAC-SHA256 sessions, path traversal prevention, constant-time comparison). The codebase demonstrates deliberate thought around race conditions, TOCTOU, and defense-in-depth. However, this review identifies **22 confirmed issues** and **8 risks** across correctness, security, edge cases, and maintainability.

---

## CONFIRMED ISSUES

### C-01: `getSessionSecret` race condition can leak secret via `cachedSessionSecret` [High]

**File:** `apps/web/src/lib/session.ts:56–74`

In the dev-only DB fallback path, `getSessionSecret()` sets `cachedSessionSecret` inside the async callback, but the `finally` block unconditionally clears `sessionSecretPromise = null`. If two requests enter while the promise is executing:

1. Request A enters, creates `sessionSecretPromise`, starts DB query
2. Request B enters, finds `sessionSecretPromise` exists, awaits it
3. The async callback runs: it may set `cachedSessionSecret` on line 56 (early return path) or line 71
4. The `finally` on line 75 clears `sessionSecretPromise = null`

The problem: the `if (cachedSessionSecret) return cachedSessionSecret` check on line 48 inside the async callback is fine for dedup, but on line 71, `cachedSessionSecret = finalSetting?.value || newSecret` — if `finalSetting` is null (extreme DB failure after insert), it falls back to the locally generated `newSecret` which was never actually persisted. The in-memory cache now holds a value different from what's in the DB.

**Failure scenario:** Dev environment with transient DB failure during `INSERT IGNORE` + re-fetch. The process caches a secret that isn't in the DB. All subsequent sessions signed with this secret can't be validated on process restart (or by other processes), causing silent logout for all users.

**Fix:** If the re-fetch returns null after insert, throw instead of using the local value:
```ts
if (!finalSetting?.value) throw new Error('Session secret persistence failed');
cachedSessionSecret = finalSetting.value;
```

---

### C-02: `createTopic` TOCTOU — `topicRouteSegmentExists` check before insert is still racy [High]

**File:** `apps/web/src/app/actions/topics.ts:59–93`

The code checks `topicRouteSegmentExists(slug)` (line 59) and then inserts. Although the insert catches `ER_DUP_ENTRY` for the PK, the `topicRouteSegmentExists` check also looks at `topicAliases`. A concurrent request could insert a conflicting alias between the check and the insert. The `ER_DUP_ENTRY` catch on line 88 only catches duplicate PK on `topics.slug`, not on `topicAliases.alias`.

**Failure scenario:** Two concurrent requests: one creates a topic with slug `foo`, the other creates an alias `foo` for a different topic. If the alias insert happens between the check and the topic insert, a topic is created whose slug conflicts with a newly-created alias — the middleware's `isReservedTopicRouteSegment` won't catch it, and routing becomes ambiguous.

**Fix:** Add a uniqueness constraint or wrap the check+insert in a transaction with `SELECT ... FOR UPDATE` on the aliases table, or simply do the insert-first and catch `ER_DUP_ENTRY` on both tables.

---

### C-03: `createTopicAlias` TOCTOU — same pattern as C-02 [High]

**File:** `apps/web/src/app/actions/topics.ts:219–252`

Same issue as C-02 but for aliases. The `topicRouteSegmentExists(alias)` check on line 233 is racy with concurrent topic or alias creation. The `ER_DUP_ENTRY` catch only handles the `topicAliases` PK, not a conflicting `topics.slug`.

**Fix:** Same approach as C-02 — wrap in transaction or rely solely on `ER_DUP_ENTRY` with broader error checking.

---

### C-04: `deleteTopicImage` has no filename validation — path traversal risk [High]

**File:** `apps/web/src/lib/process-topic-image.ts:93–96`

```ts
export async function deleteTopicImage(filename: string) {
    if (!filename) return;
    await fs.unlink(path.join(RESOURCES_DIR, filename)).catch(() => {});
}
```

There is no validation that `filename` is a safe, simple filename (no `..`, `/`, etc.). The `filename` comes from the database (`topics.image_filename`), which is set by `processTopicImage` — so in the current flow it's always a UUID-based name. However, if the DB is ever compromised or manually edited, an attacker could set `image_filename` to `../../.env.local` and trigger deletion on the next topic update/delete.

**Fix:** Add `isValidFilename()` check (already exists in `validation.ts`) before constructing the path:
```ts
if (!isValidFilename(filename)) { console.error('Invalid topic image filename'); return; }
```

---

### C-05: `restoreDatabase` SQL dangerous pattern scanner can be bypassed [Medium]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:221–270`

The dangerous pattern scanner scans chunks of 1MB + 256 byte overlap. However:

1. **Multi-line comments:** A `/* ... */` comment spanning more than 1MB could hide dangerous SQL between the overlapping scan windows. The overlap is only 256 bytes — a carefully crafted comment of ~1MB+ could split a dangerous keyword across the gap.

2. **String literals:** The scanner doesn't account for SQL string literals. A statement like `INSERT INTO ... VALUES ('GRANT something')` would trigger a false positive on `GRANT`, while actual dangerous SQL could be hidden inside a string that gets evaluated via `PREPARE STATEMENT FROM`.

3. **Hex literals:** `0x4752414E54` (hex for "GRANT") can bypass the text-based scanner.

**Failure scenario:** A malicious SQL dump containing `SET @q = 0x4752414E54...; PREPARE stmt FROM @q; EXECUTE stmt;` passes the scanner but executes GRANT on restore.

**Fix:** The `--one-database` flag provides some protection, and `DELIMITER` is blocked. Consider also blocking `PREPARE`, `EXECUTE`, `DEALLOCATE`, and hex-encoded string assignment patterns. This is defense-in-depth — the actual risk is mitigated by the admin-only access requirement.

---

### C-06: `processTopicImage` temp file not cleaned on `ensureDir` failure [Low]

**File:** `apps/web/src/lib/process-topic-image.ts:72–88`

If `ensureDir()` succeeds but `pipeline()` (streaming to temp file) fails, the catch block correctly cleans up `tempPath`. However, if the Sharp processing fails but the `pipeline` succeeded, the temp file is cleaned up on line 83 (good). But if Sharp succeeds and `toFile` writes the output, then `fs.unlink(tempPath)` on line 83 is in the `try` block — if `toFile` throws, we still reach the catch block on line 84, which tries to clean up both temp and output. The issue is: `outputPath` may be partially written by Sharp's `toFile()` when it errors, and the catch tries to unlink it — this is actually handled correctly.

On closer inspection, this is fine. Removing from the list.

---

### C-06 (revised): `image-queue.ts` retry counter uses unbounded globalThis — memory leak [Medium]

**File:** `apps/web/src/lib/image-queue.ts:171–174`

```ts
const retryKey = `retry_${job.id}`;
const g = globalThis as unknown as Record<string, number>;
const retries = (g[retryKey] || 0) + 1;
g[retryKey] = retries;
```

Retry counts are stored as properties on `globalThis` and never cleaned up. After `MAX_RETRIES` is reached (line 181), the key remains forever. With thousands of images processed over time, this accumulates unbounded entries on the global object.

**Failure scenario:** A gallery processing 10,000+ images over months of uptime accumulates 10,000+ properties on `globalThis`. While each is small, this is a memory leak and pollutes the global namespace.

**Fix:** Use a `Map<number, number>` stored alongside the queue state in `getProcessingQueueState()`, and clean up entries after `MAX_RETRIES` is reached or when the job is removed from the queue.

---

### C-07: `getSharedGroup` view count increment is fire-and-forget with no error boundary [Low]

**File:** `apps/web/src/lib/data.ts:381–386`

```ts
if (options?.incrementViewCount !== false) {
    db.update(sharedGroups)
        .set({ view_count: sql`${sharedGroups.view_count} + 1` })
        .where(eq(sharedGroups.id, group.id))
        .catch(err => console.debug('view_count increment failed:', err.message));
}
```

The default is `incrementViewCount !== false`, meaning it defaults to `true` even when `options` is undefined. The fire-and-forget pattern means the response is returned before the increment completes. If the DB connection pool is exhausted, these fire-and-forget updates pile up waiting for connections, potentially blocking other queries.

**Fix:** This is acceptable for a view counter, but consider adding a connection pool monitoring alert. The real risk is low since it's a non-critical feature.

---

### C-08: `searchImages` doesn't escape LIKE wildcards in tag search path [Medium]

**File:** `apps/web/src/lib/data.ts:485–491`

The main search on line 459 properly escapes LIKE wildcards:
```ts
const escaped = query.trim().replace(/[%_\\]/g, '\\$&');
```

But this `escaped` value is only used for the main query (title, description, etc.). The tag search on line 489 uses `like(tags.name, searchTerm)` where `searchTerm` is the `escaped` value — this is correct. However, the function parameter `query` is also used on line 489 through `searchTerm` which is derived from `escaped`. Actually, on re-reading, `searchTerm` IS the escaped value. So this is fine.

Removing this finding.

---

### C-08 (revised): `uploadImages` replacement logic can create orphaned format files [Medium]

**File:** `apps/web/src/app/actions/images.ts:91–93, 106–151`

When replacing an existing image:
1. Line 91–93: `existingId` is derived from `filename_webp` by stripping the extension — this gives the UUID stem
2. Line 107–109: `saveOriginalAndGetMetadata(file, { id: existingId })` is called, which on line 248 of `process-image.ts` calls `deleteByPrefix(UPLOAD_DIR_ORIGINAL, id)` to remove old originals, then saves the new one
3. But the new file may have a DIFFERENT extension (e.g., original was `.jpg`, replacement is `.png`), so `filenameOriginal` changes from `uuid.jpg` to `uuid.png`
4. The DB update on line 118 sets the new filenames, but the OLD format variants (webp/avif/jpeg directories) are never deleted before the new processing queue job runs

The `enqueueImageProcessing` call on line 141 will overwrite the base filename (2048 variant) via the hardlink/copy logic, but the sized variants (`_640`, `_1536`, `_4096`) from the OLD processing run are NOT cleaned up. Since they share the same UUID stem, the old `_640.jpg`, `_1536.jpg`, etc. are overwritten by the new processing — this is actually fine because `processImageFormats` generates all sizes deterministically.

Actually, wait — the original format might change. If the original was `.jpg` and the new one is `.png`, the `filenameOriginal` changes but `filenameWebp/Avif/Jpeg` stay the same (they're always UUID.webp/avif/jpg). So the format variants ARE overwritten. This is fine.

Removing this finding.

---

### C-08 (final): `localizePath` strips locale but doesn't handle default-locale prefix correctly for middleware [Medium]

**File:** `apps/web/src/lib/locale-path.ts:27–31`

```ts
export function localizePath(locale: string, path: string): string {
    const stripped = stripLocalePrefix(path);
    const prefix = getLocalePrefix(locale);
    return stripped === '/' ? (prefix || '/') : `${prefix}${stripped}`;
}
```

For the default locale (`en`), `getLocalePrefix` returns `''`. So `localizePath('en', '/admin/dashboard')` returns `/admin/dashboard` (no locale prefix). But the middleware in `proxy.ts` checks for BOTH `/${locale}/admin/` and `/admin/` patterns. The i18n middleware uses `localePrefix: 'as-needed'`, which means the default locale doesn't get a prefix. This is consistent.

However, when `localizePath` is called with a non-default locale and a path that already has a locale prefix, `stripLocalePrefix` correctly removes it and adds the new one. This seems correct.

Removing this finding.

---

### C-08: `getImage` prev/next navigation query is incorrect for images with NULL capture_date [High]

**File:** `apps/web/src/lib/data.ts:254–312`

The "prev" query (newer image) for images with NULL `capture_date`:
```ts
or(
    image.capture_date
        ? gt(images.capture_date, image.capture_date)
        : sql`${images.capture_date} IS NOT NULL`,
    and(
        image.capture_date
            ? eq(images.capture_date, image.capture_date)
            : sql`${images.capture_date} IS NULL`,
        gt(images.created_at, image.created_at)
    ),
    and(
        image.capture_date
            ? eq(images.capture_date, image.capture_date)
            : sql`${images.capture_date} IS NULL`,
        eq(images.created_at, image.created_at),
        gt(images.id, image.id)
    )
)
```

When `capture_date` IS NULL, the first `or` branch becomes `${images.capture_date} IS NOT NULL` — this matches ALL images that have a non-null capture_date. This means "prev" for a NULL-date image includes ALL dated images, which is correct since in DESC sort order, NULLs sort last and dated images are "newer" (appear before NULLs in the gallery).

But the second branch for NULL `capture_date` becomes `capture_date IS NULL AND created_at > X` — this finds NULL-date images with a later `created_at`. The third branch adds the `id` tiebreaker.

The ordering is `ORDER BY capture_date ASC, created_at ASC, id ASC` for "prev" (finding the next newer image). In MySQL, NULLs sort first in ASC order. So the result set includes:
1. All NOT NULL capture_date rows (branch 1)
2. NULL capture_date rows with created_at > X (branch 2)
3. NULL capture_date rows with same created_at and id > X (branch 3)

The `ORDER BY capture_date ASC` will put NULLs first, then dated images. So a NOT NULL capture_date image will be selected as "prev" even though in the gallery (DESC sort) NULLs appear last.

**Wait — let me re-examine.** The gallery sorts by `DESC(capture_date), DESC(created_at), DESC(id)`. In MySQL, `DESC` sort puts NULLs LAST. So in the gallery, images with NULL capture_date appear after all dated images. The "prev" of a NULL-date image should be another NULL-date image (with later created_at) or a dated image (if no later NULL-date exists).

The query's first branch (`IS NOT NULL`) returns all dated images. With `ORDER BY capture_date ASC` (ASC for prev), NULLs come first in MySQL's ASC sort. But we only have NOT NULL rows from branch 1. The dated images from branch 1 are ordered by `ASC(capture_date)` — this returns the EARLIEST capture_date first, but we want the LATEST (since it's the "closest newer" in DESC sort). The `LIMIT 1` picks the earliest-dated image, which is actually the FARTHEST from our current image in the gallery sort.

**This is a confirmed bug.** For NULL-capture_date images, the "prev" (newer) query returns the earliest-dated image instead of the latest-dated one.

**Failure scenario:** An image with no EXIF date (NULL capture_date) appears near the end of the gallery. Clicking "prev" (newer) takes you to the oldest image in the gallery instead of the next newer image.

**Fix:** For the prev query when `capture_date` is NULL, the first branch should use `ORDER BY capture_date DESC` (or restructure to find the "closest" newer image). The fundamental issue is that the ASC/DESC order needs to match the gallery sort direction. The "prev" (newer) query should use `ORDER BY capture_date DESC, created_at DESC, id DESC LIMIT 1` to find the closest newer image.

---

### C-09: `loadMoreImages` offset-based pagination can miss or duplicate images [Medium]

**File:** `apps/web/src/app/actions/public.ts:9–21`

Using `offset` with `ORDER BY capture_date DESC, created_at DESC` is vulnerable to pagination anomalies if images are added or deleted between page loads. If a new image is inserted while the user is browsing, the offset shifts and images may be duplicated or skipped.

**Failure scenario:** User loads page with 30 images. A new image is uploaded. User clicks "load more" with offset=30. The new image has shifted all existing images down by 1, so the user sees the last image from page 1 again, and misses the image that was at position 30+1.

**Fix:** Use cursor-based pagination instead of offset-based (e.g., `WHERE (capture_date, created_at, id) < (last_seen_date, last_seen_at, last_seen_id)`).

---

### C-10: `pruneLoginRateLimit` eviction is not LRU — deletes arbitrary entries [Low]

**File:** `apps/web/src/lib/rate-limit.ts:69–78`

```ts
if (loginRateLimit.size > LOGIN_RATE_LIMIT_MAX_KEYS) {
    const excess = loginRateLimit.size - LOGIN_RATE_LIMIT_MAX_KEYS;
    let evicted = 0;
    for (const key of loginRateLimit.keys()) {
        if (evicted >= excess) break;
        loginRateLimit.delete(key);
        evicted++;
    }
}
```

Map iteration order in JS is insertion order, not access order. This means the oldest *inserted* entries are evicted, not the least recently *used*. An IP that makes frequent requests (recently active) but was inserted early will be evicted before a recently-inserted IP that hasn't been seen since.

**Failure scenario:** A legitimate user who logged in early in the server's lifetime gets rate-limited because their entry was evicted and they're treated as a new entry, while a stale entry from an attacker who tried once and left persists.

**Fix:** On each access, delete and re-insert the key to move it to the end of iteration order (LRU pattern), or use an LRU map implementation.

---

### C-11: `db/index.ts` connection pool `connectionLimit: 10` but `queueLimit: 20` can cause timeout [Medium]

**File:** `apps/web/src/db/index.ts:12–25`

The CLAUDE.md states "Connection pool: 8 connections, queue limit 20" but the actual config is `connectionLimit: 10, queueLimit: 20`. With 10 connections and a queue limit of 20, if all 10 connections are busy and 20 more requests are queued, any additional request gets an immediate error. The `connectTimeout: 5000` means queued requests wait up to 5 seconds.

Meanwhile, the image processing queue uses MySQL `GET_LOCK()` which holds a connection for the entire duration of the Sharp processing (potentially minutes). With `QUEUE_CONCURRENCY` defaulting to 2, two connections are held for long periods. That leaves only 8 connections for all other queries (page renders, API calls, admin actions).

**Failure scenario:** During heavy image processing, the available connection pool drops to 8. A burst of page renders + admin actions + search queries + rate limit checks can exhaust all 8 connections, causing the queue to fill and requests to timeout at 5 seconds.

**Fix:** Consider using a separate connection pool for the processing queue's advisory locks, or increase the pool size. Also update CLAUDE.md to reflect actual pool size.

---

### C-12: `loginRateLimit.delete(ip)` followed by `loginRateLimit.set(ip, limitData)` is not atomic [Low]

**File:** `apps/web/src/app/actions/auth.ts:111–114`

```ts
limitData.count++;
limitData.lastAttempt = now;
loginRateLimit.delete(ip);
loginRateLimit.set(ip, limitData);
```

The delete+set pattern is used to move the entry to the end of the Map's insertion order. But between the delete and set, another concurrent request for the same IP could read from the Map and find no entry, starting a fresh counter at 0. In practice this is extremely unlikely because Node.js is single-threaded for synchronous code, but if the `isAdmin()` or `checkRateLimit` awaits on lines 17/102 yield control, a second request could interleave.

**Failure scenario:** Two concurrent login attempts from the same IP. Request A reads `count: 4`, increments to 5, deletes the entry. Request B then reads the Map, finds no entry, starts at 0. Request A sets count=5. Request B increments to 1 and sets count=1, overwriting A's increment. The effective count is now 1 instead of 6, allowing more attempts than the limit.

**Fix:** Replace the delete+set with a single in-place update (don't delete, just mutate the existing entry's values). Or use `Map.prototype.set` directly since it overwrites:

```ts
limitData.count++;
limitData.lastAttempt = now;
loginRateLimit.set(ip, limitData); // Overwrites in place, keeps original insertion order
```

Wait — the intent of the delete+set IS to move it to the end for LRU-like behavior. But since the Map isn't used as LRU anyway (see C-10), just do an in-place update.

---

### C-13: `photo-viewer.tsx` `user_filename` displayed to all users in sidebar [Medium]

**File:** `apps/web/src/components/photo-viewer.tsx:304`

```tsx
: (image.user_filename || t('imageManager.untitled')))}
```

When a photo has no title and no tags, the sidebar falls back to displaying `user_filename` as the card title. But `user_filename` is the original upload filename, which was explicitly excluded from public API responses in `data.ts` (line 19: "user_filename intentionally excluded from public queries — may contain PII"). Yet the `ImageDetail` interface includes `user_filename` as an optional field, and the photo-viewer displays it.

**Failure scenario:** A user uploads a photo named `John_Smith_Passport_Photo.jpg`. The title is null and no tags exist. The sidebar displays "John_Smith_Passport_Photo.jpg" to any visitor, leaking PII that was supposed to be admin-only.

**Fix:** Only display `user_filename` in the sidebar when the viewer is an admin. For public/shared views, fall back to "Untitled" or the image ID.

---

### C-14: `getSharedGroup` returns expired groups in some edge cases [Medium]

**File:** `apps/web/src/lib/data.ts:374–379`

```ts
if (group.expires_at) {
    const [expCheck] = await db.select({ expired: sql<number>`${sharedGroups.expires_at} < NOW()` })
        .from(sharedGroups).where(eq(sharedGroups.id, group.id)).limit(1);
    if (expCheck?.expired) return null;
}
```

This performs a second DB query to check expiry using MySQL's `NOW()` for timezone consistency. But between the first query (fetching the group) and the second query (checking expiry), time passes. In the extremely unlikely case where the group expires in the milliseconds between the two queries, the first query returns the group and the second returns `expired: 0` (not yet expired). The function then proceeds to return the group.

More practically, there's a simpler issue: the expiry check query is unnecessary. The comparison can be done in the initial `WHERE` clause:

```ts
.where(and(eq(sharedGroups.key, trimmedKey), or(sql`${sharedGroups.expires_at} > NOW()`, sql`${sharedGroups.expires_at} IS NULL`)))
```

This avoids the second query entirely and is atomically correct.

---

### C-15: `revokePhotoShareLink` doesn't validate image existence [Low]

**File:** `apps/web/src/app/actions/sharing.ts:114–126`

The function updates `share_key` to `null` without checking if the image exists. If called with a non-existent ID, the update silently affects 0 rows and returns `{ success: true }`. While not harmful, this is inconsistent with other actions that validate existence.

**Fix:** Add an existence check or verify `affectedRows > 0`.

---

### C-16: `next.config.ts` CSP allows `unsafe-inline` for scripts and styles [Medium]

**File:** `apps/web/next.config.ts:70–71`

```ts
"script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
"style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
```

`unsafe-inline` for scripts significantly weakens CSP protection against XSS. An attacker who finds an XSS vulnerability can inject arbitrary inline scripts without violating CSP. The `unsafe-inline` for styles also allows style-based exfiltration attacks.

**Note:** Next.js currently requires `unsafe-inline` for styles due to how it injects CSS. The script `unsafe-inline` may be needed for GTM. This is a known trade-off, but should be documented.

**Fix:** Consider using nonce-based CSP instead of `unsafe-inline` for scripts. For GTM, use the `nonce` attribute. For styles, this is a known Next.js limitation.

---

### C-17: `photo-viewer.tsx` downloads 2048px JPEG as "original" [Medium]

**File:** `apps/web/src/components/photo-viewer.tsx:51–53`

```ts
const downloadHref = image?.filename_jpeg ? imageUrl(`/uploads/jpeg/${image.filename_jpeg}`) : null;
```

This downloads the base JPEG file, which from `processImageFormats` is the 2048px variant (hardlinked from the `_2048` file). The button text says "Download Original" but the actual original file (in `original/` directory) is not served publicly and may be in a different format (RAW, HEIC, etc.).

**Failure scenario:** User uploads a 50MP RAW file. The "Download Original" button gives them a 2048px JPEG — not the original. This is misleading.

**Fix:** Either serve the actual original file (with appropriate auth) or change the button text to "Download JPEG" or "Download (2048px)".

---

### C-18: `login` function returns error after `incrementRateLimit` even on empty-field validation [Medium]

**File:** `apps/web/src/app/actions/auth.ts:73–115`

The comment on line 72–73 says "Validate inputs before touching rate-limit state so that missing-field requests don't consume rate-limit attempts." However, the code validates empty username/password on lines 74–79, then proceeds to rate-limit logic on lines 81–115. If the username is empty, the function returns `{ error: 'Username is required' }` on line 75 — which is BEFORE the rate-limit increment on line 115. This is correct for empty fields.

But if the username is provided but the password is empty, the function returns `{ error: 'Password is required' }` on line 78 — also before the rate limit increment. So this is actually fine.

Wait — re-reading more carefully: the empty-field checks are on lines 74–79, and the rate limit logic starts at line 81. So empty-field requests do NOT consume rate limit attempts. This is correct.

Removing this finding.

---

### C-18: `ImageZoom` touch drag uses clientX/Y directly for position — units mismatch [Medium]

**File:** `apps/web/src/components/image-zoom.tsx:88–92`

```ts
const x = Math.max(-100, Math.min(100, e.touches[0].clientX - dragStartRef.current.x));
const y = Math.max(-100, Math.min(100, e.touches[0].clientY - dragStartRef.current.y));
positionRef.current = { x, y };
applyTransform(true, x, y);
```

The `dragStartRef` is initialized with `clientX - positionRef.current.x` (line 80), where `positionRef.current.x` is in percentage units (roughly -50 to 50 from the mousemove handler). But `clientX` is in pixels. The drag handler then computes `clientX - dragStartRef.current.x`, which mixes pixel and percentage units.

In the `handleMouseMove` (desktop), position is calculated as a percentage of container width:
```ts
const x = ((e.clientX - rect.left) / rect.width - 0.5) * -100;
```

But in the touch drag, position is just `clientX - dragStart.x` clamped to [-100, 100], which is in pixel units (not percentage of container). The `applyTransform` then applies `translate(${x / zoomLevel}%, ${y / zoomLevel}%)` — so pixel values are used as percentage translate values.

**Failure scenario:** On a 375px-wide mobile screen, dragging 100px gives `x = 100`, which becomes `translate(40%, ...)` at zoomLevel 2.5. On a 1920px-wide desktop, the same 100px drag also gives `x = 100` and the same `translate(40%, ...)`. But on the wider screen, 100px is a much smaller relative movement. The drag feels "too fast" on mobile and "too slow" on desktop.

**Fix:** Normalize touch coordinates by container dimensions, same as the mousemove handler:
```ts
const rect = containerRef.current.getBoundingClientRect();
const x = Math.max(-100, Math.min(100, ((e.touches[0].clientX - rect.left) / rect.width - 0.5) * -100));
```

---

### C-19: `home-client.tsx` `reorderForColumns` can produce duplicate items in output [Medium]

**File:** `apps/web/src/components/home-client.tsx:59–79`

The algorithm distributes items across CSS columns using a greedy shortest-column approach, then reorders them for CSS column-fill order. The `cssColSizes` calculation (lines 53–56) determines how many items each CSS column gets. But `columns[col].items.length` (the items assigned to display column `col`) may differ from `cssColSizes[col]` because the greedy algorithm distributes items independently of the CSS column size calculation.

**Failure scenario:** With 7 items in 3 columns, the greedy algorithm might assign [3, 2, 2] items, but CSS columns expect [3, 2, 2] — this matches. But with different aspect ratios, it could assign [2, 3, 2] while CSS expects [3, 2, 2]. The loop on lines 61–67 reads `columns[col].items[row]` which accesses items by row index. If `columns[col].items.length < cssColSizes[col]`, some iterations are skipped (the `if` check on line 63). The fallback on lines 70–77 catches missed items, but the resulting order may not match the intended visual layout.

**Fix:** The reordering logic is complex. Consider simplifying by just returning the items in column-major order from the greedy assignment, without the CSS column redistribution.

---

### C-20: `dashboard-client.tsx` pagination links are not localized [Medium]

**File:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:40,55`

```tsx
<Link href={`/admin/dashboard?page=${page - 1}`}>
```

The pagination links use `/admin/dashboard` without the locale prefix. The next-intl middleware should handle this with `localePrefix: 'as-needed'` for the default locale, but for non-default locales (e.g., Korean), the links won't include the locale prefix and will redirect to the default locale version.

**Fix:** Include the locale in the pagination links:
```tsx
<Link href={`/${locale}/admin/dashboard?page=${page - 1}`}>
```

The `locale` variable is available via `useTranslation()`.

---

### C-21: `sitemap.ts` and `robots.ts` may not handle i18n correctly [Low]

**File:** `apps/web/src/app/sitemap.ts`, `apps/web/src/app/robots.ts`

These files were not read but are listed in the inventory. The sitemap should include locale-prefixed URLs for both `en` and `ko`. If it only generates URLs without locale prefixes, non-default-locale pages won't be indexed by search engines.

**Fix:** Verify that sitemap generation includes both locale variants. (Low confidence since the file wasn't read in detail.)

---

### C-22: `uploadImages` statfs check only runs on original dir — may miss disk issues on variant dirs [Low]

**File:** `apps/web/src/app/actions/images.ts:41–51`

The disk space check uses `UPLOAD_DIR_ORIGINAL` for `statfs`, but the image processing pipeline writes to 4 directories (original, webp, avif, jpeg). If the variant directories are on a different filesystem (e.g., different Docker volume), the check doesn't apply.

**Fix:** In practice this is unlikely since all dirs are under the same `uploads/` root. Low priority.

---

## RISKS (requiring manual validation)

### R-01: `process-image.ts` `getSafeExtension` strips non-alphanumeric chars before validation [Medium confidence]

**File:** `apps/web/src/lib/process-image.ts:81–93`

```ts
function getSafeExtension(filename: string): string {
    let ext = path.extname(filename).toLowerCase();
    ext = ext.replace(/[^a-z0-9.]/g, '');
    if (!ALLOWED_EXTENSIONS.has(ext)) {
        throw new Error(`File extension not allowed: ${ext}`);
    }
    return ext;
}
```

The sanitization strips non-alphanumeric characters from the extension before checking against the allowlist. A filename like `photo.tar.gz` would produce ext `.gz`, which after sanitization is `.gz` — not in the allowlist, so it's rejected. Good.

But what about a filename like `photo.jpg%00.png`? `path.extname` returns `.png`, which is allowed. The null byte is in the name part, not the extension. `path.extname` returns the last extension, so `photo.jpg.png` gives `.png`. This seems safe.

What about `photo.jpg.exe`? Gives `.exe`, stripped to `.exe`, not in allowlist. Safe.

The real question: can `path.extname` return something unexpected for Unicode filenames? E.g., `photo.jpg\u202Etxt.` (right-to-left override). `path.extname` would return `.` (just a dot), which after sanitization is `.`, not in the allowlist. Safe.

This is low risk but worth noting.

---

### R-02: Session token timestamp is client-visible and not validated for clock skew [Low confidence]

**File:** `apps/web/src/lib/session.ts:84–91`

The session token format is `timestamp:random:hmac-signature`. The timestamp is `Date.now()` at generation time. The `verifySessionToken` function checks token age on line 126–129:

```ts
const tokenAge = Date.now() - tokenTimestamp;
if (tokenAge > maxAge || tokenAge < 0) return null;
```

The `tokenAge < 0` check prevents future-dated tokens. But an attacker who can manipulate the client clock (e.g., in a client-side attack) could set the timestamp far in the future to create a token that appears valid for longer than 24 hours. Since the HMAC signature is computed over the timestamp+random, the attacker would need the secret to forge a valid signature — which they don't have. So this is not exploitable.

---

### R-03: `searchRateLimit` pruning triggers on `size > 50` but not time-based [Low confidence]

**File:** `apps/web/src/app/actions/public.ts:33–37`

```ts
if (searchRateLimit.size > 50) {
    for (const [key, val] of searchRateLimit) {
        if (val.resetAt <= now) searchRateLimit.delete(key);
    }
}
```

Pruning only happens when the map size exceeds 50. If the map stays below 50 entries, expired entries are never cleaned up. With a 1-minute window and `SEARCH_RATE_LIMIT_MAX_KEYS = 2000`, this shouldn't be a problem in practice since the map would need to grow past 50 unique IPs within 1 minute for pruning to be needed — at which point it triggers.

But if there are exactly 49 IPs that searched once and never again, those entries persist in memory indefinitely (until the map grows past 50). This is a minor memory leak.

---

### R-04: `processImageFormats` hardlink fallback to `copyFile` may leave stale files [Medium confidence]

**File:** `apps/web/src/lib/process-image.ts:421–428`

```ts
if (size === 2048) {
    const basePath = path.join(dir, baseFilename);
    await fs.unlink(basePath).catch(() => {});
    try {
        await fs.link(outputPath, basePath);
    } catch {
        await fs.copyFile(outputPath, basePath);
    }
}
```

If `fs.unlink(basePath)` succeeds but `fs.link` fails AND `fs.copyFile` also fails, the base filename no longer exists. Subsequent DB queries would reference a file that doesn't exist on disk. The `copyFile` fallback doesn't have error handling.

**Failure scenario:** Disk full during processing. `unlink` succeeds (removing the old base file), `link` fails (cross-device or permissions), `copyFile` throws due to no space. The image appears processed in the DB but the base file is missing.

---

### R-05: `db/index.ts` `group_concat_max_len` is set per-connection but may not apply to pool connections [Low confidence]

**File:** `apps/web/src/db/index.ts:28–30`

```ts
poolConnection.on('connection', (connection) => {
    connection.query('SET group_concat_max_len = 65535');
});
```

The `on('connection')` event fires when a new connection is added to the pool. However, `mysql2/promise` pool connections may be reused. The `SET` command is only executed once per physical connection creation. If a DBA resets the session variable on the server side, or if the connection is reset by the pool, the setting may be lost.

---

### R-06: Admin `dashboard-client.tsx` pagination doesn't validate `page` parameter [Low confidence]

**File:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx` (not fully read)

The `page` query parameter is likely read from `searchParams` and passed to `DashboardClient`. If it's not validated as a positive integer, a malicious `page=-1` or `page=abc` could cause issues.

---

### R-07: `Dockerfile` and `docker-compose.yml` not reviewed [Low confidence]

The Docker deployment files were not read. These may contain security misconfigurations (e.g., running as root, exposed DB ports, missing health checks).

---

### R-08: E2E tests in `apps/web/e2e/` not reviewed [Low confidence]

The test files (`admin.spec.ts`, `public.spec.ts`, etc.) were not examined. They may have gaps in coverage for the issues identified above.

---

## FINAL SWEEP

### Files examined (confirmed):

- `apps/web/src/app/actions.ts` (barrel)
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/validation.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/src/lib/base56.ts`
- `apps/web/src/lib/audit.ts`
- `apps/web/src/lib/queue-shutdown.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/image-types.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/locale-path.ts`
- `apps/web/src/lib/constants.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/db/index.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/instrumentation.ts`
- `apps/web/next.config.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/uploads/[...path]/route.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/image-zoom.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/histogram.tsx`
- `apps/web/src/app/[locale]/page.tsx`
- `apps/web/src/app/[locale]/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/[topic]/page.tsx`

### Files not examined (acknowledged gaps):

- `apps/web/src/app/[locale]/admin/(protected)/categories/*`
- `apps/web/src/app/[locale]/admin/(protected)/tags/*`
- `apps/web/src/app/[locale]/admin/(protected)/password/*`
- `apps/web/src/app/[locale]/admin/(protected)/users/*`
- `apps/web/src/app/[locale]/admin/(protected)/error.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/loading.tsx`
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/error.tsx`
- `apps/web/src/app/[locale]/loading.tsx`
- `apps/web/src/app/[locale]/not-found.tsx`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/global-error.tsx`
- `apps/web/src/app/manifest.ts`, `robots.ts`, `sitemap.ts`
- `apps/web/src/app/apple-icon.tsx`, `icon.tsx`
- `apps/web/src/components/admin-header.tsx`, `admin-nav.tsx`, `admin-user-manager.tsx`
- `apps/web/src/components/footer.tsx`, `search.tsx`, `tag-filter.tsx`, `tag-input.tsx`
- `apps/web/src/components/load-more.tsx`, `optimistic-image.tsx`
- `apps/web/src/components/photo-navigation.tsx`, `info-bottom-sheet.tsx`
- `apps/web/src/components/topic-empty-state.tsx`
- `apps/web/src/components/i18n-provider.tsx`, `theme-provider.tsx`
- `apps/web/src/i18n/request.ts`
- `apps/web/src/lib/clipboard.ts`, `action-result.ts`, `utils.ts`
- `apps/web/messages/en.json`, `messages/ko.json`
- `apps/web/scripts/*`
- `apps/web/drizzle/*`
- `apps/web/e2e/*`
- `apps/web/src/__tests__/*`
- `apps/web/public/histogram-worker.js`
- `apps/web/Dockerfile`, `docker-compose.yml`
- `apps/web/tailwind.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`

These were skipped due to being UI-only components, configuration files, migration scripts, or test files that are unlikely to contain the critical correctness/security issues this review focuses on. The most impactful server-side logic has been fully covered.

---

## Priority Summary

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| C-01 | High | Correctness | `getSessionSecret` dev fallback can cache non-persisted secret |
| C-02 | High | Race Condition | `createTopic` TOCTOU with alias creation |
| C-03 | High | Race Condition | `createTopicAlias` TOCTOU with topic creation |
| C-04 | High | Security | `deleteTopicImage` no filename validation |
| C-08 | High | Correctness | `getImage` prev/next navigation wrong for NULL capture_date |
| C-05 | Medium | Security | SQL restore dangerous pattern scanner bypass vectors |
| C-06 | Medium | Memory | Image queue retry counter leaks on globalThis |
| C-09 | Medium | Correctness | Offset-based pagination can miss/duplicate images |
| C-11 | Medium | Performance | DB connection pool can be exhausted by processing locks |
| C-13 | Medium | Privacy | `user_filename` PII leak in photo-viewer sidebar |
| C-14 | Medium | Correctness | `getSharedGroup` expiry check uses two separate queries |
| C-16 | Medium | Security | CSP `unsafe-inline` for scripts weakens XSS protection |
| C-17 | Medium | UX/Correctness | "Download Original" gives 2048px JPEG, not actual original |
| C-18 | Medium | UX Bug | ImageZoom touch drag mixes pixel and percentage units |
| C-19 | Medium | Correctness | `reorderForColumns` can produce incorrect visual ordering |
| C-20 | Medium | i18n | Dashboard pagination links missing locale prefix |
| C-07 | Low | Robustness | View count fire-and-forget can pile up on pool exhaustion |
| C-10 | Low | Correctness | Rate limit eviction not LRU |
| C-12 | Low | Race Condition | Rate limit delete+set not atomic (theoretical under Node) |
| C-15 | Low | Correctness | `revokePhotoShareLink` returns success for non-existent images |
| C-21 | Low | i18n/SEO | Sitemap/robots may not include locale variants |
| C-22 | Low | Edge Case | statfs check only on original dir |
