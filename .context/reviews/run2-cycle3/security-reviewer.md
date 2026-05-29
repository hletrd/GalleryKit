# Security Reviewer — Run-2 Cycle 3 (HEAD 420b7852)

Angle: OWASP top 10, secrets, unsafe patterns, auth/authz.

## Files examined
auth.ts, rate-limit.ts, auth-rate-limit.ts, db-actions.ts (backup/restore), db/download route, og routes, share routes, stripe/webhook route, serve-upload.ts, image-queue.ts.

## Findings
NONE net-new actionable.

### Verified-clean highlights
- **Auth (auth.ts)**: timing-equalized argon2 via lazy dummy-hash; TOCTOU-safe pre-increment of BOTH IP and account rate-limit buckets before the verify; DB-backed source-of-truth with in-memory fast-path fallback; session fixation prevented via insert-then-delete transaction; `unstable_rethrow` guards Next.js control-flow signals; documented no-rollback-on-infra-error posture (correct anti-brute-force trade-off, C1F-CR-04). Secure-cookie gating via trusted-proxy protocol normalization.
- **Rate limit (rate-limit.ts)**: `getClientIp` only trusts `X-Forwarded-For` when `TRUST_PROXY=true`, selects the client slot before the trusted proxy suffix (`hopCount`), normalizes IPv4/IPv6 with port stripping. Bounded maps with eviction. Warns once when proxy headers present but `TRUST_PROXY` unset. Correct CWE-348 posture.
- **DB restore (db-actions.ts)**: dual advisory lock (`gallerykit_db_restore` + upload-processing-contract) on dedicated pool connections; header validation (`hasPlausibleSqlDumpHeader`); chunked dangerous-SQL scan with carry-tail; 250MB cap; streaming to disk (no heap blow-up); `MYSQL_PWD` env (not `-p` /proc/cmdline leak); `--one-database`; minimal env (HOME excluded → no `~/.my.cnf`); `sanitizeStderr` redacts password/user/host/db; `0o600` temp/backup file modes; explicit RELEASE_LOCK on every early-return path. Exemplary.
- **Backup download route**: `withAdminAuth` wrapper (origin verified there per AGG9R-02); `isValidBackupFilename`; lstat symlink rejection; `realpath` containment; streams from resolved path (TOCTOU-safe); `no-store` cache; audit-logged with requester IP.
- **Stripe webhook**: mandatory signature verification (constant-time 400 on forgery); `payment_status === 'paid'` gate (async-pay rejection); idempotency via SELECT + UNIQUE sessionId + ON DUPLICATE KEY; tier allowlist (`isPaidLicenseTier`); email shape + oversize validation; zero-amount rejection; PII-aware logging (no email/tokenHash at error level). `@public-no-rate-limit-required` justified.
- **OG routes**: per-IP rate limit; post-DB 404 charged (no enumeration oracle); input validation (`isValidSlug`/`isValidTagName`); `sanitizeForOg` strips bidi/invisible/C0 control chars (defense-in-depth over admin-write-time validation).
- **Share routes**: rate-limit before DB lookup; noindex metadata; no key-validity oracle.
- Carryover DEF-06 (raw error to admin client in triggerBackfill): re-verified — acceptable under CLAUDE.md "Admin accounts are multiple root admins. The current schema has no role/capability model" (quoted). Exit criterion (non-root admin role) NOT fired.

No secrets in source. No SQL concatenation (all drizzle-parameterized). No unsafe deserialization. No SSRF (OG fetch is origin-bound).

Confidence: High.
