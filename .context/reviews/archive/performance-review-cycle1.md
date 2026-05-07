# Performance Review — Cycle 1 (2026-04-19)

**Scope:** CPU, memory, I/O, concurrency, UI responsiveness
**Methodology:** File-by-file analysis of hot paths, data layer, image pipeline, and client-side rendering

---

## FINDINGS

### PERF-01: `getSharedGroup` N+1 tag queries (same as CQ-03)
**File:** `apps/web/src/lib/data.ts:444-456`
**Severity:** MEDIUM
**Confidence:** HIGH

Each of the up to 100 images in a shared group triggers a separate `db.select()` for tags. With 100 images, this is 100 DB round-trips in `Promise.all`. A single `IN` query would reduce this to 1 round-trip.

**Impact:** +200-400ms latency on shared group pages with many images.

**Fix:** See CQ-03 — use a single batched query with `inArray`.

---

### PERF-02: `flushGroupViewCounts` sequential DB updates now parallel — but `.catch(console.debug)` swallows errors
**File:** `apps/web/src/lib/data.ts:18-30`
**Severity:** LOW
**Confidence:** HIGH

The flush was previously sequential (previous review D-06). It's now using `Promise.all` with parallel updates, which is good. However, individual failures are caught with `.catch(console.debug)` which means failed view count increments are silently lost. This is a deliberate trade-off (view counts are best-effort) but worth noting.

**Assessment:** Acceptable for a personal gallery. The parallel approach is correct.

**Reclassification:** NOT AN ISSUE — parallel flush is the right fix.

---

### PERF-03: `upload-dropzone.tsx` recreates all object URLs on every file addition
**File:** `apps/web/src/components/upload-dropzone.tsx:43-57`
**Severity:** MEDIUM
**Confidence:** HIGH

Same as CQ-01. When adding 1 file to 50 existing, all 51 object URLs are recreated. The old 50 are revoked and re-created, causing a visible flash in all preview images. This is both a performance and UX issue.

**Impact:** O(N) URL creation on every file add/remove; visual flicker for all previews.

**Fix:** Use ref-based incremental URL management.

---

### PERF-04: `searchImages` runs two separate DB queries when tag search is needed
**File:** `apps/web/src/lib/data.ts:516-564`
**Severity:** LOW
**Confidence:** MEDIUM

The search first queries images by LIKE, then if results are insufficient, queries images joined with tags. This is the documented "saves a connection" optimization. However, with MySQL's query planner, a single `UNION` or `OR` query with a subquery for tag matching might be more efficient than two separate queries.

**Assessment:** The current approach is reasonable — the tag query is only executed when needed. Not a real performance concern for the expected query volume.

**Reclassification:** NOT AN ISSUE — acceptable trade-off.

---

### PERF-05: `revalidateLocalizedPaths` calls `revalidatePath` for every path/locale combination
**File:** `apps/web/src/lib/revalidation.ts:30-40`
**Severity:** LOW
**Confidence:** MEDIUM

With 2 locales and a bulk delete of 100 images, `revalidateLocalizedPaths` calls `revalidatePath` up to 200+ times. Each call triggers ISR cache invalidation. The `seen` Set deduplicates, but the total call count can still be high.

The previous review (FS-02) identified this. The existing `revalidateAllAppData()` uses `revalidatePath('/', 'layout')` as a single-call alternative for full resets (used in DB restore). For batch operations, a similar layout-level revalidation would be more efficient.

**Fix:** For `deleteImages`, consider using `revalidatePath('/', 'layout')` instead of enumerating all affected paths. The per-photo ISR cache will be regenerated on next access.

---

### PERF-06: `home-client.tsx` `reorderForColumns` runs on every render when `allImages` or `columnCount` changes
**File:** `apps/web/src/components/home-client.tsx:174`
**Severity:** LOW
**Confidence:** MEDIUM

`useMemo(() => reorderForColumns(allImages, columnCount), [allImages, columnCount])` recalculates the column distribution whenever `allImages` changes (including when `handleLoadMore` appends new images). The algorithm is O(N) per call, which is acceptable for the expected gallery sizes (< 5000 images).

**Assessment:** Acceptable performance. The `useMemo` is correctly scoped.

**Reclassification:** NOT AN ISSUE.

---

## ISSUE SUMMARY

| ID | Severity | File | Description | Status |
|----|----------|------|-------------|--------|
| PERF-01 | MEDIUM | `data.ts:444` | N+1 tag queries in getSharedGroup | Same as CQ-03 |
| PERF-03 | MEDIUM | `upload-dropzone.tsx:43` | Object URL recreation flash | Same as CQ-01 |
| PERF-05 | LOW | `revalidation.ts:30` | Enumerative revalidatePath for batch deletes | New (prev FS-02) |
