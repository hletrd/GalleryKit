# Security Review Report — Run-9 Cycle-4 (security-reviewer)

**HEAD:** `094842a4`
**Date:** 2026-06-21
**Scope:** Deep OWASP-angle security sweep across the whole repo, deliberately widened beyond the (near-empty) source delta since run-8 convergence `f63af3b9`. Surfaces examined: auth chain (`session.ts`, `password-hashing.ts`, `app/actions/auth.ts`, `proxy.ts`, `lib/api-auth.ts`, `lib/request-origin.ts`), PAT/token auth (`lib/admin-tokens.ts`), all 8 API routes (admin + public), file upload + serving (`lib/serve-upload.ts`, LR upload route, path-traversal/symlink/SAFE_SEGMENT/ALLOWED_UPLOAD_DIRS), SQL surfaces (Drizzle parameterization, `lib/smart-collections.ts` dynamic-column compiler, raw-`sql` grep), CSV/OG/Unicode sanitization (`lib/csv-escape.ts`, `lib/og-sanitize.ts`, `lib/sanitize.ts`, `lib/validation.ts`), privacy field guards (`lib/data.ts` `_PrivacySensitiveKeys` / `publicSelectFields` / `publicMapSelectFields`), backup/restore command surface (`db-actions.ts` `spawn`, `lib/backup-filename.ts`, `lib/mysql-cli-ssl.ts`), rate limiting (`lib/rate-limit.ts`, `lib/bounded-map.ts`), and validation of all three security lint gates.

**Risk Level:** LOW (no new exploitable defect)

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low Issues: 0 new (carry-forward register unchanged)
- **Verdict: ZERO new security defects — convergence holds on the security axis.**

## Critical Issues (Fix Immediately)

None.

## High / Medium / Low Issues

None new. Every surface examined is comprehensively hardened. Detailed per-surface findings below.

---

## Per-surface examination (evidence)

### A01 Broken Access Control — CLEAN
- `lib/api-auth.ts` `withAdminAuth` enforces origin (`hasTrustedSameOrigin`) AND `isAdmin()` centrally (AGG9R-02). Token branch (`allowTokenScope`) runs FIRST and is correctly fail-closed: a **presented-but-invalid** token returns 401 and does NOT fall through to the cookie path (`api-auth.ts:65-88`); a **missing** token falls through to the same-origin + cookie path. No bypass.
- `proxy.ts` middleware is a presence/format fast-check only (`:90`, `:102-103`); full crypto validation stays in server actions (defense-in-depth, correct). Matcher correctly excludes `/api/*` (`:140`) and the comment documents that every `/api/admin/*` route must self-auth — verified true via the lint gate.
- Both `/api/admin/**` routes (`db/download`, `lr/upload`) wrap `withAdminAuth` — lint:api-auth green (2 OK).
- Every mutating server action returns early on `requireSameOriginAdmin()` — lint:action-origin green (all OK + documented exempts). Restore action additionally re-checks `isAdmin()` + origin (`db-actions.ts:272-277`).

### A02 Cryptographic Failures — CLEAN
- Passwords: Argon2id, memoryCost 65536 (64 MiB) / timeCost 3 / parallelism 4 (`password-hashing.ts:10-15`) — exceeds OWASP minimums; shared policy across login/change/seed so a lib-default change can't skew one path.
- Session tokens: HMAC-SHA256 over `timestamp:random`, verified with `timingSafeEqual` after length-equality guard (`session.ts:108-119`). Post-HMAC structural format checks (`:124-125`) are deliberately AFTER the crypto compare to avoid a timing oracle (correct ordering). 24h max-age + negative-age guard (`:127-134`). DB stores only the SHA-256 of the token (`hashSessionToken`), so DB compromise yields no usable cookies.
- `SESSION_SECRET`: production refuses the DB fallback and throws at startup if unset/<32 chars (`session.ts:30-36`) — signing key stays out of the user-data trust domain.
- PAT tokens (`admin-tokens.ts`): 32 random bytes → base64url; only SHA-256 persisted; constant-time hash compare (`tokenHashesEqual` with length + hex-charset guards, `:64-73`); fail-closed when table missing; `expires_at` enforced; plaintext never reaches a query param.

### A03 Injection (SQL / Command / XSS) — CLEAN
- **SQL:** All application queries use Drizzle ORM parameterization. The raw-`sql` template grep surfaced only column-reference interpolation (`sharedGroups.view_count`, `images.id`, `row.id`) and bound `${value}` params — Drizzle's `sql` tag auto-parameterizes interpolated VALUES (no string concatenation). `smart-collections.ts` dynamic-column path is safe: `col` is sourced from `ALLOWED_COLUMNS[pred.column]` only after the `isAllowedDirectColumn` allowlist check (`:195-199`); `contains` escapes `%_\` for LIKE (`:218-220`); BETWEEN/IN/tag values are bound params (`:225,236,255`). `admin-tokens.ts` raw `sql` uses only bound `${presentedHash}`/`${row.id}`/`${opts.*}`.
- **Command:** Backup/restore use `spawn('mysqldump'|'mysql', [argv-array], {env})` — NO shell, so no metacharacter interpretation (`db-actions.ts:157,454`). The only argv input is the constant `--one-database` flag, SSL flag from `getMysqlCliSslArgs` (constant strings — host is NOT interpolated into argv, `mysql-cli-ssl.ts:15`), and `DB_NAME` from env (operator-controlled, not request input). Credentials via `MYSQL_PWD`/`MYSQL_*` env (not `/proc/cmdline`-visible flags); `HOME` excluded to block `~/.my.cnf` injection. Restore validates the SQL header (`hasPlausibleSqlDumpHeader`) and scans the whole file for dangerous SQL before execution.
- **XSS / OG:** Satori renders text into an image (no script sink). `sanitizeForOg` (`og-sanitize.ts`) strips Unicode bidi/zero-width (global-flag `stripUnicodeFormatting`) + C0 controls; one shared sanitizer wired into both OG routes + the JSON-LD page. Admin string surfaces reject `UNICODE_FORMAT_CHARS` at the validation boundary (`validation.ts:58`, `sanitize.ts`), with `<>"'&` rejected on aliases/tag names.
- **CSV injection:** `csv-escape.ts` strips C0/C1 (preserving CR/LF for collapse), strips the shared Unicode-format set, collapses CRLF→space, prefixes `=+-@` with leading-whitespace tolerance (`/^\s*[=+\-@]/`), and quote-doubles. ZWSP-leading-formula bypass closed (C8R-RPL-01).

### A04/A05 Insecure Design / Misconfiguration — CLEAN
- `getClientIp` only trusts `X-Forwarded-For`/`X-Real-IP` when `TRUST_PROXY=true`, selects the client slot before the trusted suffix (`TRUSTED_PROXY_HOPS`), and emits a one-time `[SECURITY]` warning if proxy headers appear without `TRUST_PROXY` (`rate-limit.ts:145-176`). Fail-safe: unknown IPs still consume the SECURITY rate-limit bucket (semantic route documents this — no fail-open).
- `request-origin.ts` `hasTrustedSameOrigin` fails closed by default (`allowMissingSource=false`), requires explicit Origin/Referer match, normalizes default ports.
- No-store/nosniff defaults applied centrally by `withAdminAuth` to both token and cookie response paths.

### A06 Vulnerable Components — see dependency audit note below.

### A07 Auth Failures — CLEAN
- Login: lazily-init dummy Argon2 hash (`auth.ts:64-69,177`) equalizes the unknown-user vs wrong-password timing (anti-enumeration). Dual-bucket rate-limit (per-IP + per-account `acct:<sha256-prefix>`, 5/15min) with no-rollback on infra error (correct for security write path). Session rotation on password change; separate password-change bucket.

### A09 SSRF — N/A
- No request-driven outbound fetch surface. OG image fetch reads local on-disk derivatives via `pickFirstAvailablePhotoBuffer` (no remote URL fetch from user input). CLIP weights load OFFLINE (`allowRemoteModels=false`).

### File upload / path traversal — CLEAN
- `serve-upload.ts`: 4-layer defense — `ALLOWED_UPLOAD_DIRS` whitelist (jpeg/webp/avif), per-segment `SAFE_SEGMENT` + length + `.`/`..` reject (`:154-161`), dir↔extension map, `lstat` symlink reject, `realpath` containment with separator-suffixed prefix check (`resolvedPath.startsWith(\`${resolvedRoot}${path.sep}\`)`, `:182`) — and streams from the **resolved** path to close the realpath→createReadStream TOCTOU (`:265`). `original/` never served (not in whitelist; nginx 404 + startup assert).
- `db/download/route.ts`: `isValidBackupFilename` strict anchored regex + `path.resolve` containment + symlink reject + realpath + stream-from-resolved TOCTOU close.
- LR upload route: `getSafeUserFilename` basename + control-char reject, `isValidSlug` topic, code-point length validation (reject not silent-truncate), disk-space pre-check, restore-maintenance entry+late guard, upload-processing-contract advisory lock, cumulative upload-tracker with TOCTOU-safe pre-claim + idempotent settle, GPS strip on disk + DB null when `strip_gps_on_upload`, RAW/HDR reject. No path-controllable disk write (UUID filenames).

### Privacy / PII — CLEAN
- `data.ts` privacy guards: canonical `PrivacySensitiveKeys` union (lat/long, filename_original, user_filename, color/HDR audit cols, etc.) drives BOTH `_privacyGuard` (compile error if any sensitive key leaks into `publicSelectFields`, `:416-418`) AND `_mapPrivacyGuard` (auto-derived as union minus lat/long, `:427-430`). `publicSelectFields`/`publicMapSelectFields` are omit-derived from `adminSelectFields` as separate object references — adding a field to admin set does not auto-leak. `publicMapSelectFields` (the only lat/long-exposing select) is gated to `getMapImages()` with a `map_visible=true` inner JOIN. `avif_10bit` correctly public (encoded-output descriptor, not source PII). Documented author-discipline caveat (a NEW sensitive col must be added to the union) is unchanged and not a new defect.

### Lint-gate validation — gates cover what they claim
- **lint:api-auth** (`check-api-auth.ts`): AST-scans every `src/app/api/admin/**/route.{ts,tsx,js,mjs,cjs}`, requires each HTTP-method export be `= withAdminAuth(...)` (unwraps as/satisfies/paren), rejects function-decl + named-alias export forms, fails closed if a route exports NO handler. Ran green (2 OK). Genuinely enforces the claim.
- **lint:action-origin** (`check-action-origin.ts`): recursive AST walk of `app/actions/**` + `db-actions.ts`; requires the `requireSameOriginAdmin()` result be STORED and early-returned on, rejects pre-guard mutations, rejects `@action-origin-exempt` on bodies containing direct mutating calls, rejects aliased exports. Ran green. Genuinely enforces the claim.
- **lint:public-route-rate-limit** (`check-public-route-rate-limit.ts`): AST-scans public `/api/**` (excl. admin), requires `preIncrement*`/`checkAndIncrement*` helper or `@/lib/rate-limit` import (comment/string-stripped) on every POST/PUT/PATCH/DELETE export, fails closed on `export *`. Ran green. **Documented coverage boundary (NOT a new defect):** GET handlers are explicitly NOT scanned — the two expensive public GETs (`og/photo/[id]`, `search/similar/[id]`) DO manually wire `preIncrementOgAttempt` / `preIncrementSemanticAttempt`, verified by direct read. So the GET-exclusion is mitigated by manual wiring on every present expensive GET; a FUTURE expensive public GET added without rate-limit would be invisible to this gate (already-documented residual, carried).

### Rate-limit infra — CLEAN
- `bounded-map.ts`: collect-then-delete prune + insertion-order hard-cap eviction; no unbounded growth. Known eviction-spray weakness (attacker filling 2000 keys could evict a victim's bucket and reset its counter) is the DOCUMENTED per-process scale-out limitation (login bucket is DB-backed; CLAUDE.md "Runtime topology"); not a new defect.

---

## Confidence + DEFECT/POLISH labels for items considered and dismissed

- **api-auth token branch fall-through** — examined; correctly fail-closed (invalid token → 401, no fall-through). **NOT A DEFECT** (conf HIGH).
- **LR upload CSRF via token path bypassing same-origin** — examined; a browser cannot set the custom `X-GalleryKit-Token` header cross-origin without a CORS preflight (no CORS allow configured) AND the token value is a secret never exposed to a third-party origin; the cookie fallback path still enforces same-origin. **NOT A DEFECT** (conf HIGH).
- **smart-collections dynamic column → SQLi** — examined; allowlist-gated column ref + bound params. **NOT A DEFECT** (conf HIGH).
- **db restore command injection / DB_NAME argv** — examined; `spawn` no-shell + argv-array; only env/constant inputs. **NOT A DEFECT** (conf HIGH).
- **GET-route rate-limit gate blind spot** — real coverage boundary but all present expensive GETs are manually rate-limited; **POLISH / already-documented residual**, not a live exploit (conf MEDIUM).
- **bounded-map eviction-spray counter reset** — **POLISH / documented scale-out limitation** (conf MEDIUM).

## Dependency Audit

Not re-run this cycle as a blocking step (sandboxed environment; npm-registry network access not assumed available). The production source delta since run-8 convergence touches no dependency manifest (`git diff --stat f63af3b9..HEAD` = cicp-recheck script + 2 test files + bulk-edit a11y only; zero `package.json`/lockfile change), so the dependency posture is unchanged from prior cycles where it was audited. RECOMMENDATION (carry-forward, not a new finding): run `npm audit --workspace=apps/web` on the next deploy host pass; no new dependency was introduced to re-audit.

## Closed / refuted — NOT re-filed (re-confirmed where examined)
- ARCH-R7C2-01 / TE-R7C2-02 (Stripe webhook) — 0-hit (`grep -r stripe` confirmed absent in route inventory). CLOSED.
- RES-R7C6-01 (HEIC GPS-strip residual) — `original/` not served by any route (not in `ALLOWED_UPLOAD_DIRS`). CLOSED.
- CR-R9C2-01 (cicp-recheck onEmpty→onIdle) — FIXED. Not re-filed.
- CSP nonce reuse / session.ts off-by-one — REFUTED prior cycles. Not re-filed.

## Security Checklist
- [x] No hardcoded secrets (secrets via env; `SESSION_SECRET` prod-required; `.env.deploy` gitignored)
- [x] All inputs validated (slug/filename/code-point-length/Unicode-format/content-type/body-size)
- [x] Injection prevention verified (Drizzle params; spawn no-shell; LIKE escape; allowlist columns)
- [x] Authentication/authorization verified (withAdminAuth central origin+isAdmin; PAT constant-time; dual-bucket login RL; Argon2id)
- [x] Path traversal / symlink / TOCTOU closed on all file-serving routes
- [x] Privacy guards compile-enforced (no PII in public selects)
- [x] Lint gates validated to enforce their stated invariants (all 3 green)
- [~] Dependencies audited (no manifest change since last audited cycle; re-run recommended on deploy host)

## Disposition
**ZERO new actionable security findings. Convergence holds on the security axis.** No manufactured findings under the high bar. Carry-forward register (deferred.md) unchanged.
