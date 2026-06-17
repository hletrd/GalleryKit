# Security Review Report — Cycle 11 (run-6)

**Scope:** Whole-repo security review of GalleryKit @ HEAD `a7de3ebd`. Next.js 16 self-hosted photo gallery, MySQL/Drizzle, Argon2 auth, HMAC-SHA256 sessions, Sharp processing, **LIVE** CLIP semantic search (jina-clip-v2). Independent re-examination of every attack surface: all API routes (admin + public, esp. search/semantic + search/similar + admin/lr/upload), all server actions + db-actions, auth core (password-hashing/session/proxy/auth-rate-limit), file-upload / path-traversal / serve-upload, the data.ts PII guard, CSV/Unicode escaping, GPS stripping, the paid Stripe flow, and the CLIP activation surface.

**Risk Level: LOW** — strong convergence confirmed. **Zero real security defects found.**

## Summary
- Critical Issues: **0**
- High Issues: **0**
- Medium Issues: **0**
- Low Issues: **0**

HEAD `a7de3ebd` is one commit past the cycle-10 review baseline (`0502ae86`). The only intervening functional change was an nginx body-cap raise for the LR upload route (`71dcd09f`) plus a test addition and doc edits — **no application-logic changed**. I did NOT trust the prior report: I re-read every named surface against current HEAD and independently re-derived each verdict.

---

## Lint gates — all pass, all reflect reality (re-run at HEAD)
- `lint:api-auth` — both `/api/admin/**` routes (`db/download`, `lr/upload`) wrap `withAdminAuth(...)`. OK.
- `lint:action-origin` — every mutating action stores `requireSameOriginAdmin()` and early-returns; read-only exports carry `@action-origin-exempt`. "All mutating server actions enforce same-origin provenance."
- `lint:public-route-rate-limit` — every public mutating route uses a rate-limit helper (`checkout`, `semantic`) or carries a justified `@public-no-rate-limit-required` (`download`, `stripe/webhook`).

## Tests — green at HEAD
- Security fixtures (`privacy-fields`, `map-privacy`, `check-api-auth`, `check-action-origin`, `check-public-route-rate-limit`): **72/72 pass**.
- Core security/crypto/path/PII suite (session, request-origin, admin-tokens, api-auth headers, serve-upload, strip-gps, stripe-webhook, semantic/similar routes, clip offline-load+paths, download method-contract, backup-download, og-sanitize, gallery-config-semantic-production): **180 passed, 2 skipped** (skips = network-dependent CLIP integration tests, expected in sandbox).

---

## Independent surface-by-surface verification

### CLIP semantic / similar (the LIVE feature) — HARD GUARDS intact
- `api/search/semantic/route.ts:98-341` (POST): same-origin 403, maintenance 503, content-type prefix+param validation, chunked-TE rejection, Content-Length + raw-body 8 KiB caps, strict JSON-shape validation, codepoint min-length, **rate-limit pre-increment with rollback on every early-return**, fail-closed config read. Enrichment SELECT (lines 291-313) is explicit **public-only** columns — no GPS, no `filename_original`/`user_filename`, gated `processed=true`.
- `api/search/similar/[id]/route.ts:57-241` (GET): same-origin, maintenance, positive-int id, rate-limit pre-increment+rollback, **production-only** gate (503 else), target-embedding 404/corrupt-404, `SEMANTIC_SCAN_LIMIT` 5000 cap, self-exclusion, identical public-only enrichment.
- `lib/clip-model.ts:88-89`: `env.allowRemoteModels = false` (no runtime network → no SSRF), revision pinned (`JINA_CLIP_REVISION`), native runtime lazy-imported inside `getModelBundle()`. The deliberate **absence** of `import 'server-only'` (lines 17-27) is the documented HARD GUARD — **not a finding; I did not recommend re-adding it.**
- `actions/embeddings.ts:48-59`: `isAdmin()` + `requireSameOriginAdmin()` + per-admin hourly rate-limit + mode-aware, unwired from UI.
- Intentional gates respected (NOT findings): same-origin 403, `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, `allowRemoteModels=false`, revision pin, `disabled` default + production→disabled healing.

### Auth & sessions
- `lib/session.ts:94-151`: HMAC-SHA256, `timingSafeEqual` (length pre-checked), structural regex AFTER crypto (no timing oracle), 24 h age + negative-skew bound, hashed-token DB lookup, expired-session purge. Production REFUSES DB secret fallback (lines 30-36).
- `lib/api-auth.ts:49-121`: token path verifies scope + bypasses same-origin (PAT); cookie path enforces same-origin BEFORE `isAdmin()`; both stamp `no-store`+`nosniff`.
- `lib/request-origin.ts:79-107`: fails closed (no Origin/Referer → false); `TRUST_PROXY`-gated right-most forwarded selection; strict `URL.origin` equality.
- `proxy.ts:54-141`: protected-route matcher covers locale + default-locale admin sub-routes, excludes login; cookie format pre-check (≥100 chars, 3 segments); crypto deferred to actions; `x-gk-admin-render` self-reflective only; `/api/*` excluded (self-enforced via `withAdminAuth`).

### File upload / paid download (GPS-leak-sensitive)
- `lib/serve-upload.ts:127-309`: `ALLOWED_UPLOAD_DIRS` + `SAFE_SEGMENT` + length cap + `.`/`..` rejection + ext↔dir match + `lstat` symlink rejection + `realpath` containment + streams from resolved path (TOCTOU closed) + no SVG + fd-leak protection.
- `api/download/[imageId]/route.ts`: token-shape regex → hashed lookup → constant-time verify → expiry/refund/single-use → path containment → symlink rejection + dual realpath → **open-before-claim** → atomic single-use UPDATE → FileHandle-leak protection on every branch → RFC-6266/5987 Content-Disposition sanitization → own restrictive CSP. Claim-free GET; claim only on POST.
- `api/admin/lr/upload/route.ts:57-485`: `withAdminAuth({allowTokenScope:'lr:upload'})`, `getSafeUserFilename`, slug + Unicode-rejecting validation, restore-maintenance entry+late, contract lock, disk + cumulative quota with idempotent settle, HDR gate, **GPS strip on the on-disk original** (line 326), generic errors.
- `lib/gps-exif-strip.ts`: container-aware byte surgery (JPEG/TIFF/HEIF/WebP), never decodes pixels, bounds-checked, returns `null` on anomaly → re-encode fallback.

### DB layer / PII guard
- `lib/data.ts:204-432`: `adminSelectFields` → `publicSelectFields` (separate object via destructure-omission) → triple compile-time guards (`_privacyGuard`, `_mapPrivacyGuard`, `_largePayloadGuard`). `publicMapSelectFields` is the sole lat/lng-exposing select, used at one call site enforcing `map_visible=true`. `searchImages:1421` escapes LIKE wildcards; bounds length 2–200.

### Injection / dangerous sinks
- **SQL:** no `sql.raw`/`sql.identifier` on user input, no concatenation-into-query. Every `db.execute(sql\`…\`)` interpolation is a Drizzle AST ref or bound value (`${presentedHash}`, `${row.id}`, `${normalizedSegment}`); every `conn.query` uses `?` placeholders with bound arrays. Parameterized end-to-end.
- **XSS:** every `dangerouslySetInnerHTML` is JSON-LD via `safeJsonLd` (escapes `<`, U+2028/2029) under a CSP nonce — including the `galleryLdJson` sites in `year/[year]:92` and `timeline:102`. EXIF via `sanitizeForOg`.
- **Command exec:** only `mysqldump`/`mysql` in `db-actions.ts:157,454` with ARRAY args (no shell), `MYSQL_PWD` via env, `HOME` excluded, stderr sanitized. Backup filename regex-validated before path use, so the Content-Disposition interpolation cannot carry quotes. No `eval`/`new Function`.
- **Stripe webhook:** mandatory constant-time signature verify before DB work, `payment_status==='paid'` gate, tier allowlist, email shape + length validation, zero-amount rejection, `sessionId` idempotency with dup-key-loser disambiguation, deleted-image FK handled, PII-aware logging.
- **Checkout:** per-IP rate-limit pre-increment+rollback, strict integer parse, tier allowlist, `priceCents<=0` rejection.

### Validation / Unicode
- `lib/validation.ts:58`: `UNICODE_FORMAT_CHARS` rejects U+180E/200B-200F/202A-202E/2060/2066-2069/FEFF/FFF9-FFFB (Trojan-Source defense). `safeInsertId`, slug/filename guards present. Applied across admin string surfaces + LR upload.

### Secrets
- No hardcoded keys/passwords/tokens in `src/`. No secret logged.

## Security Checklist
- [x] No hardcoded secrets (env-based; production refuses DB fallback)
- [x] All public inputs validated, bounded, rate-limited
- [x] Injection prevention verified (SQL parameterized; LIKE escaped; JSON-LD escaped; no eval/raw-SQL; spawn array-args)
- [x] Authentication/authorization verified (Argon2id, constant-time HMAC sessions+PATs, central `withAdminAuth`, `requireSameOriginAdmin`)
- [x] Path traversal / symlink defenses verified (serve-upload, download, backup-download)
- [x] PII/GPS privacy guards verified (triple compile-time guards; single map call-site with SQL gate; public-only enrichment; on-disk GPS strip on both ingest paths)
- [x] CLIP SSRF/path/DoS verified (offline loader, pinned revision, scan caps, strict BLOB decode, lazy native import)
- [x] Lint gates + 72 fixtures + 180 core security tests pass at HEAD
- [ ] Dependency audit — `npm audit` not run (read-only/network-restricted sandbox); recommend CI continues to run it. Process gap, not a finding.

## Conclusion
No auth bypass, injection (SQL/command/XSS/Unicode/CSV), SSRF, secret leakage, privilege escalation, missing rate-limit on a mutating public route, missing same-origin guard, path traversal, unsafe deserialization, or PII/GPS disclosure was found at HEAD `a7de3ebd`. Honest convergence — **zero findings** — is the correct verdict.

**Note:** The original cycle-11 security agent ran read-only and delivered this report in its final message (Write blocked); it has been persisted here by the orchestrator verbatim.
