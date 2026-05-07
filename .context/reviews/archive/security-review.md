# Security Review Report -- Round 4

**Date:** 2026-04-11
**Reviewer:** Security Reviewer (automated, Claude Opus 4.6)
**Scope:** Full codebase review of GalleryKit at `/Users/hletrd/flash-shared/gallery`
**Risk Level:** LOW-MEDIUM (improved from R3 MEDIUM)

---

## Summary

| Severity | Count | Delta vs R3 |
|----------|-------|-------------|
| Critical | 0     | -- (was 0)  |
| High     | 1     | -1 (was 2)  |
| Medium   | 3     | -2 (was 5)  |
| Low      | 5     | -1 (was 6)  |
| Info     | 4     | +1 (was 3)  |
| **Total**| **13**| -1 (was 14) |

**Key improvements since R3:**
- MySQL-backed persistent rate limiting (`rate_limit_buckets`) is injection-safe (Drizzle ORM parameterised, `onDuplicateKeyUpdate` uses column reference not string interpolation).
- Vitest test suite covers `normalizeIp`, `isValidSlug`, `isValidFilename`, `isBase56`, `hashSessionToken`, `generateSessionToken` -- all security-critical helpers.
- Queue retry limit (MAX_RETRIES=3) prevents infinite retry loop from R3 finding.
- Shared group expiry and view counting use safe Drizzle column references.
- `audit_log` schema stores IP (varchar 45 for IPv6) and opaque `metadata` TEXT -- no PII schema leakage by design.
- Histogram Web Worker (`public/histogram-worker.js`) is a pure compute kernel with no network, DOM, or import access -- **no security risk**.

**New concerns introduced in R4:**
- `bodySizeLimit: '10gb'` (next.config.ts:28) is 50x higher than any per-file limit; creates a DoS surface.
- `purgeOldBuckets()` is exported but never called -- rate_limit_buckets table grows without bound.

---

## High Issues

### H-1. Server Action body size limit is 10 GB -- denial-of-service surface

**Severity:** HIGH
**Category:** A05 Security Misconfiguration / DoS
**Location:** `/Users/hletrd/flash-shared/gallery/apps/web/next.config.ts:28-31`
**Exploitability:** Remote, authenticated (admin). Unauthenticated users can also hit server action endpoints before auth check, holding the connection while Next.js buffers the full body.
**Blast Radius:** Memory exhaustion or disk-fill on the Node.js process. A single 10 GB POST ties up a server action worker for the entire transfer duration.

**Issue:**
```typescript
experimental: {
    serverActions: {
        bodySizeLimit: '10gb',     // line 28
    },
    proxyClientMaxBodySize: '10gb', // line 31
},
```

The comment on line 27 says "Keep this close to the app-level MAX_FILE_SIZE" but MAX_FILE_SIZE is 200 MB and MAX_RESTORE_SIZE is 250 MB. The actual per-file checks are performed *after* Next.js has already accepted and buffered the full body, so a 10 GB payload will be fully received before any application-level rejection.

With `uploadImages` accepting up to 100 files, the theoretical maximum legitimate payload is ~20 GB (100 x 200 MB), but the streaming approach (`saveOriginalAndGetMetadata` streams each file to disk individually) means the body limit only needs to cover the FormData envelope for one batch.

**Remediation:**
```typescript
experimental: {
    serverActions: {
        // 100 files x 200MB + FormData overhead. Round up for safety.
        bodySizeLimit: '250mb',
    },
    proxyClientMaxBodySize: '250mb',
},
```

If the upload dropzone already sends files one-at-a-time (UPLOAD_CONCURRENCY=3, each FormData has one file), the limit can be as low as `'210mb'`. Rely on the reverse proxy (nginx) for the actual transport-level cap as defense-in-depth.

---

## Medium Issues

### M-1. `purgeOldBuckets()` is never called -- rate_limit_buckets table grows unbounded

**Severity:** MEDIUM
**Category:** A05 Security Misconfiguration
**Location:** `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/rate-limit.ts:146`
**Exploitability:** Indirect. An attacker performing sustained login brute-force across many IPs will accumulate rows. Over weeks/months, the table grows large enough to degrade query performance of `checkRateLimit()` and `incrementRateLimit()`, weakening rate limiting itself.
**Blast Radius:** Database bloat, degraded rate-limit enforcement.

**Issue:**
The function `purgeOldBuckets()` is defined and exported but is never imported or called anywhere in the codebase. The existing hourly GC interval in `image-queue.ts:164` only calls `purgeExpiredSessions()`. The in-memory Maps (`loginRateLimit`, `searchRateLimit`) have pruning, but the persistent MySQL table does not.

**Remediation:**
Add `purgeOldBuckets` to the existing hourly GC interval in `image-queue.ts`:

```typescript
// image-queue.ts, inside bootstrapImageProcessingQueue():
import { purgeOldBuckets } from '@/lib/rate-limit';

// After purgeExpiredSessions():
purgeExpiredSessions();
purgeOldBuckets();  // <-- Add this

if (state.gcInterval) clearInterval(state.gcInterval);
state.gcInterval = setInterval(() => {
    purgeExpiredSessions();
    purgeOldBuckets();  // <-- And this
}, 60 * 60 * 1000);
```

### M-2. In-memory login rate limit resets on process restart

**Severity:** MEDIUM
**Category:** A07 Authentication Failures
**Location:** `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/rate-limit.ts:19`
**Exploitability:** Remote, unauthenticated. An attacker can exhaust 5 attempts, then force a process restart (if they can trigger an OOM or the container restarts for unrelated reasons) to get 5 more attempts. In containerised deployments with auto-restart, this partially undermines the rate limit.
**Blast Radius:** Weakened brute-force protection for admin login.

**Issue:**
The `login()` function in `auth.ts` uses the in-memory `loginRateLimit` Map exclusively. The persistent `checkRateLimit()` / `incrementRateLimit()` functions using `rate_limit_buckets` are exported but **not used** for login rate limiting. The in-memory Map is empty on every process start.

The MySQL-backed rate limit infrastructure was added in R4, but the `login()` function was not migrated to use it.

**Remediation:**
Migrate the login flow to use the persistent rate limit, or use it as a secondary check:

```typescript
// In auth.ts login():
import { checkRateLimit, incrementRateLimit } from '@/lib/rate-limit';

// After validating inputs:
const { limited } = await checkRateLimit(ip, 'login', LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
if (limited) {
    return { error: 'Too many login attempts. Please try again later.' };
}
await incrementRateLimit(ip, 'login', LOGIN_WINDOW_MS);

// On successful auth:
// (optionally reset, or just let the window expire naturally)
```

Keep the in-memory Map as a fast-path cache to avoid a DB round-trip on every attempt, but the DB must be the source of truth.

### M-3. Upload dropzone sends files individually but `uploadImages` accepts 100 files in one FormData

**Severity:** MEDIUM
**Category:** A05 Security Misconfiguration / DoS
**Location:** `/Users/hletrd/flash-shared/gallery/apps/web/src/app/actions/images.ts:48-49`
**Exploitability:** Remote, authenticated. A crafted HTTP client (not the browser UI) can submit a single FormData with 100 x 200 MB files (~20 GB). The `totalSize` check (line 48-49) caps at 10 GB, but this is still a very large payload that will be fully buffered.
**Blast Radius:** Server resource exhaustion, disk fill.

**Issue:**
```typescript
const totalSize = files.reduce((sum, f) => sum + f.size, 0);
if (totalSize > 10 * 1024 * 1024 * 1024) { // 10GB
    return { error: 'Total upload size exceeds 10GB limit' };
}
```

The 10 GB total-size check runs after `formData.getAll('files')` has already materialised all file objects. Combined with H-1 (10 GB body limit), the server accepts and holds the full payload before rejecting.

**Remediation:**
Lower the total-size cap to a more reasonable value (e.g., 2 GB) and ensure the body size limit in next.config.ts is aligned:

```typescript
const MAX_TOTAL_UPLOAD = 2 * 1024 * 1024 * 1024; // 2 GB
if (totalSize > MAX_TOTAL_UPLOAD) {
    return { error: 'Total upload size exceeds 2GB limit' };
}
```

---

## Low Issues

### L-1. `getAdminTags()` returns empty array instead of error on auth failure

**Severity:** LOW
**Category:** A01 Broken Access Control
**Location:** `/Users/hletrd/flash-shared/gallery/apps/web/src/app/actions/tags.ts:13`
**Issue:** `getAdminTags()` returns `[]` when `isAdmin()` is false, while all other admin actions return `{ error: 'Unauthorized' }`. This inconsistency makes it harder for callers to distinguish "no tags exist" from "user is not authenticated". The current behavior leaks no data, but the inconsistency may lead to incorrect error handling.

**Remediation:**
Match the pattern used by other actions:
```typescript
if (!(await isAdmin())) return { error: 'Unauthorized', tags: [] };
```

### L-2. `audit_log.metadata` column is unstructured TEXT with no size constraint

**Severity:** LOW
**Category:** A09 Logging & Monitoring Failures
**Location:** `/Users/hletrd/flash-shared/gallery/apps/web/src/db/schema.ts:118`
**Issue:** The `metadata` column is `text("metadata")` with no application-level size validation. Since the `auditLog` table is defined but no code currently inserts into it, this is a forward-looking concern: when audit logging is implemented, a bug or malicious admin could insert unbounded metadata strings. Additionally, metadata stored as unstructured TEXT makes structured querying difficult.

**Remediation:**
When implementing audit log writes, validate and cap the metadata field:
```typescript
const safeMetadata = metadata ? JSON.stringify(metadata).slice(0, 4096) : null;
```

### L-3. CSP allows `'unsafe-inline'` for both script-src and style-src

**Severity:** LOW
**Category:** A05 Security Misconfiguration (XSS mitigation weakened)
**Location:** `/Users/hletrd/flash-shared/gallery/apps/web/next.config.ts:20`
**Issue:**
```
script-src 'self' 'unsafe-inline' https://www.googletagmanager.com;
style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;
```

`'unsafe-inline'` in `script-src` largely negates CSP's XSS protection because any injected `<script>` tag or inline event handler will execute. Next.js requires `'unsafe-inline'` for its own inline scripts in development, and some production hydration patterns may also require it. However, this should be tightened where possible.

**Remediation:**
For production, replace `'unsafe-inline'` in `script-src` with a nonce-based approach if Next.js supports it, or at minimum add `'strict-dynamic'`:
```
script-src 'self' 'strict-dynamic' 'unsafe-inline' https://www.googletagmanager.com;
```
The `'strict-dynamic'` directive causes browsers that support it to ignore `'unsafe-inline'` and instead trust only scripts loaded by already-trusted scripts.

`'unsafe-inline'` in `style-src` is lower risk (CSS injection is less dangerous than JS injection) and is commonly required by CSS-in-JS frameworks and Tailwind.

### L-4. `dangerouslySetInnerHTML` used for JSON-LD -- safe but needs ongoing vigilance

**Severity:** LOW
**Category:** A03 Injection (XSS surface)
**Location:** Multiple pages:
- `/Users/hletrd/flash-shared/gallery/apps/web/src/app/[locale]/page.tsx:100-108`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/app/[locale]/p/[id]/page.tsx:181-188`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/app/[locale]/[topic]/page.tsx:119-120`

**Issue:**
All uses follow the safe pattern:
```typescript
dangerouslySetInnerHTML={{
    __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c')
}}
```

`JSON.stringify` + `</` escaping is the standard safe approach for JSON-LD. The data sources are database fields (image titles, descriptions, tag names) which could contain user-controlled content. The current escaping is correct and prevents `</script>` injection.

**Risk:** If a future developer changes the pattern (e.g., removes the `.replace()` call or concatenates strings instead of using `JSON.stringify`), XSS becomes possible.

**Remediation:**
Add a comment and consider extracting a helper:
```typescript
/** Safely serialize structured data for JSON-LD script injection. */
function safeJsonLd(data: unknown): string {
    return JSON.stringify(data).replace(/</g, '\\u003c');
}
```

### L-5. Shared group view count increment is fire-and-forget with swallowed errors

**Severity:** LOW
**Category:** A09 Logging & Monitoring Failures
**Location:** `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/data.ts:371`
**Issue:**
```typescript
db.update(sharedGroups).set({ view_count: sql`${sharedGroups.view_count} + 1` })
    .where(eq(sharedGroups.id, group.id)).catch(() => {});
```
The `.catch(() => {})` silently swallows all errors, including connection failures that might indicate a database outage. While fire-and-forget is acceptable for a non-critical counter, swallowing errors entirely masks operational issues.

**Remediation:**
Log at debug/warn level instead of silently swallowing:
```typescript
.catch((err) => { console.debug('view_count increment failed:', err.message); });
```

---

## Informational

### I-1. Histogram Web Worker in public/ is safe

**Category:** Assessment
**Location:** `/Users/hletrd/flash-shared/gallery/apps/web/public/histogram-worker.js`
**Finding:** The worker is a pure compute kernel: receives `ImageData` pixels via `postMessage`, computes RGB+luminance histograms in a tight loop, and posts results back. No `importScripts()`, no `fetch()`, no DOM access, no eval. The `self.onmessage` handler only reads `e.data.{imageData, width, height}`. **No security risk.**

### I-2. `rate_limit_buckets` INSERT ON DUPLICATE KEY is injection-safe

**Category:** Assessment
**Location:** `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/rate-limit.ts:132-139`
**Finding:**
```typescript
await db.insert(rateLimitBuckets).values({
    ip,              // validated by normalizeIp() + isIP()
    bucketType: type, // hardcoded string literals at call sites
    bucketStart: start, // computed integer
    count: 1,
}).onDuplicateKeyUpdate({
    set: { count: sql`${rateLimitBuckets.count} + 1` },
});
```
All values pass through Drizzle ORM parameterisation. The `sql` template tag in `onDuplicateKeyUpdate` references a column object (`rateLimitBuckets.count`), not user input. The `ip` parameter is validated through `normalizeIp()` which calls `isIP()` from Node.js `net` module -- only valid IP strings pass. **No SQL injection risk.**

### I-3. `audit_log` schema does not leak information

**Category:** Assessment
**Location:** `/Users/hletrd/flash-shared/gallery/apps/web/src/db/schema.ts:111-123`
**Finding:** The schema stores: `userId` (FK to admin_users), `action` (varchar 64), `targetType` (varchar 64), `targetId` (varchar 128), `ip` (varchar 45 for IPv6), `metadata` (TEXT), `created_at`. No code currently writes to this table -- it is a forward schema. The IP field stores admin IPs (not end-user IPs), which is standard for admin audit trails. The `metadata` TEXT field should be capped when writes are implemented (see L-2). **No information leakage by design.**

### I-4. Dependency audit: 4 moderate vulnerabilities, all in dev-only transitive chain

**Category:** A06 Vulnerable Components
**Finding:** `npm audit` reports 4 moderate-severity vulnerabilities, all tracing to `esbuild <= 0.24.2` via `drizzle-kit` (a dev/build tool). The vulnerability (GHSA-67mh-4wv8-2f99) allows websites to read responses from the esbuild dev server -- this is a development-time concern only, not exploitable in production. The fix requires a breaking `drizzle-kit` upgrade. **No production risk.**

---

## OWASP Top 10 Evaluation

| Category | Status | Notes |
|----------|--------|-------|
| A01: Broken Access Control | PASS | Every server action checks `isAdmin()`. Middleware guards admin routes. Admin layout double-checks auth. GPS/PII excluded from public queries. |
| A02: Cryptographic Failures | PASS | Argon2id for passwords. HMAC-SHA256 session tokens with `timingSafeEqual`. SHA-256 token hashing for DB storage. `crypto.randomBytes` for session data. SESSION_SECRET enforced in production (throws if missing). TLS auto-enabled for non-localhost DB. |
| A03: Injection | PASS | All queries via Drizzle ORM (parameterised). LIKE wildcards escaped. No raw SQL with user input. `dangerouslySetInnerHTML` uses safe `JSON.stringify` + `<` escaping. CSV export escapes formula injection. |
| A04: Insecure Design | PASS | Timing-safe login (dummy hash for non-existent users). Race condition protections (conditional UPDATE, INSERT IGNORE, transactions). Delete-while-processing handled. TOCTOU prevented via catch-ER_DUP_ENTRY pattern. |
| A05: Security Misconfiguration | PARTIAL | Security headers set (CSP, HSTS, X-Frame-Options, nosniff, Permissions-Policy, Referrer-Policy). `poweredByHeader: false`. But bodySizeLimit is 50x too high (H-1), CSP uses unsafe-inline (L-3). |
| A06: Vulnerable Components | PASS | 4 moderate vulns all in dev-only chain (esbuild via drizzle-kit). No production-affecting CVEs. |
| A07: Authentication Failures | PARTIAL | Argon2id, 12-char minimum, session invalidation on password change, last-admin deletion prevention. But login rate limit is in-memory only (M-2), not using the new persistent infrastructure. |
| A08: Software & Data Integrity | PASS | DB restore validates file headers and scans for dangerous SQL patterns. `--one-database` flag. Process-level mutex prevents concurrent restores. Upload filenames are UUIDs. |
| A09: Logging & Monitoring | PARTIAL | Health endpoint exists. Session purge runs hourly. audit_log schema defined but no code writes to it yet. View count errors silently swallowed (L-5). |
| A10: SSRF | PASS | No outbound HTTP requests based on user input. No URL fetching. Image processing is local-only. OG image generation is server-rendered with validated/truncated params. |

---

## Security Checklist

- [x] No hardcoded secrets in source code (`.env.local` is gitignored and not tracked)
- [x] All user inputs validated (slugs, filenames, IDs, tag names, search queries)
- [x] SQL injection prevention verified (all queries via Drizzle ORM, LIKE wildcards escaped)
- [x] Authentication verified (Argon2id, HMAC-SHA256 sessions, timing-safe comparison)
- [x] Authorization verified (every server action checks `isAdmin()`, middleware guards routes)
- [x] File upload security verified (UUID filenames, extension whitelist, symlink rejection, path traversal prevention, decompression bomb limits)
- [x] Dependencies audited (no production-affecting CVEs)
- [x] Security headers configured (CSP, HSTS, X-Frame-Options, nosniff, Permissions-Policy)
- [x] GPS/PII excluded from public API responses
- [x] Session secret enforced in production (throws error if missing/short)
- [x] DB backup/restore security hardened (dangerous SQL pattern scanning, --one-database, non-public storage, authenticated download)
- [ ] Login rate limiting should use persistent DB backend (M-2)
- [ ] `purgeOldBuckets()` should be wired into GC interval (M-1)
- [ ] `bodySizeLimit` should be lowered to match actual needs (H-1)

---

## New R4 Features -- Security Assessment

### MySQL-backed persistent rate limiting
- **Verdict: SAFE.** Drizzle ORM parameterises all values. `normalizeIp()` validates with `isIP()`. `onDuplicateKeyUpdate` references column objects. No injection path. One gap: `purgeOldBuckets()` is not called (M-1).

### Vitest test suite
- **Verdict: POSITIVE.** Tests cover `normalizeIp` (IP validation edge cases), `isValidSlug`, `isValidFilename` (path traversal), `isBase56` (share key validation), `hashSessionToken` (determinism), `generateSessionToken` (format). All security-critical validation helpers now have regression tests.

### Histogram Web Worker
- **Verdict: SAFE.** Pure computation, no I/O, no imports, no eval. Receives typed array, returns histogram arrays. Cannot be exploited.

### Shared link expiry/view counting
- **Verdict: SAFE.** Expiry check is server-side (`new Date(group.expires_at) < new Date()`). View count uses Drizzle column reference (`sql\`${sharedGroups.view_count} + 1\``), not string interpolation. Fire-and-forget pattern is acceptable for a counter.

### `audit_log` schema
- **Verdict: SAFE.** Forward schema only -- no code writes to it. IP storage (varchar 45) is standard. Metadata TEXT field should be capped when writes are implemented (L-2).

### Disk space pre-check
- **Verdict: SAFE.** Uses `statfs` to check for 1 GB free before accepting uploads. Gracefully degrades on platforms where `statfs` is unavailable.

### Queue retry limit
- **Verdict: SAFE.** `MAX_RETRIES = 3` prevents infinite retry loops (was an R3 finding). Retry state stored on globalThis keyed by image ID.

---

## Remediation Priority

1. **H-1** (bodySizeLimit 10 GB): Lower to 250 MB -- **within 1 week**
2. **M-1** (purgeOldBuckets not called): Wire into GC interval -- **within 2 weeks**
3. **M-2** (in-memory login rate limit): Migrate to persistent backend -- **within 2 weeks**
4. **M-3** (total upload size 10 GB): Lower to 2 GB -- **within 2 weeks** (can be fixed together with H-1)
5. **L-1 through L-5**: Backlog items, fix when convenient

---

## Comparison with R3

| R3 Finding | R4 Status | Notes |
|------------|-----------|-------|
| H-1: Queue retry infinite loop | **FIXED** | MAX_RETRIES=3 in image-queue.ts |
| H-2: In-memory rate limit reset on restart | **PARTIALLY FIXED** | Infrastructure added (rate_limit_buckets) but login() not migrated (M-2) |
| M-1: bodySizeLimit mismatch | **PERSISTS** | Still 10gb, now H-1 |
| M-2: CSP unsafe-inline | **PERSISTS** | Now L-3 (lower priority given Next.js constraints) |
| M-3: No session secret enforcement in prod | **FIXED** | session.ts throws in production if SESSION_SECRET missing |
| M-4: LIKE wildcard not escaped | **FIXED** | data.ts:429 escapes %, _, \ |
| M-5: No decompression bomb limit | **FIXED** | limitInputPixels configured |
| New: purgeOldBuckets not wired | **NEW** | M-1 |
| New: upload totalSize 10GB | **NEW** | M-3 |

---

*Review conducted against commit `e05565a` (HEAD of master). All source files in `apps/web/src/` read. npm audit executed. No secrets found in git history or tracked files.*
