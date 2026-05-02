# Cycle 4 Deep Code Review — GalleryKit

Reviewer: cycle4-composite-review
Date: 2026-04-30

## Methodology

Reviewed all core source files across: data layer, auth, image processing, rate limiting, admin actions, public actions, sharing, session management, middleware, API routes, and UI components. Cross-referenced prior cycle fixes (1-3) to identify NEW issues not previously caught.

---

## C4F-01 (High). `searchImages` LIKE wildcard escape incomplete — backslash-only escape can be bypassed

- **File+line**: `apps/web/src/lib/data.ts:1018`
- **Severity/Confidence**: High / High
- **Description**: The `escaped` variable uses `query.trim().replace(/[%_\\]/g, '\\$&')` which only escapes `%`, `_`, and `\`. However, the MySQL `LIKE` operator also treats backslash as an escape character by default. If the search query itself contains a literal backslash followed by `%` or `_`, the current escaping produces `\\%` or `\\_`, which MySQL interprets as "escaped backslash followed by unescaped wildcard" rather than "escaped percent/underscore". The correct fix is to escape backslashes FIRST (so `\\` becomes `\\\\`), then escape `%` and `_`. The current regex processes all three characters in a single pass, which correctly handles the common case because `\\$&` for `\` produces `\\` and for `%` produces `\%`. Actually, upon closer inspection, the single-pass `.replace(/[%_\\]/g, '\\$&')` IS correct because each match is independently prepended with `\`. For a backslash input, `\` becomes `\\`; for `%` it becomes `\%`. In MySQL LIKE, `\\` matches a literal backslash, and `\%` matches a literal percent. The order does not matter in a single global replace because each character is escaped independently. **Retracted** — this is actually correct.

## C4F-02 (Medium). `getSharedGroup` does not validate key length before DB query

- **File+line**: `apps/web/src/lib/data.ts:881`
- **Severity/Confidence**: Medium / High
- **Description**: `getImageByShareKey` validates the key with `isBase56(trimmedKey, 10)` before querying the DB. But `getSharedGroup` uses the same `isBase56(trimmedKey, 10)` check — so this is actually consistent. **Retracted** — both functions validate.

## C4F-03 (Medium). `uploadImages` pre-increments tracker bytes before disk-space check

- **File+line**: `apps/web/src/app/actions/images.ts:243-246`
- **Severity/Confidence**: Medium / Medium
- **Description**: At line 243, `tracker.bytes += totalSize` and `tracker.count += files.length` are set BEFORE the disk-space check at line 207 and the cumulative byte check at line 226. However, looking more carefully at the code flow: the pre-increment happens at line 243, AFTER the disk space check (line 207) and cumulative check (line 226). The tracker is incremented only after all validation passes. The code structure is: (1) get tracker (line 194), (2) disk space check (line 207), (3) per-call size check (line 220), (4) cumulative byte check (line 226), (5) topic validation (line 230), (6) pre-increment (line 243). This is actually correctly ordered. **Retracted** — validation precedes increment.

## C4F-04 (Medium). `getImagesLite` cursor condition uses `or()` with no filter for NULL capture_date when cursor has a capture_date

- **File+line**: `apps/web/src/lib/data.ts:541-559`
- **Severity/Confidence**: Medium / Medium
- **Description**: In `buildCursorCondition`, when the cursor has a `capture_date`, the `prevConditions` array includes `isNull(images.capture_date)` (line 545). This means undated images (capture_date IS NULL) will always match the "prev" condition for dated images. In MySQL, NULL sorts last in DESC order, which means they appear FIRST in ASC order. So including `isNull(images.capture_date)` in the prev conditions is correct — undated images DO sort before dated images in ASC order (the "prev" direction). This matches the gallery sort order: `DESC capture_date, DESC created_at, DESC id`. So prev (ASC) means: NULL first, then older dates. **Retracted** — the logic is correct per the gallery sort semantics.

## C4F-05 (Medium). `restoreDatabase` temp file in `os.tmpdir()` — predictable path

- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:364`
- **Severity/Confidence**: Medium / Low
- **Description**: This was already identified and deferred as D7-MED in plan-338. The temp file path uses `os.tmpdir() + '/restore-${randomUUID()}.sql'`. The UUID provides reasonable entropy. The advisory lock prevents concurrent restores. **Already deferred** — no new finding.

## C4F-06 (Medium). `searchImages` main-query results may be stale when tag/alias queries run

- **File+line**: `apps/web/src/lib/data.ts:1046-1124`
- **Severity/Confidence**: Medium / Medium
- **Description**: When the main LIKE query returns fewer than `effectiveLimit` results, the tag and alias queries run in parallel using `notInArray(images.id, mainIds)` to exclude already-found IDs. If an image is deleted between the main query and the tag/alias queries, the `notInArray` exclusion still works correctly (the deleted ID simply won't appear). If a new image is inserted between queries, it could be missed — but search is inherently approximate and the short-circuit path already handles partial results. The `slice(0, effectiveLimit)` at line 1135 ensures the returned set is bounded. This is acceptable at personal-gallery scale. **Low risk, documenting for completeness.**

## C4F-07 (Medium). `pruneUploadTracker` iterates Map and deletes during iteration

- **File+line**: `apps/web/src/lib/upload-tracker-state.ts:26-29`
- **Severity/Confidence**: Medium / Low
- **Description**: The `pruneUploadTracker` function iterates the Map with `for (const [key, entry] of uploadTracker)` and calls `uploadTracker.delete(key)` inside the loop. Per ES6 spec, deleting entries during `Map.prototype` iteration is safe — the iterator accounts for deletions. This is the same pattern as the BoundedMap.prune() issue already deferred as D1-LOW in plan-351. **Already tracked** — consistent with existing deferral.

## C4F-08 (High). `getImageByShareKey` does not include `blur_data_url` — inconsistent with `getSharedGroup`

- **File+line**: `apps/web/src/lib/data.ts:843-871`
- **Severity/Confidence**: High / High
- **Description**: `getSharedGroup` includes `blur_data_url: images.blur_data_url` in its select (line 903) for proper image loading with blur placeholders. But `getImageByShareKey` uses only `{...publicSelectFields}` which intentionally excludes `blur_data_url` (per the compile-time guard). This means the `/s/[key]` shared photo page (which uses `getImageByShareKey`) never gets a blur placeholder, while the `/g/[key]` shared group page does. The inconsistency means shared individual photo links render without blur placeholders during image decode, causing a visible flash/shift. The `/s/[key]` page at `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` presumably uses the image in a photo viewer that checks for blur_data_url, but the field is always absent from this query.
- **Fix**: Add `blur_data_url: images.blur_data_url` to the select in `getImageByShareKey`, matching `getSharedGroup`.

## C4F-09 (Medium). `getImageByShareKey` does not include `topic_label` — inconsistent with `getImage`

- **File+line**: `apps/web/src/lib/data.ts:843-871`
- **Severity/Confidence**: Medium / High
- **Description**: `getImage` (line 723) includes `topic_label: topics.label` via a LEFT JOIN on topics. But `getImageByShareKey` does not join the topics table at all and does not return `topic_label`. The shared photo page `/s/[key]` presumably needs the topic label for the "Back to [topic]" navigation link, but it's unavailable from this query. The client would need a separate query or the topic label is simply missing, resulting in a degraded UX where the topic label is shown as the raw slug instead of the display label.
- **Fix**: Add a LEFT JOIN on topics and include `topic_label: topics.label` in the select for `getImageByShareKey`.

## C4F-10 (Low). `getImageByShareKey` always returns `prevId: null, nextId: null`

- **File+line**: `apps/web/src/lib/data.ts:865-870`
- **Severity/Confidence**: Low / High
- **Description**: The shared photo page `/s/[key]` cannot navigate between photos because `prevId` and `nextId` are always null. This is by design for the share-key view — the navigation is within a shared group context, not the full gallery. However, for individual share links, this means the photo viewer's prev/next buttons are always hidden, which is correct for the standalone view. **Not a bug — by design.** Documenting for completeness.

## C4F-11 (Medium). `processImageFormats` copies same-size variants via `copyFile` instead of hard link

- **File+line**: `apps/web/src/lib/process-image.ts:477-478`
- **Severity/Confidence**: Medium / Low
- **Description**: When `resizeWidth === baseWidth` for a size that equals the original width, `copyFile` is used instead of `link`. This is for the deduplication path where two configured sizes resolve to the same resize width. The `copyFile` duplicates the file data unnecessarily — a hard link would be zero-copy on the same filesystem and is already the pattern used for the "base filename" link at line 507. Using `copyFile` wastes disk space and I/O for every such duplicate.
- **Fix**: Replace `fs.copyFile` at line 478 with `fs.link` (same as line 507), falling back to `copyFile` only on cross-device link failure.

## C4F-12 (Medium). `searchImages` ORDER BY uses `created_at` not the gallery sort order

- **File+line**: `apps/web/src/lib/data.ts:1043`
- **Severity/Confidence**: Medium / High
- **Description**: The main search query at line 1043 orders by `desc(images.created_at), desc(images.id)`, but the gallery sort order is `desc(images.capture_date), desc(images.created_at), desc(images.id)`. This means search results are sorted by upload time, not by the capture date that users see in the gallery. A photo taken in 2020 but uploaded today appears before a photo taken in 2024 but uploaded yesterday. The tag and alias queries (lines 1103, 1122) have the same issue.
- **Impact**: Search results don't match the gallery's chronological order, which could confuse users who expect search to be consistent with browsing.
- **Fix**: Change the ORDER BY to `desc(images.capture_date), desc(images.created_at), desc(images.id)` to match the gallery sort order. Note: NULL capture_date rows need special handling — `COALESCE(capture_date, '1970-01-01')` or the same IS NULL pattern used in `buildCursorCondition`.

## C4F-13 (Low). `deleteImage` and `deleteImages` revalidation paths may miss shared-group routes

- **File+line**: `apps/web/src/app/actions/images.ts:521`
- **Severity/Confidence**: Low / Low
- **Description**: After deleting an image, `revalidateLocalizedPaths` is called with specific paths. The `shareRevalidationPaths` are built from the deleted image's share_key and affected group keys, which should cover shared routes. However, if a group contains many images and only one is deleted, the group page `/g/[key]` is revalidated but not the individual `/s/[key]` pages of the OTHER images in the group (since those share_keys are not fetched). This is a minor cache staleness issue — the other images' shared pages don't reference the deleted image directly, so the staleness is limited to the group grid where the deleted image was removed. The group page IS revalidated. **Low priority.**

## C4F-14 (Medium). `updatePassword` clears ALL sessions including other devices — no opt-out

- **File+line**: `apps/web/src/app/actions/auth.ts:387`
- **Severity/Confidence**: Medium / Low
- **Description**: When an admin changes their password, ALL sessions for that user are deleted (line 387: `await tx.delete(sessions).where(eq(sessions.userId, currentUser.id))`). This means if the admin is logged in on another device, that session is also invalidated. This is the intended security posture (rotate all sessions on credential change) per the CLAUDE.md security model. The new session is then inserted in the same transaction. **By design** — documenting as a known UX tradeoff.

## C4F-15 (Medium). `exportImagesCsv` uses `GROUP_CONCAT` without `group_concat_max_len` per-query

- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:67`
- **Severity/Confidence**: Medium / Medium
- **Description**: The CSV export uses `GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY ${tags.name} SEPARATOR ', ')` to aggregate tag names. The comment at line 53-56 notes that `group_concat_max_len` is set to 65535 on every pool connection via `poolConnection.on('connection', ...)` in `db/index.ts`. This is reliable as long as the pool connection handler is the only code setting this variable. If a future change removes or conditions the pool handler, CSV tag data could be silently truncated at the default 1024-byte limit. **Already mitigated by the pool handler** — documenting the dependency for awareness.

## C4F-16 (Low). `searchImagesAction` slices query to 200 chars after already validating length

- **File+line**: `apps/web/src/app/actions/public.ts:170`
- **Severity/Confidence**: Low / High
- **Description**: At line 123, `countCodePoints(sanitizedQuery) > 200` rejects queries over 200 code points. At line 170, `sanitizedQuery.slice(0, 200)` slices to 200 characters (not code points). For BMP-only text, this is identical. For supplementary characters (emoji, rare CJK), `slice(0, 200)` returns up to 200 UTF-16 code units, which could be fewer than 200 code points. But since the validation already rejected queries over 200 code points, the slice is always a no-op. **Harmless redundancy** — the slice is a belt-and-suspenders guard.

## C4F-17 (Medium). No `Content-Security-Policy` header on API route responses

- **File+line**: `apps/web/src/app/api/admin/db/download/route.ts` and other API routes
- **Severity/Confidence**: Medium / Medium
- **Description**: API route responses (e.g., backup download) set `Cache-Control` and `X-Content-Type-Options` but do not set `Content-Security-Policy`. While API routes are excluded from the middleware (per `proxy.ts` matcher), they still return content that could be framed or embedded. The CSP header is set in the middleware for page routes but never applied to API routes. For the download route, this is low risk because the response is a file download. For other API routes that return JSON, CSP is less relevant. **Low risk but noted for defense-in-depth.**

## C4F-18 (Medium). `db-actions.ts` `runRestore` deletes temp file on success — but `close` event may fire before stream ends

- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:478-493`
- **Severity/Confidence**: Medium / Low
- **Description**: In `runRestore`, the `close` event handler at line 478 calls `await fs.unlink(tempPath)` immediately before checking the exit code. The `readStream.pipe(restore.stdin)` pattern means the `close` event fires when the `mysql` process exits. However, the readStream may still have data in flight when the process closes (e.g., if the process exits early). The `readStream.destroy()` in `failRestore` handles error paths, but the success path doesn't explicitly wait for the readStream to end. In practice, `fs.unlink` will succeed even if the stream hasn't fully ended (the file descriptor is separate from the Node.js stream), so the temp file is correctly deleted. **Not a real bug** — the unlink is fine because the process has already read what it needs.

## C4F-19 (High). `getImageByShareKey` and `getSharedGroup` do not check `processed = true` for share-key validity

- **File+line**: `apps/web/src/lib/data.ts:837-871` and `877-957`
- **Severity/Confidence**: High / Medium
- **Description**: `getImageByShareKey` correctly checks `eq(images.processed, true)` at line 849. `getSharedGroup` also checks `eq(images.processed, true)` at line 909 for the images within the group. However, neither function checks whether the share key/group itself is still valid after a DB restore or schema change. More critically, `getSharedGroup` at line 887-897 fetches the group and checks expiry, but does NOT verify that the group's images are still processed. The individual image query at line 900-913 does check `processed = true`, but if ALL images in a group become unprocessed (e.g., after a DB restore that sets processed=false), the group page returns `null` at line 943 because `imagesWithTags.length === 0`. This is actually correct behavior — if no images are processed, the group has no visible content. **Retracted** — the check is there via the image JOIN.

## C4F-20 (Medium). `searchImages` does not exclude `original_format`/`original_file_size` from SearchResult despite them being in publicSelectFields omit list

- **File+line**: `apps/web/src/lib/data.ts:997-1009`
- **Severity/Confidence**: Medium / High
- **Description**: The `SearchResult` interface and `searchFields` object include `camera_model` and `capture_date` from the image table, but do NOT include `original_format` or `original_file_size`. These fields are omitted from `publicSelectFields` (the privacy guard) — they are "omitted intentionally from public payloads" per the destructuring comments at lines 290-294. The search result correctly omits them. However, the search result DOES include `camera_model`, which is part of `publicSelectFields`. This is correct. **Retracted** — search fields are consistent with privacy requirements.

## Summary of Confirmed NEW Findings

| ID | Severity | File | Description |
|----|----------|------|-------------|
| C4F-08 | High | data.ts:843-871 | `getImageByShareKey` missing `blur_data_url` — inconsistent with `getSharedGroup` |
| C4F-09 | Medium | data.ts:843-871 | `getImageByShareKey` missing `topic_label` — inconsistent with `getImage` |
| C4F-11 | Medium | process-image.ts:477-478 | Same-size variant dedup uses `copyFile` instead of hard link |
| C4F-12 | Medium | data.ts:1043 | `searchImages` ORDER BY differs from gallery sort order |
| C4F-17 | Medium | API routes | No CSP header on API route responses |

Carry-forward deferred items from plan-349/plan-351 remain valid with no status change.
