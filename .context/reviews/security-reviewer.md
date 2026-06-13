# Security Review Report — Cycle 7

**Reviewer:** security-reviewer (OWASP Top 10 angle)
**Repo:** GalleryKit @ HEAD `d0920957` (clean tree, verified)
**Scope:** Full OWASP Top 10 + secrets, injection, IDOR, CSRF, path traversal, ReDoS, prototype pollution, SSRF, privacy/PII boundary, dependency audit.
**Date:** 2026-06-13

## Risk Level: **LOW** (no live-exploitable vulnerability found)

This is a mature, heavily security-reviewed codebase. After tracing every surface in the brief from untrusted input to sink, validating from code (not comments), and running the three blocking security lint gates + dependency audit, I found **zero new live-exploitable vulnerabilities**. The cycle-6 WebP RIFF correctness fix (`b6c4f915`) is present and correct at HEAD. The security posture is clean. Findings below are dependency hygiene (dev-only/build-only, not runtime-exploitable) — reported for completeness, not because they are live risks.

## Summary
- Critical Issues: 0
- High Issues: 0 (runtime) — 3 dependency CVEs are **dev/build-only**, not in the production tree
- Medium Issues: 0 (runtime) — 2 dependency CVEs are **build-only**
- Confirmed runtime vulnerabilities: **0**

---

## OWASP Top 10 — Category-by-Category Verdict

| # | Category | Verdict | Evidence |
|---|----------|---------|----------|
| **A01** | Broken Access Control | ✅ CLEAN | `withAdminAuth` wraps every `/api/admin/**` route (lint:api-auth PASS, no bare-function exports). Every mutating server action calls `requireSameOriginAdmin()` (lint:action-origin PASS — 8 action files manually corroborated). Middleware (`proxy.ts`) presence-gates `/[locale]/admin/*` with full crypto in actions (defense in depth). No IDOR: all-root-admin model means no per-admin ownership boundary to cross; `revokeToken`/`revokeLrToken` still scope `DELETE … WHERE id=? AND user_id=?`. |
| **A02** | Cryptographic Failures | ✅ CLEAN | Argon2id (mem 64 MiB / time 3 / par 4 — exceeds OWASP). Session tokens HMAC-SHA256 + `timingSafeEqual`; stored **hashed** (DB leak ≠ usable cookie). `SESSION_SECRET` refuses DB fallback in production (`session.ts:30-36`). Download tokens & PATs: 256-bit random, hash-only storage, constant-time verify. |
| **A03** | Injection (SQL/NoSQL/Cmd/XSS) | ✅ CLEAN | All queries Drizzle-parameterized. `smart-collections.ts`: column allowlist + `isScalarValue` rejects objects (blocks mysql2 object→SQL expansion) + LIKE escaping + depth cap. `admin-tokens.ts` uses bound `sql\`\`` params. All 6 `dangerouslySetInnerHTML` JSON-LD sinks route through `safeJsonLd` (escapes `<`, U+2028/9). No `eval`/`new Function`. LIKE wildcards escaped everywhere. |
| **A04** | Insecure Design | ✅ CLEAN | Single-use download = atomic CAS (`UPDATE … WHERE downloadedAt IS NULL` + affectedRows). GET interstitial (no claim) vs POST claim — mail-scanner safe. Open-before-claim so a missing file never burns a token. Advisory locks serialize restore/upload-contract/backfill/per-image. |
| **A05** | Security Misconfiguration | ✅ CLEAN | Global `nosniff`; per-route `no-store` on admin/API; restrictive CSP on download interstitial (`default-src 'none'`); nonce-CSP in middleware. `serve-upload` whitelist excludes `original/`, blocks SVG content-type. |
| **A06** | Vulnerable Components | ⚠️ DEV/BUILD-ONLY (see findings) | 3 high (esbuild via tsx+drizzle-kit) + 2 moderate (postcss via next). All in **devDependencies / build-time**; production `dependencies` tree is clean (`deps: []` for all flagged pkgs). Not runtime-reachable. |
| **A07** | Identification & Auth Failures | ✅ CLEAN | Dual-bucket login rate limit (per-IP + per-account, bounded maps + DB backing). Password-change bucket decoupled. Rollback-on-infra-error (decrement not delete). Token age cap (24 h). Regex shape checks AFTER crypto (no timing oracle). |
| **A08** | Data Integrity / Deserialization | ✅ CLEAN | Stripe webhook: mandatory signature (`constructStripeEvent`), `payment_status==='paid'` gate, idempotency (SELECT + ON DUPLICATE KEY + insertId disambiguation), tier allowlist, zero-amount reject, deleted-image handling. DB-restore scanner blocks 40+ dangerous SQL patterns incl. conditional-comment inner-content. `JSON.parse` sites (smart-collections, admin-tokens scopes, semantic body) all allowlist/shape-validate output → no prototype pollution. |
| **A09** | Logging & Monitoring | ✅ CLEAN | `sanitizeStderr` redacts MySQL creds. Webhook drops PII (email/tokenHash) from structured logs; plaintext token only under explicit `LOG_PLAINTEXT_DOWNLOAD_TOKENS` opt-in. Audit events on LR upload + DB backup download. |
| **A10** | SSRF | ✅ CLEAN | OG photo fetch (`og-photo-fetch.ts`) uses `origin = new URL(req.url).origin` (request's own host, NOT attacker-supplied) + DB-sourced UUID `filename_jpeg`, constrained to `${origin}/uploads/jpeg/…`. 10 s timeout, 1 MB cap, rate-limited, charged-404 (no enumeration-oracle refund). No user-controlled outbound URL anywhere. |

---

## Privacy / PII Boundary (latitude, longitude, filename_original, user_filename)

**Verdict: ✅ AIRTIGHT.** Traced the full path.

- `publicSelectFields` is **derived by destructuring-omission** from `adminSelectFields` (separate object reference) — adding an admin field cannot auto-leak (`data.ts:325-357`).
- **Three compile-time guards**: `_privacyGuard` (no PII in public), `_mapPrivacyGuard` (map select only adds lat/long), `_largePayloadGuard` (`data.ts:417-449`). If any sensitive key reaches a public select, the build fails with `never extends never` → false.
- `getImage`/`getImageCached` (public photo viewer) uses `...publicSelectFields` (verified `data.ts:963-964`) → `image.latitude`/`longitude` are **`undefined`** in the public payload. The client-side `isAdmin && image.latitude != null` guards in `photo-viewer.tsx:963` / `info-bottom-sheet.tsx:453` are belt-and-suspenders — the data isn't present unless an admin-path query ran. A spoofed client `isAdmin` flag exposes nothing.
- `publicMapSelectFields` is the ONLY public select with lat/long, gated by `topics.map_visible=true` **inner JOIN** + **runtime row assertion** in `getMapImages` (`data.ts:1565-1588`, refuses `map_visible=false` rows).
- GPS-at-rest: `strip_gps_on_upload` nulls DB columns AND byte-scrubs the on-disk original (the paid-download deliverable) on BOTH ingest paths (browser `images.ts:307`, LR `lr/upload/route.ts:312-326`).

---

## WebP GPS Scrub Fix (cycle-6 carryover) — VERIFIED FIXED at HEAD

`stripGpsFromWebpBuffer` (`gps-exif-strip.ts:564-567`) now reads RIFF sub-chunks in correct `[FourCC tag: 0-3][size: 4-7 LE]` order:
```js
const chunkTag  = buf.toString('ascii', offset, offset + 4);  // tag FIRST
const chunkSize = buf.readUInt32LE(offset + 4);               // size SECOND
```
Matches commit `b6c4f915`. The lossless WebP scrub path is live again (was dead code that fell through to the still-GPS-stripping Sharp re-encode — never a privacy leak, only generation loss). Not re-reported as a finding.

---

## Findings (dependency hygiene only — NOT runtime-exploitable)

### 1. esbuild RCE CVE in dev toolchain (GHSA-gv7w-rqvm-qjhr)
**Severity:** High (CVE) / **Effective runtime risk: NONE**
**Category:** A06 Vulnerable Components
**Location:** `node_modules/{tsx,drizzle-kit}/node_modules/esbuild` (range 0.17.0–0.28.0)
**Exploitability:** Requires a **Deno** runtime + attacker-controlled `NPM_CONFIG_REGISTRY` during install. GalleryKit is Node.js (not Deno); `tsx` and `drizzle-kit` are **devDependencies** — confirmed absent from production `dependencies` (`deps: []`). Not reachable in the deployed container (prod-deps tree only; CLAUDE.md documents the runtime never runs tsx).
**Blast radius:** None at runtime. A compromised dev/CI machine with a hostile registry env var only.
**Remediation (low priority, hygiene):** bump `tsx` ≥ 4.21.2 and `drizzle-kit` to a release pulling esbuild ≥ 0.28.1 when convenient:
```bash
npm i -D tsx@latest drizzle-kit@latest --workspace=apps/web
```

### 2. postcss XSS-in-stringify CVE via next build (GHSA-qx2v-qp2m-jg93)
**Severity:** Moderate (CVE) / **Effective runtime risk: NONE**
**Category:** A06 Vulnerable Components
**Location:** `node_modules/next/node_modules/postcss` (< 8.5.10)
**Exploitability:** XSS via unescaped `</style>` in PostCSS stringify output. The CSS PostCSS processes here is the app's **own authored Tailwind/CSS at build time**, not untrusted runtime input. No path for an attacker to feed adversarial CSS into the stringifier.
**Blast radius:** None — build-time, first-party CSS only.
**Remediation:** carried by the pinned Next version; resolves on the next Next.js minor bump. `npm audit fix --force` would downgrade Next (breaking) — do NOT run it.

---

## Verification Performed (evidence the posture is clean)

- **Read in full:** session.ts, api-auth.ts, action-guards.ts, request-origin.ts, password-hashing.ts, auth-rate-limit.ts, proxy.ts, og-photo-fetch.ts, og-sanitize.ts, safe-json-ld.ts, sanitize.ts, validation.ts, stripe.ts, stripe/webhook/route.ts, download-tokens.ts, download/[imageId]/route.ts, checkout/[imageId]/route.ts, lr/upload/route.ts, admin/db/download/route.ts, serve-upload.ts, smart-collections.ts, sql-restore-scan.ts, admin-tokens.ts, search/semantic/route.ts, data.ts (PII region + getImage), getClientIp.
- **Lint gates (all PASS):** `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`.
- **Grep sweeps:** `dangerouslySetInnerHTML` (6 sites, all `safeJsonLd`), `eval`/`new Function` (none), `JSON.parse` (3 sites, all validated), lat/long refs outside data.ts (all gated), hardcoded secrets (none), `sk_live`/`whsec_`/`AKIA`/PEM (none).
- **Dependency audit:** `npm audit --json` classified — all 5 CVEs dev/build-only.
- **Same-origin fail-closed:** confirmed `toOrigin(malformed)=null` ≠ non-null `expectedOrigin`; protocol self-derivation can only tighten, never bypass (cross-origin `Origin: evil.com` vs `Host`-derived `expectedOrigin` mismatch).
- **Test-locked contracts:** request-origin.test.ts, action-guards.test.ts, check-action-origin.test.ts, check-api-auth.test.ts, api-auth-response-headers.test.ts, strip-gps-from-original.test.ts.

## Security Checklist
- [x] No hardcoded secrets (env-var only; SESSION_SECRET prod-required)
- [x] All inputs validated (slug/filename/tag/email/topK/body-size; ReDoS-free linear regexes)
- [x] Injection prevention verified (Drizzle params, scalar-enforcement, LIKE escaping, JSON-LD escaping, no eval)
- [x] Authentication/authorization verified (withAdminAuth + requireSameOriginAdmin on 100% of surfaces, lint-enforced)
- [x] Dependencies audited (5 CVEs, all dev/build-only, none runtime-reachable)
- [x] Privacy boundary verified (3 compile-time guards + runtime map assertion; GPS scrubbed at-rest on both ingest paths)
- [x] CSRF/SSRF/IDOR/path-traversal/timing/single-use-CAS all checked clean
