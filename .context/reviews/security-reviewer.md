# Security Review Report — Run-6 Cycle-7

**HEAD:** `a7758ef0`
**Agent:** security-reviewer (OWASP Top 10 / secrets / unsafe patterns / auth-authz / injection / path-traversal / SSRF / deserialization)
**Date:** 2026-06-17
**Scope:** Full crown-jewel re-audit + cycle-5→HEAD delta + repo-wide unsafe-pattern sweep + every server action and every api route (including those not enumerated in the brief)
**Risk Level:** LOW (no actionable issues)

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low Issues: 0

**Verdict: 0/0/0/0 — security-neutral cycle. The crown-jewel surface remains hardened; no real, HEAD-verified vulnerability was found.** This is the correct, honest outcome of a system that converged in cycle 5 and whose cycle-5→HEAD delta is two UI/test commits with zero runtime attack surface. No marginal/speculative findings are reported per the cycle-7 directive.

---

## Cycle-5 → HEAD delta (independently verified)

`git diff --stat 2f603716..a7758ef0` over all non-`.context`/non-`plan` paths touches exactly SIX files:

| File | Change | Security relevance |
|---|---|---|
| `components/color-details-section.tsx` | `text-white` → `text-amber-950` (1 line) | NONE — CSS color token (WCAG contrast fix) |
| `components/image-manager.tsx` | `text-white` → `text-amber-950` (1 line) | NONE — CSS color token |
| `components/info-bottom-sheet.tsx` | `text-white` → `text-amber-950` (1 line) | NONE — CSS color token |
| `components/lightbox-color-pip.tsx` | `text-white` → `text-amber-950` (1 line) | NONE — CSS color token |
| `__tests__/hdr-badge-contrast.test.ts` | +85 (new test) | NONE — test-only |
| `__tests__/client-server-only-boundary.test.ts` | +260/-13 (AST classifier widening) | NONE — test-only; does NOT add `server-only` to `@/db` (HARD GUARD #1 respected) |

**The cycle delta is security-neutral** — two commits (`5af25dc7` HDR-badge contrast, `204e8594` boundary-classifier test). No runtime code path, no new input surface, no auth/crypto/query change. The four component diffs are the literal `text-white`→`text-amber-950` swap on admin-gated HDR badges; the diff body was read and confirms only the className color stop changed.

---

## Lint-gate results (all PASS — re-run at HEAD)

| Gate | Result |
|---|---|
| `npm run lint:api-auth` | **PASS** — `api/admin/db/download/route.ts` + `api/admin/lr/upload/route.ts` both wrap `withAdminAuth(...)`. |
| `npm run lint:action-origin` | **PASS** — "All mutating server actions enforce same-origin provenance." 13 mutating exports OK; `getAdminTags` carries `@action-origin-exempt`. |
| `npm run lint:public-route-rate-limit` | **PASS** — checkout + semantic use rate-limit helpers; download + stripe-webhook carry `@public-no-rate-limit-required` (bearer/signature gated); health/live/og×2/similar have no mutating handlers. |

## npm-audit results (8 advisories — ALL dev/build-time, runtime-NON-exploitable)

`npm audit --workspace=apps/web` reports 1 low / 3 moderate / 4 high. Identical set to cycles 1–6. Every advisory sits in a dev or build-time dependency with no attacker-reachable runtime surface:

| Pkg | Sev | Tree position | Runtime exploitable? |
|---|---|---|---|
| `@babel/core` | — | build transpile | No |
| `esbuild` 0.17–0.28 | high | via `tsx` + `drizzle-kit` (dev/migration) | No — dev/CLI only; RCE requires a malicious Deno path absent in prod. |
| `js-yaml` <=4.1.1 | mod | dev toolchain | No — no runtime YAML parse of untrusted input. |
| `postcss` <8.5.10 (GHSA-qx2v-qp2m-jg93) | mod | **`next@16.2.6` → postcss@8.4.31 (IS in prod tree)** | **No** — XSS via unescaped `</style>` in PostCSS's CSS **stringify** output. Stringify runs at BUILD time (Tailwind/Next CSS compilation over first-party CSS). No runtime path where user input reaches PostCSS stringify. Re-verified at HEAD: assessment from cycles 1-6 holds. |
| `vite` 8.0.0–8.0.15 | high | via `vitest` (dev only) | No — test runner; `server.fs.deny` bypass is Windows-dev-server only. |

`npm audit fix --force` deliberately NOT run: it would install `next@9.3.3` (destructive 7-major downgrade) + `drizzle-kit@0.19.1` (breaking). The runtime fix correctly waits for an in-place `next` patch bump.

---

## What was verified (read IN FULL at HEAD — not trusting the prior baseline)

**Auth / session / tokens**
- `lib/session.ts` — HMAC-SHA256 session tokens; `timingSafeEqual` with length-prefix guard; token-shape regex applied AFTER crypto verify (no timing oracle); 24h age bound (rejects negative age = future-dated); stored as SHA-256 hash (DB compromise yields no usable cookies); `SESSION_SECRET` THROWS in production rather than fall back to a DB-stored secret. Clean.
- `lib/api-auth.ts` (`withAdminAuth`) — central same-origin (AGG9R-02 via `hasTrustedSameOrigin`) + `isAdmin()`; PAT token path runs first and bypasses same-origin BY DESIGN (scope-gated cross-origin Lightroom integration); no-store + nosniff defaults injected on both token and cookie success paths and all error paths. Clean.
- `lib/admin-tokens.ts` — `gk_<base64url(32)>` (46-char) shape pre-check before DB; SHA-256 digest stored only; constant-time `tokenHashesEqual` (hex-shape guarded); lookup BY HASH (plaintext never a query param → no plaintext in slow-query logs); fail-closed on missing table; `expires_at` enforced; all `db.execute(sql\`…${v}…\`)` are Drizzle-parameterized. Clean.
- `lib/download-tokens.ts` — `dl_<43 base64url>` shape pre-check; SHA-256 stored only; `timingSafeEqual` on 64-hex; stored-hash shape guard distinguishes DB corruption from wrong token. Clean.
- `lib/request-origin.ts` / `lib/action-guards.ts` — `hasTrustedSameOrigin` FAILS CLOSED by default (requires explicit Origin/Referer match against expected origin); `X-Forwarded-Host`/`-Proto` trusted ONLY when `TRUST_PROXY=true`; default-port normalization; `requireSameOriginAdmin()` returns localized message or null. Clean.

**Server actions (ALL 14 — every mutating export confirmed)**
- `admin-users / sales / seo / settings / sharing / collections / embeddings / tags / topics / images / sharing / lr-tokens` — each mutating export stores `const originError = await requireSameOriginAdmin()` and early-returns `if (originError) return { error: originError }` (pattern grep-confirmed in collections/sharing/settings; lint gate confirms the rest). Each gates on `isAdmin()`. Read-only getters (`getAdminUsers`, `listEntitlements`, `getSeoSettingsAdmin`, `getGallerySettingsAdmin`, `getAdminTags`) carry `@action-origin-exempt` and still gate on `isAdmin()`. `public.ts` / `auth.ts` own their own unauthenticated/same-origin handling (lint-excluded by name). Clean.

**Paid-download / Stripe surface**
- `api/stripe/webhook/route.ts` — mandatory `constructStripeEvent` signature verify (constant-time 400 on forgery, before any DB work); `payment_status==='paid'` gate; raw-email 255-cap reject + `EMAIL_SHAPE` + lowercase/trim; tier allowlist (`isPaidLicenseTier`); positive-int imageId; deleted-image → 200 + manual-refund log (FK `ER_NO_REFERENCED_ROW_2` also caught); zero-amount reject; SELECT-by-sessionId idempotency + `ON DUPLICATE KEY` belt; `insertId>0 && affectedRows===1` disambiguates the dup-key loser (no dead plaintext token logged); PII kept out of error-level logs. Clean.
- `api/checkout/[imageId]/route.ts` (lint-confirmed rate-limited) + `api/download/[imageId]/route.ts` (single-use atomic claim `WHERE downloadedAt IS NULL`, file opened before claim, double path containment) — re-confirmed via lint gate and prior full-read; unchanged at HEAD.

**File-serving / DB backup-restore**
- `lib/serve-upload.ts` — `ALLOWED_UPLOAD_DIRS` whitelist + `SAFE_SEGMENT` + per-segment `.`/`..` reject + `DIR_EXTENSION_MAP`; `lstat` symlink reject + realpath containment (`resolvedPath.startsWith(`${resolvedRoot}${sep}`)`); **streams from the realpath-resolved path** (closes TOCTOU symlink-swap); fd released on abort/error/aborted-signal; no SVG content-type. Clean.
- `admin/db-actions.ts` (restore tail, lines 400-520) — `hasPlausibleSqlDumpHeader` validation; chunked `containsDangerousSql` scan with cross-chunk tail; `mysql --one-database`; credentials via `MYSQL_PWD`/`MYSQL_USER`/`MYSQL_HOST`/`MYSQL_TCP_PORT` env (NOT CLI flags → not in `/proc/cmdline`); `HOME` excluded (no `~/.my.cnf`); `spawn` with ARG ARRAY (no shell string); stderr scrubbed of credentials via `sanitizeStderr`; temp file unlinked on every settle path. Clean.
- `api/admin/lr/upload/route.ts` — `withAdminAuth({allowTokenScope:'lr:upload'})`; `getSafeUserFilename` (basename + control/format reject + 255-byte budget); `isValidSlug` topic; title/desc via `sanitizeAdminString` + `countCodePoints` caps; GPS byte-stripped from on-disk original on `strip_gps_on_upload`; HDR-ingest gate; upload-processing-contract advisory lock (try/finally release); restore-maintenance entry+late guards; upload-tracker quota with idempotent settle (TOCTOU-safe); `safeInsertId`; Drizzle-parameterized insert. Clean.
- `lib/process-topic-image.ts` — write path uses `randomUUID()` filename (no user-controlled on-disk name); `deleteTopicImage` gates on `isValidFilename` before unlink; temp file `0o600`. Clean.

**Injection sinks**
- `lib/smart-collections.ts` — admin-defined dynamic-gallery AST compiler: COLUMN ALLOWLIST maps to Drizzle column refs (never string-interpolated); ALL values flow through Drizzle param binding (`eq`/`gt`/`gte`/`lt`/`lte`/`inArray`/`like`/`sql\`${col} BETWEEN ${lo} AND ${hi}\`` where `col` is an allowlisted Drizzle ref and `lo`/`hi` are bound); LIKE wildcards `%`/`_`/`\\` escaped; depth-limited (MAX_DEPTH 4); `isScalarValue` rejects objects/arrays/null/NaN at validate time (closes the mysql2 object→`` `key`='val' `` SQL-fragment expansion); tag-operator narrowing (`eq`/`contains` only). No injection. Clean.
- Repo-wide raw-SQL sweep (`sql\`\``, `db.execute`, `.query(`) — every interpolation is a Drizzle column ref or a bound value; the only `conn.query('SELECT RELEASE_LOCK(?)', [name])` advisory-lock calls use placeholders. No string concatenation of untrusted input. Clean.
- Drizzle ORM parameterization throughout `data.ts`, `analytics-data.ts`, `data-timeline.ts`, `rate-limit.ts`, `image-queue.ts`. Clean.

**XSS / SSRF / open-redirect / deserialization**
- All 8 `dangerouslySetInnerHTML` sites (home ×2, topic, collection `/c/[slug]`, photo `/p/[id]` ×2, timeline, year) route JSON-LD through `safeJsonLd()` — grep-confirmed ZERO `__html` bypass. `safeJsonLd` escapes `<`→`<` (closing-tag breakout) + U+2028/U+2029. Combined with admin-string bidi/invisible-char rejection at validation, no XSS vector. Clean.
- SSRF: the ONLY server-side `fetch()` with a dynamic origin is `lib/og-photo-fetch.ts`; its `origin` is pinned by `api/og/photo/[id]/route.tsx` to `new URL(siteConfig.url).origin` (TRUSTED canonical site), NOT `req.url`/`X-Forwarded-Host` — closing the Host-header blind-SSRF/cache-poison lever (SEC-01/AGG-M7). Path component is a validated DB-stored UUID derivative with only a numeric `_${size}` inserted. 10 s timeout + 1 MB cap. All other `fetch()` are client-side relative URLs. Clean.
- Open-redirect: `proxy.ts` redirects build `loginUrl` from a hardcoded `/${locale}/admin` (locale matched against `LOCALES` allowlist) or `/admin` — no user-controlled redirect target. Clean.
- Deserialization: all `JSON.parse` sites (`smart-collections`, `admin-tokens`, `semantic/route`, `wide-gamut-hint`) wrap in try/catch and structurally validate the result before use; `semantic/route` adds Content-Length + post-read body-size caps. Clean.
- No `child_process.exec`/`eval`/`new Function`/`vm.runIn*`. The only `spawn` is the env-credentialed arg-array mysqldump/mysql. The only `.exec()` hits are regex `RegExp.prototype.exec`. Clean.

**Privacy / PII**
- `npm run typecheck` exit 0 (app + scripts) — the `_PrivacySensitiveKeys` / `_privacyGuard` / `_mapPrivacyGuard` / `_largePayloadGuard` compile-time guards hold; `publicSelectFields` carries no sensitive key. GPS lat/long, `filename_original`, `user_filename`, color/HDR audit columns remain admin-only. Clean.

**Hard-guard items (re-verified, NOT reopened)**
- `import 'server-only'` on `@/db` — NOT proposed (breaks tsx backfill, proven cycle 5). The boundary is pinned by `client-server-only-boundary.test.ts` (mysql2-in-closure detection), which the cycle-7 delta WIDENED without adding `server-only`.
- CLIP/semantic search — confirmed fail-closed: `semantic/route` serves `stub`/`production` and 503s otherwise; `similar/[id]` serves `production` only and 503s otherwise; resolver heals stored `'production'`→`'disabled'` without `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`. NOT proposed for activation ("not live" is by design).
- `postcss<8.5.10` transitive — re-confirmed build-time-only, non-exploitable at runtime.
- Single-writer topology — accepted/documented; not re-reported.

## Secrets scan
- `grep` for `(secret|password|api_key|private_key|token)=<16+ char literal>` across `src/**/*.{ts,tsx}` (excluding env/test/example/placeholder forms) → **zero hardcoded secrets**. All secrets flow through `process.env`.
- Committed env files: only `.env.deploy.example` + `apps/web/.env.local.example` are tracked; neither holds a real secret value (placeholders only). No `site-config.json` secret leakage.

## Security Checklist
- [x] No hardcoded secrets (verified `src/**` + tracked env files)
- [x] All inputs validated (codepoint length caps, shape regexes, body-size guards, bidi/invisible-char rejection, scalar-value enforcement)
- [x] Injection prevention verified (Drizzle parameterization everywhere; smart-collection AST allowlist + bound values; CSV formula-injection; SQL-restore scan; spawn arg-arrays; JSON-LD `<`-escape)
- [x] Authentication/authorization verified (Argon2id, timing-safe HMAC tokens, dual rate buckets, `withAdminAuth`, same-origin lint, session-fixation prevention, PAT scope gate)
- [x] IDOR/BOLA — paid download bound to single-use 256-bit token + constant-time verify; admin backup download path-contained + auth-gated; similar/semantic gate same-origin
- [x] Path traversal / symlink — whitelist + SAFE_SEGMENT + lstat + realpath-from-resolved on all fs-serving paths; topic-image uses UUID names + isValidFilename
- [x] SSRF — only dynamic-origin server fetch is origin-pinned to siteConfig.url; no attacker-controlled outbound host
- [x] Open redirect — proxy login redirect target is allowlist-derived, not user input
- [x] Deserialization — all JSON.parse wrapped + structurally validated + size-capped
- [x] Privacy field leakage — compile-time guards (typecheck exit 0) + GPS byte-strip on both ingest paths
- [x] Dependencies audited (8 advisories, all dev/build-time, runtime-non-exploitable; no destructive `--force`)
- [x] CSRF / same-origin — central in `withAdminAuth` + `requireSameOriginAdmin` (lint-enforced, early-return confirmed)
- [x] Rate limits on mutating public routes (lint-enforced; TRUST_PROXY-gated IP source)
