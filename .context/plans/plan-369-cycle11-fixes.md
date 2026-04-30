# Plan 369 — Cycle 11: Code correctness and queue optimization fixes

## Origin

C11-MED-01 and C11-MED-02 from cycle 11 aggregate review. Low-severity findings are deferred (see plan-370).

## Status

Done. Commits `42c7306` (C11-MED-01), `4a22a98` (C11-MED-02), `31aa530` (test). All gates pass (tsc, eslint, lint:api-auth, lint:action-origin, vitest 577/577, next build).

## C11-MED-01: Add topic-existence validation to `uploadImages`

### Problem

`uploadImages` validates the topic slug format with `isValidSlug(topic)` but never checks that the topic actually exists in the `topics` table. If an admin deletes a topic while another admin has the upload form open, images are inserted with an orphaned `topic` slug. The schema uses `varchar` without a FK constraint on `images.topic`, so the INSERT succeeds but the topic's metadata (label, order, image_filename) is missing.

### Implementation

In `apps/web/src/app/actions/images.ts`, after the `isValidSlug(topic)` check (line 237) and before the tracker pre-increment (line 243), add a topic existence check:

```ts
// Verify the topic exists in the database before accepting uploads.
// Without this, deleting a topic while another admin has the upload form
// open results in orphaned images with no topic metadata.
const [topicRow] = await db.select({ slug: topics.slug })
    .from(topics)
    .where(eq(topics.slug, topic))
    .limit(1);
if (!topicRow) {
    return { error: t('topicNotFound') };
}
```

This requires importing `topics` from `@/db` (already imported at line 5: `import { db, images, imageTags, sharedGroups, sharedGroupImages } from '@/db'` — need to add `topics`).

Also add the `t('topicNotFound')` translation key to both `messages/en.json` and `messages/ko.json` under `serverActions`.

### Files changed

- `apps/web/src/app/actions/images.ts`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/__tests__/images-actions.test.ts` (add test for non-existent topic)

## C11-MED-02: Add `permanentlyFailedIds` check to `enqueueImageProcessing`

### Problem

When a claim-retry timer fires (line 247), it calls `enqueueImageProcessing(job)`. The function checks `state.enqueued.has(job.id)` and `state.shuttingDown` but not `state.permanentlyFailedIds.has(job.id)`. If the image was marked as permanently failed between the claim failure and the retry timer, the job is re-enqueued and attempts processing, wasting a DB query and advisory lock attempt.

### Implementation

In `apps/web/src/lib/image-queue.ts`, add a check at the top of `enqueueImageProcessing`, after the `state.shuttingDown` check (line 208):

```ts
// C11-MED-02: skip permanently-failed images so claim-retry timers
// don't re-enqueue a job that already exceeded MAX_RETRIES.
if (state.permanentlyFailedIds.has(job.id)) {
    console.debug(`[Queue] Skipping job ${job.id} — permanently failed`);
    return;
}
```

### Files changed

- `apps/web/src/lib/image-queue.ts`
