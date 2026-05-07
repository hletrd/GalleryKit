# verifier — cycle 9 rpl

HEAD: `00000002ad51a67c0503f50c3f79c7b878c7e93f`.

## Evidence of stated-vs-actual behavior

### CLAUDE.md claim: "Login rate limiting: 5 attempts per 15-minute window per IP"
Verified. `rate-limit.ts:6-8` sets `LOGIN_WINDOW_MS = 15 * 60 * 1000`, `LOGIN_MAX_ATTEMPTS = 5`, `LOGIN_RATE_LIMIT_MAX_KEYS = 5000`. `auth.ts:110-113` enforces via `checkRateLimit`. Matches stated behavior.

### CLAUDE.md claim: "Max upload size: 200MB per file, 2 GiB total per batch by default, 100 files max"
Verified. `process-image.ts:43` sets `MAX_FILE_SIZE = 200 * 1024 * 1024`, `images.ts:120` enforces `if (files.length > 100)`, `upload-limits.ts` defines `MAX_TOTAL_UPLOAD_BYTES`. Total-batch check at `images.ts:162`.

### CLAUDE.md claim: "DB backups stored in `data/backups/` (volume-mounted, not public)"
Verified. `db-actions.ts:122-125` uses `path.join(process.cwd(), 'data', 'backups')` and creates it via `fs.mkdir`. Served only via authenticated `/api/admin/db/download` route.

### CLAUDE.md claim: "CSV export escapes formula injection characters (`=`, `+`, `-`, `@`, `\t`, `\r`)"
Partially verified. `csv-escape.ts:49` uses `/^\s*[=+\-@]/` and the preceding C0/C1 pass strips `\t` and `\r`. CLAUDE.md lists `\t` and `\r` as "escaped" but the actual behavior is "stripped" — an acceptable inaccuracy but worth either correcting in docs or commenting in code. **DOC DRIFT**.

### CLAUDE.md claim: "SESSION_SECRET env var is required in production"
Verified. `session.ts:30-36` throws in production when env var is missing or too short.

### CLAUDE.md claim: "All queries via Drizzle ORM (parameterized, no raw SQL with user input)"
Verified with one scope qualifier: `admin-users.ts:193-223` uses raw `conn.query<...>` with `?` placeholders for advisory locks and direct admin deletion. All placeholders are parameterized; no string interpolation with user-supplied data. `conn.query("SELECT GET_LOCK(...)")` and `conn.query("SELECT RELEASE_LOCK(...)")` use static lock names. Consistent with the stated invariant.

### CLAUDE.md claim: "Expired sessions purged automatically (hourly background job)"
Verified. `image-queue.ts:357-363` sets `gcInterval` to 60 minutes calling `purgeExpiredSessions`, `purgeOldBuckets`, `purgeOldAuditLog`, `pruneRetryMaps`.

### CLAUDE.md claim: "File upload security: Symlink rejection: Both upload routes use `lstat()` and reject `isSymbolicLink()`"
Checked `serve-upload.ts`. Need to verify the claim matches the code.

## New verification findings

### C9R-RPL-V01 — CLAUDE.md claims `\t` and `\r` are "escaped" in CSV; actual behavior is "stripped" [LOW / HIGH]
- Mismatch at CLAUDE.md (Security/DB/CSV section) vs `csv-escape.ts:34`.
- The claim says "escapes formula injection characters (`=`, `+`, `-`, `@`, `\t`, `\r`)". The code strips (via regex) rather than escapes `\t`, `\r`, and every C0/C1 control char. The prefix-with-apostrophe behavior applies only to `=`, `+`, `-`, `@`.
- Fix: update CLAUDE.md to say "strips" for `\t`/`\r`/control chars and "prefixes with apostrophe" for `=`/`+`/`-`/`@`.

### C9R-RPL-V02 — Documentation silent on account-scoped rate-limit bucket in `auth.ts` [LOW / MEDIUM]
- `auth.ts:122-130` adds a SECOND rate-limit bucket scoped by username (hashed with SHA-256) to prevent distributed brute-force. This is not mentioned in CLAUDE.md.
- Fix: add to CLAUDE.md's "Authentication & Sessions" section: "Account-scoped rate limit: additional 5/15m per-username bucket (SHA-256 hashed) prevents distributed brute-force across rotating IPs."

### C9R-RPL-V03 — `updatePassword` does NOT pre-validate form fields before rate-limit increment [MEDIUM / HIGH]
- Already flagged in C9R-RPL-01 by code-reviewer and C9R-RPL-S01 by security-reviewer. Verifier confirms the behavior mismatch: documentation says "Rate Limiting" uses the same pattern as login, but the order differs. This is a contract drift between stated and actual behavior.

## Not issues (explicit negatives)

- Argon2id for admin password hashing confirmed via `auth.ts:65, 128, 158, 342`.
- HMAC-SHA256 for session token signature confirmed at `session.ts:87`.
- `timingSafeEqual` guards signature comparison at `session.ts:117`.
- `cookie.path: '/'` + `httpOnly: true` confirmed at `auth.ts:209-215`.
- Secure cookie enforced in production + when `x-forwarded-proto === 'https'` (auth.ts:205-211). Matches stated behavior.
