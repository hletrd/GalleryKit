# Security Review — GalleryKit Cycle 16 (R16C16)

**HEAD:** 1f5fb245 · **Agent:** security-reviewer (opus) · **Risk level: LOW** (mature, heavily-hardened over 15 prior cycles; no exploitable defect this cycle).

**One-line summary:** No new exploitable vulnerability. Every cycle-15 fix verified to have landed and held (CR-15-01 BoundedMap dead-fast-path; SEC-15-01 `icc_profile_name`/`bit_depth` `isAdmin` gating; A15-02 `searchFields` privacy guard). All three security lint gates green, `npm audit` 0 vulnerabilities, no hardcoded secrets, no committed env secrets. The auth, injection, SSRF, path-traversal, rate-limit, privacy-field, and crypto surfaces were re-audited from source and are sound.

## Summary
| Severity | Count | Notes |
|----------|-------|-------|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW (new) | 0 | — |
| INFO (new) | 1 | SEC-16-01 — LR upload route case-mismatch is harmless (HTTP header lookups are case-insensitive); recorded as a non-defect observation only |
| Confirmed-deferred | 3 | SEC-14-02 (LR `err.message`), SEC-13-02 (`hasTrustedSameOriginWithOptions`), SEC-13-03 (GET rate-limit CI gate narrower than runtime) |

**Verdict:** The security area is genuinely converged this cycle. No new finding rises to LOW or above. One INFO observation recorded for completeness; all prior deferrals re-confirmed unchanged in exposure.

---

## Cycle-15 fix verification (read against installed code)

1. **CR-15-01 (BoundedMap dead fast path) — FIX HELD.** All three sites now write the incremented value back through `.set()` instead of mutating the discarded shallow copy:
   - `actions/embeddings.ts:44-46` — `const next = { count: entry.count+1, … }; backfillRateLimit.set(key, next); return next.count > 1;`
   - `actions/sharing.ts:54-56` (`checkShareRateLimit`) + rollback `:64-66` — `.set()` form.
   - `actions/admin-users.ts:40-43` (`checkUserCreateRateLimit`) + rollback — `.set()` form.
   The in-memory fast paths now accumulate correctly within the window.
2. **SEC-15-01 (`icc_profile_name`/`bit_depth` un-`isAdmin`-gated) — FIX HELD.**
   - `color-details-section.tsx:240` — `const iccName = isAdmin ? (image.icc_profile_name || '') : '';`
   - `color-details-section.tsx:291` clipboard snapshot — `sourceBitDepth: isAdmin ? (image.bit_depth ?? null) : null`.
   - `info-bottom-sheet.tsx:443` — `{isAdmin && hasExifData(image.bit_depth) && (…)}`.
   Both admin-only fields now carry the explicit `isAdmin` gate every sibling color field carries.
3. **A15-02 (`searchFields` privacy guard) — FIX HELD.** `data.ts:1502-1507` adds `type _SearchSensitive = Extract<keyof typeof searchFields, _PrivacySensitiveKeys>` + a `_searchPrivacyGuard` compile assertion. `searchFields` is clean today; a future PII column added there is now a `tsc` error.

---

## Surfaces audited from source this cycle (no findings)

### Authentication & Sessions (A07)
- **Argon2id** `memoryCost=65536 (64 MiB), timeCost=3, parallelism=4` (`password-hashing.ts`), shared by login/change/seed; module-init dummy-hash (`auth.ts:65`) equalizes login timing between missing-user and wrong-password branches (no user-enumeration oracle).
- **Sessions** (`session.ts`): HMAC-SHA256 over `timestamp:random`, verified with `timingSafeEqual` after a length-equality guard; token-part shape regexes run AFTER the crypto verify so they cannot be a timing oracle; 24 h max-age + negative-age guard; stored SHA-256 hash (DB compromise ≠ usable cookies). `SESSION_SECRET` env required in production — refuses DB fallback (`session.ts:30-36`).
- **Login** (`auth.ts`): dual per-IP + per-account (`acct:<sha256-prefix>`) rate limiting; pre-increment-before-Argon2 TOCTOU fix; DB-backed counter is source of truth with in-memory fast cache; NO rollback on infrastructure error (Pattern 1) so an attacker cannot mine extra attempts via DB faults; session-fixation prevention (insert-then-delete-others in one txn); `secure` cookie keyed on trusted-proxy protocol; password change rotates every session.
- **Cookie flags**: `httpOnly`, `secure` (TLS/prod), `sameSite: lax`, `path: /`. Sound.

### Authorization / Access Control (A01)
- **`withAdminAuth`** (`api-auth.ts`): token-scope path runs first (PATs bypass same-origin by design), else same-origin + `isAdmin()`; auto no-store + nosniff on every response. Both admin API routes pass `lint:api-auth`.
- **`requireSameOriginAdmin`** (`action-guards.ts`) + `isAdmin()`/`getCurrentUser()` confirmed on EVERY mutating server action by direct read: admin-backfill, admin-users, seo, settings, sharing, tags, topics, lr-tokens (create/revoke = same-origin+isAdmin+getCurrentUser; list = read-only getCurrentUser), images (uploadImages authenticated via `getCurrentUser` null-check `:113-116`; delete/deleteImages/updateImageMetadata/bulkUpdateImages/retryFailedImage via `isAdmin`), collections, embeddings. `lint:action-origin` green. NOTE: the lint gate enforces same-origin only — I separately verified `isAdmin`/`getCurrentUser` authZ on each, since the gate does not.
- **Middleware** (`proxy.ts`): admin sub-route guard requires a ≥100-char 3-segment cookie before reaching DB verify; `/api/*` excluded from matcher by design (routes self-guard via `withAdminAuth`). `x-gk-admin-render` only reflects the requester's own cookie.
- **Privacy field split** (`data.ts`): `publicSelectFields` derived by omission from `adminSelectFields`; compile guards `_SensitiveKeysInPublic`, `_MapSensitiveKeysInPublicMap`, `_LargePayloadKeysInPublic`, `_SearchSensitive` all enforce no PII leak. GPS only in `publicMapSelectFields`. `_PrivacySensitiveKeys` includes lat/long/filenames/icc/bit_depth/color-pipeline fields.

### Injection (A03)
- **SQL**: Drizzle parameterization throughout; `smart-collections.ts` compiles an admin-supplied AST via a column allowlist + Drizzle binding (depth ≤ 4, IN ≤ 100, scalar-value enforcement at validate-time, LIKE `%_\` escaping); tag predicate uses a parameterized subquery. `admin-tokens.ts` uses `sql` template params (hash lookup, never plaintext in a query). No string concatenation into SQL anywhere.
- **XSS / JSON-LD**: `safe-json-ld.ts` escapes `<`→`<`, `>`→`>`, U+2028/U+2029; all 8 `dangerouslySetInnerHTML` are JSON-LD via `safeJsonLd` with a CSP nonce. CSP nonce-based, no `unsafe-inline` (verified `proxy.ts` + `content-security-policy.ts`).
- **OG-text**: `og-sanitize.ts` `sanitizeForOg` strips bidi/zero-width (`stripUnicodeFormatting`, global-flag) + C0 controls; imported by both OG routes and the JSON-LD page.
- **CSV**: `escapeCsvField` (formula-prefix + C0/C1 + bidi/zero-width) — `db-actions.ts` export.
- **Unicode/Trojan-Source**: `validation.ts` `UNICODE_FORMAT_CHARS` + `sanitize.ts` `sanitizeAdminString`/`stripControlChars`/`requireCleanInput` reject bidi/zero-width on every admin string surface.
- **Command**: `db-actions.ts` `spawn('mysqldump'/'mysql', [argv])` — argv arrays, NO shell; credentials via `MYSQL_PWD`/`MYSQL_USER` env (not `/proc/cmdline`); minimal env (HOME excluded → no `~/.my.cnf`). No `eval`/`new Function`/`child_process` shell anywhere.

### SSRF (A10)
- Both OG routes pin the internal photo fetch origin to `siteConfig.url` (`og/photo/[id]/route.tsx:113`), FAIL-CLOSED to a 404 fallback if `siteConfig.url` is unset/unparseable — never falls back to the attacker-controllable request origin. `og-photo-fetch.ts` builds `${origin}/uploads/jpeg/<db-uuid>` with 10 s timeout + 1 MB cap. The home OG route renders a gradient card (no background fetch). No user-controlled `new URL().fetch()` elsewhere (`analytics.ts` only parses the Referer for host extraction, never fetches).

### Path traversal
- `serve-upload.ts`: `ALLOWED_UPLOAD_DIRS` allowlist + `SAFE_SEGMENT` per-segment regex + `.`/`..`/length rejects + dir↔extension map + `lstat` symlink rejection + `realpath` containment (`startsWith(resolvedRoot+sep)`) + stream from the resolved path (TOCTOU-closed).
- `db/download/route.ts`: `isValidBackupFilename` (`^backup-\d{4}-\d{2}-\d{2}T[\d-]+Z(?:-[0-9a-f]{8})?\.sql$` — no `"`/CR/LF/path chars → Content-Disposition header-injection closed) + `startsWith(backupsDir+sep)` + `lstat` symlink + `realpath` containment + stream-from-resolved.

### Rate limiting / DoS
- Documented 4 rollback patterns. Public surfaces all bounded: semantic/similar (30/min, Pattern 2, pre-increment-before-config-read so config probing is metered), OG x2 (30/min, charged-404 Pattern 4), share-key (60/min), search (30/min), load-more (120/min), view-record (120/min). `getClientIp` trusts XFF only under `TRUST_PROXY`, selects client before the trusted-hop suffix, one-time `[SECURITY]` warn when proxy headers present without `TRUST_PROXY`. `BoundedMap` hard-cap eviction on every `.set()`. `lint:public-route-rate-limit` green.

### Integrity / deserialization (A08)
- DB restore (`db-actions.ts`): `isAdmin` + same-origin + advisory lock `gallerykit_db_restore` + upload-contract lock + restore-maintenance flag; streams to a `0o600` temp file; validates a plausible mysqldump header (256-byte prefix, bytesRead-bounded); chunked `containsDangerousSql` scan with tail-carry; `mysql --one-database`; stderr redacted via `sanitizeStderr`. Admin-only, fail-closed.

### Secrets / config
- `npm audit --omit=dev`: **0 vulnerabilities.** No hardcoded api-key/secret/token literals in `src/`. Only `.env.local.example` / `.env.deploy.example` committed — placeholders only; `.env`, `.env.local`, `.env.deploy` gitignored. No secret values logged (the two `console.error` stderr lines pass through `sanitizeStderr` which redacts the password/host/user/db; the `session.ts` warn logs only the absence of `SESSION_SECRET`, not a value).
- No permissive CORS (`Access-Control-*` absent). No open redirect — `proxy.ts` redirects to fixed `/admin` login paths; the topic-page `redirect` uses a DB-canonical slug via `localizePath`, query carried through `URLSearchParams` (encoded, length-capped).

---

## INFO — new this cycle (non-defect, recorded for completeness)

### SEC-16-01 — LR upload route reads `X-GalleryKit-Token` while the wrapper reads `x-gallerykit-token` — NOT a defect
`api/admin/lr/upload/route.ts:65` calls `request.headers.get('X-GalleryKit-Token')` (mixed case) while `api-auth.ts:14` uses the lowercased constant. The `Headers.get()` lookup is case-insensitive per the Fetch spec, so both resolve the same value; the route's second `verifyToken` pass succeeds for the same token the wrapper already accepted. No behavioral gap. Recorded only so a future reviewer does not re-flag the visual mismatch as a bug. (Cosmetic: could align on the shared lowercased constant for consistency — not worth a commit on its own.)

---

## Confirmed-deferred (re-verified this cycle, no change in exposure)
- **SEC-14-02 — LR-upload raw `err.message` disclosure** (`lr/upload/route.ts:277` save-path catch). Recipient is an authenticated admin / valid PAT holder; ENOSPC pre-empted by the `bavail` 507 pre-check (`:185`, verified using `stats.bavail` not `bfree`). Admin-only, minimal. Optional cleanup; deferred.
- **SEC-13-02 — `hasTrustedSameOriginWithOptions` exported** (`request-origin.ts:109`). Zero production callers (`hasTrustedSameOrigin` always uses the strict fail-closed default); test-locked. Deferred.
- **SEC-13-03 — expensive public GET routes** (OG x2, similar) rate-limited at runtime (charged-404) but `lint:public-route-rate-limit` scans only POST/PUT/PATCH/DELETE. Runtime posture correct; CI guard narrower than runtime. Deferred (gate-completeness, not a runtime gap).

## Security Checklist
- [x] No hardcoded secrets (grep clean; only placeholder `.env.example` committed; real env files gitignored)
- [x] All inputs validated (slug/filename/Unicode/code-point/scalar-AST/JSON-shape guards)
- [x] Injection prevention verified (Drizzle params, smart-collection allowlist, safeJsonLd, CSV escape, spawn argv)
- [x] Authentication/authorization verified (Argon2id, HMAC+timingSafeEqual sessions; withAdminAuth + requireSameOriginAdmin + isAdmin on every admin route/action)
- [x] Dependencies audited (`npm audit --omit=dev` → 0 vulnerabilities)
- [x] SSRF / path-traversal / open-redirect / header-injection / CORS / cookie-flags swept — sound
- [x] Cycle-15 fixes verified landed and held (CR-15-01, SEC-15-01, A15-02)

**Bottom line:** No new exploitable vulnerability and no new LOW+ finding. The codebase remains exceptionally hardened. All three cycle-15 security-relevant fixes verified in installed source. All three security lint gates green, `npm audit` clean. Prior deferred items re-confirmed zero-caller / admin-only / latent.
