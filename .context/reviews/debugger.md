# Debugger Review — Cycle 3

## Scope reviewed
Inspected the high-risk mutation and serving paths across:
- `apps/web/src/app/actions/{auth,images,public,sharing,tags,topics,seo,settings,admin-users}.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/{sql-restore-scan,db-restore,rate-limit,auth-rate-limit,request-origin,restore-maintenance,image-queue,process-image,upload-paths,data,session,revalidation,photo-title}.ts`
- public/shared route components under `apps/web/src/app/[locale]/(public)/...`
- supporting tests in `apps/web/src/__tests__/...`

## Findings

### 1) Restore scanner lets destructive table-level SQL through
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Code region:**
  - `apps/web/src/lib/sql-restore-scan.ts:1-52`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:339-359`
- **What fails:** The restore scanner blocks a long denylist of statements, but it does **not** block `DROP TABLE`, `DELETE FROM`, or `TRUNCATE TABLE`. The restore path also explicitly accepts any file whose header starts with `DROP`/`INSERT`/`CREATE`/`SET`, so a malicious SQL file can pass the header check and then execute destructive table-level statements under `mysql --one-database`.
- **Concrete failure scenario:** An attacker uploads a “backup” containing:
  - `DROP TABLE images;`
  - `DELETE FROM admin_users;`
  - or `TRUNCATE TABLE sessions;`
  The current scanner returns `false` for `containsDangerousSql('DROP TABLE images;')` and `containsDangerousSql('DELETE FROM images;')`, so the restore proceeds and wipes data.
- **Suggested fix:** Expand the restore denylist to cover destructive table statements at minimum (`DROP TABLE`, `DELETE FROM`, `TRUNCATE TABLE`) and add tests for those exact cases. If arbitrary external dumps must be supported, replace the regex heuristic with a stricter statement allowlist.
- **Risk:** Broad — this is a restore-path data-destruction vulnerability.

### 2) Update mutations can report success after a concurrent delete
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Code region:**
  - Primary example: `apps/web/src/app/actions/tags.ts:74-90`
  - Same pattern also appears in `apps/web/src/app/actions/topics.ts:243-257` and `apps/web/src/app/actions/images.ts:625-650`
- **What fails:** These update flows do a pre-read (`SELECT ... LIMIT 1`) and then run `UPDATE ... WHERE id = ?`, but they never check `affectedRows`. If another request deletes the row between the read and the update, the mutation becomes a silent no-op and still returns success, logs an audit event, and revalidates paths as if the write succeeded.
- **Concrete failure scenario:** Admin A opens tag edit form for tag `#travel`. Admin B deletes that tag a moment later. Admin A submits a rename. The `SELECT` sees the tag, the `UPDATE` affects 0 rows, and `updateTag()` still returns `{ success: true }`.
- **Suggested fix:** Capture the update result and treat `affectedRows === 0` as a not-found/concurrent-write failure before logging or revalidating. The same guard should be added to the sibling topic and image-metadata update flows.
- **Risk:** Moderate — stale UI, false success responses, and inconsistent audit/revalidation behavior.

### 3) Photo-share creation charges quota even when the image disappears mid-flight
- **Severity:** Low to Medium
- **Confidence:** High
- **Status:** Confirmed by code path
- **Code region:** `apps/web/src/app/actions/sharing.ts:141-163`
- **What fails:** `createPhotoShareLink()` pre-increments the share rate limit, then retries an atomic update. If the image is deleted after the initial read but before the update, the code returns `imageNotFound` at the `!refreshedImage` branch without rolling back the pre-incremented share counters.
- **Concrete failure scenario:** An admin clicks “Create share link” while another admin deletes the photo in the same window. The action fails correctly, but the one-minute share quota is still consumed, so repeated races can exhaust the 20/minute budget without ever creating a share link.
- **Suggested fix:** Roll back both the in-memory and DB share counters before returning `imageNotFound` in the `!refreshedImage` branch, mirroring the existing rollback used for other non-retryable failures.
- **Risk:** Narrow — quota leak / user-visible throttling on a rare race.

## Similar-pattern watchlist
- `apps/web/src/app/actions/topics.ts:243-257` and `apps/web/src/app/actions/images.ts:625-650` have the same unchecked-update pattern as `tags.ts`.
- `apps/web/src/app/actions/sharing.ts` already handles rate-limit rollback on most error branches; the missing rollback is isolated to the image-not-found race.
