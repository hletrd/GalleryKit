# Plan 15: Correctness Fixes — Round 5 ✅ DONE

**Priority:** P1 (items 1-2), P2 (items 3-5), P3 (items 6-11)
**Estimated effort:** 5-6 hours
**Sources:** Comprehensive Review R5 (H-01, H-07, M-04, L-05, L-06, M-09), Prior Review (C-06, C-09, C-17, Q-02, Q-03, Q-05, R4-15, R4-7, P2-005)

---

## 1. Fix image-queue retry counter memory leak + finally block bug (P1)
**Source:** C-06 (revised), H-01 (R5 review)
**File:** `src/lib/image-queue.ts:35-49, 169-184`

Two related bugs:
1. Retry counts are stored on `globalThis` and never cleaned up. After thousands of images, properties accumulate indefinitely.
2. The `finally` block at line 183 unconditionally deletes the job ID from `state.enqueued`, undoing the retry re-enrollment from the `catch` block.

**Fix:**
- Replace `globalThis` storage with a `Map<number, number>` inside the queue state object
- Add a `retried` flag to prevent the finally block from deleting the re-enrolled job:
  ```ts
  let retried = false;
  // In catch block:
  if (retries < MAX_RETRIES) {
      state.retryCounts.set(job.id, retries);
      state.enqueued.delete(job.id);
      enqueueImageProcessing(job);
      retried = true;
      return;
  }
  // In finally block:
  if (!retried) {
      state.enqueued.delete(job.id);
  }
  ```
- Delete Map entries when MAX_RETRIES is reached or job is removed from queue

**Verification:**
- [ ] `globalThis` no longer has `retry_` prefixed keys after processing
- [ ] Retries still work correctly (fail after MAX_RETRIES)
- [ ] Re-enqueued jobs remain in `state.enqueued` (not deleted by finally)
- [ ] Memory doesn't grow unbounded over time

---

## 2. Add timeout to SIGTERM queue draining (P1)
**Source:** R4-15 (Codex review #15)
**File:** `src/instrumentation.ts:6-16`

If queue has backlog, `onIdle()` never resolves while paused → process hangs on SIGTERM.

**Fix:**
- Remove the `pause()` call before `onIdle()` — let the queue finish naturally
- Add a hard timeout:
  ```ts
  const shutdownPromise = shutdownImageProcessingQueue();
  const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 15000));
  await Promise.race([shutdownPromise, timeoutPromise]);
  process.exit(0);
  ```
- 15-second timeout is generous for Sharp jobs on a 6GB machine
- Log a warning if timeout fires: "Shutdown timed out, forcing exit with queued jobs remaining"

**Verification:**
- [ ] Process exits within 15s of SIGTERM even with queued backlog
- [ ] Running jobs get a chance to complete
- [ ] Warning logged when timeout fires

---

## 3. Fix "Download Original" label mismatch (P2)
**Source:** C-17
**File:** `src/components/photo-viewer.tsx:51-53`

Button says "Download Original" but gives 2048px JPEG, not the actual original file.

**Fix:**
- Option A (simple): Change the i18n key from `viewer.downloadOriginal` to `viewer.downloadJpeg` / "Download JPEG" in both locales
- Option B (proper): Add an authenticated API route `/api/admin/download-original/[id]` that serves from `original/` dir, and change the public button to "Download JPEG"
- Recommend Option A for now — it's honest about what the user gets
- Update `messages/en.json`: `"downloadOriginal": "Download Original"` → `"downloadJpeg": "Download JPEG"`
- Update `messages/ko.json`: `"downloadOriginal": "원본 다운로드"` → `"downloadJpeg": "JPEG 다운로드"`

**Verification:**
- [ ] Button text accurately reflects the download format
- [ ] Korean label is correct

---

## 4. Remove upload dedup title fallback (P2)
**Source:** P2-005, Q-02
**File:** `src/app/actions/images.ts:74-89`

Dedup matches on `user_filename` OR (if `user_filename` is null, by `title`). This causes silent overwrite when a different image happens to have the same title as a new file's name.

**Fix:**
- Remove the title fallback from the `WHERE` clause:
  ```ts
  // Before
  .where(or(
      eq(images.user_filename, originalFilename),
      and(isNull(images.user_filename), eq(images.title, originalFilename))
  ))

  // After — match only on user_filename
  .where(eq(images.user_filename, originalFilename))
  ```
- This means legacy rows without `user_filename` will no longer be auto-replaced by filename match
- Those rows would need manual replacement instead
- Add a brief comment explaining why title matching was removed

**Verification:**
- [ ] Uploading `sunset.jpg` no longer replaces an image titled "sunset.jpg"
- [ ] Re-uploading the same file still replaces correctly (user_filename matches)
- [ ] Build passes

---

## 5. Surface tag slug collision to the client (P2)
**Source:** Q-03
**File:** `src/app/actions/tags.ts:96-116`

When two tag names produce the same slug, the wrong tag is silently linked. Currently only `console.warn`.

**Fix:**
- Return a warning in the action response:
  ```ts
  if (tagRecord.name !== cleanName) {
      return { success: true as const, tagId: tagRecord.id, warning: `Tag "${cleanName}" was mapped to existing "${tagRecord.name}" (same slug)` };
  }
  ```
- Update `ActionResult` type (or the return type) to include optional `warning`
- In `image-manager.tsx` and `tag-input.tsx`, show a toast if `result.warning` is present
- Same fix for `batchAddTags`: collect warnings per tag and return them

**Verification:**
- [ ] Creating tag "Black/White" when "Black-White" exists shows a warning toast
- [ ] The correct existing tag is still linked (no data corruption)
- [ ] No warning when slug is unique

---

## 6. Fix `exportImagesCsv` error handling consistency (P3)
**Source:** Q-05
**File:** `src/app/[locale]/admin/db-actions.ts:31-34`

`exportImagesCsv` throws `Error("Unauthorized")` while other actions return `{ error: 'Unauthorized' }`.

**Fix:**
- Change to return structured error:
  ```ts
  if (!(await isAdmin())) {
      return { error: 'Unauthorized' };
  }
  ```
- Update caller in `db/page.tsx` if needed (it currently uses try/catch)

**Verification:**
- [ ] Error format consistent with other admin actions

---

## 7. Add DB constraint for topic alias/slug collision (P3)
**Source:** R4-7 (Codex review #7)
**File:** `src/db/schema.ts`, `src/app/actions/topics.ts`

App-level checks prevent alias values matching topic slugs, but no DB-level constraint exists. A direct DB write could create shadowing.

**Fix:**
- Add a comment documenting the constraint at the schema level
- In `createTopicAlias`, add explicit check that the alias doesn't match any existing `topics.slug`:
  ```ts
  const slugExists = await db.select({ slug: topics.slug }).from(topics).where(eq(topics.slug, alias)).limit(1);
  if (slugExists.length > 0) return { error: 'Alias conflicts with existing topic slug' };
  ```
- This is defense-in-depth on top of the existing `topicRouteSegmentExists` check

**Verification:**
- [ ] Creating alias "travel" when topic slug "travel" exists returns error
- [ ] No regression in normal alias creation

---

## 8. Convert offset pagination to cursor-based (P3)
**Source:** C-09
**File:** `src/app/actions/public.ts:9-21`

Offset-based pagination can miss/duplicate images when new images are uploaded between page loads.

**Fix:**
- Accept cursor parameters instead of offset:
  ```ts
  export async function loadMoreImages(
      cursor?: string, // base64-encoded "capture_date|created_at|id"
      limit?: number,
  )
  ```
- Build `WHERE` clause using row comparison:
  ```sql
  WHERE (capture_date, created_at, id) < (cursor_date, cursor_created, cursor_id)
  ```
- Encode/decode cursor as base64 JSON string
- Update `load-more.tsx` to pass cursor from last image instead of offset
- This is a larger change — defer if not urgent

**Verification:**
- [ ] Uploading during browsing doesn't cause duplicate/missing images
- [ ] Backwards compatible with existing client (offset fallback)

---

## 9. Fix `migrate-aliases.ts` exit code on error (P3)
**Source:** H-07 (R5 review)
**File:** `apps/web/scripts/migrate-aliases.ts:24-29`

The `catch` block logs the error but execution falls through to `process.exit(0)`. A failed migration reports success.

**Fix:**
- Add `process.exit(1)` in the catch block
- Move `process.exit(0)` into the try block

**Verification:**
- [ ] Failed migration exits with code 1

---

## 10. Fix `deleteGroupShareLink` returns success for non-existent groups (P3)
**Source:** L-05 (R5 review)
**File:** `src/app/actions/sharing.ts:126-137`

Delete always returns `{ success: true }` regardless of `affectedRows`.

**Fix:**
- Check `affectedRows` and return error if 0 rows affected

**Verification:**
- [ ] Deleting non-existent group returns error

---

## 11. Fix `updateImageMetadata` returns success for non-existent images (P3)
**Source:** L-06 (R5 review)
**File:** `src/app/actions/images.ts:415-429`

UPDATE affects 0 rows when image ID doesn't exist but still returns `{ success: true }`.

**Fix:**
- Check `affectedRows` and return error if 0 rows updated

**Verification:**
- [ ] Updating non-existent image returns error

---

## Priority order

1. Item 1 (retry counter leak) — memory bug, straightforward
2. Item 2 (SIGTERM timeout) — can hang production deployments
3. Item 4 (remove title fallback) — prevents silent data loss
4. Item 3 (download label) — honest UX
5. Item 5 (tag collision warning) — prevents confusion
6. Items 6-8 — consistency and robustness
