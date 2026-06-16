# Security Review Report — GalleryKit (Cycle 2)

**Reviewer:** Security Reviewer (OWASP Top 10 + deep adversarial sweep)
**HEAD:** 8ccc8806
**Date:** 2026-06-16
**Scope:** Full security surface — auth/session/crypto primitives, all server actions (`app/actions/**`), all API routes (`app/api/**`, incl. `api/admin/**`, download, checkout, stripe webhook, OG, search), `serve-upload.ts`, `db-actions.ts` (mysqldump/restore), `data.ts` (PII guards), `validation.ts`, `csv-escape.ts`, `gps-exif-strip.ts`, `request-origin.ts`, `rate-limit.ts`, `admin-tokens.ts`, `download-tokens.ts`, the 3 security lint gates + their AST scanners, and the dark CLIP surface (verification only — NOT activation).

**Risk Level: LOW**

This is an exceptionally mature, hardened codebase. Dozens of prior review cycles (R3–R28, runs 1–6, RPF cycles 1–8) have closed nearly every standard vulnerability class. Auth, session crypto, CSRF/same-origin, injection, path traversal, PII guards, rate limiting, and the paid-download/Stripe surface are all defense-in-depth hardened with compile-time guards, AST-enforced lint gates, and fixture tests. The two prior-cycle fixes called out in the brief (poisoned-weight cleanup on checksum mismatch; config re-darkening gate) are both verified PRESENT and intact (see Verified-Closed below). No Critical or High findings. The findings below are residual hardening observations and defense-in-depth symmetry notes — none are confirmed-exploitable in a default deployment.

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 2
- Low Issues: 4
- Informational / Verified-Closed: 5

---

## Critical Issues
None.

## High Issues
None.

---

## Medium Issues

### SEC-01 — Per-photo OG route fetches an attacker-influenced origin (theoretical SSRF / cache-key surface)
**Severity:** MEDIUM (downgraded from theoretical — not confirmed exploitable)
**Category:** A10 SSRF (peripheral)
**Confidence:** Medium · **Exploitability:** Theoretical (requires TRUST_PROXY misconfig or an unfiltered Host)
**Location:** `apps/web/src/app/api/og/photo/[id]/route.tsx:103` → `apps/web/src/lib/og-photo-fetch.ts:50-54`

`buildOg` computes `const origin = new URL(req.url).origin` and passes it to `pickFirstAvailablePhotoBuffer(origin, image.filename_jpeg, ...)`, which issues a server-side `fetch(\`${origin}/uploads/jpeg/${sizedFilename}\`)`. `req.url`'s host is derived from the inbound request (Host / X-Forwarded-Host). In a correctly-configured deployment (reverse proxy that pins/validates Host, or no TRUST_PROXY), `origin` is always the canonical site origin, so the fetch is a same-origin self-call and the filename component is a DB-stored UUID derivative (`SAFE_SEGMENT`-shaped at write time) — no traversal, no arbitrary host. The residual concern: if a deployment fronts the app with a proxy that forwards an arbitrary `Host`/`X-Forwarded-Host` without validation, the OG generator could be coerced into fetching `http://attacker/uploads/jpeg/<uuid>.jpg`. The blast radius is limited (10 s timeout, 1 MB cap, only an `<img>` decode of the result into a Satori canvas — no body reflected to the caller, no header echo), so even in the misconfigured case it is a weak blind-SSRF/cache-poisoning primitive, not data exfiltration.

**Exploit scenario:** Misconfigured proxy → attacker sends `Host: attacker.tld` → OG route fetches `http://attacker.tld/uploads/jpeg/<uuid>.jpg` and embeds the returned bytes in the cached OG card; or uses it to probe internal hosts (blind, timing-only).
**Remediation:** Derive the internal fetch origin from a trusted source (env `SITE_URL` / `seo.url`) rather than the request Host, or hard-pin the fetch to `127.0.0.1` + the configured Host header. Already-validated `filename_jpeg` keeps the path component safe; the host is the only attacker lever.
```ts
// og-photo-fetch.ts — pin to a trusted base instead of request-derived origin
const base = process.env.INTERNAL_ORIGIN ?? new URL(seo.url).origin; // not req.url
const photoUrl = `${base}/uploads/jpeg/${sizedFilename}`;
```
**Note:** This is the single SSRF-class fetch in the codebase; the CLIP runtime sets `env.allowRemoteModels = false` (no network), and mysqldump/restore use `spawn` with array args (no shell). So the attack surface is genuinely just this one helper.

### SEC-02 — `check-api-auth` only scans `src/app/api/admin/**`; a privileged route placed elsewhere is unscanned
**Severity:** MEDIUM (process/defense-in-depth gap, not a live vuln)
**Category:** A01 Broken Access Control (preventive control coverage)
**Confidence:** High · **Exploitability:** N/A (no such route exists today)
**Location:** `apps/web/scripts/check-api-auth.ts:17` (`API_ADMIN_DIR = .../src/app/api/admin`)

The `lint:api-auth` gate — which mandates `withAdminAuth(...)` on every HTTP-method export — recurses ONLY under `src/app/api/admin/`. Today every privileged route correctly lives there (`admin/db/download`, `admin/lr/upload`). But the convention is path-based: a future contributor who adds a privileged route OUTSIDE `/api/admin/` (e.g. `src/app/api/internal/purge/route.ts`) gets ZERO coverage from this gate and could ship without `withAdminAuth`. The middleware matcher also excludes `/api/*` entirely (`proxy.ts:140`), so there is no middleware backstop for a misplaced privileged API route — the only defense would be a hand-rolled `isAdmin()` the author might forget.

**Exploit scenario:** A privileged action is added under a non-`admin/` API path, the author forgets the auth wrapper, and the gate stays green because it never scanned the file → unauthenticated mutation.
**Remediation:** Broaden the scanner to flag any `route.*` under `src/app/api/**` whose handler body references privileged operations (db mutations, `getCurrentUser`, fs writes) but does not wrap `withAdminAuth`, OR add an allow-list of non-admin public routes and require every other API route to justify its auth posture (mirror the `lint:public-route-rate-limit` exempt-comment pattern). At minimum, document the "all privileged routes MUST live under /api/admin/" rule as an enforced invariant.

---

## Low Issues

### SEC-03 — `getTrustedRequestProtocol` falls back to `'http'`, weakening the Secure-cookie decision under header loss
**Severity:** LOW
**Category:** A02 Cryptographic Failures (cookie transport)
**Confidence:** Medium · **Exploitability:** Low
**Location:** `apps/web/src/lib/request-origin.ts:45-53`; consumed at `apps/web/src/app/actions/auth.ts:228-229,406`

`getTrustedRequestProtocol` returns `'http'` when no trusted `X-Forwarded-Proto`, `Origin`, or `Referer` indicates HTTPS. The login/password cookie `secure` flag is `requestIsHttps || NODE_ENV === 'production'`, so in production the cookie is always Secure regardless — good. But a non-production HTTPS deployment (staging behind TLS without `NODE_ENV=production`) that drops the proto headers would mint a non-Secure session cookie. This is a narrow misconfiguration window; the `NODE_ENV === 'production'` OR-clause covers the intended prod path. **Remediation:** Document that any TLS-terminated deployment must set both `TRUST_PROXY=true` and `NODE_ENV=production`; consider failing closed to `secure: true` when `Origin`/`Referer` are HTTPS even if `NODE_ENV` is unset.

### SEC-04 — `XMP_GPS_TOKEN` regex on attacker-supplied XMP is benign but unbounded-input adjacent
**Severity:** LOW (no ReDoS — informational)
**Category:** A03 (ReDoS class — cleared)
**Confidence:** High · **Exploitability:** None
**Location:** `apps/web/src/lib/gps-exif-strip.ts:63`

`/GPS(?:Latitude|Longitude|Altitude|Position|Coordinates|DestLatitude|DestLongitude)/` is run against XMP packet bytes extracted from uploaded originals. The alternation is a flat literal set with no nested quantifiers or overlapping prefixes that backtrack catastrophically, so it is NOT ReDoS-prone even on a multi-MB adversarial XMP blob. Logged only to confirm the audit covered it. No change needed. (The broader upload-size bound — Sharp `limitInputPixels` + 200 MB/file cap — also bounds the input.)

### SEC-05 — `LOG_PLAINTEXT_DOWNLOAD_TOKENS` writes single-use download tokens to stdout when enabled
**Severity:** LOW (opt-in, documented)
**Category:** A09 Logging Failures / sensitive data in logs
**Confidence:** High · **Exploitability:** Low (operator opt-in, off by default)
**Location:** `apps/web/src/app/api/stripe/webhook/route.ts:437-450`

When `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true`, the webhook prints `token=<dl_...>` (a live single-use download credential) to stdout for the manual-distribution workflow. This is intentional, off-by-default, and the surrounding comments + README document the risk and the rotation expectation. The token is single-use, 24 h TTL, and tied to a paid entitlement. **Remediation:** None required; ensure the deployment's log shipper retention/ACLs are considered before enabling this flag (already noted in CLAUDE.md / README). Flagged for completeness because it is the one deliberate sensitive-value-in-logs path.

### SEC-06 — Admin DB backups stored plaintext at rest (accepted threat model)
**Severity:** LOW (documented, by design)
**Category:** A02 Cryptographic Failures (data at rest)
**Confidence:** High · **Exploitability:** Low (requires host/volume access)
**Location:** `apps/web/src/app/[locale]/admin/db-actions.ts:140-166` (mode `0o700` dir, `0o600` file)

`mysqldump` output is written unencrypted to `data/backups/` (mode 0600, dir 0700, non-public, served only via the authenticated `/api/admin/db/download` route which is `withAdminAuth`-wrapped + same-origin enforced + path-contained + symlink-rejected). CLAUDE.md explicitly accepts plaintext-at-rest backups for the personal-gallery threat model. The full DB (including Argon2 hashes and Stripe customer emails) is therefore readable to anyone with host filesystem access. **Remediation:** None required under the documented model; for multi-tenant or higher-assurance deployments, encrypt backups with an operator-held key. The dir/file modes already provide owner-only defense-in-depth.

---

## Informational / Verified-Closed (do NOT re-report)

- **VC-1 — Poisoned-weight cleanup on checksum mismatch (PRIOR CYCLE, INTACT):** `apps/web/scripts/clip-model-manifest.ts` `verifyAndCleanArtifacts()` computes SHA-256 per artifact against `CLIP_MODEL_MANIFEST`, and on mismatch calls `rmSync(filePath, { force: true })` then aborts (`scripts/download-clip-models.ts:93-106`). Confirmed present.
- **VC-2 — CLIP config re-darkening gate (PRIOR CYCLE, INTACT):** `apps/web/src/lib/gallery-config.ts:129-145` heals a stored `semantic_search_mode='production'` to `'disabled'` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`. The semantic + similar routes fail closed to 503 on any non-`stub`/`production` resolved mode. Runtime `env.allowRemoteModels=false` (`clip-model.ts:74`) — no network at serve time. The dark feature is genuinely non-exploitable by default; NOT activated by this review.
- **VC-3 — Session/auth crypto is sound:** HMAC-SHA256 tokens verified with `timingSafeEqual` after length-equalization; structural shape checks placed AFTER the constant-time compare to avoid a timing oracle (`session.ts:110-125`); production refuses DB-stored secret fallback (`session.ts:30-36`); login uses a dummy Argon2 hash to equalize the user-exists/missing timing (`auth.ts:65-70,177`); session fixation closed by delete-other-sessions-in-txn on login and full rotation on password change. Argon2id params (64 MiB / t=3 / p=4) exceed OWASP minimums and are centralized in `password-hashing.ts`.
- **VC-4 — Injection surfaces clean:** All raw `db.execute(sql\`...\`)` sites (`admin-tokens.ts`, `topics.ts`, `admin-backfill-runner.ts`, `health`) use Drizzle parameterized template interpolation — no string concatenation of untrusted input. mysqldump/restore use `spawn(cmd, [args])` (no shell), credentials via `MYSQL_PWD`/`MYSQL_*` env (not `/proc/cmdline`), HOME stripped, restore validates dump header + scans for dangerous SQL + advisory-locked. XSS sinks (`dangerouslySetInnerHTML`) are exclusively JSON-LD via `safeJsonLd()` (escapes `<`, U+2028/U+2029) with CSP nonce; OG text via `sanitizeForOg()` (strips bidi/zero-width/C0). `blur_data_url` is contract-validated (`isSafeBlurDataUrl`) producer+consumer. CSV export escapes formula-injection + strips bidi/zero-width.
- **VC-5 — Access control / CSRF / PII / rate limiting complete:** `withAdminAuth` centrally enforces same-origin + `isAdmin()` + no-store/nosniff on every `/api/admin/**` route; PATs bypass same-origin by design (cross-origin integration) but require a valid scoped token verified constant-time. Every mutating server action returns early on `requireSameOriginAdmin()` (AST-enforced by `lint:action-origin`, which rejects aliased exports, exempt-comments-on-mutating-bodies, ignored guard results, and pre-guard mutations). All three lint gates PASS. PII guarded by compile-time `_privacyGuard`/`_mapPrivacyGuard` over derived `publicSelectFields`/`publicMapSelectFields`; semantic-search enrichment selects only public fields (`title`/`description`/`camera_model`/`lens_model`/`capture_date` — all in `publicSelectFields`). Download tokens (`dl_` + 43 b64url) and PATs (`gk_` + 43 b64url) are shape-gated before hashing, stored as SHA-256, verified constant-time, single-use claimed via atomic `UPDATE ... WHERE downloadedAt IS NULL`. Stripe webhook signature-verified, idempotent (sessionId UNIQUE + insertId disambiguation), `payment_status==='paid'` gated, zero-amount/deleted-image/oversized-email rejected. All in-memory rate-limit maps are bounded (`createResetAtBoundedMap`/`createWindowBoundedMap`) with TOCTOU-safe pre-increment-then-check and symmetric rollback. `getClientIp` only trusts proxy headers under `TRUST_PROXY=true` and parses the chain by trusted-hop count. Last-admin deletion prevented under advisory lock. IDOR on share/group/download/token routes closed by ownership scoping (`user_id` in token queries) + unguessable 256-bit/base56 keys + constant-time token verification.

---

## Files Examined (count: 41)
Core: `lib/api-auth.ts`, `lib/session.ts`, `lib/password-hashing.ts`, `proxy.ts`, `lib/request-origin.ts`, `lib/action-guards.ts`, `lib/admin-tokens.ts`, `lib/download-tokens.ts`, `lib/rate-limit.ts`, `lib/validation.ts`, `lib/serve-upload.ts`, `lib/gps-exif-strip.ts`, `lib/og-photo-fetch.ts`, `lib/og-sanitize.ts`, `lib/safe-json-ld.ts`, `lib/data.ts`, `lib/analytics.ts`, `lib/gallery-config.ts`, `lib/gallery-config-shared.ts`, `lib/clip-model.ts`, `scripts/download-clip-models.ts`, `scripts/clip-model-manifest.ts`.
Actions: `auth.ts`, `sharing.ts`, `lr-tokens.ts`, `admin-users.ts`, `sales.ts`, `settings.ts`, `embeddings.ts`, `topics.ts`, `tags.ts`, `images.ts`, `public.ts`.
API routes: `download/[imageId]`, `checkout/[imageId]`, `stripe/webhook`, `admin/lr/upload`, `admin/db/download`, `og/photo/[id]`, `og` (head), `search/semantic`, `search/similar/[id]`, `health`.
Admin: `[locale]/admin/db-actions.ts`. Lint scanners: `check-action-origin.ts`, `check-api-auth.ts` (+ ran all 3 gates: all PASS).

## Top 3 Findings
1. **SEC-01 (MED)** — Per-photo OG route (`og-photo-fetch.ts:50`) fetches `${new URL(req.url).origin}/uploads/jpeg/<uuid>` — theoretical blind-SSRF/cache-poison if a fronting proxy forwards an arbitrary Host; pin the fetch base to a trusted env/`seo.url` instead of the request Host.
2. **SEC-02 (MED)** — `lint:api-auth` scans only `src/app/api/admin/**`; a privileged route placed outside that path would ship unscanned with no middleware backstop. Broaden the gate or enforce the "privileged routes live under /api/admin/" invariant.
3. **SEC-03 (LOW)** — `getTrustedRequestProtocol` defaults to `'http'`; a TLS staging deploy without `NODE_ENV=production` + dropped proto headers would mint a non-Secure session cookie. Fail closed to Secure when Origin/Referer are HTTPS, and document the TRUST_PROXY+NODE_ENV requirement.

## Security Checklist
- [x] No hardcoded secrets (no SESSION_SECRET/DB_PASSWORD/STRIPE/MYSQL_PWD leaked to client responses or logs)
- [x] All inputs validated (slug/filename/tag/title/description/email/token-shape; code-point-aware length caps; Unicode bidi/zero-width stripped/rejected)
- [x] Injection prevention verified (Drizzle parameterization; spawn array-args no-shell; safeJsonLd; CSV formula escaping; path containment + realpath + symlink rejection)
- [x] Authentication/authorization verified (Argon2id, constant-time HMAC sessions, withAdminAuth, requireSameOriginAdmin AST-enforced, last-admin lock)
- [x] Dependencies audited (CLIP weights SHA-256-pinned + clean-on-mismatch; runtime allowRemoteModels=false; no other external fetch)
