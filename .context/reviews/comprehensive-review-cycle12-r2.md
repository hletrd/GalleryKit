# Comprehensive Review — Cycle 12 Round 2 (2026-04-19)

**Reviewer:** Multi-angle comprehensive review (code quality, security, performance, architecture, UI/UX, testing)

---

## Findings

### C12R2-01: Hardcoded image sizes in client components diverge from admin-configured sizes [MEDIUM] [HIGH confidence]

**Files:**
- `apps/web/src/components/photo-viewer.tsx:186,191` — hardcoded `[640, 1536, 2048, 4096]`
- `apps/web/src/components/lightbox.tsx:149,155` — hardcoded `[640, 1536, 2048, 4096]`
- `apps/web/src/components/home-client.tsx:252,257` — hardcoded `_640` and `_1536` sizes
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:30,56,142` — hardcoded `_1536.jpg`/`_1536.webp`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:28,53` — hardcoded `_1536.jpg`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:62` — hardcoded `_1536.jpg`
- `apps/web/src/app/[locale]/(public)/page.tsx:41` — hardcoded `_1536.jpg`

**Problem:** The server-side image processing pipeline now uses admin-configurable sizes (`getGalleryConfig().imageSizes`) to generate variants, but all client components still reference the default `[640, 1536, 2048, 4096]` sizes hardcoded. If an admin changes the `image_sizes` setting (e.g., removing 1536, adding different breakpoints), the client components will request non-existent image files (`_1536.webp` etc.), resulting in 404s for every image on the site. The OG metadata on public pages also references `_1536.jpg` which would break.

**Concrete failure scenario:** Admin changes image_sizes from "640,1536,2048,4096" to "800,1200,2000" in settings. All newly uploaded images only have `_800`, `_1200`, `_2000` variants. But the entire frontend still requests `_640`, `_1536`, `_2048`, `_4096` variants — every image shows a broken state.

**Fix:** Pass the configured `imageSizes` array from the server to client components (via page props or a client-safe shared config). In client components, use the configured sizes to build srcSet strings dynamically. For OG metadata on server pages, read from `getGalleryConfig()` instead of hardcoding `_1536`.

---

### C12R2-02: Shared group page does not validate `photoId` query param belongs to the group [LOW] [MEDIUM confidence]

**File:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:75-90`

**Problem:** When a `photoId` query parameter is provided, the code does `group.images.findIndex(img => img.id === photoId)`. If the `photoId` belongs to an image not in the group, `findIndex` returns -1, `selectedImage` stays `null`, and the page falls through to the gallery grid view — which is the correct fallback. However, if the `photoId` is a valid image ID that exists in the database but is NOT in this group AND is NOT processed, the image is simply not found — no information leakage. The current behavior is safe but worth noting as a defense-in-depth observation.

**Assessment:** Not a bug — the fallback behavior is correct and safe. No fix needed.

---

### C12R2-03: `dumpDatabase` stderr logging may leak DB credentials in production logs [LOW] [MEDIUM confidence]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:142`

**Problem:** `dump.stderr.on('data', (data: Buffer) => { console.error(\`mysqldump stderr: \${data}\`); })` logs all stderr output from mysqldump. In some MySQL error scenarios, stderr may include connection strings or credential-related error messages. While the admin is authenticated, server logs may be accessible to other processes or monitoring systems.

**Concrete failure scenario:** A misconfigured MySQL user causes mysqldump to output "Access denied for user 'gallery'@'10.0.0.5' (using password: YES)" to stderr. This gets logged and may be visible in log aggregation systems.

**Fix:** Sanitize stderr output or only log a truncated/summarized version, not the raw mysqldump stderr. The same issue exists at line 331 for the `mysql` restore command.

---

### C12R2-04: `checkShareRateLimit` has check-then-increment TOCTOU (same pattern as fixed login A-01) [MEDIUM] [HIGH confidence]

**File:** `apps/web/src/app/actions/sharing.ts:40-49`

**Problem:** The `checkShareRateLimit` function checks the in-memory count and increments it in the same call. However, in `createPhotoShareLink` (line 58), the rate limit check happens at the top, but there is no DB-backed rate limit check or pre-increment for the share operations. The in-memory Map is the only rate limit. Between concurrent requests from the same IP, both could read the same count before either increments, allowing burst share creation. This is the same TOCTOU pattern that was fixed for login (A-01) and `createAdminUser` (C11R2-02).

**Concrete failure scenario:** Two concurrent `createPhotoShareLink` requests from the same IP both pass the in-memory check (both see count < 20), both increment, resulting in 22 shares created instead of the 20-per-window limit.

**Fix:** Either use the DB-backed `incrementRateLimit`/`checkRateLimit` pattern (matching login/admin-user-creation), or restructure `checkShareRateLimit` to pre-increment before the check (matching the in-memory pattern used in login).

---

### C12R2-05: `searchRateLimit` in-memory increment happens before DB-backed check, causing premature rate limiting when DB count is lower [LOW] [MEDIUM confidence]

**File:** `apps/web/src/app/actions/public.ts:52-94`

**Problem:** The search rate limit pre-increments the in-memory Map (line 56-59), then checks the DB (line 63). If the DB check shows `limited=true`, it rolls back the in-memory count (line 69-74). However, if the DB `incrementRateLimit` call fails (line 82-94), it also rolls back the in-memory count. This means a transient DB outage causes the in-memory counter to be undercounted relative to actual usage, which is the safe direction (allows more searches, not fewer). This is acceptable behavior but inconsistent with the login pattern where DB failures fall back to the in-memory Map.

**Assessment:** Low risk — the search rate limit is not security-critical (unlike login), and the current behavior is safe (undercounting = more permissive). No fix needed.

---

### C12R2-06: `shareRateLimit` Map has no DB-backed persistence — rate limits reset on server restart [LOW] [LOW confidence]

**File:** `apps/web/src/app/actions/sharing.ts:22`

**Problem:** The share rate limit (`shareRateLimit`) is only stored in an in-memory Map. Unlike login and password change rate limits (which have DB-backed persistence via `rateLimitBuckets`), share creation rate limits are lost on server restart. An attacker could bypass the 20-per-minute share limit by timing requests around server restarts.

**Assessment:** Low risk — share creation requires admin authentication, and the rate limit is a defense-in-depth measure against accidental bulk creation, not a security-critical guard. Admins who want to create many shares can do so legitimately. The TOCTOU issue (C12R2-04) is more impactful.

**Fix:** Optional — add DB-backed rate limiting for share operations if defense-in-depth is desired.

---

## Previously Fixed — Confirmed Resolved

All previously fixed items from cycles 1-11 remain fixed:
- S-01, S-02, S-05, S-06, S-07 (security)
- C-02, C-03, C-08 (code quality)
- R-03, D-01, D-05, D-07 (data/race conditions)
- A-01, A-02, A-04 (auth)
- SEC-39-03, C39-01, C39-02, C39-03 (cycle 39)
- C11R2-01 (dynamic import), C11R2-02 (createAdminUser TOCTOU)

## New Issues This Cycle

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| C12R2-01 | Hardcoded image sizes in client diverge from admin-configured sizes | MEDIUM | HIGH | IMPLEMENT |
| C12R2-02 | Shared group photoId validation (not a bug) | — | — | NOT A BUG |
| C12R2-03 | dumpDatabase stderr may leak credentials in logs | LOW | MEDIUM | DEFER |
| C12R2-04 | checkShareRateLimit TOCTOU — no DB-backed pre-increment | MEDIUM | HIGH | IMPLEMENT |
| C12R2-05 | searchRateLimit DB-failure rollback (safe direction) | — | — | NOT A BUG |
| C12R2-06 | shareRateLimit has no DB persistence | LOW | LOW | DEFER |

**Actionable findings:** 2 MEDIUM (implement), 2 LOW (defer)

---

## Deferred Carry-Forward

All previously deferred items from cycles 5-39 remain deferred with no change in status (see plan README for full list).
