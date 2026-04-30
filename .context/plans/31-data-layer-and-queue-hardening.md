# Plan 31: Data Layer and Queue Hardening

**Priority:** HIGH
**Estimated effort:** 2-3 hours
**Sources:** U-04, U-05, U-06, U-08, U-09, U-14, U-16, U-17
**Status:** COMPLETED (cycle 1, commits 10f41f5, c4a289e, 9e01a8f)

---

## Scope
- Cap claim retries in image processing queue
- Fix N+1 tag queries in getSharedGroup
- Unify maxInputPixels configuration
- Fix revokePhotoShareLink misleading error
- Remove unused adminExtraFields export
- Add random suffix to backup filenames
- Fix bigint precision for original_file_size
- Add error handling for orphaned topic image cleanup

---

## Item 1: Cap claim retries in image queue (U-04)

**File:** `apps/web/src/lib/image-queue.ts:112-118`

**Problem:** When a job cannot acquire a MySQL advisory lock, it re-enqueues itself via `setTimeout` with no cap. If another worker holds the lock permanently, the job retries every 5 seconds forever.

**Fix:** Add a `claimRetryCounts` Map and cap at 10 attempts with escalating backoff:

```typescript
// In ProcessingQueueState type, add:
// claimRetryCounts: Map<number, number>;

// In the claim failure handler:
const claimRetries = (state.claimRetryCounts.get(job.id) || 0) + 1;
if (claimRetries >= 10) {
    state.claimRetryCounts.delete(job.id);
    state.enqueued.delete(job.id);
    console.error(`[Queue] Job ${job.id} failed to acquire claim ${claimRetries} times, giving up`);
    return;
}
state.claimRetryCounts.set(job.id, claimRetries);
const delay = CLAIM_RETRY_DELAY_MS * Math.min(claimRetries, 5); // escalating up to 25s
const retryTimer = setTimeout(() => {
    enqueueImageProcessing(job);
}, delay);
retryTimer.unref?.();
```

Also clear `claimRetryCounts` in the finally block alongside `retryCounts`.

---

## Item 2: Fix N+1 tag queries in getSharedGroup (U-05)

**File:** `apps/web/src/lib/data.ts:444-456`

**Problem:** Each of the up to 100 images triggers a separate DB query for tags.

**Fix:** Replace the `Promise.all(groupImages.map(...))` with a single batched query:

```typescript
import { inArray } from 'drizzle-orm';

// After fetching groupImages:
let imagesWithTags;
if (groupImages.length > 0) {
    const imageIds = groupImages.map(img => img.id);
    const allTagRows = await db.select({
        imageId: imageTags.imageId,
        slug: tags.slug,
        name: tags.name,
    })
    .from(imageTags)
    .innerJoin(tags, eq(imageTags.tagId, tags.id))
    .where(inArray(imageTags.imageId, imageIds));

    const tagsByImage = new Map<number, { slug: string; name: string }[]>();
    for (const t of allTagRows) {
        const arr = tagsByImage.get(t.imageId) || [];
        arr.push({ slug: t.slug, name: t.name });
        tagsByImage.set(t.imageId, arr);
    }

    imagesWithTags = groupImages.map(img => ({
        ...img,
        tags: tagsByImage.get(img.id) || [],
    }));
} else {
    imagesWithTags = [];
}
```

---

## Item 3: Unify maxInputPixels configuration (U-06)

**File:** `apps/web/src/lib/process-topic-image.ts:11-14`, `apps/web/src/lib/process-image.ts:20-23`

**Problem:** Both files parse `IMAGE_MAX_INPUT_PIXELS` independently with different fallback defaults (64M vs 256M). Setting the env var overrides both, eliminating the intentional lower limit for topic images.

**Fix:** Create a shared config in `process-image.ts` and import it in `process-topic-image.ts`:

```typescript
// In process-image.ts, export:
export const MAX_INPUT_PIXELS = maxInputPixels;
export const MAX_INPUT_PIXELS_TOPIC = (() => {
    const envTopicPixels = Number.parseInt(process.env.IMAGE_MAX_INPUT_PIXELS_TOPIC ?? '', 10);
    return Number.isFinite(envTopicPixels) && envTopicPixels > 0
        ? envTopicPixels
        : 64 * 1024 * 1024;
})();
```

```typescript
// In process-topic-image.ts, import:
import { MAX_INPUT_PIXELS_TOPIC } from '@/lib/process-image';
// Use MAX_INPUT_PIXELS_TOPIC instead of local maxInputPixels
```

---

## Item 4: Fix revokePhotoShareLink misleading error (U-09)

**File:** `apps/web/src/app/actions/sharing.ts:126-146`

**Problem:** If the image exists but `share_key` is already null, the UPDATE affects 0 rows and returns `{ error: 'Share link not found' }`.

**Fix:** Check `share_key` before the UPDATE:

```typescript
const [image] = await db.select({ id: images.id, share_key: images.share_key })
    .from(images).where(eq(images.id, imageId));
if (!image) return { error: 'Image not found' };
if (!image.share_key) return { error: 'Image does not have an active share link' };

const [result] = await db.update(images)
    .set({ share_key: null })
    .where(eq(images.id, imageId));
```

---

## Item 5: Remove unused adminExtraFields export (U-14)

**File:** `apps/web/src/lib/data.ts:579`

**Problem:** `adminExtraFields` is exported but never imported. It contains PII fields (latitude, longitude, user_filename).

**Fix:** Remove the `export` keyword. Keep the constant as a module-local reference for future admin queries.

---

## Item 6: Add random suffix to backup filenames (U-08)

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:84-85`

**Problem:** Backup filenames follow a predictable `backup-YYYY-MM-DDTHH-MM-SS-mmm.sql` pattern.

**Fix:**
```typescript
const filename = `backup-${timestamp}-${randomUUID().slice(0, 8)}.sql`;
```

---

## Item 7: Fix bigint precision for original_file_size (U-16)

**File:** `apps/web/src/db/schema.ts:50`

**Problem:** `bigint('original_file_size', { mode: 'number' })` can lose precision above 2^53.

**Fix:** This requires a Drizzle migration. The safest approach is to add a runtime validation in `saveOriginalAndGetMetadata` or `uploadImages` to ensure `file.size` (which is a JavaScript number) is within `Number.MAX_SAFE_INTEGER`. Since file sizes are capped at 200MB, this is already guaranteed.

```typescript
// In uploadImages, after file.size check:
if (file.size > Number.MAX_SAFE_INTEGER) {
    return { error: 'File size exceeds maximum representable value' };
}
```

This is a defensive check. The real fix (changing to `mode: 'bigint'`) would require updating all consumers, which is more disruptive than warranted for a 200MB upload limit.

---

## Item 8: Add error handling for orphaned topic image cleanup (U-17)

**File:** `apps/web/src/app/actions/topics.ts:161-163`

**Problem:** If `deleteTopicImage` fails after a successful DB update, the old image file remains as an orphan with no logging.

**Fix:**
```typescript
if (previousImageFilename && imageFilename && previousImageFilename !== imageFilename) {
    try { await deleteTopicImage(previousImageFilename); }
    catch (e) { console.error('Failed to delete previous topic image:', previousImageFilename, e); }
}
```

---

## Deferred Items

None — all data integrity findings are planned above.
