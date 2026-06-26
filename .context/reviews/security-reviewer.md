# Security Review — GalleryKit Cycle 14 (R14C14)

**HEAD:** 39cfa889 · **Agent:** security-reviewer (opus) · **Risk level: LOW** (mature, heavily-hardened; no exploitable defect this cycle).

## Summary
| Severity | Count | Notes |
|----------|-------|-------|
| CRITICAL | 0 | `npm audit --omit=dev` → 0 vulnerabilities |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW (new) | 1 | SEC-14-01 — `bfree`→`bavail` parity gap on the LR-upload sibling + co-located raw-fs-error path disclosure |
| Confirmed-deferred | 3 | SEC-13-02, SEC-13-03, TRC-13-05 — all re-verified, zero production callers |

## LOW — new this cycle

### SEC-14-01 — `bfree` vs `bavail` disk pre-check diverges between the two upload ingress paths — HIGH confidence
**File:** `apps/web/src/app/api/admin/lr/upload/route.ts:180`
**Category:** OWASP A09-adjacent (operational reliability) + minor A01 info-disclosure.
The cycle-13 fix corrected the browser path (`images.ts:211` → `bavail`) but missed the structurally identical LR-route sibling. Exactly two `statfs` call sites exist and they now disagree. On a near-full disk (only root-reserved blocks remaining) the LR upload passes the 1 GiB pre-check then fails at `fs.writeFile` with `ENOSPC`.
**Secondary (same branch):** `lr/upload/route.ts:272-273` returns the raw `err.message` to the client on the failure path, which for a Node fs error includes the absolute upload-directory path. Recipient is an authenticated admin/token holder, so impact is minimal, but it is inconsistent with the route's generic DB-error arm (line 409) and the browser path.
**Fix:** line 180 `stats.bfree` → `stats.bavail`; optionally replace the raw `err.message` return with a generic message + server-side log.

## Confirmed-deferred (re-verified, no change in exposure)
- **SEC-13-02 / AGG-R12-09** — `hasTrustedSameOriginWithOptions` exported (`request-origin.ts:109`). Zero production callers; `hasTrustedSameOrigin` (fail-closed) is the only path used; `lint:action-origin` + `lint:api-auth` fence every mutating surface; test-locked. Deferred.
- **SEC-13-03** — expensive public GET routes (`api/og/route.tsx`, `api/og/photo/[id]`, `api/search/similar/[id]`) rate-limited at runtime (`preIncrement*`) but `lint:public-route-rate-limit` only scans POST/PUT/PATCH/DELETE. Runtime posture correct; CI guard narrower. Deferred.
- **TRC-13-05 / AGG-R12-10** — `BoundedMap.entries()` raw iterator (`bounded-map.ts:116`). Zero callers. Deferred.

## Surfaces audited and sound (no findings)
- **Authn/Authz:** Argon2id (m=64 MiB, t=3, p=4); module-init dummy-hash timing equalization; HMAC-SHA256 sessions with `timingSafeEqual` after length-guard; session fixation prevented (transactional insert-then-delete); full rotation on password change; `SESSION_SECRET` refuses DB fallback in production; `withAdminAuth` enforces same-origin + `isAdmin()` on both admin API routes; `requireSameOriginAdmin()` on every mutating action (grep-confirmed); both CI auth gates back this.
- **Admin PATs:** 256-bit token, SHA-256 digest only stored, constant-time compare, fail-closed on missing table, expiry honored, per-user scope, edge-rate-limited.
- **Injection:** all raw SQL uses Drizzle parameterized `sql` templates; smart-collections uses strict column allowlist + parameterized values + LIKE-wildcard escaping + IN-length caps.
- **XSS/JSON-LD:** `safe-json-ld.ts` escapes `<`,`>`,U+2028/2029; nonce-based prod CSP, no `unsafe-inline`; EXIF strings pass `sanitizeForOg`; admin strings reject bidi/zero-width.
- **SSRF/open-redirect:** OG routes pin internal fetch to `siteConfig.url` and fail closed (404) when unset; login/logout redirect only to fixed locale-validated `/admin*` paths.
- **Path traversal/upload:** `db/download` uses filename validation + `path.resolve` containment + `lstat` symlink rejection + realpath TOCTOU close; uploads use `crypto.randomUUID` filenames; Sharp `limitInputPixels`; nginx 404s `/uploads/original/`.
- **GPS/PII:** `gps-exif-strip.ts` bounds-checked fail-closed walkers; `publicSelectFields` derived-by-omission with compile-time `_SensitiveKeysInPublic` guard; Atom-feed username disclosure (SEC-13-01) confirmed fixed (`data.ts:798` literal NULL).
- **Rate-limit/IP trust:** pre-increment-before-verify (TOCTOU-safe), DB-backed login bucket, nginx overwrites XFF/X-Real-IP with `$remote_addr`.
- **Deps:** `npm audit --omit=dev` → 0 vulnerabilities.

**Bottom line:** No new exploitable vulnerability. One LOW availability/correctness parity gap (SEC-14-01). All deferred security items re-confirmed zero-caller/latent.
