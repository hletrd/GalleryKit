# Cycle 6 Comprehensive Review (2026-04-19)

**Reviewer:** Single-agent multi-angle review (code quality, security, performance, UI/UX, data integrity)
**Scope:** Full repository sweep, all source files re-examined after 5 prior cycles of fixes.

---

## Methodology

Every source file under `apps/web/src/` was read in full. Prior cycle findings (C1-C5, U-01 through U-21) were cross-referenced to avoid duplication. The review focuses on issues not previously identified, with emphasis on cross-file interactions, edge cases, and subtle correctness bugs.

---

## New Findings

### C6-01: `photo-viewer.tsx` keyboard handler intercepts 'f'/'F' in input fields within lightbox

**File:** `apps/web/src/components/photo-viewer.tsx` lines 136-141
**Severity:** MEDIUM | **Confidence:** HIGH

**Description:** The photo viewer registers a global `keydown` listener that toggles the lightbox on 'f'/'F'. It has a guard for `HTMLInputElement` and `HTMLTextAreaElement`, but only when `showLightbox` is false (line 131: `if (showLightbox) return`). The lightbox component (lightbox.tsx lines 111-133) has its own keyboard handler that also handles 'f'/'F' with the same guard. However, neither handler checks for `contentEditable` elements or `<select>` elements, which can also receive keyboard input. More importantly, the photo viewer handler at line 131 skips entirely when lightbox is open, so this is actually not a direct issue — but the lightbox handler at line 117 does check `e.target instanceof HTMLInputElement`. The real issue is that neither handler guards against `contentEditable` or `[role="textbox"]` elements, which could be added in the future.

**Concrete scenario:** If a contentEditable element is ever added inside the lightbox (e.g., a comment input), pressing 'f' would toggle fullscreen instead of typing the letter.

**Fix:** Extract a shared `isEditableTarget(e: KeyboardEvent)` helper that checks `HTMLInputElement`, `HTMLTextAreaElement`, `contentEditable`, and `[role="textbox"]`, and use it in both handlers.

---

### C6-02: `image-manager.tsx` batch tag add uses raw `<input>` instead of `<Input>` component — inconsistent styling and missing accessibility

**File:** `apps/web/src/components/image-manager.tsx` lines 213-221
**Severity:** LOW | **Confidence:** HIGH

**Description:** The batch tag add AlertDialog uses a raw `<input>` element with inline className mimicking the shadcn/ui `<Input>` component, instead of using the actual `<Input>` component. This means:
1. Any future styling changes to `<Input>` won't propagate here
2. The raw `<input>` lacks `aria-*` attributes that `<Input>` may provide
3. The `onKeyDown` handler for Enter doesn't prevent form submission context (no `e.preventDefault()` on Enter within the AlertDialog)

**Concrete scenario:** A user types a tag name and presses Enter — the AlertDialogAction fires AND `handleBatchAddTag` fires simultaneously (race on the same state).

**Fix:** Replace with `<Input>` component and add `e.preventDefault()` in the `onKeyDown` handler.

---

### C6-03: `upload-dropzone.tsx` — concurrent uploads may exceed per-IP cumulative byte limit due to TOCTOU

**File:** `apps/web/src/app/actions/images.ts` lines 72-108
**Severity:** MEDIUM | **Confidence:** MEDIUM

**Description:** The server-side upload tracker checks cumulative bytes before processing, but the check and the tracker update happen at different points in the function. Between lines 77-82 (read tracker, check window) and line 227-229 (update tracker after all files processed), multiple concurrent uploads from the same IP could all pass the byte check and each upload their full payload, exceeding the limit. The client sends files with `UPLOAD_CONCURRENCY = 3` parallel requests.

The flow is:
1. Request A reads tracker: 0 bytes
2. Request B reads tracker: 0 bytes (same state, A hasn't written yet)
3. Both pass the cumulative check
4. Both upload their files
5. Both update tracker sequentially — total exceeds limit

**Concrete scenario:** With a 2GB limit, two concurrent 1.5GB uploads both pass the 0-byte check, resulting in 3GB total — exceeding the limit by 50%.

**Fix:** Pre-increment the tracker bytes before processing (similar to the rate-limit TOCTOU fix pattern), and subtract on failure. Alternatively, use the upload IP as a mutex key via the MySQL advisory lock pattern already used in db-actions.ts.

---

### C6-04: `topic-manager.tsx` — `handleDelete` and `handleDeleteAlias` fire action before dialog fully closes

**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` lines 196, 272
**Severity:** LOW | **Confidence:** HIGH

**Description:** In the AlertDialogAction `onClick` handlers, the pattern is `onClick={() => { if (deleteSlug) handleDelete(deleteSlug); setDeleteSlug(null); }}`. The `handleDelete` function is async, and `setDeleteSlug(null)` is called synchronously after starting the async operation. This means the dialog closes immediately (via `onOpenChange` triggered by state change), but the user gets no visual feedback that the deletion is in progress. The same pattern exists in `tag-manager.tsx` line 128.

While not a bug per se (the delete does complete), there's no loading state shown to the user during deletion. If the server is slow, the user might think nothing happened and try again.

**Concrete scenario:** User clicks delete, dialog closes immediately, then the page refreshes 2-3 seconds later with the item removed. During that gap, the item still appears in the table.

**Fix:** Add an `isDeleting` state that disables the action button and shows a spinner, similar to `deletingId` in `image-manager.tsx`.

---

### C6-05: `data.ts` `getSharedGroup` — view count incremented even for expired group queries that return null

**File:** `apps/web/src/lib/data.ts` lines 406-431
**Severity:** LOW | **Confidence:** HIGH

**Description:** The `getSharedGroup` function first queries for the group with the expiry check (lines 416-427), and only returns null if no group is found. However, `bufferGroupViewCount(group.id)` is called at line 430 after confirming the group exists. The issue is that the view count is buffered before the group's images are fetched. If the image fetch fails (DB error), the view count is still incremented but the user sees an error. This is minor — the view count increment is correct since the group was accessed — but it means the view count can slightly overcount on DB errors during image fetch.

**Concrete scenario:** A shared group exists and hasn't expired. User accesses it. The group query succeeds, view count is buffered. The image JOIN query fails. The user sees an error page but the view count was incremented.

**Fix:** Move `bufferGroupViewCount` after the image fetch completes successfully. This is a low-priority fix since DB failures during the image query are extremely rare and the overcount is at most 1 per failure.

---

### C6-06: `process-image.ts` — blur placeholder generated at 16px with JPEG quality 40 may produce invalid base64 data URL on corrupt input

**File:** `apps/web/src/lib/process-image.ts` lines 255-263
**Severity:** LOW | **Confidence:** MEDIUM

**Description:** The blur placeholder generation wraps in try/catch and sets `blurDataUrl` to null on failure, which is correct. However, if `blurBuffer` is empty (zero bytes) but the `toBuffer()` call doesn't throw, `blurBuffer.toString('base64')` would produce an empty string, resulting in `data:image/jpeg;base64,` — an invalid data URL that could cause rendering issues in Next.js's `<Image>` component.

**Concrete scenario:** A degenerate image passes Sharp metadata validation but produces an empty blur buffer. The base64 string would be empty, creating a broken data URL.

**Fix:** Add a size check: `if (blurBuffer.length > 0) { blurDataUrl = ... }`.

---

### C6-07: `auth.ts` login — session fixation prevention deletes all sessions except current, but current session may not be persisted yet

**File:** `apps/web/src/app/actions/auth.ts` lines 150-160
**Severity:** MEDIUM | **Confidence:** MEDIUM

**Description:** After successful login, the code inserts a new session (line 150-154), then deletes all other sessions for the user (lines 157-159), and finally sets the cookie (lines 167-173). The delete query uses `sql\`${sessions.id} != ${hashSessionToken(sessionToken)}\`` to exclude the new session. This is correct — the new session was already inserted, so the hash matches. However, the delete runs in the same implicit transaction scope as the insert in MySQL, and if the insert somehow produces a duplicate session ID hash (astronomically unlikely with HMAC-SHA256 but theoretically possible), the delete would remove the existing session and the new insert would have failed, leaving the user with no valid session but a set cookie pointing to a non-existent session.

**Concrete scenario:** A collision in HMAC-SHA256 session token hashes — astronomically unlikely (~2^-256) but if it occurred, the user would be logged out and unable to log in until the conflicting session expired.

**Fix:** Wrap the insert + delete in an explicit transaction, and check the insert result before deleting other sessions.

---

### C6-08: `admin-user-manager.tsx` — `user.username === 'admin'` hardcoded check to prevent deletion is fragile

**File:** `apps/web/src/components/admin-user-manager.tsx` line 123
**Severity:** LOW | **Confidence:** HIGH

**Description:** The component uses `disabled={user.username === 'admin'}` to prevent deleting the default admin user. However, the server-side `deleteAdminUser` function (`admin-users.ts` line 60-94) correctly checks if it's the last admin (count-based), not a specific username. The client-side check is redundant but also incorrect: if the default admin's username was changed (e.g., from 'admin' to 'superadmin'), the button would no longer be disabled. Meanwhile, if a second user named 'admin' was created, their delete button would be incorrectly disabled.

**Concrete scenario:** Admin changes default username from 'admin' to 'superadmin'. The UI now allows deleting the last admin (button is enabled). The server correctly blocks it, but the UX is confusing — the user expects the button to be disabled.

**Fix:** Remove the hardcoded username check and rely on the server-side last-admin check. The server already returns a clear error message. Alternatively, add a server-provided `isLastAdmin` flag.

---

### C6-09: `db-actions.ts` — `exportImagesCsv` does not limit memory for very large galleries

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 30-71
**Severity:** MEDIUM | **Confidence:** MEDIUM

**Description:** The CSV export fetches up to 50,000 rows (line 50) and then materializes the entire CSV in memory as a string (lines 52-67). Each row includes tags via GROUP_CONCAT, which can be large. For 50,000 rows with average 200 bytes each, this is ~10MB of string data, which is manageable. However, the `results` array itself also stays in memory during the `map()` call, effectively doubling memory usage to ~20MB. For galleries with many tags per image, GROUP_CONCAT could produce much longer strings.

**Concrete scenario:** A gallery with 50,000 images, each with 20+ tags. GROUP_CONCAT produces ~500 bytes per row. Total: 50,000 * 500 = 25MB for results + 25MB for CSV string = 50MB. This is under the default Node.js heap but could be problematic in memory-constrained Docker containers.

**Fix:** Stream the CSV response instead of materializing it entirely in memory. Use a Transform stream that converts rows to CSV lines as they're fetched.

---

### C6-10: `image-queue.ts` — `bootstrapImageProcessingQueue` does not handle large numbers of pending images

**File:** `apps/web/src/lib/image-queue.ts` lines 245-292
**Severity:** LOW | **Confidence:** MEDIUM

**Description:** On startup, the bootstrap function fetches ALL unprocessed images (line 251-258) and enqueues them all. With a PQueue concurrency of 2 (line 57), this could queue hundreds of jobs at once. While PQueue handles this correctly (it processes them sequentially up to concurrency), the initial SELECT query could return a very large result set if many images were uploaded before a restart.

**Concrete scenario:** 500 images uploaded in a batch, server crashes. On restart, all 500 are fetched and enqueued. The SELECT is fine (only fetching needed columns), but the queue will process them 2 at a time for hours, during which Sharp processes consume significant CPU.

**Fix:** This is acceptable behavior — the queue correctly processes them sequentially. Document that the queue processes unprocessed images on restart with the configured concurrency. No code change needed, but the behavior should be documented for operators.

---

## No-Action / By-Design Observations

1. **`serve-upload.ts` missing `.gif` in content types** — GIF is listed in `ALLOWED_EXTENSIONS` in process-image.ts but not in `CONTENT_TYPES` in serve-upload.ts. However, GIF uploads are accepted and processed, and the output is always in JPEG/WebP/AVIF formats, so GIF originals in `original/` are never served through this route (the `original/` directory is excluded from `ALLOWED_UPLOAD_DIRS`). **No fix needed.**

2. **`password-form.tsx` missing `maxLength` attribute on password inputs** — The server validates password length (max 1024 chars), but the client inputs don't have `maxLength`. This is actually intentional for security: setting a visible `maxLength` could reveal the server's maximum password length to attackers. The server validation is the authority. **No fix needed.**

3. **`searchImages` in `data.ts` doesn't enforce a minimum query length** — The `searchImagesAction` in `public.ts` checks `query.trim().length < 2`, but the underlying `searchImages` in `data.ts` only checks for empty query. This is fine — the data layer is general-purpose and the action layer is the correct place for user-facing validation. **No fix needed.**

---

## Previously Fixed — Verified Still Resolved

All cycle 1-5 fixes remain in place. Specifically verified:
- U-09/U-20/C4-02/C5-01: All `confirm()` calls replaced with AlertDialog
- C5-02: `Number.isFinite` guard on `insertId` in images.ts, admin-users.ts, sharing.ts
- C5-03: Hard cap on viewCountBuffer re-buffering
- C5-06: Alias deletion confirmation dialog in topic-manager.tsx

---

## Finding Summary

| ID | Severity | Confidence | File | Description |
|----|----------|------------|------|-------------|
| C6-01 | MEDIUM | HIGH | photo-viewer.tsx | Keyboard handler doesn't guard contentEditable elements |
| C6-02 | LOW | HIGH | image-manager.tsx | Raw `<input>` instead of `<Input>` component, missing preventDefault |
| C6-03 | MEDIUM | MEDIUM | images.ts | Upload tracker TOCTOU on concurrent uploads from same IP |
| C6-04 | LOW | HIGH | topic-manager.tsx, tag-manager.tsx | Delete actions fire without loading state feedback |
| C6-05 | LOW | HIGH | data.ts | View count incremented before image fetch completes |
| C6-06 | LOW | MEDIUM | process-image.ts | Empty blur buffer could produce invalid data URL |
| C6-07 | MEDIUM | MEDIUM | auth.ts | Session fixation prevention not in explicit transaction |
| C6-08 | LOW | HIGH | admin-user-manager.tsx | Hardcoded 'admin' username check is fragile |
| C6-09 | MEDIUM | MEDIUM | db-actions.ts | CSV export materializes entire result in memory |
| C6-10 | LOW | MEDIUM | image-queue.ts | Bootstrap fetches all pending images without limit (documentation) |

**Total: 10 findings (3 MEDIUM, 7 LOW)**

---

## Deferred Carry-Forward (unchanged from Plan 40)

1. U-15 connection limit docs mismatch
2. U-18 enumerative revalidatePath
3. /api/og throttle architecture
4. Font subsetting
5. Docker node_modules removal
6. C5-04 searchRateLimit in-memory race
7. C5-05 original_file_size from client value
8. C5-07 prunePasswordChangeRateLimit infrequent pruning
9. C5-08 dumpDatabase partial file cleanup race
