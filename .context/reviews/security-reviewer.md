# Security Review Report — GalleryKit (Cycle 13)

**Scope:** Full repository at `/Users/hletrd/flash-shared/gallery`, app under `apps/web/`. HEAD `80145992` (cycle-12 fixes landed since the prior review's `2a9976a1`).
**Reviewer:** Security Reviewer — OWASP Top 10, authn/authz, secrets, SSRF, path traversal, injection (SQL/cmd/CSV/XSS/XML), session/cookie, rate-limit bypass, file-upload, CSRF/same-origin, privacy/PII, deserialization, ReDoS, prototype pollution, DoS.
**Date:** 2026-06-27
**Risk Level:** LOW — no confirmed exploitable CRITICAL/HIGH/MEDIUM vulnerabilities. One NEW LOW (admin-username disclosure in the public Atom feed) + two carry-over LOWs.

---

## Summary

| Severity | Count | IDs |
|----------|-------|-----|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW | 3 | SEC-13-01 (new), SEC-13-02 (carry-over R12-SEC-01), SEC-13-03 (carry-over R12-SEC-02) |

**Evidence collected this cycle (all from source, not sampled):**
- `npm audit` full tree **and** `--omit=dev`: **0 vulnerabilities**.
- All three security lint gates **PASS**: `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`.
- Delta `2a9976a1..HEAD` reviewed line-by-line: instrumentation shutdown, db init-timer hygiene, image-queue runtime-shape guard, `_verifyAvifNclx` partial read, audit `prioritizeSecurityFields` export. **All clean / positive** — no new vulnerability class.
- High-value surfaces re-audited from source: LR PAT upload, semantic + similar search, both OG routes, upload serving (path traversal), DB backup download, DB dump/restore (`spawn`), middleware admin guard, session/cookie, request-origin/CSRF, validation/sanitize/csv-escape/sql-restore-scan regexes (ReDoS), `data.ts` privacy guards + map GPS gating, analytics geoip, both Atom feed routes, share-key entropy, embedding decode, settings prototype-pollution, last-admin guard, nginx XFF handling.

**Verdict:** Mature, exceptionally well-hardened codebase. Twelve prior review cycles have driven the security posture to convergence. Every control claimed in CLAUDE.md was independently re-verified holding in current code. The only substantive new observation is an information-disclosure tension between the public Atom feed and the login flow's deliberate anti-enumeration design.

---

## LOW Findings

### SEC-13-01 — Public Atom feed discloses admin LOGIN usernames (new)
- **Severity:** LOW · **Confidence:** High (confirmed from code) · **Class:** A07 Identification & Authentication Failures (username enumeration) / sensitive-data exposure
- **Location:**
  - `apps/web/src/lib/data.ts:792` — `getImagesForFeed()` selects `author_name: adminUsers.username` (LEFT JOIN `admin_users` on `images.uploaded_by`).
  - `apps/web/src/app/feed.xml/route.ts:76-92` and `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:87-102` — emit it as the per-entry `<author><name>`.
- **Why it is a problem:** The value surfaced publicly is the admin's **login username** — one of the two credentials required to authenticate. The login flow goes to deliberate lengths to *prevent* username enumeration: a precomputed Argon2 dummy hash equalizes timing between "user missing" and "wrong password" (`auth.ts:65-68,175-176`), the error is a generic `invalidCredentials` for both branches (`auth.ts:178-182`), and the account-scoped rate-limit bucket is keyed on `sha256(username)` precisely so the username is never reflected (`rate-limit.ts:136-140`). The public Atom feed hands an unauthenticated attacker the exact valid username(s) for free, undermining that anti-enumeration posture. CLAUDE.md frames this as "JOIN-derived display name only" (a privacy win because the raw `uploaded_by` id stays admin-only), but the "display name" *is* the login credential.
- **Exploit / failure scenario:** Attacker `GET`s `https://gallery.example.com/feed.xml`, reads `<author><name>` on each entry, and now has the valid admin username(s). On a multi-photographer studio deployment (an explicitly documented use case) every contributor's login name becomes public, enabling **targeted** credential-stuffing (test a few breach-database passwords against a now-known account — the 5/15-min account cap still permits ~480 attempts/day) and convincing spear-phishing.
- **Mitigations already present (why it is LOW, not MEDIUM):** account-scoped rate limit (5 attempts / 15 min keyed exactly on the username) + per-IP rate limit + Argon2id (64 MiB/t3/p4) + 12-codepoint minimum password. These make online brute-force impractical even with the username known. For a single-admin personal gallery the username is often the photographer's public identity anyway, so impact there is negligible.
- **Fix (concrete):** Add a separate, admin-settable public `display_name` column on `admin_users` and surface that (falling back to the feed-level `<author>` when unset) instead of `username`:
  ```ts
  // data.ts getImagesForFeed — do NOT expose the login credential:
  .leftJoin(adminUsers, eq(images.uploaded_by, adminUsers.id))
  // select adminUsers.display_name (new nullable column), NOT adminUsers.username
  author_name: adminUsers.display_name,
  ```
  Alternatives: make per-entry author opt-in per upload, or omit the per-entry `<author>` entirely (RFC 4287 §4.1.1 is satisfied by the feed-level `<author>` already emitted). If the single-admin == public-photographer assumption is intended, document the tradeoff explicitly so multi-admin operators know their login names are public.
- **Status:** Confirmed. XML output is correctly escaped (`escapeXml`, `atom-feed.ts:21`), so this is disclosure only — no XML injection.

### SEC-13-02 — `hasTrustedSameOriginWithOptions` still exported (carry-over of R12-SEC-01 / AGG-R12-09)
- **Severity:** LOW · **Confidence:** High · **Class:** A01 Broken Access Control / CSRF (latent footgun)
- **Location:** `apps/web/src/lib/request-origin.ts:109` (`export { hasTrustedSameOriginWithOptions };`)
- **Why it is a problem:** The options variant accepts `{ allowMissingSource: true }`, which makes the same-origin check return `true` for a request bearing **no** `Origin` and **no** `Referer` — defeating the CSRF boundary for any caller that opts in. It is exported **solely** so `__tests__/request-origin.test.ts` can lock the loose-opt-in contract.
- **Exploitability:** None today — `grep` confirms **zero** production callers pass `allowMissingSource: true` (only the strict public wrapper `hasTrustedSameOrigin()` and the test). Purely a future-misuse footgun. The cycle-12 plan explicitly **DEFERRED** this (AGG-R12-09) with exit criterion "any production import OR a lint-gate watch for the symbol."
- **Fix:** make the options variant a non-exported internal exercised through a test-only shim, or add an `eslint no-restricted-syntax` rule forbidding `allowMissingSource: true` outside the test file.

### SEC-13-03 — Expensive public GET routes rate-limited at runtime but not CI-gated (carry-over of R12-SEC-02)
- **Severity:** LOW (informational) · **Confidence:** High · **Class:** A05 Security Misconfiguration / DoS-defense regression risk
- **Location:** `apps/web/src/app/api/search/similar/[id]/route.ts` (O(n) embedding scan), `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx` (Satori/Sharp CPU + internal fetch).
- **Why it is a problem:** `lint:public-route-rate-limit` only scans **mutating** handlers (POST/PUT/PATCH/DELETE) and explicitly skips GET. All three routes ARE rate-limited at runtime today (`preIncrementSemanticAttempt` / `preIncrementOgAttempt`), so no live exposure — but a future refactor deleting a pre-increment from any of these expensive GETs would pass CI silently, re-opening an unmetered-CPU/internal-fetch DoS surface. (The Atom feed GETs are bounded `LIMIT 50` and CDN-cached `s-maxage=1800`, so they are a lesser concern.)
- **Fix:** extend the gate to scan a curated allowlist of expensive public GET routes, requiring a `preIncrement*`/`checkAndIncrement*` helper or an explicit `@public-no-rate-limit-required:` exempt comment — the contract already enforced for mutating routes.

---

## Surface-by-Surface Verification (confirmed clean this cycle)

| Surface | File(s) | Result |
|---|---|---|
| Session / login | `app/actions/auth.ts`, `lib/session.ts`, `lib/password-hashing.ts` | Argon2id (64 MiB/t3/p4); HMAC-SHA256 token verified with `timingSafeEqual` (length-checked first); shape asserts AFTER crypto to avoid timing oracle; 24 h age window; `SESSION_SECRET` required ≥32 chars in production (refuses DB fallback). Dual-bucket rate limit (IP + `acct:sha256(username)`), pre-increment BEFORE Argon2 (TOCTOU), no-rollback-on-infra-error (Pattern 1). Dummy-hash timing equalization (precomputed at module init). Session-fixation prevented (insert+delete-others in one tx). Cookie `httpOnly`+`secure`(prod/TLS)+`sameSite:lax`+`path:/`+24h. **Solid.** |
| LR PAT upload | `api/admin/lr/upload/route.ts`, `lib/admin-tokens.ts`, `lib/api-auth.ts` | Token `gk_`+base64url(32B), SHA-256 stored, `timingSafeEqual`, well-formed pre-check, scope gate, parameterized lookup by hash. Upload mirrors browser path: `getSafeUserFilename`, slug/title/desc validation (codepoint length + `sanitizeAdminString`), restore-maintenance gate, contract advisory lock, 1 GB disk pre-check, TOCTOU-safe cumulative tracker keyed on token user, HDR-ingest gate, GPS strip on disk, idempotent quota settle, audit log. **Solid.** |
| Path traversal (serve) | `lib/serve-upload.ts`, `app/uploads/[...path]/route.ts` (+ locale twin) | `ALLOWED_UPLOAD_DIRS` (jpeg/webp/avif; `original/` excluded), `SAFE_SEGMENT`, `.`/`..`/length reject, ext↔dir match, `lstat` symlink reject, `realpath` containment (`startsWith(root+sep)`), stream from resolved path (TOCTOU closed). **Solid.** |
| Path traversal (backup dl) | `api/admin/db/download/route.ts`, `lib/backup-filename.ts` | `withAdminAuth`, anchored `BACKUP_FILENAME_PATTERN` (no quotes/CRLF → no Content-Disposition injection), containment + `lstat` symlink reject + `realpath`, streams from resolved path, audit log. **Solid.** |
| SSRF (OG) | `api/og/route.tsx`, `api/og/photo/[id]/route.tsx`, `lib/og-photo-fetch.ts`, `lib/seo-og-url.ts` | Home OG: inline gradient, no fetch. Photo OG: internal fetch base **pinned to trusted `siteConfig.url`**, fail-closed 404 on unparseable; path is a system UUID derivative; fallback redirect validates same-origin (no open redirect; backslash rejected in `seo-og-url.ts` relative branch). Rate-limited + charged-on-failure. **Solid.** |
| SSRF (CLIP) | `lib/clip-model.ts:88`, `lib/clip-paths.ts` | `env.allowRemoteModels = false` (offline). Weights load from operator-controlled `CLIP_MODELS_ROOT` only; model id/revision are hardcoded constants validated as 2-segment repo + 40-hex SHA. No network fetch path. **Solid.** |
| Injection (SQL) | Drizzle params throughout; `admin-tokens.ts`/`db-actions.ts`/`admin-users.ts` raw SQL all `${param}`/`?`-bound | No untrusted string concatenation into SQL. Search query never reaches SQL (goes to CLIP encoder). `inArray` IDs are validated integers. **No SQLi.** |
| Injection (command) | `db-actions.ts:157,454` `spawn('mysqldump'|'mysql', [array], {env})` | Array form, no shell; creds via `MYSQL_PWD`/`MYSQL_USER`/`MYSQL_HOST` env (not `/proc/cmdline`); `HOME` excluded (no `~/.my.cnf`); `LANG/LC_ALL=C.UTF-8`; `DB_NAME`/SSL args operator-controlled. `sanitizeStderr` redacts password + host/user/db. **No command injection.** |
| Injection (CSV) | `lib/csv-escape.ts` | Strips C0/C1, strips bidi/zero-width (`UNICODE_FORMAT_CHARS_G`), collapses CRLF, prefixes `= + - @` with `'` (tolerating leading whitespace), wraps+doubles quotes. **OWASP-compliant.** |
| Injection (XSS) | 8× `dangerouslySetInnerHTML` (all JSON-LD) via `lib/safe-json-ld.ts`; OG via `lib/og-sanitize.ts` | `safeJsonLd` escapes `<`→`<`, `>`→`>`, U+2028/U+2029 — prevents `</script>` breakout. React escapes elsewhere. **No XSS.** |
| Injection (XML) | `lib/atom-feed.ts:21` `escapeXml` | Escapes `&<>"'` + strips XML-illegal controls on every emitted value. **No XML injection.** |
| ReDoS | `validation.ts`, `csv-escape.ts`, `sanitize.ts`, `sql-restore-scan.ts`, `rate-limit.ts`, `base56.ts`, `backup-filename.ts` | All anchored, single-char-class quantifiers; SQL string-literal patterns use mutually-exclusive alternations (no ambiguous overlap); the only superlinear shape (`[^;]*?\s+`) is on an admin-only, size-capped restore file (self-DoS at worst). `sanitizeStderr` escapes all metachars before `new RegExp`. **No exploitable ReDoS.** |
| Privacy (PII) | `lib/data.ts` | `publicSelectFields` derived-by-omission from `adminSelectFields` (separate ref); compile-time guards `_PrivacySensitiveKeys` / `_SensitiveKeysInPublic` / `_MapPrivacyGuard` / `_LargePayloadGuard`. GPS exposed ONLY by `getMapImages()` behind SQL `map_visible=true` INNER JOIN + runtime per-row assertion; `map_visible` is admin-gated. **Solid** (except the username field in `getImagesForFeed` → SEC-13-01). |
| Privacy (analytics) | `lib/analytics.ts` | Country-code only (2-char), never full IP; referrer reduced to eTLD+1; private IPs/`.onion`→`direct`. **Solid.** |
| CSRF / same-origin | `lib/request-origin.ts`, `lib/action-guards.ts`, `lib/api-auth.ts` | Fail-closed (no Origin AND no Referer → reject). `requireSameOriginAdmin()` on every mutating action (lint-enforced); `withAdminAuth` enforces origin centrally; token path bypass is intentional + scope-gated. One latent footgun → SEC-13-02. |
| Rate-limit IP trust | `lib/rate-limit.ts` + `apps/web/nginx/default.conf` | `getClientIp` only trusts XFF when `TRUST_PROXY=true`; shipped nginx **overwrites** `X-Forwarded-For $remote_addr` (does NOT append), so attacker XFF is dropped and `getClientIp` falls through to `X-Real-IP` (real client). XFF-spoofing not exploitable in the shipped config. **Solid.** |
| Prototype pollution | `lib/sanitize.ts` `normalizeStringRecord`, `actions/settings.ts:53-54` | Rejects non-object/array; settings call supplies `allowedKeys = GALLERY_SETTING_KEYS` so `__proto__`/`constructor` keys are rejected; string assignment to `__proto__` is a no-op anyway. **Safe.** |
| Deserialization | `lib/clip-embeddings.ts` `decodeEmbeddingColumn` | Validates `decoded.length === EMBEDDING_BYTES` before float32 conversion; no eval. **Safe.** |
| Share-key entropy | `lib/base56.ts`, `actions/sharing.ts` | 10-char base56 (~58 bits) via CSPRNG `randomBytes` + rejection sampling (no modulo bias); share routes rate-limited 60/min/IP. **Not enumerable.** |
| Last-admin lockout | `actions/admin-users.ts:218-275` | `LOCK_ADMIN_DELETE` advisory lock + tx + `COUNT(*)<=1 → LAST_ADMIN`; parameterized; audit_log detach (`user_id=NULL`) avoids FK 1451. **Solid.** |
| Secrets | repo-wide grep + `git ls-files` | Only `.env.deploy.example` + `apps/web/.env.local.example` tracked; no hardcoded secret literals; env-sourced creds; stderr redaction. **Clean.** |
| Security headers | `lib/content-security-policy.ts`, `proxy.ts`, `next.config.ts` | Production CSP: `default-src 'self'`; `script-src 'nonce-…' 'self'` (no `unsafe-inline`); `object-src 'none'`; `base-uri 'self'`; `frame-ancestors 'self'`; `form-action 'self'`. Per-request nonce. `IMAGE_BASE_URL` validated (absolute https, no creds/query/hash). `X-Content-Type-Options: nosniff` global + on API responses. **Solid.** |
| Cycle-12 delta | `instrumentation.ts`, `db/index.ts`, `image-queue.ts`, `process-image.ts`, `audit.ts` | Timer `clearTimeout`+`.unref()` + explicit `process.exit`; init-timer hygiene; runtime-shape value-type guard; `_verifyAvifNclx` 4 KB partial read; `prioritizeSecurityFields` exported-for-test. **All clean; no regression.** |

---

## Security Checklist

- [x] Argon2id password hashing (64 MiB / t=3 / p=4), shared policy module
- [x] HMAC-SHA256 sessions, `timingSafeEqual`, secure cookie attrs (secure always-on in prod), session-fixation prevented
- [x] PAT auth: SHA-256 stored, constant-time compare, scope + expiry, parameterized lookup
- [x] `withAdminAuth` on every `api/admin/**` route (lint-enforced, verified)
- [x] `requireSameOriginAdmin()` + admin-auth on every mutating server action (lint + manual, verified)
- [x] Public mutating routes rate-limited (lint-enforced); expensive public GETs rate-limited at runtime (CI gap → SEC-13-03)
- [x] Path traversal: whitelist + SAFE_SEGMENT + realpath containment + symlink reject (serve + backup dl)
- [x] File upload: UUID names, 200 MiB/file + 2 GiB cumulative + 100-file caps, disk pre-check, `limitInputPixels`, HDR gate
- [x] SSRF: OG fetch base pinned to trusted origin, fail-closed; CLIP offline-only
- [x] Open redirect: OG fallback same-origin-validated; SEO OG URL backslash-rejected
- [x] CSV / XSS / XML injection: formula-prefix + bidi/zero-width strip; `safeJsonLd`; `escapeXml`
- [x] Unicode bidi/zero-width rejected at all admin string entry points
- [x] Command injection: `spawn` array form, env-based creds, HOME excluded
- [x] SQL injection: Drizzle parameterization; raw SQL all bound
- [x] Privacy: GPS two-layer gated (map_visible), filename/original omitted from public; analytics country-only — EXCEPT admin username in Atom feed (SEC-13-01)
- [x] Prototype pollution: settings `allowedKeys`; deserialization length-validated
- [x] Dependencies: `npm audit` 0 vulnerabilities (full + prod)
- [x] No hardcoded secrets

---

## Conclusion

GalleryKit's security posture remains **strong and converged**. Every CLAUDE.md-claimed control was independently re-verified holding in current code, the cycle-12 hardening diffs are clean, all three lint gates pass, and `npm audit` is clean (full + prod). No new CRITICAL/HIGH/MEDIUM finding.

The one substantive new observation (SEC-13-01) is a LOW information-disclosure tension: the public Atom feed surfaces the admin **login username** as the per-entry author, partially undermining the login flow's deliberate anti-enumeration design — mitigated in practice by the account-scoped rate limit + Argon2id + 12-char minimum password, but worth closing with a separate `display_name` column on multi-admin deployments. The two carry-over LOWs (SEC-13-02 footgun export, SEC-13-03 GET-route CI gap) remain as previously deferred.

*All findings verified against source at HEAD `80145992`. Lint-gate + `npm audit` evidence captured this cycle.*
