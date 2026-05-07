# Security Review — Cycle 38 (2026-04-19)

## Reviewer: security-reviewer
## Scope: OWASP Top 10, secrets, unsafe patterns, auth/authz

### Findings

**Finding SEC-38-01: GPS coordinates leaked to admin-authorized PhotoViewer**
- **File**: `apps/web/src/components/photo-viewer.tsx` lines 470-483
- **Severity**: MEDIUM | **Confidence**: HIGH
- **Description**: The PhotoViewer conditionally shows GPS coordinates with a `(canShare && image.latitude != null && image.longitude != null)` check. The `canShare` prop is set based on `isAdmin()` result. However, the `selectFields` in `data.ts` intentionally excludes `latitude` and `longitude` from public queries, and the `getImage()` function does NOT return these fields. The only way `image.latitude` could be non-null in the PhotoViewer is if the data was fetched from an admin-only query path that includes those fields. Reviewing the photo page (`/p/[id]/page.tsx`), the data comes from `getImageCached()` which uses `selectFields` (excludes GPS). Therefore `image.latitude` will ALWAYS be null/undefined in the PhotoViewer, making the GPS display code dead code. However, this dead code creates a false sense of security — if someone modifies `selectFields` to include GPS, the PhotoViewer would immediately expose it. The compile-time privacy guard in `data.ts` prevents this, but the dead code in photo-viewer.tsx should still be noted.
- **Fix**: Either remove the dead GPS display code from the public PhotoViewer, or add a comment explaining that it's intentionally unreachable via public queries. If GPS should be shown to admins, ensure the admin-only data path explicitly includes these fields.

**Finding SEC-38-02: Session token timestamp is not validated against DB session expiry**
- **File**: `apps/web/src/lib/session.ts` lines 94-145
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: `verifySessionToken` checks token age via the embedded timestamp (max 24h), then queries the DB for the session record and checks `session.expiresAt < new Date()`. These are two independent expiry checks. The token timestamp check uses client-provided data (though HMAC-verified, the timestamp was set at token creation time). The DB check is authoritative. If the session expiry is shortened (e.g., admin changes password and sessions are invalidated), the DB check would catch it even if the token timestamp hasn't expired. This is correct behavior — the dual check is actually a defense-in-depth pattern. No fix needed, but documenting this would help future reviewers.

**Finding SEC-38-03: `restoreDatabase` SQL scan can be bypassed with multi-byte encoding**
- **File**: `apps/web/src/lib/sql-restore-scan.ts` + `apps/web/src/app/[locale]/admin/db-actions.ts` lines 275-293
- **Severity**: LOW | **Confidence**: LOW
- **Description**: The SQL restore scanner reads chunks as UTF-8 and applies regex patterns. If an attacker crafts a SQL dump where dangerous keywords are split across multi-byte character boundaries, the regex might not match. For example, a UTF-8 BOM or specific encoding tricks could cause `GRANT` to be split across chunk boundaries in a way that the overlap handling doesn't catch. The `OVERLAP = 256` bytes should be sufficient for most cases since multi-byte sequences are at most 4 bytes. The risk is very low because: (1) this is an admin-only action, (2) the file header is validated, (3) the regex patterns are comprehensive. However, using a binary-safe scanner would be more robust.
- **Fix**: Consider scanning the raw bytes instead of decoding to UTF-8, or increase overlap to 1024 bytes.

**Finding SEC-38-04: Rate limit Maps are vulnerable to IP hash collision DoS**
- **File**: `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`
- **Severity**: LOW | **Confidence**: LOW
- **Description**: The in-memory rate limit Maps use IP addresses as keys. An attacker controlling many IPs (botnet) could fill the Maps to their hard cap (5000 for login, 2000 for search), causing legitimate users to be evicted. The hard caps and LRU-style eviction mitigate this, but the eviction is by insertion order, not by least-recently-used, so active legitimate users can be evicted. This is a known deferred item.
- **Fix**: Use LRU eviction based on `lastAttempt` timestamp.

**Finding SEC-38-05: `health` API route may leak DB connectivity info**
- **File**: `apps/web/src/app/api/health/route.ts`
- **Severity**: LOW | **Confidence**: MEDIUM
- **Description**: This is a known deferred item (C32-04/C30-08). The health endpoint may disclose whether the DB is reachable. In production, this could help an attacker determine if the DB is down for a potential attack window.
- **Fix**: Restrict health endpoint to internal networks or require authentication.

### Deferred Items (no change from prior cycles)
- C32-03: Insertion-order eviction in Maps
- C32-04/C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03/C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04/C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency

### Review Coverage
All auth flows, session management, middleware guards, rate limiting, upload security, file serving, DB backup/restore, SQL injection prevention, API route auth, cookie security, CSRF protection, privacy guards.
