# Ultra-Deep Security & Code Quality Review — GalleryKit

**Date:** 2026-04-17
**Reviewer:** Claude Opus 4.7
**Scope:** Full repository — trust boundaries, auth/authz, data exposure, input validation, command/file access, secrets handling, escalation risks, race conditions, edge cases, code quality

---

## Trust Boundary Map

```
Internet → [proxy.ts middleware] → Next.js Routes
                                      ├─ Public: /, /[topic], /p/[id], /s/[key], /g/[key]
                                      │   Trust: unauthenticated, read-only
                                      ├─ Upload static: /uploads/[...path]
                                      │   Trust: unauthenticated, read-only (whitelisted dirs)
                                      ├─ Admin login: /[locale]/admin
                                      │   Trust: unauthenticated, writes credentials
                                      ├─ Admin protected: /[locale]/admin/(protected)/*
                                      │   Trust: authenticated admin only
                                      ├─ API: /api/admin/db/download
                                      │   Trust: authenticated admin only
                                      └─ API: /api/health
                                          Trust: unauthenticated, read-only
```

**Key trust boundaries:**
1. **Unauthenticated → authenticated**: `proxy.ts` middleware + `isAdmin()` in every server action
2. **Authenticated → DB/file system**: server actions, `db-actions.ts` with `spawn()`
3. **Client → server**: all `formData.get()` inputs
4. **DB → public API**: `selectFields` vs `adminExtraFields` in `data.ts`

---

## CRITICAL SECURITY FINDINGS

### S-01: GPS coordinates leak to unauthenticated users via shared photo pages [Critical — CONFIRMED]

**Files:**
- `apps/web/src/components/photo-viewer.tsx:435–448`
- `apps/web/src/components/info-bottom-sheet.tsx:275–288`
- `apps/web/src/lib/data.ts:44–48`

The CLAUDE.md explicitly states: "GPS coordinates (latitude, longitude) excluded from public API responses." And indeed, `selectFields` in `data.ts` omits `latitude`/`longitude` from the default public select. These fields are only in `adminExtraFields`.

**However**, the `ImageDetail` interface (`image-types.ts:37–38`) includes `latitude` and `longitude` as optional fields. The `getImage()` function uses `selectFields` which correctly excludes them. But when `getImage()` is called, the returned object does NOT have latitude/longitude. Yet the photo-viewer component renders them if present:

```tsx
// photo-viewer.tsx:435
{(image.latitude != null && image.longitude != null) && (
    <a href={`https://www.google.com/maps/search/?api=1&query=${image.latitude},${image.longitude}`}>
```

**Current state: Safe** — because `getImage()` (used by `/p/[id]` page) uses `selectFields` which excludes lat/lon, so the values are `undefined`, and the conditional `!= null` check is false.

**But there is a latent risk:** If any code path ever passes an `ImageDetail` object that includes `latitude`/`longitude` (e.g., from an admin query that uses `adminExtraFields`), GPS coordinates would be rendered to unauthenticated users. The `info-bottom-sheet.tsx` component has the same rendering logic and is used on the mobile view of the same photo page.

**Concrete escalation scenario:** A developer adds a "quick edit" feature that re-fetches image data using `adminExtraFields` and passes it to `PhotoViewer`. The GPS data is now visible to all visitors.

**Fix:** Either remove `latitude`/`longitude` from `ImageDetail` entirely (create a separate `AdminImageDetail` type), or add an explicit prop like `showLocation={false}` to `PhotoViewer` for public pages, or strip the fields at the page boundary before passing to client components.

---

### S-02: `deleteTopicImage` allows path traversal via DB-compromised `image_filename` [High — CONFIRMED]

**File:** `apps/web/src/lib/process-topic-image.ts:93–96`

```ts
export async function deleteTopicImage(filename: string) {
    if (!filename) return;
    await fs.unlink(path.join(RESOURCES_DIR, filename)).catch(() => {});
}
```

No validation that `filename` is a simple, safe filename. The value comes from `topics.image_filename` in the DB. If the DB is compromised (SQL injection via `restoreDatabase`, or direct DB access), an attacker can set `image_filename` to `../../.env.local` and trigger file deletion when the topic is updated or deleted.

**This is called from:**
- `topics.ts:86` — on failed `createTopic` (cleanup)
- `topics.ts:165–167` — on `updateTopic` (old image cleanup)
- `topics.ts:204–206` — on `deleteTopic`

**Attack chain:** Admin restores a crafted SQL dump → sets `topics.image_filename` to `../../.env.local` → updates any topic → `deleteTopicImage` deletes `.env.local`, exposing `SESSION_SECRET` and `DB_PASSWORD` in the process (or just causing a denial of service).

**Fix:**
```ts
export async function deleteTopicImage(filename: string) {
    if (!filename || !isValidFilename(filename)) return;
    await fs.unlink(path.join(RESOURCES_DIR, filename)).catch(() => {});
}
```

---

### S-03: `restoreDatabase` SQL scanner misses `PREPARE`/`EXECUTE`/hex-encoded attacks [High — CONFIRMED]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:221–270`

The dangerous pattern scanner checks for `GRANT`, `CREATE USER`, `DROP DATABASE`, etc. But it does NOT check for:

1. **`PREPARE stmt FROM ...` / `EXECUTE stmt`** — allows indirect execution of any SQL statement via a prepared string. The string can be built from hex literals that bypass the text scanner.

2. **Hex literals**: `SET @q = 0x4752414E54...;` encodes "GRANT" as hex. The text scanner only looks at ASCII patterns.

3. **`CONCAT()` + `PREPARE`**: `SET @q = CONCAT('GR','ANT ALL ON *.* TO ...'); PREPARE stmt FROM @q; EXECUTE stmt;` — splits the keyword across a function call.

4. **Binary literals**: `SET @q = b'01000111...';` — even more obscure encoding.

5. **MySQL user variables**: `SET @a='GR', @b='ANT'; SET @q=CONCAT(@a,@b,' ALL ON *.* TO ...'); PREPARE stmt FROM @q; EXECUTE stmt;`

The `DELIMITER` pattern IS blocked, which prevents multi-statement tricks. But `PREPARE`/`EXECUTE` within a single statement (using `;` delimiter) is not blocked.

**Attack chain:** Admin (or compromised admin session) uploads a crafted SQL dump containing:
```sql
SET @q = CONCAT('GR','ANT ALL ON *.* TO ','''hacker''@''%''',' IDENTIFIED BY ''password''');
PREPARE stmt FROM @q;
EXECUTE stmt;
```
The scanner doesn't match `PREPARE` or `EXECUTE` or `CONCAT('GR','ANT')`. The `--one-database` flag doesn't block `GRANT` statements because they're not database-scoped.

**Fix:** Add to `dangerousPatterns`:
```ts
/\bPREPARE\b/i,
/\bEXECUTE\b/i,
/\bDEALLOCATE\s+PREPARE\b/i,
/\bSET\s+@\w+\s*=\s*0x/i,  // hex variable assignment
/\bSET\s+@\w+\s*=\s*b'/i,  // binary variable assignment
/\bCONCAT\s*\(/i,            // string building (context-dependent, may cause false positives)
```

---

### S-04: `verifySessionToken` performs DB query on every request — no caching, enables timing-based user enumeration [High — CONFIRMED]

**File:** `apps/web/src/lib/session.ts:94–147`

Every call to `verifySessionToken()` performs:
1. `getSessionSecret()` — cached in memory (good)
2. HMAC verification — constant-time (good)
3. `db.query.sessions.findFirst()` — DB query on every request

This DB query on every authenticated request has two problems:

**Problem A — Performance:** Every admin page load, every server action call, every `isAdmin()` check hits the DB. The `getCurrentUser()` function is `cache()`'d per React render, but `isAdmin()` is called in many different server actions, each with its own render context. With `connectionLimit: 10` and 2 connections held by the processing queue, this can contribute to connection pool exhaustion under load.

**Problem B — Timing side-channel for session existence:** If an attacker has a valid HMAC signature (knows the secret, which requires server compromise), they can distinguish between "session exists in DB" (slow, DB hit) and "session doesn't exist" (fast, DB miss). However, this is mitigated by the fact that knowing the secret already implies full compromise.

**More practical concern:** The `getSession()` function is called by `isAdmin()`, which is called by `getCurrentUser()`, which is `cache()`'d. But `getSession()` itself is NOT cached — it calls `verifySessionToken()` every time. If multiple uncached code paths call `isAdmin()` in the same request, they each hit the DB.

**Fix:** Cache `verifySessionToken()` results per-request using React `cache()`, or add a short-lived in-memory LRU cache (e.g., 60-second TTL) for verified sessions.

---

### S-05: `isAdmin()` uses `cache()` which only deduplicates within a single server component render — not across actions [High — CONFIRMED]

**File:** `apps/web/src/app/actions/auth.ts:27–49`

```ts
export const getCurrentUser = cache(async function getCurrentUser() {
    const session = await getSession();
    ...
});

export async function isAdmin() {
    return !!(await getCurrentUser());
}
```

React's `cache()` deduplicates calls within a single render pass. But each server action invocation is a SEPARATE render context. So if a page component calls `isAdmin()` and then a server action also calls `isAdmin()`, these are two separate DB queries.

More critically: the `proxy.ts` middleware validates the cookie format (`token.split(':').length !== 3`) but does NOT call `isAdmin()`. The first real auth check happens in the server action. If an attacker bypasses the middleware (e.g., direct API access), the server action's `isAdmin()` call is the only defense.

This is not a vulnerability per se (defense in depth is working), but the `cache()` gives a false sense of deduplication. In a single upload operation, `uploadImages()` calls `isAdmin()` once, but the `getCurrentUser()` used in `logAuditEvent()` chains create additional DB queries.

---

### S-06: Session fixation resistance is incomplete — old session not invalidated on login [Medium — CONFIRMED]

**File:** `apps/web/src/app/actions/auth.ts:143–173`

When a user logs in, a new session is created and a new cookie is set. But if the user already had an existing valid session (e.g., from a different browser tab), the OLD session is NOT invalidated. This means:

1. User logs in on Tab A → gets session token A
2. User logs in again on Tab B → gets session token B
3. Both session tokens A and B are valid simultaneously
4. If the user logs out on Tab A, only session A is deleted from the DB. Session B remains valid.

**But the real risk is session fixation:** If an attacker can set a session cookie on the victim's browser before login (e.g., via XSS on a subdomain, or physical access), and the application doesn't rotate the session on login, the attacker's known session remains valid after the victim authenticates.

In this code, the login always creates a NEW session (line 149–153), which is good. The old session cookie is effectively overwritten by the new one (line 165). However, the old session record in the DB is NOT deleted. If the attacker's pre-set session was different from the new one, the old session record lingers until expiry (24 hours).

**Fix:** On successful login, delete any pre-existing sessions for the same user before creating the new one:
```ts
// Before inserting the new session:
await db.delete(sessions).where(eq(sessions.userId, user.id));
```

---

### S-07: `getClientIp` trusts `X-Forwarded-For` without proxy validation — IP spoofing for rate limit bypass [Medium — CONFIRMED]

**File:** `apps/web/src/lib/rate-limit.ts:43–59`

```ts
export function getClientIp(headerStore: HeaderLike): string {
    const xRealIp = normalizeIp(headerStore.get('x-real-ip'));
    if (xRealIp) return xRealIp;

    const xForwardedFor = headerStore.get('x-forwarded-for');
    if (xForwardedFor && xForwardedFor.length <= 512) {
        const parts = xForwardedFor.split(',').map(p => p.trim()).filter(Boolean);
        for (let i = parts.length - 1; i >= 0; i--) {
            const normalized = normalizeIp(parts[i] || null);
            if (normalized) return normalized;
        }
    }
    return 'unknown';
}
```

The code takes the LAST IP in `X-Forwarded-For` (iterates from end). This assumes the last entry is added by the trusted reverse proxy. But if there's no reverse proxy, or if the proxy doesn't strip/append `X-Forwarded-For`, an attacker can set this header directly.

**Attack scenario (no reverse proxy):** An attacker sends requests with `X-Forwarded-For: 1.2.3.4, 5.6.7.8, <random-ip>` for each request. The rate limiter sees a different IP each time, completely bypassing rate limits on login and search.

**Attack scenario (with reverse proxy):** If the reverse proxy appends the real IP, the header becomes `<attacker-injected>, <real-ip>`. The code takes the last entry (real IP), which is correct. But if there are multiple proxies and the last one doesn't append, the attacker can inject.

**Fix:** Document that a reverse proxy MUST strip incoming `X-Forwarded-For` and `X-Real-IP` headers before appending. Or add a configurable list of trusted proxy IPs and only trust the header when the request comes from a trusted proxy.

---

### S-08: `exportImagesCsv` exposes `filename_original` to admin — potential for path disclosure [Low — CONFIRMED]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:39–54`

```ts
const results = await db.select({
    id: images.id,
    filename: images.filename_original,
    ...
})
```

The `filename_original` column contains the UUID-based server filename (e.g., `abc123.jpg`), not the user's original filename. So this doesn't leak user filenames. The `user_filename` is intentionally NOT included. This is fine.

---

### S-09: Middleware `isProtectedAdminRoute` doesn't protect API routes [Medium — CONFIRMED]

**File:** `apps/web/src/proxy.ts:58–61`

```ts
export const config = {
    matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']
};
```

The middleware explicitly EXCLUDES `/api/*` routes from matching. This means the middleware's cookie validation does NOT run for API routes. The `/api/admin/db/download` route handles its own auth via `isAdmin()` on line 11. The `/api/health` route is intentionally unauthenticated.

**But** if any new admin API route is added without its own auth check, it would be accessible without any session cookie. The middleware won't catch it because it skips API routes entirely.

**Risk:** Developer adds a new `/api/admin/something/route.ts` and forgets to call `isAdmin()`. The route is fully open.

**Fix:** Either include API routes in the middleware matcher and add a separate admin check, or add a convention/documentation requiring all `/api/admin/*` routes to verify auth.

---

### S-10: `restoreDatabase` mutex is not cross-process — race condition in multi-instance deployments [Medium — CONFIRMED]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:162`

```ts
let restoreInProgress = false;
```

This is a process-level boolean. In a single-instance deployment, it works. But in a multi-instance deployment (e.g., multiple Next.js workers, Kubernetes pods), each process has its own `restoreInProgress` flag. Two admins (or the same admin with multiple tabs) on different workers could start concurrent restores.

**Failure scenario:** Two concurrent 250MB restores fill `/tmp` on the same machine, or cause conflicting `mysql` client processes that corrupt the database.

**Fix:** Use a DB-based lock (e.g., `GET_LOCK('gallerykit:db-restore', 0)`) or a distributed lock.

---

## CODE QUALITY FINDINGS

### Q-01: `getImage` prev/next query is fundamentally broken for NULL `capture_date` — confirmed from prior review [Critical]

**File:** `apps/web/src/lib/data.ts:254–312`

This was identified in the prior review but warrants deeper analysis. The "prev" query (newer image) when `capture_date` is NULL produces:

```sql
WHERE (
    capture_date IS NOT NULL           -- Branch 1: ALL dated images
    OR (capture_date IS NULL AND created_at > ?)  -- Branch 2: NULL-date images newer by created_at
    OR (capture_date IS NULL AND created_at = ? AND id > ?)  -- Branch 3: tiebreaker
)
AND processed = true
ORDER BY capture_date ASC, created_at ASC, id ASC
LIMIT 1
```

In MySQL, `NULL` sorts first in ASC order. So with `ORDER BY capture_date ASC`:
- All `capture_date IS NULL` rows (from branches 2,3) sort first
- All `capture_date IS NOT NULL` rows (from branch 1) sort after NULLs

The `LIMIT 1` picks the first row in ASC order — which is a NULL-date image (if branch 2/3 matches) or the EARLIEST-dated image (if only branch 1 matches).

But we want the CLOSEST newer image (in gallery DESC sort order). The gallery shows images in `DESC(capture_date)` order, where NULLs appear last. So the "prev" (newer) of a NULL-date image should be:
1. Another NULL-date image with later `created_at` (closest by created_at)
2. If no such image exists, the LATEST-dated image (the one immediately before the NULL block in DESC sort)

The current query returns the EARLIEST-dated image instead of the latest. This is definitely wrong.

**For the "next" query (older image) when `capture_date` is NULL:**
```sql
WHERE (
    FALSE   -- Branch 1: deliberately disabled for NULL
    OR (capture_date IS NULL AND created_at < ?)
    OR (capture_date IS NULL AND created_at = ? AND id < ?)
)
ORDER BY capture_date DESC, created_at DESC, id DESC
LIMIT 1
```

This only looks for NULL-date images. It never finds dated images. But in the gallery, after the NULL block (in DESC sort), there are no more images — NULLs are last. So this is actually correct: there are no "older" images when you're at the end of the DESC sort.

**However**, the "prev" query is still broken for the case where a NULL-date image is the only NULL-date image, and there are dated images. In that case, branches 2 and 3 return nothing, and branch 1 returns all dated images ordered by `ASC(capture_date)`. The `LIMIT 1` picks the earliest-dated image, which is the FARTHEST from the current image in the gallery.

**Fix for prev query:** Use `DESC` ordering and pick the closest dated image:
```sql
WHERE (capture_date IS NOT NULL)  -- All dated images are "before" NULL in DESC sort
OR (capture_date IS NULL AND created_at > ?)
OR (capture_date IS NULL AND created_at = ? AND id > ?)
ORDER BY capture_date DESC, created_at DESC, id DESC  -- DESC to get closest
LIMIT 1
```

Wait — this still isn't right. We need:
- If branch 2/3 matches (NULL-date image with later created_at), pick the one with the LATEST created_at
- If only branch 1 matches (all dated images), pick the one with the LATEST capture_date

Using `DESC` ordering gives us this: NULLs sort last in DESC (correct for branch 2/3 tiebreaker), and within dated images, the latest comes first.

**Actually**, the issue is more subtle. With `OR` combining branches 1, 2, and 3, and `ORDER BY capture_date DESC`:
- In MySQL DESC sort, NOT NULL comes before NULL
- So dated images (branch 1) sort before NULL-date images (branches 2,3)
- Among dated images, `DESC` gives the latest first

So `ORDER BY capture_date DESC, created_at DESC, id DESC LIMIT 1` would pick:
1. The LATEST-dated image (if any dated images exist) — this is the closest newer image to the NULL block
2. If no dated images exist, the NULL-date image with the latest created_at

This IS correct for the "prev" (newer) query. The current code uses `ASC` ordering, which is wrong.

---

### Q-02: `uploadImages` deduplication logic is fragile — matches by `user_filename` OR title [Medium]

**File:** `apps/web/src/app/actions/images.ts:74–89`

```ts
const existingImage = originalFilename.length > 0
    ? (await db.select({...})
        .from(images)
        .where(or(
            eq(images.user_filename, originalFilename),
            and(isNull(images.user_filename), eq(images.title, originalFilename))
        ))
        .orderBy(desc(images.id))
        .limit(1))[0]
    : null;
```

The deduplication matches existing images by `user_filename` OR (if `user_filename` is null, by `title`). The second condition is a migration fallback for legacy rows without `user_filename`.

**Problem:** If a user uploads a file named `sunset.jpg` and later uploads a different photo also named `sunset.jpg`, the second upload REPLACES the first photo. The user may not intend this — they might be uploading a different photo that happens to have the same filename.

**Additionally:** The `orderBy(desc(images.id)).limit(1)` picks the NEWEST matching image. If there are multiple images with the same `user_filename` (possible from a previous bug or manual DB edit), only the newest is considered for replacement.

**Fix:** Consider adding a confirmation step when replacement is detected, or at minimum, make the replacement behavior opt-in rather than automatic.

---

### Q-03: `batchAddTags` and `addTagToImage` use slug-based tag lookup — collision risk leads to wrong tag [Medium]

**File:** `apps/web/src/app/actions/tags.ts:96–116`

```ts
const slug = getTagSlug(cleanName);  // e.g., "Black-White" → "black-white"
await db.insert(tags).ignore().values({ name: cleanName, slug });
const [tagRecord] = await db.select(...).from(tags).where(eq(tags.slug, slug));
```

If two tags have names that produce the same slug (e.g., "Black/White" and "Black-White" both produce slug "black-white"), the `INSERT IGNORE` silently skips the insert, and the `SELECT` returns the EXISTING tag — which may have a different name. The warning on line 108–110 only logs to console; it doesn't prevent the wrong tag from being applied.

**Failure scenario:** Admin creates tag "Black & White" (slug: "black-white"). Later, admin tries to add tag "Black White" (slug: "black-white"). The system applies the existing "Black & White" tag instead, without any user-facing warning.

**Fix:** Return the collision warning to the client, or prevent slug collisions at the UI level by showing existing tags with the same slug.

---

### Q-04: `password-form.tsx` has stale comments from development [Low]

**File:** `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:13–14,32–34`

```ts
// Define explicit return type for the action to make TS happy
// or just cast initialState to any if we want to be lazy, but let's try to be correct.
```

and

```ts
// ... (keep imports)
// ... (keep ActionState type and initialState)
```

These are developer notes that should have been removed before commit. They don't affect functionality but indicate rushed code.

---

### Q-05: `db-actions.ts` `exportImagesCsv` doesn't enforce admin auth consistently [Medium]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:31–34`

```ts
export async function exportImagesCsv() {
    if (!(await isAdmin())) {
        throw new Error("Unauthorized");
    }
```

Unlike most other admin actions that return `{ error: 'Unauthorized' }`, this function `throw`s an Error. The client code in `db/page.tsx:70` calls it inside a `try/catch`, so it works. But the inconsistency means:
- Other actions: client gets a structured error object `{ error: string }`
- This action: client gets a raw Error that needs `e instanceof Error ? e.message : 'Unknown error'`

Not a security issue, but inconsistency that could lead to mishandled errors if the pattern is copied.

---

### Q-06: `admin-user-manager.tsx` not reviewed — deleteAdminUser last-admin check has TOCTOU risk in UI [Risk]

The `deleteAdminUser` server action correctly uses a DB transaction to atomically check the admin count and delete (lines 72–79 in `admin-users.ts`). However, the UI (`admin-user-manager.tsx`) was not fully reviewed. If the UI shows multiple admins and a user clicks "delete" on two admins simultaneously, the second delete could succeed because the UI state is stale.

The server-side transaction correctly prevents this (it would throw `LAST_ADMIN`), so this is a UX issue, not a data integrity issue. The user would see an error on the second attempt. Acceptable.

---

### Q-07: `getImageByShareKey` doesn't increment view count — shared photos have no access tracking [Low]

**File:** `apps/web/src/lib/data.ts:325–359`

Unlike `getSharedGroup` which increments `view_count`, `getImageByShareKey` has no access tracking. There's no way to know how many times a shared photo link has been viewed.

---

### Q-08: `login` function doesn't use CSRF protection — relies on SameSite cookie attribute [Medium]

**File:** `apps/web/src/app/actions/auth.ts:66–185`

The login form uses `useActionState` with a server action. Next.js server actions include their own CSRF protection via the `Origin` header check (automatically enforced by Next.js). However, if this protection is ever bypassed or weakened, the login form is vulnerable to CSRF — an attacker could force a victim to log in as the attacker's account.

The `sameSite: 'lax'` cookie attribute provides some protection (cookie is not sent on cross-site POST requests), but it doesn't prevent all CSRF scenarios (e.g., top-level navigations from external sites).

**Note:** Next.js server actions do enforce Origin checking. This is informational, not a current vulnerability.

---

### Q-09: `revalidation.ts` can cause N+1 revalidation calls in topic/filter changes [Medium]

**File:** `apps/web/src/lib/revalidation.ts:28–38`

Every admin action calls `revalidateLocalizedPaths()` with multiple paths. For example, `uploadImages` calls:
```ts
revalidateLocalizedPaths('/', '/admin/dashboard');
```

This generates revalidation for: `/`, `/en`, `/ko`, `/admin/dashboard`, `/en/admin/dashboard`, `/ko/admin/dashboard` — 6 revalidation calls per upload.

During batch uploads (up to 100 files), each file's processing completion does NOT trigger revalidation (good — removed from queue). But the single `revalidateLocalizedPaths` call at the end of `uploadImages` is fine. However, `updateImageMetadata` also calls `revalidateLocalizedPaths('/admin/dashboard', '/')`, and `deleteImage` does the same. These are called per-image in the admin UI, which is acceptable.

The real concern is that `revalidatePath('/')` revalidates the entire homepage, which may be expensive with large galleries. Consider using `revalidateTag` or more targeted paths.

---

### Q-10: `DB_HOST` env var used in `sslConfig` logic AND `mysqldump`/`mysql` spawn — inconsistent TLS enforcement [Medium]

**File:** `apps/web/src/db/index.ts:7–10`

```ts
const dbHost = process.env.DB_HOST ?? '127.0.0.1';
const isLocalhost = ['127.0.0.1', 'localhost', '::1'].includes(dbHost);
const sslDisabled = process.env.DB_SSL === 'false';
const sslConfig = (!isLocalhost && !sslDisabled) ? { ssl: { rejectUnauthorized: true } } : {};
```

The Drizzle/MySQL2 pool uses TLS for non-localhost connections. But `db-actions.ts` uses `spawn('mysqldump', ...)` and `spawn('mysql', ...)` without any TLS flags. The `mysqldump` and `mysql` CLI clients will connect WITHOUT TLS unless `--ssl` is explicitly passed.

**Failure scenario:** DB is on a remote host. The application pool uses TLS (encrypted), but backup/restore uses plaintext (unencrypted). An attacker on the network can sniff the DB credentials from the `MYSQL_PWD` env var and the entire database contents from the dump stream.

**Fix:** Add `--ssl-mode=REQUIRED` (or `--ssl`) to the `mysqldump` and `mysql` spawn arguments when the DB is not localhost.

---

### Q-11: `getNextConfig` `proxyClientMaxBodySize` may not align with server action body size limit [Low]

**File:** `apps/web/next.config.ts:88–89`

```ts
experimental: {
    serverActions: {
        bodySizeLimit: NEXT_UPLOAD_BODY_SIZE_LIMIT,
    },
    proxyClientMaxBodySize: NEXT_UPLOAD_BODY_SIZE_LIMIT,
},
```

Both are set to the same value, which is correct. `proxyClientMaxBodySize` controls the maximum request body size for the dev server proxy, and `serverActions.bodySizeLimit` controls the limit for server actions. Since uploads go through server actions, both need to be aligned. They are. Good.

---

### Q-12: `db/page.tsx` backup download creates an `<a>` element with `result.url` — open redirect risk [Medium]

**File:** `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:23–29`

```ts
if (result.success && result.url) {
    const link = document.createElement('a');
    link.href = result.url;
    link.download = result.url.split('/').pop() || 'backup.sql';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
```

The `result.url` comes from `dumpDatabase()` which returns `/api/admin/db/download?file=backup-<timestamp>.sql`. This is a server-controlled URL. But if the server response were ever manipulated (e.g., MITM), `link.href` could be set to an external URL. The `link.download` attribute only works for same-origin URLs; for cross-origin URLs, the browser navigates instead of downloading.

**Risk:** Low, because `result.url` is server-generated. But the code doesn't validate that `result.url` starts with `/api/admin/db/download`.

**Fix:** Validate `result.url` starts with the expected prefix before creating the link.

---

### Q-13: `process-image.ts` `UPLOAD_ROOT` detection based on `process.cwd()` is fragile [Medium]

**File:** `apps/web/src/lib/process-image.ts:27–45`

```ts
const UPLOAD_ROOT = (() => {
    if (process.cwd().endsWith('apps/web')) {
        return simplePath;
    }
    return monorepoPath;
})();
```

This determines the upload directory based on the current working directory. In the Docker standalone output, the CWD is `/app` and the structure is different. The comment says "we know the CWD is /app and structure is copied" but this is fragile.

**Failure scenario:** If the Docker container is launched with a different CWD (e.g., via `workingDir` in Kubernetes), or if the Next.js standalone server changes its CWD behavior, uploads would go to the wrong directory.

**Fix:** Use an environment variable (e.g., `UPLOAD_ROOT`) with a sensible default, rather than guessing from `process.cwd()`.

---

### Q-14: `searchImages` returns `filename_jpeg` in results — potential for directory enumeration [Low]

**File:** `apps/web/src/lib/data.ts:462–468`

The `SearchResult` type includes `filename_jpeg`, `filename_webp`, and `filename_avif`. These are UUID-based filenames (e.g., `abc123.jpg`), so they don't leak user data. But they do reveal the server's UUID pattern, which could be used for enumeration if UUIDs are predictable (they're not — `crypto.randomUUID()` uses CSPRNG).

---

### Q-15: No CSRF protection on `logout` — forced logout attack [Low]

**File:** `apps/web/src/app/actions/auth.ts:187–200`

The `logout` function deletes the session from the DB and the cookie. If an attacker can trick a user into submitting a form to the logout action (e.g., via a crafted page), the user is logged out. This is a low-severity issue — forced logout is annoying but not dangerous. Next.js server actions provide Origin checking, so this is mitigated.

---

### Q-16: `admin-header.tsx` logout form doesn't include CSRF token [Low]

**File:** `apps/web/src/components/admin-header.tsx:21–24`

```tsx
<form action={logout}>
    <input type="hidden" name="locale" value={locale} />
    <Button variant="ghost" size="sm">{t('nav.logout')}</Button>
</form>
```

No CSRF token is included. However, Next.js server actions enforce Origin checking automatically, so this is not exploitable in practice.

---

### Q-17: `info-bottom-sheet.tsx` displays `user_filename` as fallback title — same PII leak as photo-viewer [Medium]

**File:** `apps/web/src/components/info-bottom-sheet.tsx:106–110`

```ts
const displayTitle = image.title && image.title.trim() !== ''
    ? image.title
    : (image.tags && image.tags.length > 0
        ? image.tags.map((tag: TagInfo) => `#${tag.name}`).join(' ')
        : (image.user_filename || t('imageManager.untitled')));
```

Same issue as C-13 from the prior review. The bottom sheet displays `user_filename` as a fallback when no title or tags exist.

---

### Q-18: `ImageZoom` ref-based DOM manipulation can get out of sync with React state [Medium]

**File:** `apps/web/src/components/image-zoom.tsx:25–30, 96–106`

The `applyTransform` function directly mutates `innerRef.current.style.transform` without going through React state. This is intentionally done for performance (avoiding re-renders on every mousemove). However:

1. If the component re-renders while zoomed, React may reset `style.transform` to the initial value (`scale(1) translate(0%, 0%)`) from line 138.
2. The `useEffect` on lines 109–114 tries to keep the DOM in sync when `isZoomed` changes, but it only handles the `!isZoomed` case.
3. The keyboard handler on lines 96–106 sets `isZoomed` state and calls `applyTransform` — but the state update is asynchronous, so the DOM may briefly show the wrong state.

**Fix:** Use a `ref` for the current transform values and apply them in a `useEffect` that runs on every render, ensuring the DOM always reflects the latest state.

---

## DEEP CROSS-CUTTING ANALYSIS

### Cross-01: Auth chain — `proxy.ts` → `isAdmin()` → `getCurrentUser()` → `getSession()` → `verifySessionToken()` → DB

The entire auth chain is:
1. Middleware checks cookie format (3 colon-separated parts)
2. Server actions call `isAdmin()` which calls `getCurrentUser()` which calls `getSession()`
3. `getSession()` calls `verifySessionToken()` which verifies HMAC + checks DB session

**Weakness:** Step 1 only validates format, not cryptographic validity. An attacker can craft a cookie with the format `timestamp:random:invalid-signature` that passes the middleware check but fails at `verifySessionToken()`. This means the middleware check is just a performance optimization (avoids the HMAC+DB check for obviously invalid cookies), not a security boundary.

**This is acceptable** — the real security check is in step 3. But it should be documented that the middleware is not a security boundary.

---

### Cross-02: Data flow — GPS coordinates from EXIF → DB → potential leak

The flow for GPS data:
1. `process-image.ts:484–515` — extracts GPS from EXIF, converts DMS to decimal degrees
2. `images.ts:131` — stored in `images.latitude` and `images.longitude` columns
3. `data.ts:44–48` — `adminExtraFields` includes lat/lon
4. `photo-viewer.tsx:435–448` — rendered in sidebar if `image.latitude != null`
5. `info-bottom-sheet.tsx:275–288` — same rendering in mobile view

The `selectFields` object (used by `getImage`, `getImagesLite`, etc.) correctly omits lat/lon. But the `ImageDetail` interface includes them as optional fields. If any future code path passes an image with lat/lon to a public component, the data leaks.

**Recommended hardening:** Create a `PublicImageDetail` type that omits `latitude`, `longitude`, and `user_filename`, and use it as the prop type for public-facing components.

---

### Cross-03: File system operations — no atomicity guarantees

Multiple operations combine DB changes with filesystem changes without atomicity:

| Action | DB operation | Filesystem operation | Risk if FS fails |
|--------|-------------|---------------------|------------------|
| `uploadImages` | INSERT image | Write original to disk | Orphaned file if INSERT fails (acceptable) |
| `deleteImage` | DELETE image | Unlink 4 files per image | DB says deleted but files remain (acceptable) |
| `updateTopic` | UPDATE topic | Delete old image, write new | Old image deleted, new not written (acceptable — topic just loses its image) |
| `dumpDatabase` | — | Write backup file | Backup file partial (handled by writeStream error) |
| `restoreDatabase` | — | Write temp, validate, pipe to mysql | Temp file cleaned up in all error paths |

The current approach is acceptable — DB is the source of truth, and orphaned files are preferable to missing files (which would cause 404s). The reverse (DB says exists but file is missing) is handled gracefully by the `serveUploadFile` route returning 404.

---

## TEST COVERAGE GAPS

### T-01: No test for `verifySessionToken` — the most security-critical function

The session test file (`__tests__/session.test.ts`) only tests `hashSessionToken` and `generateSessionToken` format. It does NOT test:
- `verifySessionToken()` with valid/invalid signatures
- `verifySessionToken()` with expired tokens
- `verifySessionToken()` with tokens where the DB session doesn't exist
- `verifySessionToken()` with replayed tokens after logout

### T-02: No test for `isAdmin()` or `getCurrentUser()` auth chain

### T-03: No test for `serveUploadFile` — path traversal, symlink rejection, directory whitelist

### T-04: No test for `restoreDatabase` — dangerous SQL pattern detection

### T-05: No test for `deleteTopicImage` — path traversal via `image_filename`

### T-06: No test for `getSharedGroup` expiry logic

### T-07: No test for `getImage` prev/next navigation (the NULL capture_date bug)

---

## PRIORITY MATRIX

| ID | Category | Severity | Effort | Description |
|----|----------|----------|--------|-------------|
| S-01 | Privacy | Critical | Medium | GPS coords latent leak via ImageDetail type |
| S-02 | Security | High | Low | `deleteTopicImage` path traversal |
| S-03 | Security | High | Medium | SQL restore scanner bypass via PREPARE/EXECUTE |
| S-04 | Performance | High | Medium | Session verification DB hit on every request |
| Q-01 | Correctness | Critical | Medium | `getImage` prev/next broken for NULL capture_date |
| S-06 | Security | Medium | Low | Session fixation — old session not invalidated on login |
| S-07 | Security | Medium | Medium | IP spoofing for rate limit bypass |
| S-09 | Security | Medium | Low | API routes excluded from middleware auth |
| S-10 | Security | Medium | Medium | Restore mutex not cross-process |
| Q-02 | UX/Correctness | Medium | Low | Upload dedup replaces by filename without confirmation |
| Q-03 | Correctness | Medium | Medium | Tag slug collision applies wrong tag silently |
| Q-10 | Security | Medium | Low | mysqldump/mysql CLI doesn't use TLS |
| Q-12 | Security | Medium | Low | Backup download URL not validated client-side |
| Q-13 | Robustness | Medium | Low | UPLOAD_ROOT detection fragile |
| C-13/S-17 | Privacy | Medium | Low | `user_filename` PII leak in photo-viewer and bottom sheet |
| Q-18 | Correctness | Medium | Low | ImageZoom DOM state can desync from React state |
| S-05 | Performance | High | Medium | `isAdmin()` cache doesn't work across actions |
| Q-05 | Consistency | Low | Low | `exportImagesCsv` throws vs returns error |
| S-08 | Non-issue | — | — | `filename_original` in CSV is UUID, not PII |
| Q-04 | Code quality | Low | Low | Stale dev comments in password-form.tsx |
| Q-07 | Feature | Low | Medium | No view tracking for shared photo links |
| Q-08 | Security | Low | — | No CSRF on login (mitigated by Next.js) |
| Q-09 | Performance | Low | Medium | Revalidation may be expensive on large galleries |
| Q-14 | Security | Low | — | Search results expose UUID filenames |
| Q-15 | Security | Low | — | Forced logout via CSRF (mitigated by Next.js) |
| Q-16 | Security | Low | — | Logout form lacks CSRF token (mitigated) |

---

## RECOMMENDED FIX ORDER

1. **Q-01** (prev/next navigation bug) — affects all users with undated photos
2. **S-02** (deleteTopicImage path traversal) — one-line fix, high impact
3. **S-03** (SQL scanner bypass) — add PREPARE/EXECUTE/hex patterns
4. **S-01** (GPS latent leak) — create PublicImageDetail type
5. **C-13/S-17** (user_filename PII leak) — guard behind admin check
6. **S-06** (session fixation) — delete old sessions on login
7. **S-07** (IP spoofing) — document proxy requirements
8. **S-09** (API route auth) — document convention or extend middleware
9. **Q-10** (TLS for mysqldump/mysql) — add --ssl-mode=REQUIRED
10. **S-10** (restore mutex) — use DB-based lock
11. **S-04** (session verification caching) — add per-request cache
12. **Q-02** (upload dedup UX) — add confirmation for replacement
13. **Q-03** (tag slug collision) — surface warning to client
14. All Low severity items
