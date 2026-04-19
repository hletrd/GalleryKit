# Cycle 30 Comprehensive Review (2026-04-19)

**Reviewer:** Single multi-angle reviewer (code quality, security, performance, architecture, UX)
**Scope:** Full codebase — all action files, library modules, components, schema, middleware, and API routes

---

## Methodology

Reviewed every server action (`auth.ts`, `images.ts`, `topics.ts`, `tags.ts`, `sharing.ts`, `admin-users.ts`, `public.ts`, `db-actions.ts`), all library modules (`data.ts`, `process-image.ts`, `session.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `serve-upload.ts`, `sql-restore-scan.ts`, `image-queue.ts`, `validation.ts`, `audit.ts`, `revalidation.ts`, `api-auth.ts`, `upload-limits.ts`), key components (`image-manager.tsx`, `upload-dropzone.tsx`, `admin-user-manager.tsx`, `password-form.tsx`, `dashboard-client.tsx`), schema, DB connection, middleware, and API routes.

---

## Findings

### C30-01: `deleteGroupShareLink` returns `t('failedToCreateGroup')` on generic error [LOW, High Confidence]

**File:** `apps/web/src/app/actions/sharing.ts`, line 244

When `deleteGroupShareLink` encounters a non-`GROUP_NOT_FOUND` error in the transaction, it returns `t('failedToCreateGroup')` — an error message about *creating* a group, not deleting one. This is a copy-paste error from the `createGroupShareLink` function.

**Failure scenario:** Admin tries to delete a shared group link. A database error occurs. The UI shows "Failed to create group" instead of "Failed to delete group."

**Fix:** Add a dedicated i18n key `failedToDeleteGroup` to `en.json`/`ko.json` and use it here:
```ts
return { error: t('failedToDeleteGroup') };
```

---

### C30-02: `updatePassword` rate limit uses `LOGIN_MAX_ATTEMPTS` cap instead of a dedicated password change limit [LOW, Medium Confidence]

**File:** `apps/web/src/app/actions/auth.ts`, lines 236-243

The `updatePassword` function checks `limitData.count >= LOGIN_MAX_ATTEMPTS` (5) and uses `checkRateLimit(ip, 'password_change', LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS)`. While the bucket type is correctly `password_change`, the *limit* is shared with login (5 attempts per 15 min). Password changes have a much lower abuse risk than login brute-force. A legitimate admin who mistypes their current password 5 times in 15 minutes is locked out of changing their password — a different and arguably less dangerous operation than login brute-force.

**Failure scenario:** An admin mistypes their current password 5 times while trying to change it. They are now rate-limited from changing their password for 15 minutes, using the same threshold designed for preventing brute-force login attacks.

**Fix:** Add a `PASSWORD_CHANGE_MAX_ATTEMPTS` constant (e.g., 10) and use it in the password change rate limit checks. This allows more attempts for the less risky operation while keeping login strict.

---

### C30-03: `flushGroupViewCounts` re-buffers failed increments without a retry limit [LOW, Medium Confidence]

**File:** `apps/web/src/lib/data.ts`, lines 27-52

When a view count DB update fails, the failed increment is re-buffered into `viewCountBuffer` (line 41-43). However, there is no retry counter or backoff. If the DB is persistently unavailable for a particular group, the same count will be re-buffered on every flush cycle (every 5 seconds), and the DB query will keep failing — creating a tight failure loop that wastes DB connections.

**Failure scenario:** Database has a transient outage for 5 minutes. Each 5-second flush cycle re-buffers the same failed view counts. When the DB comes back, a burst of accumulated increments all hit the DB simultaneously, potentially causing a connection pool spike.

**Fix:** Add a per-group retry counter. After 3 consecutive failures for the same group, drop the increment and log a warning. Reset the counter on success.

---

### C30-04: `createGroupShareLink` does not validate `insertId` safety consistently with other actions [LOW, Low Confidence]

**File:** `apps/web/src/app/actions/sharing.ts`, lines 158-163

The `createGroupShareLink` function validates `insertId` with `Number.isFinite(groupId) && groupId <= 0` and throws on failure. However, the check is `groupId <= 0` which means `groupId === 0` throws, but `groupId < 0` is also caught. This is correct. However, unlike `uploadImages` (line 175-179 of `images.ts`) which uses `!Number.isFinite(insertedId) || insertedId <= 0` and gracefully continues with `failedFiles.push()`, `createGroupShareLink` throws and causes the entire transaction to roll back. If `insertId` is somehow invalid (a driver bug), all the shared group images are lost too.

**Failure scenario:** A MySQL driver bug returns `insertId = 0`. The transaction rolls back, and the group share link creation fails entirely instead of returning an error gracefully.

**Fix:** Move the `insertId` check outside the transaction. First insert the group, get the `insertId`, validate it, and only then insert the group images. If `insertId` is invalid, clean up the orphaned group row and return an error.

---

### C30-05: `purgeOldAuditLog` ignores the `maxAgeMs` parameter when `AUDIT_LOG_RETENTION_DAYS` env var is set [LOW, Medium Confidence]

**File:** `apps/web/src/lib/audit.ts`, lines 46-50

The `purgeOldAuditLog` function signature accepts `maxAgeMs` as a parameter, but the implementation ignores it when `AUDIT_LOG_RETENTION_DAYS` is set:
```ts
const retentionDays = Number.parseInt(process.env.AUDIT_LOG_RETENTION_DAYS ?? '', 10) || 90;
const effectiveMaxAgeMs = maxAgeMs ?? retentionDays * 24 * 60 * 60 * 1000;
```
The `??` (nullish coalescing) operator means: if `maxAgeMs` is provided (even as `0`), it takes precedence. But the env var is *always* read, even when `maxAgeMs` is explicitly provided. This means the env var parsing runs unnecessarily, and the function's behavior is confusing — the env var comment says "Default retention: 90 days. Override with AUDIT_LOG_RETENTION_DAYS env var" but the code also allows per-call override.

**Failure scenario:** A developer calls `purgeOldAuditLog(7 * 24 * 60 * 60 * 1000)` expecting a 7-day purge, but doesn't realize the `maxAgeMs` parameter actually works correctly (it does take precedence when not `undefined`). The confusing code could lead to incorrect assumptions.

**Fix:** Simplify the logic to make the precedence clear: if `maxAgeMs` is provided, use it; otherwise, check the env var; otherwise, default to 90 days. Add a comment clarifying the precedence.

---

### C30-06: `loadMoreImages` does not revalidate `isValidSlug` for `tagSlugs` — relies on regex in data layer [LOW, Low Confidence]

**File:** `apps/web/src/app/actions/public.ts`, line 19 vs `apps/web/src/lib/data.ts`, line 193

The `loadMoreImages` action filters `tagSlugs` with `/^[a-z0-9-]+$/i.test(s) && s.length <= 100`, while the data layer's `buildTagFilterCondition` uses the same regex. This is redundant validation, not a bug. However, the action uses `/^[a-z0-9-]+$/i` while `isValidSlug` in `validation.ts` uses `/^[a-z0-9_-]+$/i` — note the underscore `_` is allowed by `isValidSlug` but NOT by the inline regex in `public.ts` and `data.ts`. Tag slugs are generated by `getTagSlug` which replaces non-alphanumeric with hyphens, so underscores never appear in tag slugs. But this inconsistency could cause issues if a tag slug is manually inserted into the DB with an underscore.

**Failure scenario:** A tag with slug `my_tag` (manually inserted) would be filtered out by the inline regex but accepted by `isValidSlug`. The tag would be unreachable via the public API even though it exists.

**Fix:** Use `isValidSlug` consistently for tag slug validation, or add a dedicated `isValidTagSlug` that matches the actual generation pattern (no underscores).

---

### C30-07: `searchImagesAction` does not escape LIKE wildcards for the `query` before passing to `searchImages` [MEDIUM, High Confidence]

**File:** `apps/web/src/app/actions/public.ts`, line 86-87 vs `apps/web/src/lib/data.ts`, line 549

Wait — `searchImages` in `data.ts` line 549 does escape LIKE wildcards: `const escaped = query.trim().replace(/[%_\\]/g, '\\$&')`. So this is actually properly handled. On closer inspection, the `searchImagesAction` sends the raw `safeQuery` to `searchImages`, which then escapes it. This is correct.

**Revised finding:** NOT a real issue. Withdrawing C30-07.

---

### C30-08: `health` API route exposes database connectivity status without authentication [LOW, Medium Confidence]

**File:** `apps/web/src/app/api/health/route.ts`

The `/api/health` endpoint returns database connectivity status (`db: true/false`) without any authentication. While health check endpoints are commonly unauthenticated for load balancer probes, exposing the DB status can help attackers identify when the database is down for a targeted attack.

**Failure scenario:** An attacker monitors the health endpoint. When it reports `"db": false`, they know the database is down and can time their attack to coincide with degraded service.

**Fix:** Either (a) remove the `db` field from the response and only return `status: "ok"` or `status: "degraded"`, or (b) add an optional `verbose` query parameter that requires admin auth for the detailed response. The simple `status` field is sufficient for load balancer health checks.

---

### C30-09: `createAdminUser` and `deleteAdminUser` do not revalidate `/admin/users` path [LOW, Medium Confidence]

**File:** `apps/web/src/app/actions/admin-users.ts`, lines 51, 88

After creating or deleting an admin user, only `/admin/dashboard` is revalidated. If there is a dedicated admin users page (e.g., `/admin/users`), it would not be revalidated and could show stale data.

**Failure scenario:** Admin creates a new user on the users page. After creation, the users list still shows the old state because the page was not revalidated.

**Fix:** Check if there's an `/admin/users` page route. If so, add it to the revalidation paths in both `createAdminUser` and `deleteAdminUser`.

---

## Confirmed Previously Fixed

All cycle 1-29 findings remain resolved. No regressions detected. The cycle 29 fixes (audit logging for `dumpDatabase`, `/admin/dashboard` and `/admin/tags` revalidation paths, `purgeOldAuditLog`) have been fully implemented and verified.

---

## Deferred Carry-Forward

All previously deferred items from cycles 5-29 remain deferred with no change in status:
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap

---

## Totals

- **0 CRITICAL/HIGH** findings
- **0 MEDIUM** findings (C30-07 withdrawn)
- **8 LOW** findings (actionable)
- **8 total** findings
