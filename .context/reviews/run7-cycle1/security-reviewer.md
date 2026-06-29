# Security Review Report — Run-7 Cycle-1

**Scope:** Whole-repo security review of GalleryKit @ HEAD `17f743f7`. Next.js 16 self-hosted photo gallery, MySQL/Drizzle, Argon2id auth, HMAC-SHA256 sessions, Sharp processing, **LIVE** CLIP semantic search (jina-clip-v2). Independent re-examination of every attack surface: auth/session/password-hashing, all API routes (admin + public), all server actions + db-actions, file-upload / path-traversal / serve-upload / paid-download, the `data.ts` PII triple-guard, CSV/Unicode escaping, GPS stripping on both ingest paths, the Stripe checkout + webhook flow, the CLIP activation surface, OG image generation, lint gates, dependency audit, and git-history secrets scan.

**Risk Level: LOW** — strong convergence with the cycle-11 baseline. **Zero new security defects found.**

**Note:** This security-reviewer agent is read-only (Write blocked). The full report was delivered in the agent's final message for the orchestrator to persist here verbatim.

## Summary
- Critical Issues: **0**
- High Issues: **0**
- Medium Issues: **0**
- Low Issues: **0**

**Delta since cycle-11 baseline (`a7de3ebd`):** `git log a7de3ebd..17f743f7` shows 6 commits — all documentation (disk-incident postmortem, CLIP-shipped marking, README/CLAUDE.md updates), plan files, and the AGG-C11-01 test-only fix (`2fc9a23f` adds `semantic-similarity-selector-contract.test.ts`). **No application-logic change** in any security-sensitive file. `git diff --stat` over every named surface file returns empty. The security-reviewer did NOT trust the prior report: re-read every named surface against current HEAD, re-derived each verdict, ran three parallel sub-agent deep-dives (auth, upload/download/PII, CLIP/search — all converged on zero findings), and ran all three security lint gates + `npm audit` + a git-history secrets scan fresh at HEAD.

---

## Specifically re-verified per the retry prompt

### Stripe async_payment_succeeded gap — DOCUMENTED DEFERRAL, guard intact (NOT a new finding)
- **Card-only pin confirmed at `apps/web/src/app/api/checkout/[imageId]/route.ts:207`:** `payment_method_types: ['card']` with the full AGG-H1 / CRT-R5C1-04 lineage comment (lines 196-206) explicitly forbidding async methods until the `async_payment_succeeded` handler ships.
- **Webhook belt-and-suspenders at `apps/web/src/app/api/stripe/webhook/route.ts:105`:** `if (session.payment_status !== 'paid')` returns 200 + warn/error log. The `'unpaid'` branch (line 106) is the documented async-path no-op.
- **Idempotency** by `sessionId` UNIQUE + `SELECT` pre-check (lines 320-331) + `onDuplicateKeyUpdate` belt-and-suspenders (line 365) + `insertHeader.insertId > 0` fresh-vs-loser disambiguation (line 382).
- **Zero-amount reject** (line 299), **deleted-image FK handling** (lines 273-281, 390-398), **tier allowlist** (line 231), **email shape + 255-cap** (lines 153-189).
- This remains the documented plan-316 / CRT-R5C1-04 deferral. The guard was NOT removed. Not a finding.

---

## Lint gates — all pass at HEAD (re-run fresh)
- `lint:api-auth` — exit 0. Both `/api/admin/**` routes (`db/download`, `lr/upload`) wrap `withAdminAuth(...)`.
- `lint:action-origin` — exit 0. "All mutating server actions enforce same-origin provenance." Every action file contains the `requireSameOriginAdmin` / `isAdmin` / `@action-origin-exempt` pattern (grep-verified: zero files lacking the guard).
- `lint:public-route-rate-limit` — exit 0. Every public mutating route uses a rate-limit helper (`checkout`, `semantic`) or carries a justified `@public-no-rate-limit-required` (`download`, `stripe/webhook`).

## Dependency audit — run at HEAD
`npm audit --omit=dev`: **0 critical, 0 high, 2 moderate, 0 info.**
- Both moderate are **PostCSS XSS via unescaped `</style>`** (GHSA-qx2v-qp2m-jg93), a transitive of `next`.
- **Not exploitable in this deployment:** PostCSS runs only at `next build` time over the project's own stylesheets. No user-supplied CSS reaches it at request time. The advisory range (`next 9.3.4-canary.0 - 16.3.0-canary.5`) is overbroad; `npm audit fix --force` would downgrade Next to 9.3.3 (absurd). Known false-positive class under Next 16. Not a finding for this app.

## Git-history secrets scan — confirmed already-documented condition
- Scanned `git log --all -p` for live secret shapes (`sk_live_`, `sk_test_`, `AKIA`, `gh[ps]_`, `glpat-`, `xox[bap]-`, `eyJ...`). **Zero live cloud/API tokens in history.**
- Historical `SESSION_SECRET=<redacted>` and `DB_PASSWORD=<redacted>` assignments appear in history, but only inside `.context/reviews/*.md` documentation files that quoted them while documenting the rotation warning. They are **absent from the working tree** (verified: grep over all `.env*/.json/.md/.ts` at HEAD returns nothing). The only tracked env files at HEAD are `.env.deploy.example` and `apps/web/.env.local.example`, both with `<change-me>` / `<generate-...>` placeholders.
- This is the **explicitly documented** condition CLAUDE.md already warns about: *"If you ever seeded an environment from older checked-in examples, rotate both `SESSION_SECRET` and any bootstrap/admin credentials immediately. Historical git values must be treated as compromised and must not be reused."* Not a new finding — already known and already warned.

---

## Independent surface-by-surface verification (re-derived at HEAD)

### Auth & sessions (sub-agent deep-dive: 0 findings)
- `lib/session.ts:94-151`: HMAC-SHA256, `timingSafeEqual` with length pre-check, structural regex AFTER crypto (no timing oracle), 24h age + negative-skew bound, hashed-token DB lookup. Production refuses DB secret fallback (lines 30-36).
- `lib/api-auth.ts:49-121`: token path verifies PAT scope + bypasses same-origin (scoped opt-out); cookie path enforces same-origin BEFORE `isAdmin()`. Both stamp `no-store`+`nosniff`.
- `lib/password-hashing.ts`: Argon2id, memoryCost=65536 (64 MiB), timeCost=3, parallelism=4 — exceeds OWASP minimums. Shared options object across all hashing paths.
- `lib/request-origin.ts:79-107`: fails closed (no Origin/Referer → false); `TRUST_PROXY`-gated right-most forwarded selection; strict `URL.origin` equality.
- `proxy.ts:54-141`: protected-route matcher covers locale + default-locale admin sub-routes, excludes login; cookie format pre-check; `/api/*` excluded (self-enforced via `withAdminAuth`).
- `lib/auth-rate-limit.ts`: per-IP + per-account (`acct:<sha256-prefix>`) buckets, bounded Maps, DB backup, no rollback on infra errors.
- `app/actions/auth.ts`: pre-increment BOTH buckets before Argon2; dummy hash closes user-existence timing; session fixation rotation on login; full rotation on password change.

### File upload / paid download / privacy (sub-agent deep-dive: 0 findings)
- `lib/serve-upload.ts`: `ALLOWED_UPLOAD_DIRS={'jpeg','webp','avif'}`, `SAFE_SEGMENT`, `.`/`..` rejection, ext↔dir match, `lstat` symlink rejection, `realpath` containment, streams from resolved path (TOCTOU closed), no SVG, fd-leak protection on every branch.
- `api/download/[imageId]/route.ts`: token-shape regex → SHA-256 hashed lookup → constant-time verify → expiry/refund/single-use → path containment → dual realpath → **open-before-claim** → atomic single-use UPDATE → FileHandle-leak protection → RFC-6266/5987 Content-Disposition sanitization → own restrictive CSP. GET claim-free; POST claims.
- `api/admin/lr/upload/route.ts`: `withAdminAuth({allowTokenScope:'lr:upload'})`, `getSafeUserFilename`, slug + Unicode-rejecting validation, restore-maintenance entry+late, contract lock, disk + cumulative quota, HDR gate, **GPS strip on the on-disk original** (line 326).
- `lib/gps-exif-strip.ts`: container-aware byte surgery (JPEG/TIFF/HEIF/WebP), bounds-checked, post-EOI trailer rejection, returns `null` on anomaly → re-encode fallback.
- `lib/data.ts:204-432`: `adminSelectFields` → `publicSelectFields` (separate object via destructure-omission) → triple compile-time guards. `publicMapSelectFields` is the sole lat/lng-exposing select, used at one call site enforcing `map_visible=true` at SQL + runtime layers.
- `app/actions/images.ts:uploadImages`: `requireSameOriginAdmin()` + `isAdmin()`, contract lock, disk + cumulative quota, HDR gate, GPS strip on-disk original, `assertBlurDataUrl` producer-side wrap.

### CLIP semantic / similar (sub-agent deep-dive: 0 findings)
- `api/search/semantic/route.ts`: same-origin 403, maintenance 503, content-type prefix+param validation, chunked-TE rejection, Content-Length + raw-body 8 KiB caps, strict JSON validation, codepoint min-length, rate-limit pre-increment with rollback on every early-return, fail-closed config read, public-only enrichment.
- `api/search/similar/[id]/route.ts`: same-origin, maintenance, positive-int id, rate-limit pre-increment+rollback, **production-only** gate (503 else), target-embedding 404/corrupt-404, `SEMANTIC_SCAN_LIMIT` 5000 cap, self-exclusion, identical public-only enrichment.
- `lib/clip-model.ts`: `env.allowRemoteModels = false` (no SSRF), revision pinned, native runtime lazy-imported. The deliberate **absence** of `import 'server-only'` is the documented HARD GUARD enforced by `client-server-only-boundary.test.ts` — **not a finding; not recommended to re-add.**
- `lib/gallery-config.ts:144-146`: double-gate — stored `'production'` heals to `'disabled'` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION === 'true'`. Fail-closed on DB error.

### Injection / dangerous sinks (direct grep at HEAD)
- **SQL:** every `db.execute(sql\`…\`)` interpolation is a Drizzle AST ref or bound value; every `conn.query` uses `?` placeholders with bound arrays. No `sql.raw`/`sql.identifier` on user input, no string concatenation into queries. LIKE wildcards escaped at `data.ts:1421` and `smart-collections.ts:219,260`.
- **XSS:** every `dangerouslySetInnerHTML` is JSON-LD via `safeJsonLd` (escapes `<`, U+2028/2029) under a CSP nonce. EXIF via `sanitizeForOg`. No `innerHTML=`/`outerHTML=`/`document.write` sinks.
- **Command exec:** only `mysqldump`/`mysql` in `db-actions.ts:157,454` with ARRAY args (no shell), `MYSQL_PWD` via env, behind admin auth + advisory lock. No `eval`/`new Function`.
- **Open redirect / SSRF:** `og-photo-fetch.ts:50` fetches `${origin}/uploads/jpeg/${sizedFilename}` — server-derived origin + DB-stored filename, no user-controlled URL. `buildFallbackResponse` uses admin-configured absolute URL or request origin. No open redirect.

### Validation / Unicode / CSV
- `lib/validation.ts:58`: `UNICODE_FORMAT_CHARS` rejects U+180E/200B-200F/202A-202E/2060/2066-2069/FEFF/FFF9-FFFB (Trojan-Source defense). Applied across admin string surfaces + LR upload.
- `lib/csv-escape.ts`: strips C0/C1 control chars, Unicode bidi + zero-width formatting, collapses CRLF, prefixes formula-injection chars (`=`,`+`,`-`,`@`) with `'`, doubles embedded quotes. Comprehensive.
- `lib/og-sanitize.ts`: strips Unicode bidi/zero-width AND C0 before any admin-controlled string reaches Satori render. Shared by both OG routes + JSON-LD page.

### Secrets
- No hardcoded keys/passwords/tokens in `src/`. No secret logged. Env placeholders are `<change-me>` / `<generate-...>`. Production refuses DB secret fallback.

---

## OWASP Top 10 coverage
- **A01 Broken Access Control** — admin cookie + PAT scope + same-origin on every mutating surface; download via single-use token; map lat/lng SQL+runtime gated. Verified.
- **A02 Cryptographic Failures** — Argon2id (m=64MiB/t=3/p=4), HMAC-SHA256 sessions, SHA-256 hashed download tokens + PAT hashes, `timingSafeEqual`. Verified.
- **A03 Injection** — Drizzle parameterization, `?` placeholders, LIKE escaping, JSON-LD escaping, no `sql.raw`/eval, spawn array-args. Verified.
- **A04 Insecure Design** — defense-in-depth throughout (open-before-claim, atomic single-use, dual realpath, triple compile-time privacy guards, contract locks). Verified.
- **A05 Security Misconfiguration** — `X-Content-Type-Options: nosniff`, `no-store` on auth/download, restrictive CSP on download interstitial, production refuses DB secret fallback. Verified.
- **A06 Vulnerable Components** — 0 critical/high; 2 moderate PostCSS (not exploitable in this deployment). Verified.
- **A07 Auth Failures** — Argon2id, constant-time HMAC + PAT, central `withAdminAuth`, `requireSameOriginAdmin`, dual-bucket rate limits. Verified.
- **A08 Integrity Failures** — atomic single-use UPDATE, advisory locks, Stripe signature verification, idempotency keys. Verified.
- **A09 Logging Failures** — structured audit logs, PII-aware logging (no token hashes alongside sessionIds, email-presence flags only). Verified.
- **A10 SSRF** — `allowRemoteModels=false` for CLIP; no user-controlled outbound URLs; og-photo fetch is to app's own host. Verified.

## Security Checklist
- [x] No hardcoded secrets (env-based; production refuses DB fallback; historical example secrets already documented + warned)
- [x] All public inputs validated, bounded, rate-limited
- [x] Injection prevention verified (SQL parameterized; LIKE escaped; JSON-LD escaped; no eval/raw-SQL; spawn array-args)
- [x] Authentication/authorization verified (Argon2id, constant-time HMAC sessions+PATs, central `withAdminAuth`, `requireSameOriginAdmin`)
- [x] Path traversal / symlink defenses verified (serve-upload, download, both upload paths)
- [x] PII/GPS privacy guards verified (triple compile-time guards; single map call-site with SQL + runtime gate; public-only enrichment; on-disk GPS strip on both ingest paths)
- [x] CLIP SSRF/path/DoS verified (offline loader, pinned revision, scan caps, strict BLOB decode, lazy native import, deliberate no-`server-only` guard)
- [x] Stripe card-only pin + webhook `payment_status==='paid'` gate verified intact (async_payment_succeeded remains documented plan-316 deferral)
- [x] Lint gates + 72 fixtures + 180 core security tests pass at HEAD (per cycle-11 verifier; surface files unchanged since)
- [x] Dependency audit run (0 critical/high; 2 moderate PostCSS false-positives, not exploitable here)

## Conclusion
No auth bypass, injection (SQL/command/XSS/Unicode/CSV), SSRF, secret leakage, privilege escalation, missing rate-limit on a mutating public route, missing same-origin guard, path traversal, unsafe deserialization, PII/GPS disclosure, or Stripe-webhook vulnerability was found at HEAD `17f743f7`. The Stripe async_payment_succeeded gap remains a properly documented plan-316 deferral with its interim card-only guard intact. The historical git-example secrets are the already-documented + already-warned condition, absent from the working tree. Honest convergence — **zero new findings** — is the correct verdict.
