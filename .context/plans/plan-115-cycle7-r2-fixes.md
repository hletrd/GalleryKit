# Plan 115 — Cycle 7 R2 Fixes

**Created:** 2026-04-19 (Cycle 7 R2)
**Status:** DONE

---

## Task 1: Remove internal filename fields from search results returned to unauthenticated users [C7R2-01]

**Severity:** MEDIUM | **Confidence:** HIGH | **Agents:** 4

**Files:**
- `apps/web/src/lib/data.ts` lines 573-604
- `apps/web/src/app/actions/public.ts` line 97

**Problem:** `searchImages` returns `filename_jpeg`, `filename_webp`, `filename_avif` in `SearchResult`, which is used by the unauthenticated `searchImagesAction`. This bypasses the `publicSelectFields` privacy guard.

**Fix:**
1. Remove `filename_jpeg`, `filename_webp`, `filename_avif` from the `searchFields` object in `searchImages`
2. Remove these fields from the `SearchResult` interface
3. Update `searchImagesAction` return type accordingly
4. The search UI only needs `id`, `title`, `description`, `width`, `height`, `topic`, `camera_model`, `capture_date` for rendering

**Verification:** DONE. Grep confirmed no references to removed filename fields. All gates pass (eslint, tsc, build, vitest). Commit: `0000000547858117e4d9722ca897b18b86e3d74c`.

---

## Task 2: Fix `uploadImages` tag batch to use name-first lookup [C7R2-02]

**Severity:** MEDIUM | **Confidence:** HIGH | **Agents:** 2

**File:** `apps/web/src/app/actions/images.ts` lines 188-190

**Problem:** The tag batch in `uploadImages` uses `inArray(tags.slug, slugs)` — slug-only lookup. When two tag names produce the same slug, the wrong tag is linked.

**Fix:**
1. After `db.insert(tags).ignore().values(tagEntries)`, fetch tag records by name first using `inArray(tags.name, uniqueTagNames)`, then fetch remaining by slug for any not found by name
2. This matches the pattern already used in `addTagToImage`, `batchAddTags`, and `batchUpdateImageTags`
3. Keep the slug collision warning log

**Verification:** DONE. Code matches addTagToImage/batchAddTags pattern. All gates pass. Commit: `0000000ff8397e24d99e0dd1b8a2622deea061f3`.

---

## Task 3: Wrap `updateSeoSettings` and `updateGallerySettings` loops in transactions [C7R2-03]

**Severity:** LOW | **Confidence:** MEDIUM | **Agents:** 3

**Files:**
- `apps/web/src/app/actions/seo.ts` lines 100-111
- `apps/web/src/app/actions/settings.ts` lines 57-67

**Problem:** Both functions iterate over settings performing individual DB upserts without a transaction. A crash mid-loop leaves partial state.

**Fix:**
1. In `updateSeoSettings`: wrap the `for (const [key, value] of Object.entries(settings))` loop inside `db.transaction(async (tx) => { ... })`, using `tx` instead of `db`
2. In `updateGallerySettings`: same pattern — wrap the loop in `db.transaction()`
3. Keep the storage backend switch outside the transaction (it's a runtime operation, not DB state)

**Verification:** DONE. Both functions wrapped in db.transaction(). All gates pass. Commit: `0000000ae970b91c471cf44af413e3e6b33d8881`.

---

## Deferred Items

### C7R2-DEFER-01: `flushGroupViewCounts` re-buffer loop buffer overflow [LOW] [MEDIUM]
- **File:** `apps/web/src/lib/data.ts` lines 53-58
- **Original severity/confidence:** LOW / MEDIUM
- **Reason:** Already deferred as C30-03 / C36-03. The buffer-overflow angle adds nuance but the practical impact remains LOW (only under sustained DB outage + high traffic). The existing cap check in `bufferGroupViewCount` provides adequate protection for normal operation.
- **Exit criterion:** If buffer overflow is observed in production logs or if the processing queue is made concurrent.

### C7R2-DEFER-02: Search component ARIA roles [LOW] [MEDIUM]
- **File:** `apps/web/src/components/search.tsx`
- **Reason:** Needs manual UI inspection with screen reader. Cannot verify programmatically. shadcn/ui combobox pattern generally provides good ARIA support.
- **Exit criterion:** Accessibility audit flags search component.

### C7R2-DEFER-03: Back-to-top focus management [LOW] [LOW]
- **File:** `apps/web/src/components/home-client.tsx` lines 334-350
- **Reason:** LOW confidence and LOW severity. Focus management on scroll-to-top is a minor UX polish, not a functional bug.
- **Exit criterion:** Accessibility audit flags focus management.

### C7R2-DEFER-04: No unit tests for `data.ts` view count buffering [LOW] [HIGH]
- **File:** `apps/web/src/lib/data.ts` lines 25-72
- **Reason:** Test coverage gap. The buffering logic is tested indirectly via E2E. Adding unit tests is beneficial but not blocking.
- **Exit criterion:** Test coverage sprint.

### C7R2-DEFER-05: No unit tests for `settings.ts` or `seo.ts` [LOW] [MEDIUM]
- **Files:** `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/seo.ts`
- **Reason:** Test coverage gap. Server actions with DB dependencies are harder to unit test without mocking.
- **Exit criterion:** Test coverage sprint.

### C7R2-DEFER-06: No unit tests for `image-types.ts` utilities [LOW] [HIGH]
- **File:** `apps/web/src/lib/image-types.ts` lines 50-60
- **Reason:** Simple utility functions. Adding tests is beneficial but not blocking.
- **Exit criterion:** Test coverage sprint.
