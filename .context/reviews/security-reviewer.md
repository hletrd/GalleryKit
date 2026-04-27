# Security Reviewer — Cycle 1 Fresh Review (2026-04-27)

## Inventory

Full security review of the GalleryKit codebase. Files examined:
- `proxy.ts` — middleware auth guard, CSP
- `lib/session.ts` — token generation, HMAC verification, timing-safe comparison
- `lib/validation.ts` — input validation, Unicode formatting rejection
- `lib/rate-limit.ts` — IP normalization, DB-backed rate limiting
- `lib/auth-rate-limit.ts` — login/password rate limiting
- `lib/blur-data-url.ts` — blur data URL contract enforcement
- `lib/serve-upload.ts` — path traversal prevention, symlink rejection
- `lib/content-security-policy.ts` — CSP generation
- `lib/csv-escape.ts` — CSV formula injection prevention
- `lib/request-origin.ts` — same-origin CSRF protection
- `lib/action-guards.ts` — server action origin checks
- `lib/api-auth.ts` — API route auth wrapper
- `lib/upload-paths.ts` — path construction, directory whitelisting
- `lib/upload-limits.ts` — upload size/file count limits
- `lib/sanitize.ts` — control character stripping
- `lib/sql-restore-scan.ts` — SQL dump validation
- `app/actions/auth.ts` — login flow, Argon2, session management
- `app/actions/images.ts` — upload, delete, metadata update
- `app/actions/public.ts` — public search/load-more
- `app/api/admin/db/download/route.ts` — backup file download
- `db/schema.ts` — database schema, indexes

---

## Findings

### C1-SR-01: CSP `style-src` includes `'unsafe-inline'` in production
**File:** `apps/web/src/lib/content-security-policy.ts:64`
**Severity:** Medium | **Confidence:** High

```ts
"style-src 'self' 'unsafe-inline'",
```

The production CSP allows `'unsafe-inline'` in `style-src`. This is a common compromise because Tailwind CSS generates inline styles and many UI libraries inject inline styles. However, `'unsafe-inline'` in `style-src` weakens CSP by allowing attackers who find an XSS vulnerability to apply arbitrary styles, which can be used for data exfiltration (CSS-based exfiltration via `background-image` URLs or `font-face` src), clickjacking, and UI redressing.

**Fix:** This is a known trade-off with Tailwind CSS / Radix UI. To fully remove `'unsafe-inline'`, the project would need to migrate to CSS modules or use nonce-based style injection. For now, document this as an accepted risk. The `style-src` restriction is less critical than `script-src` which correctly uses nonces.

---

### C1-SR-02: Backup download route reveals file existence via timing
**File:** `apps/web/src/app/api/admin/db/download/route.ts:60-66`
**Severity:** Low | **Confidence:** Medium

```ts
const stats = await lstat(filePath);
if (stats.isSymbolicLink() || !stats.isFile()) {
    return new NextResponse('Access denied', { status: 403 });
}
```

The backup download route checks for symlinks after `lstat`. If a symlink exists that resolves to a file outside the backups directory, the route returns 403 ("Access denied") rather than 404. This reveals that the symlink exists on the filesystem. However, this route is behind `withAdminAuth` and same-origin checks, so the information disclosure is limited to authenticated admins.

**Fix:** Return 404 for both non-existent and access-denied cases to avoid information leakage. Low priority since the route is admin-only.

---

### C1-SR-03: `loadMoreRateLimit` in `public.ts` is in-memory only — resets on restart
**File:** `apps/web/src/app/actions/public.ts:38-65`
**Severity:** Low | **Confidence:** High

The `loadMoreRateLimit` Map is in-memory only, unlike `searchRateLimit` which has both in-memory and DB-backed persistence. On a server restart, all load-more rate limit state is lost, allowing a burst of requests immediately after restart. However, load-more is a low-risk public read path, and the in-memory limiter is intentionally kept lightweight per the comment at line 96. The 120 requests/minute limit is generous enough that the restart window is negligible.

**Status:** Not a real vulnerability — the design choice is intentional and documented.

---

### C1-SR-04: Session token contains timestamp in cleartext
**File:** `apps/web/src/lib/session.ts:82-89`
**Severity:** Low | **Confidence:** Low (informational)

```ts
const timestamp = Date.now().toString();
const random = randomBytes(16).toString('hex');
const data = `${timestamp}:${random}`;
const signature = createHmac('sha256', secret).update(data).digest('hex');
return `${data}:${signature}`;
```

The session token format is `timestamp:random:signature`. The timestamp is in cleartext, which reveals the approximate login time to anyone who can read the cookie (e.g., via XSS). This is a minor information leak. The timestamp is also used for server-side expiry checks. This is a common pattern and the leak is negligible since cookie access requires XSS, which is a more severe vulnerability.

**Status:** Not a real vulnerability — informational only. The timestamp is needed for server-side expiry and the HMAC signature prevents tampering.

---

### C1-SR-05: `getClientIp` returns "unknown" when `TRUST_PROXY` is not set
**File:** `apps/web/src/lib/rate-limit.ts:105-111`
**Severity:** Medium | **Confidence:** High

```ts
const ip = 'unknown';
```

When `TRUST_PROXY` is not set (and the app is behind a reverse proxy), all requests are rate-limited under the shared IP key `"unknown"`. This means a single abuser can exhaust the rate limit for ALL users behind the proxy. The warning log at line 108 helps, but if missed, all users share a single rate-limit bucket. The Docker Compose deployment documentation recommends `TRUST_PROXY=true`, but the default is `false`.

**Fix:** Consider defaulting to `TRUST_PROXY=true` when `NODE_ENV=production` and proxy headers are detected, or at minimum, add a startup-time warning (not just per-request) when production mode is detected without `TRUST_PROXY`. The current per-request warning is rate-limited to once per process, which is good, but it only fires when proxy headers are actually present.

---

### C1-SR-06: `UNICODE_FORMAT_CHARS` regex may miss some Unicode bidi characters
**File:** `apps/web/src/lib/validation.ts:35`
**Severity:** Low | **Confidence:** Low

The regex `/[᠎​-‏‪-‮⁠⁦-⁩﻿￹-￻]/` uses literal Unicode characters. While this covers the documented ranges (U+202A-202E, U+2066-2069, U+200B-200F, U+2060, U+FEFF, U+180E, U+FFF9-FFFB), the regex uses compact range notation that may be fragile under different editor encodings. The regex itself is correct and matches the CLAUDE.md specification. No actual gap found.

**Status:** Not a real issue — the regex covers all specified ranges correctly. The compact notation is well-documented.

---

### C1-SR-07: No CSRF token for server actions — reliance on same-origin check
**File:** `apps/web/src/lib/action-guards.ts` and `app/actions/*.ts`
**Severity:** Low | **Confidence:** High (by design)

All mutating server actions use `requireSameOriginAdmin()` which checks the `Origin`/`Referer` headers. This is a standard CSRF protection pattern for Next.js server actions. However, the `SameSite: lax` cookie policy does not protect against same-site subdomains or post-login redirect attacks. The `SameSite: lax` + origin check combination is the standard pattern for Next.js and is sufficient for this application's threat model.

**Status:** By design — the same-origin check + lax cookie is the recommended Next.js CSRF mitigation.

---

## Positive Findings (Security Controls Verified)

1. **Argon2id** for password hashing — industry standard
2. **HMAC-SHA256** with `timingSafeEqual` for session token verification — prevents timing attacks
3. **Path traversal prevention** in `serve-upload.ts` — `SAFE_SEGMENT` regex + `ALLOWED_UPLOAD_DIRS` + `realpath` containment
4. **Symlink rejection** — both upload routes use `lstat()` + `isSymbolicLink()` check
5. **UUID filenames** — no user-controlled filenames on disk
6. **Privacy guard** — compile-time type guard prevents PII fields from leaking to `publicSelectFields`
7. **Blur data URL contract** — three-point validation (producer, write, read) prevents CSS injection
8. **Unicode bidi/formatting rejection** — prevents Trojan-Source-style spoofing
9. **CSV escape** — formula injection prevention with C0/C1 control character stripping
10. **Rate limiting** — pre-increment-then-check pattern prevents TOCTOU bursts
11. **Advisory locks** — MySQL locks for DB restore, upload processing contract, and per-image processing claims
12. **Decompression bomb mitigation** — Sharp `limitInputPixels` configured
13. **Directory whitelist** — only jpeg/webp/avif served publicly; original excluded
