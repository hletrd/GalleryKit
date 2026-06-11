# Security Review Report — GalleryKit (Run 5, Cycle 1)

**Reviewer:** security-reviewer (OWASP Top 10, secrets, authz, SSRF, injection, timing, CSP)
**Scope:** Every trust-boundary surface — `apps/web/src/app/api/**`, `apps/web/src/app/actions/**`, `proxy.ts`, `lib/{api-auth,request-origin,action-guards,session,download-tokens,admin-tokens,content-security-policy,csp-nonce,serve-upload,validation,smart-collections,seo-og-url,og-photo-fetch,atom-feed,stripe,rate-limit}.ts`, `db-actions.ts`, both feed routes, `nginx/default.conf`, `Dockerfile`, `docker-compose.yml`.
**Method:** Read every file in scope (no sampling). Validated from code, not comments/tests. Ran secrets scan + `npm audit`.
**Risk Level:** LOW

This codebase has survived 20 prior security-heavy review cycles and the maturity shows. Authentication (Argon2id + dummy-hash timing equalization + HMAC sessions verified with `timingSafeEqual`), CSRF (centralized `requireSameOriginAdmin` + `withAdminAuth` origin gate), path traversal (lstat symlink reject + realpath containment + SAFE_SEGMENT allowlist), injection (Drizzle parameter binding everywhere; smart-collection compiler is allowlisted + depth-limited + scalar-enforced), single-use download tokens (constant-time, atomic claim), Stripe webhook signature verification, rate-limiting (dual in-memory + DB bucket, TOCTOU-safe pre-increment), and Trojan-Source/Unicode hardening are all correctly implemented. No CRITICAL or HIGH residual issues were found. Findings below are defense-in-depth / hardening.

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 2
- Low Issues: 4
- Dependency: 1 known moderate CVE (transitive, no fix without breaking downgrade)

---

## Medium Issues

### SEC-R5C1-01 — Per-photo OG route can be steered to fetch an attacker-controlled host (Host-header SSRF, constrained)
**Severity:** MEDIUM **Confidence:** Medium **Classification:** needs-manual-validation
**Category:** A10 SSRF
**Location:** `apps/web/src/app/api/og/photo/[id]/route.tsx:114` (`const origin = new URL(req.url).origin;`) → `apps/web/src/lib/og-photo-fetch.ts:50-52` (`fetch(\`${origin}/uploads/jpeg/${sizedFilename}\`)`).
**Issue:** The internal photo fetch that feeds the Satori OG image derives its origin from `req.url`, which Next.js builds from the request `Host` header. `nginx/default.conf` forwards `proxy_set_header Host $host;` (client-supplied) and declares `server_name gallery.atik.kr` but has **no `default_server` reject block**, so whether a crafted `Host: attacker.tld` reaches the app depends entirely on the upstream TLS-terminating edge's Host filtering. If the edge passes arbitrary Host through, `pickFirstAvailablePhotoBuffer` issues `GET https://attacker.tld/uploads/jpeg/<derived>.jpg` from the server, base64-embeds the response body into the returned OG JPEG, and serves it — a (partially blind, partially observable) SSRF + cache-poisoning of the `Location` fallback 302.
**Exploitability:** Remote, unauthenticated, but requires the edge to forward a spoofed Host. Constrained: method is fixed GET, path suffix is fixed to `/uploads/jpeg/<name>.jpg`, 10 s timeout, 1 MB body cap. Cannot hit internal metadata endpoints with arbitrary paths, but CAN reach any host:port that serves a 2xx at that fixed path, and the fetched bytes are exfiltrated inside the OG image.
**Blast Radius:** Server-side request forgery to arbitrary external hosts on a fixed path; response-body exfiltration via the rendered image; CDN cache poisoning of the per-photo OG entry.
**Remediation:** Derive the internal-fetch origin from a trusted server-side base, not the request Host. The repo already has `process.env.BASE_URL` / `siteConfig.url` used by the feed and SEO validators — reuse it here:
```tsx
// BAD — origin from attacker-influenceable Host header
const origin = new URL(req.url).origin;
const fetched = await pickFirstAvailablePhotoBuffer(origin, image.filename_jpeg, config.imageSizes);

// GOOD — trusted base; fall back to req origin only if BASE_URL unset (dev)
import siteConfig from '@/site-config.json';
const trustedBase = (process.env.BASE_URL?.trim() || siteConfig.url || '').replace(/\/+$/, '');
const origin = trustedBase || new URL(req.url).origin;
```
Optionally also add a `default_server` 444 block in nginx as belt-and-braces. Same `new URL(req.url).origin` pattern is used for the 302 fallback `Location` at line 262 — harden both.

### SEC-R5C1-02 — `/api/admin/lr/upload` token path: PAT auth bypasses same-origin AND the only quota is per-token in-memory; no auth-failure rate limit on `withAdminAuth`
**Severity:** MEDIUM **Confidence:** Medium **Classification:** likely (hardening)
**Category:** A07 Identification & Authentication Failures / A04 Insecure Design
**Location:** `apps/web/src/lib/api-auth.ts:63-89` (token path runs first, no failed-attempt accounting); `apps/web/src/app/api/admin/lr/upload/route.ts:57` (PAT upload).
**Issue:** When `allowTokenScope` is set, `withAdminAuth` verifies the presented `X-GalleryKit-Token` against the DB on every request with **no per-IP rate limit on verification failures** at the application layer. The token keyspace is 256-bit so online brute-force is infeasible (this is the saving grace), but: (1) a leaked/over-scoped PAT has no app-level throttle beyond the per-token upload-tracker window, and (2) unlike the cookie login path (5/15min IP + account buckets, audit `login_failure`), failed PAT presentations are not audit-logged or counted, so credential-stuffing of stolen PATs across many tokens leaves no signal. Edge nginx `limit_req zone=admin` (30 r/m) does throttle `/api/admin/`, which mitigates volume but is IP-scoped and bypassable per-IP if `TRUST_PROXY` mis-set.
**Exploitability:** Requires a stolen/leaked PAT (shown once at creation, stored hashed — good). Impact is bounded by token scope.
**Blast Radius:** Undetected use of a compromised PAT; no forensic trail of failed token auth.
**Remediation:** Add a failed-token-verification audit event + a small per-IP failure counter in the token branch of `withAdminAuth`, mirroring the `login_failure` audit pattern in `auth.ts:182`. Example:
```ts
const verified = await verifyToken(presented);
if (verified && tokenHasScope(verified.scopes, options.allowTokenScope)) { /* ... */ }
await logAuditEvent(null, 'token_auth_failure', 'admin_token', undefined, getClientIp(headers)).catch(()=>{});
return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS });
```
Keyspace makes this hardening, not an active vuln — hence MEDIUM.

---

## Low Issues

### SEC-R5C1-03 — Transitive `postcss < 8.5.10` moderate CVE (GHSA-qx2v-qp2m-jg93) via Next.js
**Severity:** LOW **Confidence:** High **Classification:** confirmed
**Category:** A06 Vulnerable & Outdated Components
**Location:** `npm audit` (prod): `node_modules/next/node_modules/postcss` — 2 moderate advisories. PostCSS XSS via unescaped `</style>` in CSS stringify output.
**Issue:** Pinned by Next's own dependency tree; `npm audit fix --force` would downgrade Next to 9.3.x (breaking, unacceptable). The vulnerable code path is PostCSS's stringifier processing untrusted CSS — GalleryKit does not run user-supplied CSS through PostCSS at runtime (build-time only, trusted input), so practical exposure is effectively nil. Track for the next Next.js patch that bumps the transitive postcss.
**Remediation:** No action that doesn't break the build. Monitor `next` releases; the advisory resolves when Next ships a postcss ≥ 8.5.10 in its tree. Document as accepted residual.

### SEC-R5C1-04 — `validateSeoOgImageUrl` relative branch admits same-origin `//` only via `\` check; encoded-traversal not normalized
**Severity:** LOW **Confidence:** Medium **Classification:** needs-manual-validation
**Category:** A01 / open-redirect-adjacent
**Location:** `apps/web/src/lib/seo-og-url.ts:9-24`.
**Issue:** The SEC-R4C20-01 fix (reject `\` in the relative branch) correctly closed the `/\evil.com` → `//evil.com` scheme-relative bypass. Residual: the relative branch accepts ANY string starting with `/` (not `//`, not containing `\`) without normalizing percent-encoded or control-stripped path segments. `normalizeStringRecord` strips C0 controls upstream, and the value lands in an admin-only `<meta og:image>` / 302 Location, so the blast radius is admin-self-XSS-of-crawlers at most. The current guard is sound for the known browser normalization vectors; flagged only so the next reviewer re-checks if a new URL-normalization quirk (e.g. `/%2f%2fevil.com` re-decoded by a crawler) emerges.
**Remediation:** Defense-in-depth — also reject relative values containing `%2f%2f` / `%5c` (case-insensitive) or run the relative path through `new URL(value, siteOrigin)` and re-assert `.origin === siteOrigin`:
```ts
if (trimmedUrl.startsWith('/') && !trimmedUrl.startsWith('//')) {
  if (trimmedUrl.includes('\\')) return false;
  try { return new URL(trimmedUrl, configuredBaseUrl).origin === new URL(configuredBaseUrl).origin; }
  catch { return false; }
}
```

### SEC-R5C1-05 — `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true` writes single-use download tokens + customer email to stdout
**Severity:** LOW **Confidence:** High **Classification:** confirmed (documented, opt-in)
**Category:** A09 Security Logging Failures / A02 sensitive data
**Location:** `apps/web/src/app/api/stripe/webhook/route.ts:437-449`.
**Issue:** When the operator opts in, the plaintext `dl_…` token (a bearer credential granting one paid download) and the customer email are emitted on a `[manual-distribution]` stdout line. This is the documented manual-fulfillment scaffold (email pipeline deferred), gated behind an explicit env flag and off by default. Risk is real only where stdout ships to a retained/shared log sink — a live bearer credential + PII in logs.
**Remediation:** Acceptable as the documented interim workflow. Harden the operational note: require that deployments using this flag scrub/short-TTL the log sink, and prioritize replacing the scaffold with the email pipeline (`TODO(US-P54-phase2)`). Consider logging only the token's hash-prefix + a one-time retrieval URL rather than the raw token.

### SEC-R5C1-06 — Analytics view-record actions are public + best-effort; per-IP cap is in-memory only (process-local)
**Severity:** LOW **Confidence:** High **Classification:** confirmed (by-design, documented)
**Category:** A04 Insecure Design (resource consumption)
**Location:** `apps/web/src/app/actions/public.ts:330-405` (`recordPhotoView`/`recordTopicView`/`recordSharedGroupView`, 120 req/min/IP in-memory).
**Issue:** These intentionally-anonymous analytics inserts rely solely on an in-memory `ResetAtBoundedMap` per-IP limiter (no DB-backed bucket like login/search). On the documented single-instance topology this is fine, but the counter is process-local: a restart resets budgets, and `getClientIp` returns `'unknown'` (single shared bucket → trivially exhausted or trivially bypassed) whenever `TRUST_PROXY` is unset. Worst case is bounded table growth in `image_views`/`topic_views`/`shared_group_views`, not a confidentiality/integrity issue. FKs reject junk ids; full IPs are never stored (only derived country) — privacy posture is correct.
**Remediation:** Acceptable for the stated single-writer deployment. If horizontal scale is ever introduced (CLAUDE.md already warns against it), move these limiters to the shared DB bucket helper. No change needed now.

---

## Notable surfaces verified CLEAN (no finding)
- **Auth/session timing:** `auth.ts` dummy-hash equalizes user-enumeration timing; `session.ts` verifies HMAC with `timingSafeEqual` (length-checked first); session fixation closed (insert-then-delete-others in a tx on login; full rotation on password change). `getSessionSecret` refuses DB fallback in production.
- **CSRF:** Centralized `requireSameOriginAdmin()` on every mutating action (lint-enforced); `withAdminAuth` now enforces origin centrally; `hasTrustedSameOrigin` fails closed (requires explicit Origin/Referer match).
- **Path traversal:** `serve-upload.ts`, `/api/download`, `/api/admin/db/download` all do lstat symlink-reject + realpath containment + stream-from-resolved-path (TOCTOU-closed). Download route opens the FD *before* the atomic single-use claim (token never burned on a missing file).
- **SQL injection:** Every raw `sql\`…\`` uses Drizzle parameter binding; smart-collection compiler allowlists columns, depth-limits to 4, caps IN at 100, and enforces scalar value types at validation. CSV export escapes formula-injection + bidi + zero-width chars.
- **Stripe:** Webhook mandates signature verification (constant-time HMAC), gates on `payment_status==='paid'`, rejects zero-amount, idempotent on `sessionId` + dup-key disambiguation, never trusts metadata tier without allowlist.
- **Download tokens / PATs:** stored as SHA-256 only, constant-time compared, shape-validated before hashing, fail closed on missing table; PAT labels sanitized; expiry validated (rejects NaN/past).
- **CSP:** Per-request nonce (production), `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`, `form-action 'self'`; download interstitial ships its own `default-src 'none'` policy; nginx repeats security headers on the static image location with a tight per-asset CSP.
- **Secrets:** No hardcoded secrets, no `.env` tracked, no `sk_live/whsec_/AKIA/BEGIN` literals in source. All credentials via `process.env`; mysqldump/restore use `MYSQL_PWD` env (not `/proc/cmdline`), stderr sanitized.
- **Feed XSS:** `atom-feed.ts` XML-escapes all fields + strips C0 controls; per-entry `author_name` is a trusted JOIN to `admin_users.username` (admin-only id stays admin-only). Topic feed validates locale + topic slug.

## Security Checklist
- [x] No hardcoded secrets (git-grep + scan clean; no tracked .env)
- [x] All inputs validated (Drizzle params; slug/tag/filename allowlists; Unicode-format rejection; countCodePoints length)
- [x] Injection prevention verified (no string-concat SQL; allowlisted smart-collection compiler)
- [x] Authentication/authorization verified (Argon2id, HMAC sessions, isAdmin + requireSameOriginAdmin on every mutation, lint-gated)
- [x] Dependencies audited (1 transitive moderate postcss CVE, no safe fix — accepted)
- [~] SSRF (1 MEDIUM residual — SEC-R5C1-01, OG internal fetch uses request Host)
