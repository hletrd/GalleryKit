# Security Review Report — Cycle 10 (run-6)

**Scope:** Whole-repo security review of GalleryKit @ HEAD `0502ae86`. Next.js 16 self-hosted photo gallery, MySQL/Drizzle, Argon2 auth, HMAC-SHA256 sessions, Sharp processing, **LIVE** CLIP semantic search (jina-clip-v2). Focused on the CLIP activation surface (hardened in cycles 8–9) plus a full re-sweep of all API routes, server actions, auth, file upload, DB backup/restore, paid-download, privacy guards, validation, and SQL surfaces.

**Risk Level: LOW** — strong convergence confirmed. **Zero real security defects found.**

## Summary
- Critical Issues: **0**
- High Issues: **0**
- Medium Issues: **0**
- Low Issues: **0**

This is the expected outcome after 9 prior review cycles. The CLIP surface that was the focus of recent cycles is correctly hardened, and the previously-reviewed paid-flow / auth / upload surfaces remain intact at current HEAD. No marginal/speculative findings are reported, per the cycle-10 mandate.

---

## What was verified (evidence)

### Lint gates (all pass)
- `lint:api-auth` — every `/api/admin/**` HTTP-method export wraps `withAdminAuth(...)`. (download, lr/upload OK)
- `lint:action-origin` — every mutating server action stores `requireSameOriginAdmin()` and early-returns; read-only exports carry `@action-origin-exempt`. "All mutating server actions enforce same-origin provenance."
- `lint:public-route-rate-limit` — every public mutating route uses a rate-limit helper or carries a justified `@public-no-rate-limit-required` tag.
- Security-critical fixtures: `privacy-fields`, `map-privacy`, `check-api-auth`, `check-action-origin`, `check-public-route-rate-limit` — **72/72 pass**.

### CLIP semantic / similar surface (cycle 8–9 focus) — HARD GUARDS confirmed intact
- `api/search/semantic/route.ts` (POST): same-origin 403 guard (`hasTrustedSameOrigin`), restore-maintenance 503, content-type prefix+param validation, chunked-TE rejection, `Content-Length` + raw-body 8 KiB caps, JSON shape validation, codepoint-aware min-length, rate-limit **pre-increment with rollback** on every early-return before expensive work (`preIncrementSemanticAttempt`/`rollbackSemanticAttempt`), fail-closed config read. `semantic_search_mode` default `disabled` → 503. Enrichment SELECT lists explicit **public-only** columns (no GPS / `filename_original` / `user_filename`).
- `api/search/similar/[id]/route.ts` (GET): same-origin, maintenance, positive-int id validation, rate-limit pre-increment+rollback, **production-only** gate, target-embedding 404/corrupt-404, `SEMANTIC_SCAN_LIMIT` (5000) hard cap, identical public-only enrichment SELECT.
- `lib/clip-model.ts`: `env.allowRemoteModels = false` (no SSRF — runtime never hits network), revision pinned to immutable 40-hex SHA (`JINA_CLIP_REVISION`), native runtime imported lazily. Public routes call only `embedTextReal` (text), never the image encoder.
- `lib/clip-paths.ts`: `clipModelArtifactDir` asserts 2-segment repo id + 40-hex revision (rejects branch/tag like `main`) — no path mis-nesting. `resolveClipModelsRoot` honors absolute bind-mount verbatim.
- `scripts/download-clip-models.ts`: SHA-256 manifest verify + delete-on-mismatch (poisoned-weight defense); HTTPS + pinned revision; never runs at runtime.
- `lib/clip-embeddings.ts` `decodeEmbeddingColumn`: strict `length === EMBEDDING_BYTES` check before any conversion → malformed BLOB returns `null` and is skipped. No buffer over-read / DoS.
- `actions/embeddings.ts` `backfillClipEmbeddings`: `isAdmin()` + `requireSameOriginAdmin()` + per-admin hourly rate limit; mode-aware; unwired from UI (sidecar canonical).
- **Intentional gates respected (NOT findings):** the same-origin 403 on `/api/search/semantic`; `SEMANTIC_SEARCH_ALLOW_PRODUCTION` operator gate; `allowRemoteModels=false`; revision pin; code default `semantic_search_mode='disabled'`. `gallery-config.ts` correctly HEALS a stored `production` → `disabled` unless the operator env is set (AGG-C10-02).

### Authentication & sessions
- `lib/session.ts`: HMAC-SHA256 tokens, `timingSafeEqual` constant-time compare (length-checked first), structural regex checks placed AFTER crypto (no timing oracle), 24 h age + skew bound, hashed-token DB lookup, expired-session purge. Production refuses DB-stored secret fallback (`SESSION_SECRET` env required, min 32 chars).
- `lib/password-hashing.ts`: Argon2id, memoryCost 64 MiB, timeCost 3, parallelism 4 — exceeds OWASP.
- `lib/admin-tokens.ts` (PAT): well-formed pre-check, hashed-by-hash DB lookup (plaintext never in a query param), `timingSafeEqual` digest compare, expiry enforced, fail-closed if table missing.
- `lib/api-auth.ts` `withAdminAuth`: centrally enforces same-origin for the cookie path AND token-scope for the PAT path; adds `no-store` + `nosniff` to all responses.
- `lib/request-origin.ts`: fails closed by default (requires Origin/Referer match); `TRUST_PROXY`-gated forwarded-host/proto with right-most trusted-hop selection.
- `proxy.ts`: protected-route matcher covers locale-prefixed + default-locale admin sub-routes, excludes login; cookie format pre-check (≥100 chars, 3 non-empty segments); full crypto validation deferred to actions; per-request CSP nonce; `x-gk-admin-render` header is self-reflective only.

### File upload / paid download (GPS-leak-sensitive)
- `api/admin/lr/upload/route.ts`: `withAdminAuth` (PAT scope `lr:upload`), filename sanitization (`getSafeUserFilename`), slug + Unicode-rejecting title/description validation, restore-maintenance + upload-contract lock, disk-space + cumulative quota with idempotent settle, `allow_hdr_ingest` gate, **GPS strip on disk** when `strip_gps_on_upload`, generic errors.
- `api/download/[imageId]/route.ts`: token-shape regex pre-check, hashed lookup, constant-time `verifyTokenAgainstHash`, expiry/refund/single-use checks, path-traversal containment (`path.resolve` + `startsWith(dir+sep)`), symlink rejection (`lstat`) + `realpath` double-check, **open-before-claim** (missing file never burns token), atomic single-use UPDATE, FileHandle-leak protection on every branch, RFC-6266/5987 Content-Disposition sanitization, own restrictive CSP on interstitial HTML.
- `data.ts` privacy: dual compile-time guards (`_privacyGuard`, `_mapPrivacyGuard`); `publicMapSelectFields` is used at exactly ONE call site (`getMapImages`) which enforces `map_visible=true` at the SQL layer (inner JOIN) AND a runtime row-level assertion. `searchImages` / semantic+similar enrichment use explicit public-only field sets.

### Injection / dangerous sinks
- SQL: **no** `sql.raw`, `sql.identifier`, string-concatenation-into-SQL, or template-literal-as-query-string anywhere in `src/`. All raw SQL uses `?` placeholders or Drizzle auto-parameterizing `sql\`\``. `searchImages` escapes LIKE wildcards (`/[%_\\]/g → \\$&`).
- `dangerouslySetInnerHTML`: only JSON-LD, serialized via `safeJsonLd` (escapes `<` → `<`, U+2028/U+2029) under a CSP nonce; EXIF values pass `sanitizeForOg`. `</script>` breakout neutralized.
- DB backup/restore (`db-actions.ts`): `isAdmin` + same-origin + maintenance gate + advisory lock on a dedicated pinned connection; credentials via `MYSQL_PWD`/`MYSQL_*` env (not `/proc/cmdline`); `HOME` excluded; header validation + dangerous-SQL scan + `--one-database`; stderr sanitized.
- `admin-users.ts`: parameterized raw SQL, last-admin advisory lock, self-delete prevention, Argon2, rate-limit pre-increment, audit detach before delete.
- Secret logging: scan found no plaintext password/secret/token logged (the `LOG_PLAINTEXT_DOWNLOAD_TOKENS` path is documented opt-in; other hits log error objects/IPs only).
- `getClientIp`: `TRUST_PROXY`-gated XFF with hop-count validation + IP normalization; warns on misconfiguration; never fails open on rate limits.

### Validation
- `lib/validation.ts`: Unicode bidi/invisible-char rejection (`UNICODE_FORMAT_CHARS`), slug/filename traversal guards, `safeInsertId` BigInt overflow guard. Applied across all admin-controlled persistent string surfaces.

## Security Checklist
- [x] No hardcoded secrets (env-based; production refuses DB secret fallback)
- [x] All public inputs validated (length/shape/codepoint), bounded, and rate-limited
- [x] Injection prevention verified (SQL parameterized; LIKE escaped; JSON-LD `<`-escaped; no eval/raw-SQL)
- [x] Authentication/authorization verified (Argon2id, constant-time HMAC sessions + PATs, central `withAdminAuth`, `requireSameOriginAdmin` on every mutating action)
- [x] Path traversal / symlink defenses verified on every fs-serving route
- [x] PII/GPS privacy guards verified (dual compile-time guards + single map call-site with SQL+runtime enforcement)
- [x] CLIP surface SSRF/path/DoS verified (offline loader, pinned revision, scan caps, strict BLOB decode)
- [x] Lint gates + 72 security fixtures pass
- [ ] Dependency audit — see note below

## Dependency audit note
`npm audit` was not executed in this read-only pass (read-only constraints + network-restricted sandbox). This is a process gap, not a finding. Recommend the standard `npm audit --workspace=apps/web` continue to run in CI; no application-code vulnerability depends on it.

## Conclusion
No auth bypass, injection, SSRF, secret leakage, privilege escalation, missing rate-limit on a mutating public route, path traversal, unsafe deserialization, missing same-origin guard, or PII disclosure was found at HEAD `0502ae86`. The repository is in a strongly-converged security state.
