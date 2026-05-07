# Security Review — Cycle 7 (RPL loop, 2026-04-23)

**Reviewer role:** security-reviewer (OWASP top 10, secrets, unsafe
patterns, auth/authz)
**Scope:** auth, server actions, admin routes, lint gates, rate
limiting, privacy fields, restore scanner.

## Findings

### S7-01 — `escapeCsvField` strips C0/C1 control chars but still
preserves the Unicode BIDI override characters (U+202E etc.)

**File:** `apps/web/src/lib/csv-escape.ts:16`

```ts
value = value.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
```

The range covers ASCII control chars only. Unicode bidi-override
characters like U+202E (RLO), U+2066 (LRI), U+2069 (PDI) are NOT
stripped. These can reorder rendered text in spreadsheet apps (Trojan
Source-style CSV injection). A malicious admin uploading a user_filename
containing U+202E could cause the displayed CSV row to visually show
the filename in reversed order, potentially disguising a malicious
extension (`gpj.exe` rendered as `exe.jpg`).

Exposure is low in practice because `user_filename` is admin-set (only
authenticated admins upload files, and the file-name basename already
strips many chars in `path.basename`). But as defense-in-depth, the
CSV export would benefit from also stripping bidi overrides.

**Severity:** LOW
**Confidence:** MEDIUM
**Recommendation:** extend the strip pattern to include
`[‪-‮⁦-⁩]` (bidi formatting + isolates).

### S7-02 — `searchImagesAction` rollback deletes the in-memory bucket
entry wholesale when `count <= 1` but leaves the DB counter at 1

**File:** `apps/web/src/app/actions/public.ts:81-89`

```ts
const currentEntry = searchRateLimit.get(ip);
if (currentEntry && currentEntry.count > 1) {
    currentEntry.count--;
} else {
    searchRateLimit.delete(ip);
}
await decrementRateLimit(ip, 'search', SEARCH_WINDOW_MS).catch(...)
```

When the in-memory counter was at 1 (fresh request), rollback deletes
it outright while the DB counter is `GREATEST(count - 1, 0)` — which
decrements correctly and cleans up via the follow-up DELETE at
rate-limit.ts:258-265. So the two paths are consistent.  Cross-request
observation: an immediately-following search request from the same IP
would re-establish the in-memory entry (count=1). No residual drift.

**Severity:** LOW (no actionable issue, confirmation)
**Confidence:** HIGH
**Recommendation:** none — rollback is symmetric.

### S7-03 — `runRestore` uses `readStream.pipe(restore.stdin)` AFTER
registering error handlers, but the `restore.stdin.on('error')` filter
could swallow legitimate EPIPE-like errors during very early crashes

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:399-405`

```ts
restore.stdin.on('error', async (err: NodeJS.ErrnoException) => {
    if (isIgnorableRestoreStdinError(err)) {
        return;
    }
    await failRestore(t('restoreFailed'), 'mysql restore stdin error:', err);
});
```

If `mysql` crashes immediately after spawn (before accepting any bytes)
stdin may emit EPIPE. `isIgnorableRestoreStdinError` filters these, which
is the correct behavior because `restore.on('close')` will report the
non-zero exit code. Good defensive pattern.

**Severity:** INFORMATIONAL
**Confidence:** HIGH
**Recommendation:** none.

### S7-04 — Restore path validates file header regex but does NOT
require a mysqldump-specific signature

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:328-332`

```ts
const validHeader = /^(--)|(CREATE\s)|(INSERT\s)|(DROP\s)|(SET\s)|(\/\*!)/.test(headerBytes.trimStart());
```

Any file that begins with a SQL comment, CREATE, INSERT, DROP, SET, or
MySQL conditional block passes. A hand-crafted SQL file (not from
mysqldump) that still passes `containsDangerousSql` scanning would be
accepted. This is by design (admins may restore dumps from any MySQL
tool) but could be tightened to require the mysqldump "Server version"
comment in the first 256 bytes for stricter provenance.

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** document the intent; strict mysqldump-only matching
would break legitimate third-party dumps.

### S7-05 — `SESSION_SECRET` is required in production; dev/test fall
back to DB-stored generated value

**File:** `apps/web/src/lib/session.ts` (by CLAUDE.md reference);
verified prior-cycle audit.

Design is sound. No finding this cycle.

**Severity:** INFORMATIONAL
**Confidence:** HIGH

### S7-06 — `check-api-auth.ts` and `check-action-origin.ts` lint gates
enforce authorization at the gate level but the authorization in the
action body still runs after `isAdmin()` returns, even on origin-fail
paths

**File:** `apps/web/src/app/actions/sharing.ts:92-99` and similar

```ts
if (!(await isAdmin())) return { error: t('unauthorized') };
// C2R-02: defense-in-depth same-origin check for mutating server actions.
const originError = await requireSameOriginAdmin();
if (originError) return { error: originError };
```

Both `isAdmin()` and `requireSameOriginAdmin()` are async; an attacker
without a valid session hits `isAdmin() → false` first and never reaches
the origin check. Good. But a legitimate admin from a wrong origin
gets the localized `unauthorized` message — same message as session
failure, which is correct for privacy (no info leak about session vs
origin state).

**Severity:** INFORMATIONAL
**Confidence:** HIGH
**Recommendation:** none.

### S7-07 — `getClientIp` trusts `x-real-ip` WITHOUT checking its
network-source provenance; relies solely on `TRUST_PROXY=true`

**File:** `apps/web/src/lib/rate-limit.ts:77-79`

```ts
const xRealIp = normalizeIp(headerStore.get('x-real-ip'));
if (xRealIp) return xRealIp;
```

If `TRUST_PROXY=true` but the reverse proxy layer fails to strip
incoming `X-Real-IP` from clients (e.g., misconfigured nginx), a
client-supplied `X-Real-IP` would be trusted. The README already
documents nginx config that uses `proxy_add_x_forwarded_for` but doesn't
prescribe `proxy_set_header X-Real-IP $remote_addr` with `$request`
hardening.

**Severity:** LOW (config-dependent; documented)
**Confidence:** MEDIUM
**Recommendation:** add a deploy-guide note that nginx must
`proxy_set_header X-Real-IP $remote_addr;` (overwrite, not append)
for TRUST_PROXY to be safe.

### S7-08 — `buildAccountRateLimitKey` hashes lowercased-trimmed
username. Collision between two usernames differing only in
normalization-invisible whitespace (e.g. U+00A0 no-break space vs regular
space) is resolved by `.trim().toLowerCase()` followed by SHA-256 —
acceptable.

**File:** `apps/web/src/lib/rate-limit.ts:55-59`

**Severity:** INFORMATIONAL
**Confidence:** HIGH

### S7-09 — `scanFd.read` in restore path does not check bytesRead;
same issue as cycle-6-rpl D6-07

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:339-351`

`Buffer.alloc(readSize)` zeroes the buffer, so a short read leaves
trailing zero bytes rather than uninitialized data. `toString('utf8')`
on trailing `\0` adds U+0000 chars to `chunk`, which the
dangerous-SQL regexes treat as word-boundary noise. The pattern match
is still correct. Low exposure; no exploit path.

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** slice `chunkBuf.subarray(0, bytesRead).toString('utf8')`
for defense-in-depth and to handle non-zeroed buffer pools if that
behavior changes in a future Node version.

### S7-10 — Session cookie `maxAge` is 24 hours but absolute expiry is
also stored server-side; sessions do NOT rotate on sensitive actions
like password change

**File:** `apps/web/src/app/actions/auth.ts:181-202, 351-364`

Login creates a new session and deletes all others. `updatePassword`
deletes sessions EXCEPT the current one. This means the current
session's cookie (with same value) persists after password change —
which is intentional (admin isn't logged out of their own session) but
reduces forward secrecy: if the session cookie was previously leaked,
changing the password won't invalidate the attacker's access to the
current session.

**Severity:** LOW (tradeoff; by design)
**Confidence:** HIGH
**Recommendation:** optionally rotate the current session token on
password change — issue a new cookie, keep the user logged in.

## Summary

10 findings. All LOW or INFORMATIONAL. Authentication and authorization
surface is stable and defense-in-depth. S7-01 (bidi override CSV
injection) and S7-07 (X-Real-IP hardening doc) are the most
actionable.
