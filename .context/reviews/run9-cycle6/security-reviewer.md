# Security Review — run-9 cycle-6

**HEAD:** `ba3277da`. Whole-repo OWASP Top 10 review.
**Risk Level:** LOW (no new exploitable defects)

> This agent is read-only (Write blocked); the lead persisted this review from the agent's returned text.

## Summary
- Critical: 0  | High: 0 | Medium: 0 | Low: 0
- **No new DEFECTS or POLISH items.** Truthful zero-finding result, consistent with deep convergence.

## Surfaces audited
auth chain (`session.ts`, `actions/auth.ts`, `password-hashing.ts`, `api-auth.ts`, `proxy.ts`, `admin-tokens.ts`, `request-origin.ts`), all 8 API routes (`app/api/**`), all 13 server-action files (`app/actions/**` + `[locale]/admin/db-actions.ts`), file-upload/path handling (`serve-upload.ts`, `db/download/route.ts`, `lr/upload/route.ts`, `gps-exif-strip.ts`), SQL surfaces (`smart-collections.ts`, `data.ts` selects, raw `sql`-tag grep), sanitizers (`csv-escape.ts`, `og-sanitize.ts`, `safe-json-ld.ts`, `sanitize.ts`, `validation.ts`), privacy guards (`data.ts` `_PrivacySensitiveKeys`/`publicSelectFields`), restore (`sql-restore-scan.ts`, `db-actions.ts`), rate limiting (`rate-limit.ts`, `auth-rate-limit.ts`, `public.ts`), binary parsers, all 3 security lint gates.

## OWASP evidence (abridged)
- **A01 Access Control** — middleware gates admin sub-routes; every mutating action re-verifies `isAdmin()` + `requireSameOriginAdmin()`; both admin API routes `withAdminAuth`-wrapped; `deleteAdminUser` last-admin lockout race closed by `gallerykit_admin_delete` lock + self-delete guard; no IDOR.
- **A02 Crypto** — Argon2id (64 MiB/3/4); session tokens HMAC-SHA256 + `timingSafeEqual` with structural regex AFTER the crypto compare (no timing oracle); `SESSION_SECRET` required in prod; PATs SHA-256 + `timingSafeEqual` fail-closed.
- **A03 Injection** — all queries Drizzle-parameterized; raw `sql` interpolations bind values; smart-collections uses column refs gated by allowlist + scalar enforcement + LIKE-escape; `spawn(mysqldump/mysql,[array])` no shell, `DB_NAME` from env; JSON-LD `safeJsonLd` escapes `<`→`<` + U+2028/2029; OG strings via `sanitizeForOg`.
- **A05 Misconfig** — `nosniff` + `no-store` on admin; CSP nonce per-request; `getClientIp` refuses XFF unless `TRUST_PROXY=true`; `request-origin.ts` fails closed.
- **A07 Auth** — dual-bucket login RL (IP + acct), pre-increment-before-Argon2, dummy-hash timing equalization, session-fixation rotate, no RL refund on infra errors.
- **A08 Integrity** — restore scanner blocks 35+ dangerous classes, strips comments/literals/hex before matching, masks only known-app DROP TABLE; `--one-database` + header validation + 250 MB cap + advisory lock.
- **A09 Logging** — `sanitizeStderr` redacts password + connection params; no secret values logged.
- **A10 SSRF** — only dynamic `fetch` (`og-photo-fetch.ts:52`) pinned to trusted `siteConfig.url`; DB-sourced UUID path + numeric size — attacker Host cannot redirect.

## Re-validated prior false-positives (all REFUTED — guards present)
- `color-detection.ts` NCLX `colr` reads — guarded by `dataSize >= 11` + `pos + size > buffer.length` break.
- `gps-exif-strip.ts` ILOC walker — every read preceded by `pos + N > dataEnd` checks; itemCount/extentCount capped (4096/64).
- `gain-map-detection.ts` / `icc-extractor.ts` — preceding bounds checks confirmed.

## Lint-gate enforcement (ran scanners against real files)
- `check-api-auth.ts` → both admin routes OK (requires direct `withAdminAuth(...)` variable-export; fails closed on aliased/function-decl).
- `check-action-origin.ts` → all mutating actions OK; read-only getters SKIP (exempt comment); rejects exempt on mutating bodies + aliased exports.
- `check-public-route-rate-limit.ts` → all public routes OK; fails closed on `export *`.

## Note on CR-R9C6-01 (code-reviewer's finding)
The upload-path bypass of 6 processing settings is a **correctness** defect, not a security one — none of the 6 settings is a security control (no privacy/auth/injection impact). No security angle to add. Out of this agent's lane.

**Verdict: ZERO new security DEFECTS.**
