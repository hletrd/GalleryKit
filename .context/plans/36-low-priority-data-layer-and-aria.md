# Plan 36: Data Layer Optimizations and ARIA Improvements

**Priority:** MEDIUM
**Estimated effort:** 1-2 hours
**Sources:** C3-03, C3-04, C3-05, C3-06, C3-07, C3-08, C3-09, C3-10, C3-11, C3-12
**Status:** COMPLETED (cycle 3, commits 0909dd3, f481a9b, 3cfd423, 51882dc, 03813f4)

---

## Scope
- Fix searchRateLimit pruning threshold
- Track only successful upload bytes in uploadTracker
- Re-buffer failed view count increments
- Remove blur_data_url from getImageByShareKey and searchFields
- Add aria-autocomplete to TagInput
- Add nav landmark to admin navigation
- Use layout-level revalidation for large batch deletes
- Explicitly truncate original_format
- Use user_filename in CSV export

---

## Item 1: Fix searchRateLimit pruning (C3-03)

**File:** `apps/web/src/app/actions/public.ts:33-37`

**Problem:** Pruning only triggers when `searchRateLimit.size > 50`, so stale entries remain when the map is small.

**Fix:** Always prune expired entries:

```typescript
// Before:
if (searchRateLimit.size > 50) {
    for (const [key, val] of searchRateLimit) {
        if (val.resetAt <= now) searchRateLimit.delete(key);
    }
}

// After:
for (const [key, val] of searchRateLimit) {
    if (val.resetAt <= now) searchRateLimit.delete(key);
}
// Hard cap (same pattern as loginRateLimit and uploadTracker)
if (searchRateLimit.size > SEARCH_RATE_LIMIT_MAX_KEYS) {
    const excess = searchRateLimit.size - SEARCH_RATE_LIMIT_MAX_KEYS;
    let evicted = 0;
    for (const key of searchRateLimit.keys()) {
        if (evicted >= excess) break;
        searchRateLimit.delete(key);
        evicted++;
    }
}
```

Import `SEARCH_RATE_LIMIT_MAX_KEYS` from `rate-limit.ts`.

---

## Item 2: Track only successful upload bytes (C3-04)

**File:** `apps/web/src/app/actions/images.ts:226-228`

**Problem:** `tracker.bytes += totalSize` counts all files including failed ones.

**Fix:** Track bytes for successful uploads only:

```typescript
// Add a variable before the loop:
let uploadedBytes = 0;

// Inside the per-file loop, after successCount++:
uploadedBytes += file.size;

// After the loop, replace:
//   tracker.bytes += totalSize;
// With:
tracker.bytes += uploadedBytes;
```

---

## Item 3: Re-buffer failed view count increments (C3-05)

**File:** `apps/web/src/lib/data.ts:22-29`

**Problem:** `.catch(console.debug)` silently drops view counts on DB failure.

**Fix:** Re-buffer failed increments:

```typescript
await Promise.all(
    [...batch].map(([groupId, count]) =>
        db.update(sharedGroups)
            .set({ view_count: sql`${sharedGroups.view_count} + ${count}` })
            .where(eq(sharedGroups.id, groupId))
            .catch(() => {
                // Re-buffer failed increment for next flush
                viewCountBuffer.set(groupId, (viewCountBuffer.get(groupId) ?? 0) + count);
            })
    )
);
```

---

## Item 4: Remove blur_data_url from getImageByShareKey (C3-06)

**File:** `apps/web/src/lib/data.ts:361-363`

**Problem:** Shared photo page never uses blur_data_url but fetches it.

**Fix:** Remove `blur_data_url` from the select in `getImageByShareKey`:

```typescript
const result = await db.select({
    ...selectFields,
    // blur_data_url removed — not needed for shared view
})
```

---

## Item 5: Remove blur_data_url from searchFields (C3-11)

**File:** `apps/web/src/lib/data.ts:530-536`

**Problem:** Search results include blur_data_url but never use it.

**Fix:** Remove `blur_data_url` from `searchFields`:

```typescript
const searchFields = {
    id: images.id, title: images.title, description: images.description,
    filename_jpeg: images.filename_jpeg, filename_webp: images.filename_webp,
    filename_avif: images.filename_avif, width: images.width, height: images.height,
    topic: images.topic, camera_model: images.camera_model,
    capture_date: images.capture_date,
    // blur_data_url removed — not needed for search results
};
```

Note: This changes the `SearchResult` interface. Verify no consumers depend on `blur_data_url` in search results.

---

## Item 6: Add aria-autocomplete to TagInput (C3-07)

**File:** `apps/web/src/components/tag-input.tsx:143-155`

**Problem:** Combobox input missing `aria-autocomplete="list"` attribute.

**Fix:** Add the attribute:

```typescript
<input
    ref={inputRef}
    type="text"
    role="combobox"
    aria-autocomplete="list"  // Added
    aria-expanded={isOpen && !!(inputValue || filteredTags.length > 0)}
    ...
```

---

## Item 7: Add nav landmark to admin navigation (C3-08)

**File:** `apps/web/src/components/admin-nav.tsx`

**Problem:** Admin navigation uses `<div>` without landmark role or aria-label.

**Fix:** Wrap the navigation in a `<nav>` element with `aria-label`:

```tsx
<nav aria-label="Admin navigation">
    {/* existing nav content */}
</nav>
```

Also check `admin-header.tsx` for similar issues.

---

## Item 8: Layout-level revalidation for large batch deletes (C3-09)

**File:** `apps/web/src/app/actions/images.ts:387-392`

**Problem:** Deleting 100 images triggers 200+ `revalidatePath` calls.

**Fix:** Use layout-level revalidation for batches over 20:

```typescript
if (foundIds.length > 20) {
    revalidateLocalizedPaths('/', '/admin/dashboard');
} else {
    revalidateLocalizedPaths(
        '/',
        '/admin/dashboard',
        ...foundIds.map(id => `/p/${id}`),
        ...[...affectedTopics].map(topic => `/${topic}`)
    );
}
```

---

## Item 9: Explicitly truncate original_format (C3-10)

**File:** `apps/web/src/app/actions/images.ts:151`

**Problem:** `original_format` derived from filename extension is not explicitly truncated before DB insert. The column is `varchar(10)`.

**Fix:**

```typescript
original_format: (data.filenameOriginal.split('.').pop()?.toUpperCase() || '').slice(0, 10) || null,
```

---

## Item 10: Use user_filename in CSV export (C3-12)

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:36`

**Problem:** CSV export uses `filename_original` (UUID-based server filename) instead of `user_filename` (the original user-provided name which is more useful to the admin).

**Fix:** Replace `filename: images.filename_original` with `filename: images.user_filename` and rename the column header if needed.

---

## Deferred Items

None — all LOW findings are either planned above or carried forward as explicitly deferred per repo rules:

- U-15 connection limit docs mismatch: Very low priority, cosmetic only
- U-18 enumerative revalidatePath: Low priority, current approach works
- /api/og throttle architecture: Edge runtime constraint, delegated to reverse proxy
- Font subsetting: Python dependency issue
- Docker node_modules: Native module dependency

Each deferred item records:
- **File+line**: Documented above and in prior reviews
- **Original severity/confidence**: Not downgraded
- **Concrete reason for deferral**: Listed above — all are infrastructure/tooling constraints or cosmetic
- **Exit criterion**: U-15/U-18 could be reopened if a focused cleanup pass is scheduled; OG/font/Docker items depend on external dependency resolution
