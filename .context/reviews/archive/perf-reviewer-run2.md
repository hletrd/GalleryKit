# Performance Review -- Cycle 1 (Run 2)

**Date**: 2026-05-05
**Focus**: CPU, memory, UI responsiveness, query performance

---

## Findings

### PR-R2-01: `revalidateAllAppData()` overuse in tag/topic actions (Low-Med, High confidence)

**File**: `apps/web/src/app/actions/tags.ts:93,131,200,261,337,466`

Multiple tag actions (`updateTag`, `deleteTag`, `addTagToImage`, `removeTagFromImage`, `batchAddTags`, `batchUpdateImageTags`) call both `revalidateLocalizedPaths` AND `revalidateAllAppData`. The latter revalidates every localized path, which is expensive. Since tag changes only affect specific photo pages, topic pages, and admin pages, the broad call is wasteful.

**Suggestion**: Replace `revalidateAllAppData()` calls in tag actions with targeted `revalidateLocalizedPaths` calls listing only the affected paths (already partially done -- the `revalidateAllAppData` is redundant).

---

### PR-R2-02: `bulkUpdateImages` runs N+1 UPDATE queries for alt text application (Low, Medium confidence)

**File**: `apps/web/src/app/actions/images.ts:906-917`

For each image needing alt text, an individual UPDATE is issued inside a transaction. For a batch of 100 images all needing alt text, this is 100 sequential queries. The total time is bounded by the transaction, but it's suboptimal.

**Suggestion**: Low priority. Bulk alt text application is rare and the transaction ensures correctness.

---

### PR-R2-03: `searchImages` tag query has no dedup limit (Low, Medium confidence)

**File**: `apps/web/src/lib/data.ts:1214-1248`

The tag search query fetches `remainingLimit` rows, but tags can match many images. If a common tag like "portrait" matches 1000 images, the query fetches `remainingLimit` rows, which is correct. The dedup Set ensures no duplicates.

**Verdict**: Properly bounded. Not a finding.