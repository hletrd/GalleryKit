# Debugger Review — Cycle 1

## Bug-relevant file inventory examined first

Scope was the Gallery web app under `/Users/hletrd/flash-shared/gallery`, with no application-code edits. I inventoried and read/scanned the bug-relevant runtime surface before writing findings:

- **Runtime/config/scripts/e2e/i18n:** 204 files, ~25.1k lines.
  - Root/build/deploy config: 14 (`apps/web/Dockerfile`, `package.json`, `next.config.ts`, `drizzle.config.ts`, `playwright.config.ts`, `eslint.config.mjs`, `tsconfig*.json`, `docker-compose.yml`, `nginx/*`, etc.).
  - Drizzle SQL migrations: 4 (`apps/web/drizzle/*.sql`).
  - E2E specs/helpers: 6 (`apps/web/e2e/*.ts`).
  - Operational scripts: 17 (`apps/web/scripts/*`).
  - App routes/actions/API/admin/public pages: 56 (`apps/web/src/app/**`).
  - Client/server components: 45 (`apps/web/src/components/**`).
  - DB connection/schema/migrations helpers: 3 (`apps/web/src/db/**`).
  - Shared libraries: 52 (`apps/web/src/lib/**`).
  - Middleware/instrumentation/site config/i18n: `apps/web/src/proxy.ts`, `apps/web/src/instrumentation.ts`, `apps/web/src/site-config.example.json`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- **Test corpus scanned for coverage and regressions:** 91 test/e2e files under `apps/web/src/__tests__/*.test.ts` and `apps/web/e2e/*.ts`.
- **Highest-risk files examined line-by-line:** `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/advisory-locks.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, and `apps/web/src/lib/upload-processing-contract-lock.ts`.
- **Skipped from bug review:** prior `.context/**` review artifacts/screenshots except this report target, `.git/**`, `node_modules/**`, binary fixtures/assets (`*.jpg`, `*.png`, `*.woff2`), generated Drizzle meta snapshots (`apps/web/drizzle/meta/*.json`), and non-runtime visual artifacts. Locale JSON files were not skipped; both parsed successfully and had matching 499 flattened keys.

## Findings

### 1. HIGH — Admin-user deletion can race to zero admins

- **Status:** confirmed
- **Confidence:** High
- **File/line regions:**
  - `apps/web/src/lib/advisory-locks.ts:26-32` defines `getAdminDeleteLockName(userId)` as `gallerykit_admin_delete:${userId}`.
  - `apps/web/src/app/actions/admin-users.ts:198-215` says the delete path serializes requests so concurrent deletes cannot remove the final admins, but then scopes the lock to the target user ID.
  - `apps/web/src/app/actions/admin-users.ts:217-255` acquires the target-scoped lock, starts a transaction, reads `SELECT COUNT(*) AS count FROM admin_users`, and deletes the target if the count is greater than one.
- **Concrete failure scenario:** Admin A and Admin B are both logged in. A submits `deleteAdminUser(B)` while B submits `deleteAdminUser(A)`. The lock names differ (`...:B` vs `...:A`), so both transactions acquire locks, both read count `2`, both delete the other user, and both commit. The table can be left with zero admin users, locking operators out without direct database intervention.
- **Suggested fix:** Use a single global advisory lock for the whole “delete any admin user” critical section, or lock the relevant `admin_users` rows/table inside a serializable/locking transaction (`SELECT ... FOR UPDATE` on a shared guard row/table plus count). Add a regression test that runs two cross-deletes concurrently and asserts one delete fails with “cannot delete last admin.”

### 2. MEDIUM — Existing-photo share no-op rolls back rate-limit counters before any matching increment

- **Status:** confirmed
- **Confidence:** High
- **File/line regions:**
  - `apps/web/src/app/actions/sharing.ts:95-105` returns an existing `image.share_key` but first calls `rollbackShareRateLimitFull(ip, 'share_photo', shareBucketStart)`.
  - `apps/web/src/app/actions/sharing.ts:108-124` performs the actual in-memory and DB pre-increment later, so the early existing-key branch has no corresponding increment to undo.
  - `apps/web/src/app/actions/sharing.ts:55-76` decrements/deletes the in-memory bucket and calls `decrementRateLimit`.
  - `apps/web/src/lib/rate-limit.ts:344-363` persists that decrement and deletes zero-count rows.
  - Coverage gap: `apps/web/src/__tests__/sharing-source-contracts.test.ts:7-16` only asserts rollback for the concurrent-winner branch after a pre-increment, not this initial existing-key branch.
- **Concrete failure scenario:** An admin already has a share link for image X. Repeatedly pressing/calling “share” for X enters the no-op branch and decrements the current `share_photo` bucket for that IP, even if other tabs/requests just spent real share attempts. The admin can then create more new share links in the same minute than the intended limit, and the DB bucket can be erased by unrelated no-op calls.
- **Suggested fix:** Remove `rollbackShareRateLimitFull` from the initial `if (image.share_key)` branch, or move the existing-key check before any rate-limit bucket bookkeeping and document it as an uncharged no-op. Keep rollback in the later `refreshedImage.share_key` branch because that path follows a real pre-increment. Add a regression test that an already-shared image does not call `decrementRateLimit` before any pre-increment.

### 3. MEDIUM — Share-page metadata performs DB lookups outside the enumeration rate limit

- **Status:** likely
- **Confidence:** Medium
- **File/line regions:**
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:42-55` explicitly skips rate limiting in `generateMetadata`, then calls `getImageByShareKeyCached(key)`.
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:101-112` rate-limits only in the page body before the second lookup.
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:37-51` explicitly skips rate limiting in `generateMetadata`, then calls `getSharedGroupCached(key, { incrementViewCount: false })`.
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-121` rate-limits only in the page body before the second lookup.
  - `apps/web/src/lib/rate-limit.ts:234-244` shows the share lookup limiter is an in-memory pre-increment helper.
  - `apps/web/src/__tests__/shared-route-rate-limit-source.test.ts:32-50` currently codifies that metadata must not call the limiter.
- **Concrete failure scenario:** A bot sends many syntactically plausible `/en/s/<key>` or `/en/g/<key>` requests from one IP. After the share lookup budget is exhausted, the page body returns `notFound()`, but metadata generation can still issue one DB lookup per request before that body guard. This weakens the stated anti-enumeration/DB-pressure protection for exactly the random-key traffic it is meant to absorb.
- **Suggested fix:** Prefer generic `noindex` metadata for share pages that does not hit the share-key tables, or move the rate-limit decision to a request-level guard shared by metadata and page body without double-charging. Add a regression test that over-limit share requests do not call the metadata data lookup.

### 4. MEDIUM — Successful admin-user creation rolls back the CPU/creation rate limit

- **Status:** likely regression risk
- **Confidence:** Medium
- **File/line regions:**
  - `apps/web/src/app/actions/admin-users.ts:113-130` says admin creation is rate-limited to prevent brute-force / CPU DoS and pre-increments before Argon2.
  - `apps/web/src/app/actions/admin-users.ts:137-154` performs `argon2.hash`, inserts the user, then rolls back the `user_create` bucket on success.
  - `apps/web/src/app/actions/admin-users.ts:42-55` shows rollback decrements both in-memory and DB counters.
  - `apps/web/src/__tests__/admin-users.test.ts:150-161` currently asserts this success rollback behavior.
- **Concrete failure scenario:** With a compromised admin session, malicious admin, or automated browser on an admin workstation, unique successful user creations run Argon2 and write rows while leaving the hourly `user_create` bucket effectively unchanged. The limit only constrains over-limit/duplicate/unexpected failure paths, not the success path that actually consumes CPU and creates database state.
- **Suggested fix:** If the budget is meant to cap creation work, do not roll back successful creations; roll back only validation/no-op/infrastructure failures that did not consume the protected resource. If unlimited successful creation is intentional, update the comments and tests, and add a separate quota/backstop for successful admin creation bursts.

### 5. LOW — Invalid `photoId` query suppresses shared-group view counting while rendering the grid

- **Status:** confirmed
- **Confidence:** High
- **File/line regions:**
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-121` calls `getSharedGroupCached(key, { incrementViewCount: !photoIdParam })`, so any non-empty `photoId` disables the group view increment.
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:132-147` later accepts only positive numeric IDs that match an image as a selected-photo view; invalid or nonexistent values fall through to the normal grid render.
  - `apps/web/src/lib/data.ts:1014-1019` increments the group view count only when `incrementViewCount !== false`.
- **Concrete failure scenario:** `/en/g/<validKey>?photoId=garbage` or `/en/g/<validKey>?photoId=999999` renders the shared group grid, but the earlier non-empty query string already disabled view counting. Crawlers or malformed copied links can undercount group analytics.
- **Suggested fix:** Parse and validate `photoIdParam` before calling `getSharedGroupCached`, and pass `incrementViewCount: false` only when it resolves to an actual selected image. Alternatively redirect invalid `photoId` values to the canonical group URL and count the canonical view.

### 6. LOW — Dangerous restore-dump cleanup can leak the temp file on Windows-like unlink semantics

- **Status:** risk
- **Confidence:** Medium
- **File/line regions:**
  - `apps/web/src/app/[locale]/admin/db-actions.ts:408-433` opens `scanFd`, scans the uploaded SQL dump, and on `containsDangerousSql(combined)` calls `fs.unlink(tempPath)` before the `finally` block closes `scanFd`.
- **Concrete failure scenario:** On POSIX, unlinking an open file succeeds. On Windows or Windows-like mounted volumes, unlinking an open file can fail with `EPERM`; this code swallows the unlink error and then closes the descriptor in `finally`, leaving the rejected SQL dump in the temp upload directory until some external cleanup removes it.
- **Suggested fix:** Record a `dangerousSql` flag, exit the scan loop, close `scanFd` in `finally`, and unlink the temp file after the close. Alternatively explicitly close the descriptor before unlinking in the dangerous-SQL branch.

## Final missed-issues sweep and skipped-file confirmation

- Re-ran targeted sweeps for `rollback*`, `decrementRateLimit`, `GET_LOCK`, `FOR UPDATE`, `preIncrementShareAttempt`, `incrementViewCount`, `fs.unlink`, timer/background work, and swallowed cleanup errors across `apps/web/src`, `apps/web/scripts`, and `apps/web/e2e`.
- Verified the key line regions above with numbered source output immediately before writing this report.
- Parsed both locale catalogs and compared flattened keys: `en.json` = 499, `ko.json` = 499, no missing keys either direction.
- Confirmed skipped files were non-runtime/generated/binary/review artifacts: previous `.context/**` material, `.git/**`, `node_modules/**`, image/font binaries, e2e image fixtures, and Drizzle meta snapshots.
- No application code was edited; only this report file was changed.

## Counts by severity

- Critical: 0
- High: 1
- Medium: 3
- Low: 2
- Total: 6
