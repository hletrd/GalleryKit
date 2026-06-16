# Security Review Report — GalleryKit

**Headline:** Honest convergence holds at run-6 cycle-5 — zero new exploitable findings; the sole `npm audit` item is a non-exploitable transitive dev-only postcss advisory. **Risk Level: LOW.**

**Reviewer:** security-reviewer (run-6, cycle-5)
**HEAD:** 2f603716 (working tree clean)
**Prior cycle HEAD:** f8147868 (cycle-4)
**Date:** 2026-06-16
**Scope:** OWASP Top 10 — auth/authz, session/crypto, secrets, injection (SQL/command/path/formula), SSRF, XSS, CSRF/same-origin, file-upload safety, rate-limiting, privacy (PII/GPS leakage), unsafe deserialization, dependency CVEs. Full primary-surface re-derivation from current HEAD source (NOT sampled, NOT trusting prior summaries) + regression audit of the cycle-4→cycle-5 diff (f8147868..2f603716) + all three security lint gates run + `npm audit` dependency check.

## Summary

- Critical Issues: **0 (new)**
- High Issues: **0 (new)**
- Medium Issues: **0 (new)**
- Low / Informational: **0 (new)**
- Dependency advisories: **1 surfaced, assessed NON-EXPLOITABLE (no code change warranted)**

**Zero new actionable security findings.** This is cycle 5 of a system where ~58 findings were closed across runs 4–6 and independently re-verified each cycle. I re-derived every primary attack surface from current HEAD source (auth/session/crypto, injection/path/SSRF, privacy/data-layer/upload — two parallel deep audits plus direct line-by-line reads of the crown-jewel files), audited the entire cycle-4→cycle-5 source diff for any regression, ran all three security lint gates (all pass), confirmed zero live secrets at HEAD, and ran `npm audit`. I found NO new injection, auth-bypass, SSRF, XSS, CSRF, secret-exposure, or privacy-leak vulnerability. The one dependency advisory (`postcss < 8.5.10` via Next's bundled compiler) is provably non-exploitable in this deployment (assessment below).

---

## Cycle-4→Cycle-5 regression audit (f8147868..2f603716)

5 commits landed. The security-relevant verdict is decisive: **`git log f8147868..2f603716` over every security-relevant path** (`src/lib/auth-rate-limit.ts`, `session.ts`, `gps-exif-strip.ts`, `serve-upload.ts`, `data.ts`, `api-auth.ts`, `src/app/actions/**`, `src/app/api/**`, `proxy.ts`) **returns EMPTY** — not one auth/session/injection/privacy/request-handling source file changed this cycle.

| File | Change | Security assessment |
|---|---|---|
| `scripts/backfill-color-pipeline.ts:145-175,442-527` | Added two pure exported helpers (`countDeletedMidReencodeDetectionFailures`, `computeBackfillExitCode`) + a `detectionFailures` walk-back for deleted-mid-reencode rows (AGG-C4-03/04) | **Neutral.** Operator-invoked sidecar tooling, outside the request-handling trust boundary. Pure functions on integer counters + an exit-code expression; no DB-write, auth, injection, or data-exposure change. Reads no request data. |
| `src/components/ui/switch.tsx:11-16` | Header comment corrected `translate-x-[calc(100%-2px)]` → `translate-x-full` (AGG-C4-05) | **Comment-only.** Zero runtime surface. |
| `src/__tests__/image-queue-bootstrap.test.ts` | Flaky-wait timeout fix (AGG-C4-01) | Test-only. |
| `src/__tests__/switch-geometry-contract.test.ts` (new) | Geometry regression pin (AGG-C4-02) | Test-only. |
| `src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts` (new) | Exit-code matrix pin (AGG-C4-03) | Test-only. |

**Verdict: no security regression introduced by the cycle-4 fixes; the request-handling attack surface is byte-identical to cycle-4.**

---

## Lint-gate enforcement (all three pass at HEAD)

Ran all three; output captured:

- **`lint:api-auth`** — both admin routes OK (`db/download`, `lr/upload`). Recursive over all 5 Next route extensions; aliased/function-decl/class-decl exports rejected; empty-handler route fails.
- **`lint:action-origin`** — "All mutating server actions enforce same-origin provenance." 18 mutating actions OK + 4 read-only exempt (`sales.ts::listEntitlements`, `seo.ts::getSeoSettingsAdmin`, `settings.ts::getGallerySettingsAdmin`, `tags.ts::getAdminTags` — each carries an explicit `@action-origin-exempt` comment). Recursive discovery; aliased re-exports a hard failure; exempt-comment-on-mutating-body a hard failure; guard must be stored-and-early-returned.
- **`lint:public-route-rate-limit`** — 9 public routes OK. Mutating public handlers (`checkout`, `search/semantic`) use rate-limit helpers; `download/[imageId]` and `stripe/webhook` carry justified `@public-no-rate-limit-required` (single-use token claim / Stripe-signature-gated respectively). The two expensive public GETs in the documented GET blind spot (`og`, `og/photo/[id]`) are independently rate-limited via `preIncrementOgAttempt`.

These gates structurally guarantee no mutating server action or admin API route can ship without same-origin + auth enforcement.

---

## Primary attack surfaces — re-verified from HEAD source this cycle (NOT findings)

**Authentication & sessions** (`session.ts` read in full): HMAC-SHA256 session tokens verified with `timingSafeEqual` (`:117`) BEFORE the token-shape regexes (`:124-125`) — no timing oracle; length-guard before compare (`:113`); 24h age bound with `Number.isFinite` + negative-age reject (`:128-133`); token SHA-256-hashed before DB lookup (`:136`, so DB compromise yields no usable cookies); **production throws on missing/<32-char `SESSION_SECRET`** (`:30`), refusing the DB-stored dev fallback. Argon2id (memoryCost 65536 / timeCost 3 / parallelism 4) per CLAUDE.md.

**Rate limiting** (`auth-rate-limit.ts`): per-IP + per-account (`acct:<sha256>`) login buckets via `createWindowBoundedMap` (bounded with window eviction, `LOGIN_RATE_LIMIT_MAX_KEYS` / 5000-key password-change cap); pre-incremented before Argon2 (TOCTOU-safe); deletes on success (session-fixation-clean). Unchanged this cycle.

**Same-origin / CSRF / API auth** (`api-auth.ts` read in full): `withAdminAuth` runs the PAT token-scope path first (constant-time `verifyToken` + `tokenHasScope`, by-design CORS bypass for Lightroom), then `hasTrustedSameOrigin` (403 on fail), then `isAdmin()` (401), auto-applying `no-store` + `nosniff` on every response (cookie AND token paths). `requireSameOriginAdmin()` on every mutating action (lint-enforced).

**Middleware guard** (`proxy.ts` read in full): protects every `/[locale]/admin/*` sub-route, checks cookie presence + token shape (length ≥ 100, exactly 3 non-empty colon segments), redirects to login; `/api/*` excluded from matcher (documented — each `/api/admin/*` enforces its own `withAdminAuth`). `x-gk-admin-render` header reflects only the requester's own cookie (no cross-user disclosure); full crypto validation stays in server actions.

**Injection** (parallel deep audit + direct reads): all SQL is Drizzle ORM or parameterized `sql\`${...}\`` / `?` placeholders — independent fan-out + targeted grep found ZERO string-concatenation into SQL. `smart-collections.ts` admin-defined predicates are parameterized (`sql\`${col} BETWEEN ${p.lo} AND ${p.hi}\``, `${images.id} IN (...)` — `:225/251/261`), no `sql.raw`. `admin-tokens.ts` queries with `${presentedHash}` / `${row.id}` parameterization. LIKE escaping `.replace(/[%_\\]/g, '\\$&')` at every sink (`data.ts:1421`). `mysqldump`/`mysql` spawned with **array args** (no `shell:true`), credentials via `MYSQL_PWD` env (`db-actions.ts:157/454`), `--one-database` on restore. CSV: `escapeCsvField` on every export field; C0/C1 + bidi + zero-width strip + `=+-@` prefixing. No `eval`/`Function`/`vm`/dynamic-require on any path.

**Path traversal** (both serving paths read in full): `serve-upload.ts` → `ALLOWED_UPLOAD_DIRS` whitelist (`:138`) → dir/ext match (`:147`) → per-segment `SAFE_SEGMENT` + `.`/`..`/length reject (`:154-161`) → `lstat` symlink reject (`:177`) → `realpath` containment with `${resolvedRoot}${path.sep}` boundary (`:182`); streams from the RESOLVED path (TOCTOU-safe). `download/[imageId]/route.ts` → DB-sourced UUID filename → containment (`:309`) → lstat symlink reject (`:323`) → parallel realpath containment (`:334`) → **open-before-claim** (`:349`) → atomic single-use claim `WHERE downloadedAt IS NULL` (`:382-385`) → handle closed on every failure path. `db/download` validates backup filename + realpath containment.

**SSRF**: OG per-photo internal fetch pinned to `siteConfig.url` (`og/photo/[id]/route.tsx:113-115`), NOT request Host; filename is a `crypto.randomUUID()`-derived DB value. No request-derived `fetch` URL anywhere (grep clean).

**XSS / output encoding**: all 8 `dangerouslySetInnerHTML` sinks route through `safeJsonLd` (verified each: home `page.tsx:207/216`, `p/[id]:274/281`, topic `:209`, `c/[slug]:137`, `timeline:102`, `year/[year]:92`) — escapes `</script>` + U+2028/2029. OG (Satori) text via `sanitizeForOg`. Admin string surfaces reject `UNICODE_FORMAT_CHARS` (bidi + zero-width) at validation. Production CSP nonce + global nosniff/X-Frame-Options/HSTS.

**Stripe / paid downloads** (`stripe/webhook/route.ts` + `download-tokens.ts` read in full): webhook signature MANDATORY (`constructStripeEvent` throws → 400 in constant time before DB work; missing `stripe-signature` → 400); `payment_status === 'paid'` gate (`:105`); tier allowlist (`isPaidLicenseTier`); zero-amount reject (`:299`); deleted-image → 200 + manual-refund log (no Stripe retry storm); idempotency SELECT + `insertedFresh = affectedRows===1 && insertId>0` disambiguation (closes the dead-token dup-key hazard); customer email PII never logged at error level; `LOG_PLAINTEXT_DOWNLOAD_TOKENS` opt-in + documented. Download tokens: `dl_<43 base64url>`, SHA-256 hashed, `STORED_HASH_SHAPE` validation, `timingSafeEqual` on equal-length buffers, single-use atomic claim.

**File-upload safety**: UUID filenames (no user-controlled names on disk), Sharp `limitInputPixels` (decompression-bomb), per-file 200 MB + cumulative-byte + file-count window caps, HDR-ingest gate honored on BOTH browser and Lightroom PAT paths, `assertBlurDataUrl` at write time.

**Privacy** (parallel deep audit + `data.ts` guards): `publicSelectFields` derived from `adminSelectFields` by OMISSION (separate object ref) with compile-time `_PrivacySensitiveKeys` / `_SensitiveKeysInPublic` (`:418-419`) + `_mapPrivacyGuard` (`:431`). The full PII omit-set (lat/lng, `filename_original`, `user_filename`, `uploaded_by`, all color/HDR audit columns, `processing_error`, `failed_at`) is confirmed absent from every public select. GPS exposed only via `publicMapSelectFields`, gated on `topics.map_visible = true` INNER JOIN + runtime assertion (`getMapImages :1588/1597-1603`). Atom feed surfaces `author_name` (JOIN-derived username), NOT the raw `uploaded_by` id. GPS scrubbed from the on-disk ORIGINAL via bounds-checked byte-level `gps-exif-strip.ts`; never `withMetadata()`. No new schema column leaks to a public surface. No secrets/tokens/hashes logged.

**CLIP semantic search**: remains dark-by-design. **HARD GUARD honored** — not proposing activation; reviewed the route only for input-handling safety (body-size cap, content-type + chunked checks, rate-limited).

---

## Dependency advisory assessment (`npm audit`) — NON-EXPLOITABLE, no code change

`npm audit --omit=dev` surfaces **one moderate** advisory: **GHSA-qx2v-qp2m-jg93 — PostCSS XSS via unescaped `</style>` in CSS stringify output** (`postcss < 8.5.10`).

**Disposition: NON-EXPLOITABLE in this deployment. No remediation warranted this cycle.** Evidence (HEAD-verified):

1. **The direct dependency is already patched.** `postcss` is a **devDependency only** (`apps/web/package.json devDependencies.postcss: ^8.5.10`; NOT in `dependencies`). The hoisted root install is `postcss@8.5.10` — the **fixed** version (advisory range is `< 8.5.10`). Every Tailwind transitive copy (`postcss-import`, `postcss-js`, `postcss-load-config`) dedupes to `8.5.10`.
2. **The only vulnerable copy is Next's internal build-time compiler.** `npm ls postcss` shows `next@16.2.6 → postcss@8.4.31` (at `node_modules/next/node_modules/postcss`). This is Next's bundled, pinned CSS compiler used during `npm run build` to compile **developer-authored** CSS (Tailwind + component styles).
3. **No exploit path exists.** The advisory requires **attacker-controlled CSS** flowing through postcss's stringify into a `<style>` context. GalleryKit has **zero runtime CSS-processing surface**: app source never imports `postcss` (grep clean); there is no user-supplied CSS, no runtime CSS-in-JS stringification, no `cssText`/`insertRule`/runtime `<style>` interpolation on any request path (grep clean). CSS is fully compiled at build time; `postcss.config.mjs` is `{ tailwindcss, autoprefixer }` (build-only). The standalone runtime serves pre-built static `.next/static/css`.
4. **The production runtime image does not invoke postcss.** The Dockerfile `prod-deps` stage runs `npm ci --omit=dev` and the standalone output bundles pre-compiled CSS — postcss is a build-stage artifact, never executed in the deployed container at request time.
5. **The suggested fix is destructive and wrong.** `npm audit fix --force` would downgrade `next` to **9.3.3** (a 7-major-version regression). The correct path is to let a future Next patch bump its vendored postcss, or accept (no exploit path). Per the prior cycle's standing recommendation: track such CVEs in CI without acting when non-exploitable.

This is not a new finding — it is an upstream transitive-dev advisory with no reachable sink in GalleryKit, surfaced and dispositioned here for the audit trail.

---

## Deferred-item re-confirmation (still correctly deferred at HEAD — NOT new findings)

All three carry forward; deferral reasoning re-confirmed factually correct at HEAD 2f603716:

- **AGG-C3-31 — git-history SESSION_SECRET/passwords (operational, HEAD-clean).** HEAD `.env.local.example` is placeholder-only; live-secret literal scan over `src`+`scripts` returns ZERO. Production refuses the DB-stored secret fallback (`session.ts:30`). Exposure is purely historical git state; no code change at HEAD remediates it. Deferral correct.
- **AGG-C3-32 — SQL-restore inter-token comment bypass (defense-in-depth).** The restore path remains triple-gated: `isAdmin()` + `requireSameOriginAdmin()` + `mysql --one-database`, with app-table drops intentionally allowed during a legitimate restore. The comment-stripping scanner is defense-in-depth, not the primary control. Deferral correct.
- **AGG-C3-33 — `admin-tokens.verifyToken` bumps `last_used_at` before scope check (cosmetic).** Confirmed at `admin-tokens.ts:157-159` (fire-and-forget `last_used_at` UPDATE inside `verifyToken`) vs the scope check in caller `api-auth.ts:67` (`tokenHasScope`). `last_used_at` advances for a valid-but-wrong-scope token on a 401 path; the request is still rejected, the timestamp is advisory. Deferral correct.

---

## Security Checklist

- [x] No hardcoded/live secrets at HEAD (placeholder-only `.env.local.example`; live-secret literal scan over src+scripts returns zero)
- [~] Secrets in git history — historical SESSION_SECRET/passwords recoverable (AGG-C3-31, deferred/operational, HEAD-clean, documented in CLAUDE.md)
- [x] All inputs validated (codepoint-aware length, Unicode-format rejection, slug/filename regex, JSON shape + size caps)
- [x] Injection prevention verified (parameterized Drizzle SQL incl. admin smart-collection predicates, array-arg spawn, path containment + symlink rejection, CSV formula escaping)
- [x] Authentication/authorization verified (Argon2id, HMAC + timingSafeEqual with shape-check-after-compare, middleware guard, withAdminAuth + requireSameOriginAdmin, all 3 lint gates run + pass, bounded rate-limit maps)
- [x] SSRF prevented (OG fetch pinned to siteConfig.url; no request-derived fetch URL anywhere)
- [x] XSS prevented (all 8 JSON-LD sinks via safeJsonLd + prod nonce CSP, OG sanitized, security headers)
- [x] CSRF prevented (fail-closed same-origin on every mutating action + admin API route; gates enforce structurally)
- [x] Privacy enforced (compile-time public/admin/map field guards, GPS byte-strip on originals, uploaded_by id admin-only, author_name JOIN-derived)
- [x] Dependencies audited (`npm audit` run; sole advisory = transitive dev-only postcss<8.5.10 via Next's build compiler, assessed non-exploitable — no reachable runtime CSS sink; `audit fix --force` would destructively downgrade Next 16→9, rejected)
- [x] CLIP semantic search remains dark-by-default; HARD GUARD respected — NOT proposing activation
- [x] No security regression in the cycle-4→cycle-5 diff (f8147868..2f603716 — zero security source files changed)
