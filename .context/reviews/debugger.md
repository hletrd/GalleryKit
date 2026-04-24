# Debugger Review — Gallery Workspace

Scope: reviewed the runtime source tree under `apps/web/src/**`, plus the web app configs and route handlers that affect auth, uploads, pagination, sharing, restore/backup, and image serving. I also ran `npm run typecheck --workspace=apps/web` and `npm test --workspace=apps/web` successfully.

## Confirmed

### 1) Newly processed uploads can stay hidden until ISR expiry
- **Severity:** Medium
- **Confidence:** High
- **Files:**
  - `apps/web/src/app/actions/images.ts:338-339`
  - `apps/web/src/lib/image-queue.ts:296-300`
  - `apps/web/src/app/[locale]/(public)/page.tsx:16`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:16`
- **Failure scenario:** `uploadImages()` revalidates `/` and the topic path immediately after the DB insert, but the new row is still `processed=false` at that moment. The queue later flips `processed=true` and deliberately does **not** revalidate on success. Because the public homepage/topic pages are ISR-cached for 3600s, the new photo can remain absent from the gallery until the cache naturally expires or some unrelated mutation revalidates the path.
- **Concrete fix:** move the relevant `revalidateLocalizedPaths('/', '/<topic>')` call to the queue success path after `processed=true` is committed, or add a small batched flush in `image-queue.ts` so successful processing invalidates the homepage/topic pages once the image is actually visible.

## Likely

### 2) Offset pagination on a live sort order can skip/duplicate items
- **Severity:** Medium
- **Confidence:** Medium
- **Files:**
  - `apps/web/src/lib/data.ts:318-335`
  - `apps/web/src/lib/data.ts:359-391`
  - `apps/web/src/lib/data.ts:398-417`
  - `apps/web/src/components/load-more.tsx:30-66`
  - `apps/web/src/components/home-client.tsx:252-259`
- **Failure scenario:** the gallery feed is sorted by mutable fields (`capture_date`, `created_at`, `id`) and paged with `OFFSET`. If an upload/delete happens while a user is paging, rows can shift above or below the current offset. The user then sees duplicates, gaps, or an apparent “missing photo” when loading more.
- **Concrete fix:** switch to cursor-based pagination using the existing sort tuple `(capture_date, created_at, id)` instead of `OFFSET`, and have `LoadMore` carry a cursor from the last visible item.

### 3) CSV export materializes the full result set and the full CSV string in memory
- **Severity:** Medium
- **Confidence:** High
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts:50-98`
- **Failure scenario:** `exportImagesCsv()` loads up to 50k rows, builds `csvLines: string[]`, then `join()`s them into one large string and returns that string through a server action. Large galleries can hit memory pressure, slow responses, or transport limits before the browser even starts downloading.
- **Concrete fix:** stream the export to a temp file or directly to the authenticated download route pattern already used for database backups, instead of returning the entire CSV payload from the action.

## Risk

### 4) Experimental local storage writes are not atomic on failure
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/lib/storage/local.ts:55-77`
- **Failure scenario:** `writeStream()` and `writeBuffer()` write directly to the final destination path. If the stream/write fails mid-flight, a truncated file can be left behind and later reads may observe a partially written object.
- **Concrete fix:** write to a temp key and rename on success, or delete the destination on write failure before returning.

## Final sweep

- I re-checked the previously reported info-bottom-sheet and admin backup cache issues; they appear fixed and are not repeated here.
- I did not find additional high-confidence defects in auth/session/origin checks, upload/delete flows, sharing, serve-upload containment, or the SQL restore scanner beyond the findings above.
- Skipped only generated/build artifacts and review-artifact files under `.context/reviews/**`; the runtime source files in `apps/web/src/**` and the relevant config/route files were reviewed.
