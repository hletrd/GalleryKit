# Security Review — Cycle 14 (2026-04-20)

**Reviewer:** Security-focused deep audit
**Scope:** All server actions, API routes, middleware, auth, storage, upload pipeline, client components
**Previous cycle:** Cycle 13 (C13-01 through C13-03)

---

## Previously Fixed — Confirmed Resolved

- **C13-01**: Login rate limit rollback on unexpected errors — **FIXED**. `auth.ts:193-199` now clears `clearSuccessfulLoginAttempts(ip)` in the outer catch block.
- **C13-02**: Password change rate limit rollback on unexpected errors — **FIXED**. `auth.ts:332-337` now clears `clearSuccessfulPasswordAttempts(ip)` in the outer catch block.

All prior cycle 1–12 findings remain resolved. No regressions detected.

---

## New Findings

### C14-01: Topic image temp file not cleaned up on Sharp processing failure (MEDIUM)

**File:** `apps/web/src/lib/process-topic-image.ts:64-78`
**Lines:** 64–78

**Description:** When Sharp processing fails (line 70–73), the temp file at `tempPath` is cleaned up in the catch block (line 77). However, if the `sharp().resize().webp().toFile()` call partially writes `outputPath` before throwing, the output file is cleaned up (line 78), but there is no cleanup for the case where the `pipeline()` on line 68 succeeds (writing `tempPath`) but the process crashes (OOM, SIGKILL) between lines 68 and 70. In that case, the orphaned temp file `tmp-{uuid}` persists in `RESOURCES_DIR` indefinitely.

**Attack Scenario:** An attacker who can trigger repeated topic image uploads with malformed images that pass streaming but cause Sharp to OOM could fill disk space with orphaned temp files. While this requires admin auth, the defense-in-depth gap means disk exhaustion from uncleaned temp files over time.

**Suggested Fix:** Add a startup or periodic cleanup of `tmp-*` files in `RESOURCES_DIR` (matching the temp file naming pattern), or use `os.tmpdir()` for temp files instead of the resources directory.

**Confidence:** Low — requires admin auth + OOM/crash scenario, and the existing catch blocks handle most failure modes.

---

### C14-02: `processTopicImage` uses `file.name` for extension check but doesn't validate the extension is consistent with actual content (LOW)

**File:** `apps/web/src/lib/process-topic-image.ts:53-55`
**Lines:** 39–55

**Description:** `isAllowedExtension(file.name)` checks the browser-supplied filename extension (e.g., `.jpg`), but the actual file content could be anything. Sharp will reject truly invalid inputs, but the extension check is purely cosmetic. By contrast, `process-image.ts:getSafeExtension()` does the same pattern but at least normalizes the extension. Neither validates content-type consistency (e.g., a `.png` file that's actually a GIF). This is a defense-in-depth gap, not an exploitable vulnerability — Sharp handles the actual decode safely.

**Attack Scenario:** A malicious admin could upload a file with a mismatched extension (e.g., rename `malicious.gif` to `image.webp`). Sharp would still process it correctly as a GIF internally, but the `.webp` extension in the output would be misleading. No security impact since Sharp validates content independently.

**Suggested Fix:** Low priority. Could optionally validate `file.type` matches the extension, or rely on Sharp's content-based detection (current behavior is functionally safe).

**Confidence:** Low — Sharp is the ground truth for image format; extension checks are a UX guard, not a security boundary.

---

### C14-03: DB restore scan doesn't detect `DO` statements (LOW)

**File:** `apps/web/src/lib/sql-restore-scan.ts:1-31`
**Lines:** 1–31

**Description:** The `DANGEROUS_SQL_PATTERNS` list catches many dangerous SQL constructs (GRANT, CREATE USER, DROP DATABASE, INTO OUTFILE, etc.), but it doesn't include `\bDO\b` — MySQL's `DO` statement executes an expression without returning a result. While `DO` is relatively benign compared to `GRANT` or `LOAD DATA`, it can invoke stored functions: `DO some_malicious_function()`. Combined with the existing `CREATE FUNCTION` block, this is mitigated since the function creation itself would be blocked. However, `DO SLEEP(10000)` could cause a denial-of-service during restore.

**Attack Scenario:** A crafted SQL dump containing `DO SLEEP(86400)` would pass the dangerous pattern scanner and cause the `mysql` restore process to hang for 24 hours, blocking the advisory lock and preventing other restores.

**Suggested Fix:** Add `/\bDO\s+/i` to `DANGEROUS_SQL_PATTERNS` in `sql-restore-scan.ts`. This blocks `DO` statements in restores, which have no legitimate use in mysqldump output.

**Confidence:** Medium — `DO` statements never appear in legitimate mysqldump output, so blocking them has zero false-positive risk. The DoS risk is real but requires admin auth.

---

### C14-04: `updateSeoSettings` doesn't sanitize `seo_og_image_url` for SSRF in OG meta tags (LOW)

**File:** `apps/web/src/app/actions/seo.ts:88-97`
**Lines:** 88–97

**Description:** The `seo_og_image_url` field is validated to be a valid HTTP/HTTPS URL, but internal/private network URLs (e.g., `http://127.0.0.1:3306`, `http://169.254.169.254/latest/meta-data/`) pass validation. When this URL is used in OG meta tags or the OG image route, it could be used to probe internal services (SSRF) if the server ever fetches the URL server-side. Currently, the URL is only rendered in HTML meta tags and never fetched server-side by GalleryKit itself, so there is no active SSRF vector. Social media crawlers (Facebook, Twitter, etc.) that fetch OG images would make the request from their own infrastructure, not from the GalleryKit server.

**Attack Scenario:** No current server-side SSRF vector exists. The URL is only emitted as metadata. If a future feature adds server-side fetching of the OG image (e.g., for validation or caching), the lack of private-IP filtering would become exploitable.

**Suggested Fix:** Low priority — add private IP/hostname filtering to `seo_og_image_url` validation (reject `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`) as defense-in-depth against future SSRF. Alternatively, document that the URL must never be fetched server-side.

**Confidence:** Low — no current server-side fetch of this URL; purely defense-in-depth for future changes.

---

### C14-05: `restoreDatabase` passes `LANG` and `LC_ALL` to mysql child process — minor env leak surface (LOW)

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:313-314`
**Lines:** 313–314 (same pattern at line 121)

**Description:** The `env` option for `spawn('mysql', ...)` and `spawn('mysqldump', ...)` explicitly passes `LANG: process.env.LANG` and `LC_ALL: process.env.LC_ALL`. This is intentional — it ensures proper UTF-8 handling in the child process. However, the explicit env whitelist approach is good security practice and these are safe locale variables. This is not a finding per se, but documenting that the env whitelist is intentionally minimal (only `PATH`, `HOME`, `NODE_ENV`, `MYSQL_PWD`, `LANG`, `LC_ALL`).

**Suggested Fix:** No action needed — the whitelist approach is correct and these variables are safe.

**Confidence:** N/A — informational, not a finding.

---

## Comprehensive Security Audit — No Issues Found

The following areas were reviewed and found to have no new security concerns:

### Authentication & Session Management
- **Argon2id password hashing** with dummy hash for timing-safe user enumeration prevention (`auth.ts:130`)
- **HMAC-SHA256 session tokens** with `timingSafeEqual` verification (`session.ts:94-145`)
- **Session fixation prevention** — old sessions deleted in transaction before new session created (`auth.ts:157-169`)
- **Password change invalidates other sessions** in transaction (`auth.ts:310-323`)
- **Secure cookie attributes** — `httpOnly`, `secure` (in production/HTTPS), `sameSite: lax` (`auth.ts:176-182`)
- **Production refuses DB-stored session secret** (`session.ts:30-36`)
- **Last-admin deletion prevention** with atomic check (`admin-users.ts:151-159`)

### Middleware & API Route Auth
- **Middleware cookie format check** on protected admin routes (`proxy.ts:39-41`)
- **API routes excluded from middleware** — documented in matcher config, all `/api/admin/*` routes use `withAdminAuth` (`proxy.ts:60-62`, `api-auth.ts`)
- **`withAdminAuth` wrapper** enforces `isAdmin()` on all admin API routes (`api-auth.ts:9-19`)

### Server Actions — Auth Checks
- Every admin server action starts with `if (!(await isAdmin()))` — verified across all action files:
  - `images.ts:50`, `tags.ts:20/42/81/107/156/193/282`, `topics.ts:34/100/189/228/269`, `sharing.ts:58/137/229/256`, `settings.ts:16/37`, `admin-users.ts:63/138`, `seo.ts:30/57`
- Public actions (`public.ts`) have no auth requirement by design, with rate limiting

### Input Validation
- **Slugs** validated with `isValidSlug()` (alphanumeric + hyphens + underscores, max 100 chars)
- **Filenames** validated with `isValidFilename()` (no path traversal, safe chars only, starts alphanumeric)
- **Tag names** validated with `isValidTagName()` (no HTML characters `<>"'&`)
- **Image IDs** validated as positive integers throughout
- **Batch size limits** — 100 for images, 100 for tags, 100 for share groups
- **Upload limits** — 200MB per file, 2GB total, 100 files per window, 1-hour tracking window
- **Search query** — max 200 chars, min 2 chars
- **SEO settings** — key whitelist + per-field length limits + URL protocol validation
- **Gallery settings** — key whitelist + per-key validators (ranges, enums)

### Path Traversal Prevention
- **Upload serving** (`serve-upload.ts:8-9`): `SAFE_SEGMENT` regex + `ALLOWED_UPLOAD_DIRS` whitelist + `resolvedPath.startsWith()` containment + symlink rejection via `lstat()`
- **DB backup download** (`route.ts:8-18`): `SAFE_FILENAME` regex + `resolvedPath.startsWith()` containment + symlink rejection
- **Local storage** (`local.ts:26-30`): `path.resolve()` + `startsWith()` containment in `resolve()` method
- **Image filenames** — UUID-based via `crypto.randomUUID()`, never user-controlled on disk

### File Upload Security
- **Decompression bomb mitigation** — `limitInputPixels` on Sharp constructors
- **Extension sanitization** — `getSafeExtension()` strips non-alphanumeric, checked against whitelist
- **Topic images** — `ALLOWED_EXTENSIONS` check + Sharp `limitInputPixels`
- **Temp file modes** — `0o600` permissions on write streams

### SQL Injection Prevention
- All queries via Drizzle ORM (parameterized)
- LIKE wildcards (`%`, `_`, `\`) properly escaped in `searchImages()` (`data.ts:596`)
- SQL restore scanning (`sql-restore-scan.ts`) blocks dangerous patterns before restore

### XSS Prevention
- All `dangerouslySetInnerHTML` uses go through `safeJsonLd()` which escapes `<` as `\u003c`
- No `innerHTML`, `eval()`, `Function()`, or `document.write` usage found
- React JSX auto-escaping handles all other rendered content
- Tag names block `<>"'&` characters at validation level

### CSRF Protection
- `sameSite: lax` cookies prevent cross-site POST attacks
- Server actions require `'use server'` directive — Next.js validates origin headers

### Privacy
- **GPS coordinates** excluded from `publicSelectFields` with compile-time guard (`data.ts:139-148`)
- **`filename_original`** and **`user_filename`** excluded from public queries
- **`stripGpsOnUpload`** setting available (admin-configurable)
- **Search results** omit `filename_webp` and `filename_avif`

### Rate Limiting
- **Login**: 5 attempts / 15 min (in-memory + DB-backed, pre-increment TOCTOU fix)
- **Password change**: 10 attempts / 15 min (separate map from login)
- **Search**: 30 requests / 1 min (in-memory + DB-backed, pre-increment TOCTOU fix)
- **Upload**: 100 files / 1 hour (in-memory cumulative tracker)
- **Share creation**: 20 / 1 min (in-memory + DB-backed)
- **User creation**: 10 / 1 hour (in-memory + DB-backed)
- All Maps have hard-cap eviction to prevent unbounded memory growth
- All Maps prune expired entries

### Child Process Security
- `mysqldump` and `mysql` spawned with minimal env whitelist (`PATH`, `HOME`, `NODE_ENV`, `MYSQL_PWD`, `LANG`, `LC_ALL`)
- `MYSQL_PWD` env var used instead of `-p` flag (avoids password in process args)
- `--one-database` flag on restore prevents cross-database writes
- Advisory lock prevents concurrent restores

### Audit Logging
- All admin actions logged with user ID, action, target, and optional metadata
- Metadata truncated to 4KB to prevent audit log abuse
- Failed serialization handled gracefully

---

## DEFERRED CARRY-FORWARD

All items from cycle 13 carry-forward remain deferred (unchanged):

1. U-15 connection limit docs mismatch (very low priority)
2. U-18 enumerative revalidatePath (low priority, current approach works)
3. /api/og throttle architecture (edge runtime, delegated to reverse proxy)
4. Font subsetting (Python brotli dependency issue)
5. Docker node_modules removal (native module dependency)
6. C5-04 searchRateLimit in-memory race (safe by Node.js single-thread guarantee)
7. C5-05 original_file_size from client value (acceptable for display metadata)
8. C5-07 prunePasswordChangeRateLimit infrequent pruning (hard cap sufficient)
9. C5-08 dumpDatabase partial file cleanup race (negligible risk)
10. C6-10 queue bootstrap unbounded fetch (by-design, paginated limit if >10K pending)
11. C7-07 NULL capture_date prev/next navigation (legacy-only, reasonable UX)
12. C7-08 rate limit inconsistency in safe direction (no fix needed)
13. C8-04 searchImages query length guard (defense in depth, caller truncates)
14. C8-05 audit log on race-deleted image (control flow already guards)
15. C8-10 batchUpdateImageTags added count accuracy (negligible UX inaccuracy)

---

## TOTALS

- **0 CRITICAL / HIGH** findings
- **1 MEDIUM** finding (C14-01 — orphaned topic image temp files)
- **3 LOW** findings (C14-02 — extension/content mismatch, C14-03 — `DO` statement in SQL restore, C14-04 — SSRF defense-in-depth for OG URL)
- **4 total** actionable findings (1M + 3L)
- **All cycle 1–13 findings remain resolved** — no regressions detected
