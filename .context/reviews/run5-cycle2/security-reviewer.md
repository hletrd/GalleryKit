# Security Review — Run-5 Cycle-2 (SECURITY-REVIEWER lane)

**Reviewer angle:** OWASP Top 10, authn/authz on every route + server action, secrets, injection, path traversal, SSRF, rate limiting, session handling, unsafe patterns.
**Repo:** `/Users/hletrd/flash-shared/gallery` (GalleryKit — Next.js 16 App Router, React 19, MySQL 8 + Drizzle, Argon2 + HMAC-SHA256 sessions, Sharp, Docker).
**Date:** 2026-06-12.
**Diff scrutinized:** `git diff b7d4729b..HEAD` (20 commits, cycle-1 landings).
**Suppression context honored:** plan-315 (MEDIUM), plan-316 (LOW/docs), plan-317 (deferred + verified-non-issue + documented-intentional). Items in those plans are NOT re-reported.

## Risk Level: LOW

This codebase is exceptionally hardened. Every mutating surface carries dual defense-in-depth (`isAdmin()` + `requireSameOriginAdmin()`), all four security lint gates are wired (`lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`, ESLint), and the security-relevant lineage is extensively documented and test-locked. The cycle-1 diff introduced **no new weaknesses** — the fresh changes (isAdmin in `retryFailedImage`, fail-closed `semantic_search_mode='stub'`, `[AUTO]` title strip, unlink-original-on-detection-failure, keyset backfill) are all net security improvements.

## Summary
- **CRITICAL:** 0
- **HIGH:** 0
- **MEDIUM:** 0 (new) — all candidate MEDIUMs already planned (plan-315) or accepted residuals (plan-317)
- **LOW:** 2 (both defense-in-depth hardening; neither exploitable today)
- **Informational / verified-clean:** see appendix

No finding rises above LOW after suppression of already-planned items. The two LOWs below are genuinely new (not in plan-315/316/317) but are belt-and-suspenders nits, not vulnerabilities.

---

## Cycle-1 diff verdict (fresh changes b7d4729b..HEAD)

All scrutinized; all sound:

- **`retryFailedImage` (images.ts:1042)** — TRC-R5C1-18 fix correct: `requireSameOriginAdmin()` result now wrapped as `{ error }` AND `isAdmin()` added. Previously the function returned the bare `originError` string and had NO `isAdmin()` gate — this was a real authz hole now closed. Confirmed both gates present and the return shape matches the action contract.
- **`semantic/route.ts` (CRT-R5C1-01 / COR-R5C1-04)** — validator now rejects `'production'` (`gallery-config-shared.ts:167`) AND route hard-gates on `semanticMode !== 'stub'` (defense-in-depth for stale DB rows). Rate-limit pre-increment moved BEFORE config read with `rollbackSemanticAttempt(ip)` on the 503 / 500 / 500 early-returns; success and enrichment-failure paths stay charged. Pattern-2 consistent, no free config-probing oracle. Correct.
- **`photo-title.ts` (CRT-R5C1-02)** — `[AUTO]` stub prefix stripped from visible titles / `<title>` / OG via an anchored, regex-escaped prefix match. The raw `alt_text_suggested` is still available for `alt=""`. Empty-after-strip falls through to generic fallback. No ReDoS (fixed literal prefix, single `\s*`). Correct.
- **`process-image.ts` saveOriginal (BUG-R5C1-02)** — post-write work wrapped in try/catch that `fs.unlink`s the orphaned original before re-throw. No traversal risk (path is the just-written original). Correct.
- **`admin-backfill-runner.ts` (PERF-R5C1-01)** — keyset pagination; cursor is the integer `id` from a parameterized Drizzle `sql` template (`AND id > ${cursor}` / `LIMIT ${BATCH_SIZE}`), both bound parameters. No injection. Lock lifetime/`finally` release preserved. Correct.
- **migration 0021 + migrate.js reconcile** — `CREATE INDEX` DDL only; index names/columns are static literals. `_journal.json` `when=1781183604120` is strictly greater than the prior max (`1779494400001`), so the migrator will not silently skip it. Correct.
- **feature-flags.ts deletion (CRT-R5C1-03)** — dead `HDR_FEATURE_ENABLED` scaffolding removed; no behavioral surface. Correct.

---

## LOW findings (new; defense-in-depth only)

### SEC-R5C2-01 — `verifySessionToken` accepts any HMAC-valid token whose timestamp parses, even with a non-numeric `random` segment
- **File:** `apps/web/src/lib/session.ts:99-128`
- **Class:** Input validation (defense-in-depth) — A07 Auth.
- **Detail:** `verifySessionToken` splits on `:` into exactly 3 parts and HMAC-verifies `${timestamp}:${random}`. The `random` segment is never shape-checked (expected: 32 hex chars from `randomBytes(16)`). Because the signature covers `random`, an attacker cannot forge a valid token without the secret, so this is NOT exploitable — the HMAC is the real gate. But the middleware (`proxy.ts:102-103`) and this verifier both accept structurally-odd-but-signed tokens. The only token-minting path is `generateSessionToken`, which always emits 32-hex random, so in practice every accepted token is well-formed.
- **Exploit scenario:** None reachable — forging requires the `SESSION_SECRET`. Purely a strictness gap.
- **Fix (optional):** After signature verification, assert `/^[0-9a-f]{32}$/.test(random)` and `/^[0-9a-f]{64}$/.test(signature)` to reject any token shape the minter would never produce. Cheap, post-crypto, no behavior change for legitimate tokens.
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed (non-exploitable hardening).

### SEC-R5C2-02 — `og/photo` 302 fallback `Location` is attacker-influenced via admin `og_image_url`, with no scheme allowlist at emit time
- **File:** `apps/web/src/app/api/og/photo/[id]/route.tsx:246-258` (`buildFallbackResponse`, the `ogImageUrl` branch)
- **Class:** Open-redirect surface (A01/A10-adjacent), admin-controlled.
- **Detail:** When a photo/derivative is unavailable, the route emits `302 Location: ogImageUrl` where `ogImageUrl = seo.og_image_url`. That value is admin-controlled (set via SEO settings, which DO validate via `seo-og-url.ts`). The 302 itself does not re-validate the scheme at emit time, so it relies entirely on the write-time validator being airtight. This is adjacent to — but distinct from — the already-planned **SEC-R5C1-01** (which addresses the `new URL(req.url).origin` Host-derivation on the *internal fetch* and the *no-fallback* 302, lines 114 + 262) and **SEC-R5C1-04** (plan-316 Unit D, which hardens `seo-og-url.ts` normalization). Because SEC-R5C1-04 is already tightening the write-time validator, the residual here is fully covered by planned work; flagged only to confirm the emit-site relies on that validator and to recommend an emit-time `startsWith('https://')||startsWith('/')` assertion as belt-and-suspenders if cheap.
- **Exploit scenario:** An admin (the only writer) would have to set a hostile `og_image_url`; crawlers following the 302 would be redirected. Self-inflicted only under the current single-admin-trust model (no role separation per CLAUDE.md). Not a privilege-boundary crossing.
- **Fix (optional):** Re-assert scheme at the 302 emit site, OR treat as fully covered by SEC-R5C1-04 and close. Recommend the latter.
- **Severity:** LOW · **Confidence:** Med · **Classification:** likely-covered-by-planned-work (SEC-R5C1-04). Listed for traceability; no independent action required.

---

## Full attack-surface coverage (every file examined, not sampled)

### API routes — 10/10 examined
| Route | Authz / gate | Verdict |
|---|---|---|
| `api/admin/db/download/route.ts` | `withAdminAuth` + `isValidBackupFilename` + realpath containment + symlink reject | clean |
| `api/admin/lr/upload/route.ts` | `withAdminAuth({allowTokenScope:'lr:upload'})` + per-token upload tracker + contract lock + GPS strip + restore-maint guards | clean (exemplary) |
| `api/checkout/[imageId]/route.ts` | per-IP rate-limit (Pattern 2) + strict price parse + idempotency key | clean (idempotency-key-when-IP-unknown = planned TRC-R5C1-16) |
| `api/download/[imageId]/route.ts` | single-use token, GET=interstitial/POST=claim, lstat+realpath+open-before-claim, RFC6266 filename | clean |
| `api/health` / `api/live` | liveness only | clean |
| `api/og/photo/[id]/route.tsx` | rate-limit (Pattern 4 charged), sanitizeForOg, Host-deriv = planned SEC-R5C1-01 | clean (+ SEC-R5C2-02 traceability note) |
| `api/og/route.tsx` | rate-limit (Pattern 4), source-locked | clean |
| `api/search/semantic/route.ts` | same-origin + rate-limit + fail-closed stub gate | clean (fresh, verified) |
| `api/stripe/webhook/route.ts` | Stripe signature mandatory, idempotent insert, paid-status gate, tier allowlist | clean |

### Server actions — 14 files + db-actions.ts examined
- Every **mutating** export verified to carry BOTH `isAdmin()` and `requireSameOriginAdmin()` (order varies — isAdmin-first or origin-first — but both always present; grep-confirmed across admin-backfill, admin-users, collections, embeddings, images (7 mutators), lr-tokens, sales, seo, settings, sharing (4), tags (6), topics (6)).
- Every **read-only** getter carries `@action-origin-exempt: <reason>` (admin getters still gate `isAdmin()`).
- `public.ts` (intentionally anonymous): all inputs validated (`isValidSlug`/`isValidTagSlug`, codepoint length caps, offset DoS cap at 10000, tag-array canonicalization), dual in-memory + DB rate limiting, fire-and-forget analytics with per-IP 120/min cap. Sound.
- `db-actions.ts`: backup/restore use env-var creds (no `/proc/cmdline` leak), `MYSQL_PWD`, minimal env (HOME excluded → no `~/.my.cnf`), SQL-dump header validation, chunked dangerous-SQL scan, `--one-database`, advisory locks (`LOCK_DB_RESTORE` + upload-contract), `sanitizeStderr`, file mode 0o600 / dir 0o700. Sound.

### Core libs examined
`api-auth.ts` (central origin+auth wrapper, token path), `session.ts` (constant-time HMAC, age-bound, DB-backed, dev-only secret fallback refused in prod), `auth.ts` (Argon2 + dummy-hash anti-enumeration, dual-bucket rate-limit, TOCTOU pre-increment, session-fixation prevention, secure cookies), `rate-limit.ts` (TRUST_PROXY-gated IP derivation, 4 documented rollback patterns), `request-origin.ts` (fail-closed same-origin), `admin-tokens.ts` (constant-time, fail-closed, parameterized), `upload-paths.ts`, `serve-upload.ts` (SAFE_SEGMENT + realpath containment + symlink reject + dir/ext map), `validation.ts` (Unicode-format-char rejection, path-traversal guards, safe insertId), `safe-json-ld.ts` (escapes `<`, U+2028/9 → no `</script>` breakout), `base56.ts` (CSPRNG `randomBytes` + rejection sampling), `content-security-policy.ts` (nonce scripts, object-src none, base-uri self, frame-ancestors self, form-action self).

### Infra / config examined
- `next.config.ts headers()`: nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy, broad Permissions-Policy, HSTS preload (prod). Sound.
- `nginx/default.conf`: per-location body caps (2M default / 64K login / 250M db-restore / 216M dashboard), security headers `always`, single-hop `X-Forwarded-For $remote_addr`. Sound.
- `docker-compose.yml`: host networking, `TRUST_PROXY=true`, `HOSTNAME=127.0.0.1`. Sound.
- `.env.local.example`: placeholders only (`<change-me>`, `<generate-with: openssl rand -hex 32>`) — no real secrets.

## Secrets & dependency sweep
- **Source secret scan:** zero hardcoded keys/passwords/tokens in `apps/web/src` (regex sweep excluding `process.env`/tests/placeholders).
- **Git history:** `.env.local` / `.env` / `.env.deploy` never committed (gitignored) — no leaked runtime secrets in tree history.
- **XSS sinks:** 8 `dangerouslySetInnerHTML` usages, all JSON-LD `<script type="application/ld+json">` routed through `safeJsonLd()` which escapes the `</script>` breakout vector. No raw user/admin string reaches an HTML sink unescaped.
- **Raw SQL:** no `sql.raw()` with interpolation in app code; audited raw surfaces confined to schema/admin maintenance with bound parameters (per CLAUDE.md).
- **Dependency pins:** current/recent majors (Next 16.2.3, React 19.2.5, Argon2 0.44, mysql2 3.22, drizzle 0.45, Stripe 22.1, Sharp 0.34.5). `npm audit` unavailable offline this session; the prior cycle recorded SEC-R5C1-03 (transitive postcss moderate via Next, runtime exposure ~nil) as an accepted, tracked residual — not re-raised.

## Security checklist
- [x] No hardcoded secrets (source + git history)
- [x] All inputs validated (slug/tag/codepoint/offset caps; Unicode-format-char rejection)
- [x] Injection prevention verified (Drizzle parameterization; safeJsonLd; CSV escape per CLAUDE.md; no sql.raw interpolation)
- [x] Authentication/authorization verified (every mutating route+action: isAdmin + same-origin; PAT scope-gated; constant-time crypto)
- [x] Path traversal contained (serve-upload, download, db-download: SAFE_SEGMENT + realpath + symlink reject)
- [x] Session handling sound (HMAC constant-time, age-bound, fixation prevention, secure cookies, prod secret in env only)
- [x] Rate limiting present on all cost-bearing surfaces (login dual-bucket, search, load-more, checkout, OG, semantic, share, view-record)
- [x] SSRF bounded (OG internal fetch: 10s timeout + 1MB cap; Host-deriv hardening already planned SEC-R5C1-01)
- [x] Dependencies audited (pins current; postcss residual tracked SEC-R5C1-03)
- [x] Headers/CSP/cookie attributes verified

## Final verdict
**No new actionable security findings at MED or above.** The two LOWs are optional hardening with no reachable exploit. The cycle-1 changes are clean and net-positive. Overall risk: **LOW**.
