# Document Specialist - Cycle 13

Scope: doc/code alignment. Reviewed CLAUDE.md, README.md, AGENTS.md, apps/web/.env.local.example against actual code.

## Findings

No new CRITICAL, HIGH, MEDIUM, or LOW findings.

### Spot-verified claims in CLAUDE.md

- "All queries via Drizzle ORM (parameterized, no raw SQL with user input)" — confirmed; only parameter-bound raw `conn.query()` uses placeholders.
- "Passwords hashed with **Argon2**" — confirmed at `auth.ts:136`, `admin-users.ts:136`.
- "HMAC-SHA256 signed, verified with `timingSafeEqual`" — confirmed at `session.ts:87, 117`.
- "Cookie attributes: `httpOnly`, `secure` (in production), `sameSite: lax`, `path: /`" — confirmed at `auth.ts:209-215`.
- "Login rate limiting: 5 attempts per 15-minute window per IP, with bounded Map + LRU eviction" — confirmed at `rate-limit.ts:6-8, 101-119`.
- "Session secret: `SESSION_SECRET` env var is required in production" — confirmed at `session.ts:30-36`.
- "Path traversal prevention: `SAFE_SEGMENT` regex + `ALLOWED_UPLOAD_DIRS` whitelist + `resolvedPath.startsWith()` containment" — confirmed.
- "Symlink rejection: Both upload routes use `lstat()` and reject `isSymbolicLink()`" — confirmed.
- "Filename sanitization: UUIDs via `crypto.randomUUID()` (no user-controlled filenames on disk)" — confirmed.
- "Decompression bomb mitigation: Sharp `limitInputPixels` configured" — confirmed.
- "CSV export escapes formula injection characters" — confirmed in `csv-escape.ts`.
- "Storage Backend (Not Yet Integrated): ... local filesystem storage only" — confirmed; `@/lib/storage/index.ts` header still says not yet wired.
- "Permanently Deferred: 2FA/WebAuthn: Not planned" — confirmed, no TOTP/WebAuthn code surface.
- "Node.js 24+ required, TypeScript 6.0+" — confirmed in root `package.json` engines.
- "Max upload size: 200MB per file, 2 GiB total per batch by default" — confirmed in `upload-limits.ts`.
- "Docker liveness should probe `/api/live`; `/api/health` is DB-aware readiness" — confirmed, `/api/live` is static ok-200, `/api/health` touches DB.

All documented claims match code at HEAD.

## Confidence: High
