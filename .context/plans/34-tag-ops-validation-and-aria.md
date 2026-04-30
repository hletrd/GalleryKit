# Plan 34: Tag Operations Validation, Search Optimization, and ARIA Improvements

**Priority:** MEDIUM
**Estimated effort:** 1-2 hours
**Sources:** C2-03, C2-05, C2-06, C2-10, C2-12, C2-14, C2-16
**Status:** COMPLETED (cycle 2, commits 082b43d, 9a451f4)

---

## Scope
- Add tag array size validation to batchUpdateImageTags
- Add focus-visible ring to admin checkboxes
- Optimize searchImages tag query limit
- Add aria-autocomplete to search combobox
- Fix deleteImages redundant affectedTopics filter
- Return slug collision warnings from batchUpdateImageTags
- Add TOCTOU comment to createTopicAlias

---

## Item 1: Add tag array size validation to batchUpdateImageTags (C2-03)

**File:** `apps/web/src/app/actions/tags.ts:212-215`

**Problem:** `addTagNames` and `removeTagNames` have no length cap. A malicious client could pass thousands of tag names, each triggering a DB query inside the transaction.

**Fix:**
```typescript
if (addTagNames.length > 100 || removeTagNames.length > 100) {
    return { success: false, added: 0, removed: 0, warnings: ['Too many tags in a single update (max 100 each)'] };
}
```

---

## Item 2: Add focus-visible ring to admin checkboxes (C2-05)

**File:** `apps/web/src/components/image-manager.tsx:268-274, 289-296`

**Problem:** Raw `<input type="checkbox">` has no visible focus indicator for keyboard users.

**Fix:** Replace `focus:ring-primary` with `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` on both the "select all" and per-row checkboxes.

---

## Item 3: Optimize searchImages tag query limit (C2-06)

**File:** `apps/web/src/lib/data.ts:553`

**Problem:** When the main query returns some results, the tag search still uses `effectiveLimit` as its limit, performing unnecessary DB work.

**Fix:**
```typescript
const remainingLimit = effectiveLimit - results.length;
const tagResults = remainingLimit <= 0 ? [] : await db.select(searchFields)
    .from(images)
    .innerJoin(imageTags, eq(images.id, imageTags.imageId))
    .innerJoin(tags, eq(imageTags.tagId, tags.id))
    .where(and(eq(images.processed, true), like(tags.name, searchTerm)))
    .orderBy(desc(images.created_at))
    .limit(remainingLimit);
```

---

## Item 4: Add aria-autocomplete to search combobox (C2-10)

**File:** `apps/web/src/components/search.tsx:127`

**Problem:** Missing `aria-autocomplete="list"` attribute for screen reader compatibility.

**Fix:** Add `aria-autocomplete="list"` to the Input component (alongside existing `role="combobox"` and `aria-expanded`).

---

## Item 5: Fix deleteImages redundant affectedTopics filter (C2-12)

**File:** `apps/web/src/app/actions/images.ts:360-363`

**Problem:** `imageRecords.filter(r => foundIdSet.has(r.id))` is always true since `foundIdSet` is derived from `imageRecords`.

**Fix:**
```typescript
const affectedTopics = new Set(imageRecords.map(r => r.topic));
```

---

## Item 6: Return slug collision warnings from batchUpdateImageTags (C2-14)

**File:** `apps/web/src/app/actions/tags.ts:228-262`

**Problem:** Slug collision warnings are logged via `console.warn` but not returned to the caller, unlike `addTagToImage` which returns a `warning` field.

**Fix:** Collect warnings during the transaction and include them in the return value:
```typescript
const warnings: string[] = [];
// Inside tag insertion:
if (tagRecord.name !== cleanName) {
    const msg = `Tag "${cleanName}" was mapped to existing "${tagRecord.name}" (same slug)`;
    console.warn(`Tag slug collision: "${cleanName}" collides with existing "${tagRecord.name}" on slug "${slug}"`);
    warnings.push(msg);
}
// Return:
return { success: true, added, removed, warnings };
```

---

## Item 7: Add TOCTOU comment to createTopicAlias (C2-16)

**File:** `apps/web/src/app/actions/topics.ts:229-250`

**Problem:** Missing US-007 comment documenting that TOCTOU between `topicRouteSegmentExists` and INSERT is handled by `ER_DUP_ENTRY` catch.

**Fix:** Add comment before the try block:
```typescript
// US-007: Insert directly and catch ER_DUP_ENTRY to avoid TOCTOU race
// (matching the pattern in createTopic)
```

Wait, there's already a comment at line 233: `// US-007: Insert directly and catch ER_DUP_ENTRY to avoid TOCTOU race`. Let me verify.

Actually, re-reading the code, line 233 already has this comment. So this finding is already addressed. Removing from plan.

---

## Deferred Items

- **C2-UX-04 (info sidebar state persistence):** Low priority — current behavior (reset on page navigation) is acceptable for a photo viewer. Would need sessionStorage similar to auto-lightbox, but the UX benefit is marginal.
- **C2-UX-05 (lightbox close button fullscreen flash):** Low priority — visual flash is brief and not disruptive. Changing the order could cause other issues with component unmount timing.
- **C2-SEC-04 (no explicit CSRF token):** Low priority — SameSite: lax cookies provide reasonable protection for a self-hosted gallery. Next.js server actions follow this architectural pattern. Would need a significant framework-level change.
- **C2-DI-02 (view count flush error logging):** Low priority — changing from `console.debug` to `console.warn` is a trivial change but the current behavior (silent drop) is acceptable for view counts.
- **C2-PERF-03 (NULL capture_date index):** Low priority — the fallback index on `(processed, created_at)` handles this case adequately for current data volumes.
