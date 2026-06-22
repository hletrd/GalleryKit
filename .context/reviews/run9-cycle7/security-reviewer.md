# Security Review — run-9 cycle-7

**HEAD:** `feb63faa`. Whole-repo OWASP-oriented security review.
**Risk Level:** LOW (no exploitable security/privacy defect; one correctness/data-fidelity DEFECT confirmed for the lead — out of the security lane).

> This agent is read-only (Write/Edit blocked); this review was persisted from the agent's returned text. The agent itself only read, ran lint/test/typecheck/audit, and grepped.

## Summary
- Critical: 0 | High: 0 | Medium: 0 | Low: 0 (security)
- **Special-focus finding CONFIRMED (DEFECT, correctness — not security):** the Lightroom PAT upload path omits the same 6 processing settings that CR-R9C6-01 fixed on the browser path. Recorded below as cross-confirmation for the lead/code-reviewer; it is a delivery-fidelity bug, NOT a security or privacy issue (none of the 6 is an auth/injection/privacy control; `strip_gps_on_upload` — the privacy control — IS correctly applied on the LR path).
- **No new security DEFECTS.** One dependency-audit item (postcss transitive under Next) assessed and judged non-exploitable in this app's runtime (build-time-only, no untrusted CSS path).

---

## SPECIAL FOCUS — confirm/refute the lead's preliminary finding

**Lead's read:** the CR-R9C6-01 fix extended `ImageProcessingJob` with 6 settings and wired them from `uploadConfig` in the browser upload (`images.ts:461-466`), but the LR PAT route at `route.ts:420` supplies `quality`+`imageSizes` but NOT the 6 → same defect on the Lightroom publish path.

**VERDICT: CONFIRMED.** (DEFECT, confidence **High**, **correctness/data-fidelity**, not security.)

### Mechanism
- The queue handler config-load gate is `if (!quality && !imageSizes)` at `apps/web/src/lib/image-queue.ts:336`. It only loads the 6 settings from current config when BOTH `quality` and `imageSizes` are absent (`image-queue.ts:339-352`). When a job supplies `quality`, the gate is FALSE → the 6 fall back to the per-field handler defaults at `image-queue.ts:326-335` (`?? false` / `undefined`).
- Browser path (CORRECT): `apps/web/src/app/actions/images.ts:461-466` explicitly forwards all 6 (`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled`).
- **LR PAT path (DEFECTIVE):** `apps/web/src/app/api/admin/lr/upload/route.ts:420-444` forwards only `quality` (428-432), `imageSizes` (433), caption inputs, `iccProfileName`, and `colorSignals` (443). The 6 are absent. Because `quality` IS supplied, the gate never enters → the 6 are silently defaulted.
- The `config` object needed is already in hand: `const config = await getGalleryConfig()` at `route.ts:170`, and `getGalleryConfig()` returns all 6 (`gallery-config.ts:62/72/81/84/87/90`). They are simply not passed through.

### All 7 enqueue/processing entry points audited (table)

| Entry point | file:line | quality/imageSizes supplied? | gate enters? | 6 honored? |
|---|---|---|---|---|
| Browser upload | `actions/images.ts:440` | Yes | No | **Yes** (explicit forward) |
| **LR PAT upload** | `api/admin/lr/upload/route.ts:420` | Yes | No | **NO — silently defaulted** ← DEFECT |
| Bootstrap | `lib/image-queue.ts:674` | No | Yes | Yes (config-load) |
| retry re-enqueue (claim) | `lib/image-queue.ts:290` | re-enqueues same `job` | inherits | inherits originator |
| retry re-enqueue (error) | `lib/image-queue.ts:510` | re-enqueues same `job` | inherits | inherits originator |
| retryFailedImage | `actions/images.ts:1139` | No | Yes | Yes (config-load) |
| admin-backfill-runner | `lib/admin-backfill-runner.ts:499` (direct `processImageFormats`, config at :644-656) | n/a | n/a | Yes |
| sidecar backfill | `scripts/backfill-color-pipeline.ts:203` (direct `processImageFormats`, settings object) | n/a | n/a | Yes |

Only the LR path is defective. Bootstrap and `retryFailedImage` correctly fall THROUGH the gate (no quality → config-load). The two retry re-enqueues replay the same `job` object, so an LR-originated job carries its missing 6 through retries (consistent, not worse). Both backfill paths bypass the queue and call `processImageFormats` directly with all 6 from config.

### Runtime impact (blast radius)
Divergence manifests ONLY when an admin has changed one of the 6 away from its CODE default, then publishes via Lightroom:
- `force_srgb_derivatives=true` ignored → a wide-gamut LR upload ships **P3 WebP/JPEG** when the admin explicitly wanted sRGB derivatives (delivery-correctness divergence).
- non-default `wide_gamut_jpeg_chroma` / `sdr_jpeg_chroma` / `avif_effort` (e.g. effort 9 for smaller files) ignored → wrong encode params.
- `auto_alt_text_enabled=true` ignored → LR uploads get no auto caption.
- `wide_gamut_max_source_pixels` lowered → OOM-guard downscale threshold not honored on the LR path.
Note: handler/process-image per-field fallbacks (e.g. `effectiveEffort = avifEffort ?? 6` at `process-image.ts:1056`) happen to match the config DEFAULTS, so a default-config install sees no divergence — exactly the CR-R9C6-01 profile. The fix is a backfill-re-encode away, but every fresh LR publish is wrong until then.

### Fix
In `apps/web/src/app/api/admin/lr/upload/route.ts`, the `enqueueImageProcessing({...})` call at :420 should add (mirroring `images.ts:461-466`):
```ts
forceSrgbDerivatives: config.forceSrgbDerivatives,
wideGamutJpegChroma: config.wideGamutJpegChroma,
avifEffort: config.avifEffort,
sdrJpegChroma: config.sdrJpegChroma,
wideGamutMaxSourcePixels: config.wideGamutMaxSourcePixels,
autoAltTextEnabled: config.autoAltTextEnabled,
```
A regression test asserting both enqueue call sites forward the identical 6-field set would pin browser/LR parity going forward.

**Security/privacy classification:** NONE of the 6 is a security control. `strip_gps_on_upload` (the GPS-privacy control) is handled SEPARATELY and CORRECTLY on the LR path at `route.ts:311-324` (DB lat/long nulled + on-disk `stripGpsFromOriginal`), so the privacy-critical behavior is intact. This finding is therefore a **correctness DEFECT** owned by the code-reviewer/executor lane, surfaced here only as independent confirmation.

---

## OWASP Top 10 — evidence (surfaces re-audited this cycle)

### A01 Broken Access Control — CLEAN
- `proxy.ts` middleware gates all `/[locale]/admin/*` sub-routes (cookie redirect on miss).
- `withAdminAuth` (`lib/api-auth.ts:49`) wraps both admin API routes: token path runs first (`verifyToken` + `tokenHasScope`, fail-closed 401), then central origin check (`hasTrustedSameOrigin`, 403), then `isAdmin()` (401). Both admin routes use the direct `export const X = withAdminAuth(...)` form (`lr/upload/route.ts:57` + `:482 {allowTokenScope:'lr:upload'}`; `db/download/route.ts:22`).
- Every mutating server action stores `requireSameOriginAdmin()` and returns early (verified via `lint:action-origin` PASS + `db-actions.ts:47-51/125-129/272-276`).
- No IDOR: object reads keyed by validated UUID / numeric id; LR uploads attributed to the verified PAT user (`uploaded_by: tokenUserId`, `route.ts:390`).

### A02 Cryptographic Failures — CLEAN
- Passwords: Argon2id (CLAUDE.md: 64 MiB / t=3 / p=4). Login timing equalized via lazily-built dummy hash (`auth.ts:getDummyHash`).
- Session tokens: HMAC-SHA256, `timingSafeEqual` with a length guard BEFORE the compare (`session.ts:113-119`); structural regex AFTER the crypto compare (`session.ts:124-125`) so it cannot be a timing oracle (documented at :121-123); 24h maxAge + DB expiry purge.
- `SESSION_SECRET` required in prod (`session.ts:32`); dev/test DB fallback only.
- PATs: 256-bit random (`randomBytes(32)`), SHA-256 stored, looked up by indexed hash equality with a `timingSafeEqual` re-check (`admin-tokens.ts:64-73/136-166`), fail-closed on bad format / unknown / expired / missing table.

### A03 Injection — CLEAN
- All app queries Drizzle-parameterized. The only `sql\`\`` interpolations (smart-collections.ts:225/251/261) bind VALUES as placeholders; the column ref is allowlist-resolved (`ALLOWED_COLUMNS[pred.column]`, throws otherwise — `smart-collections.ts:195-199`), LIKE wildcards escaped (`:218-220/:260`), IN count-capped (`MAX_IN_VALUES`).
- `clip-model.ts:165 .raw()` is the mysql2 raw-ROW-format option, not SQL raw — not an injection sink.
- Restore/backup: `spawn('mysqldump'|'mysql', [array])` — no shell, no interpolation; `MYSQL_PWD` env (no creds in argv/`/proc/cmdline`); `--one-database`; `DB_NAME` from env.
- XSS: JSON-LD via `safeJsonLd` (`<`→`<`, U+2028/2029 escaped) + per-request CSP `nonce`; all `dangerouslySetInnerHTML` sinks are JSON-LD only (no CSS/HTML). OG strings via `sanitizeForOg`.

### A05 Security Misconfiguration — CLEAN
- `withAdminAuth` forces `no-store` + `nosniff` on success and error responses (`api-auth.ts:75-81/112-118`); admin-render header `x-gk-admin-render` drives SW offline-cache exclusion.
- `getClientIp` refuses XFF/X-Real-IP unless `TRUST_PROXY=true`; hop-count selects the slot before trusted proxies; XFF length-capped at 512; loud `[SECURITY]` warn if proxy headers present without TRUST_PROXY (`rate-limit.ts:145-176`).
- `request-origin.ts` fails closed (no Origin/Referer → reject unless explicit `allowMissingSource`).

### A06 Vulnerable Components — 1 ITEM (assessed non-exploitable; see Dependency Audit below)

### A07 Identification & Auth Failures — CLEAN
- Dual-bucket login RL: per-IP + per-account (`acct:<sha256-prefix>`), DB-backed login bucket as cross-restart source of truth + in-memory fast path; bounded maps with hard key caps + eviction; separate password-change bucket (`auth-rate-limit.ts`).
- Pre-increment BEFORE Argon2; rollback only on legitimate cases; dummy-hash timing equalization; session rotation on login.

### A08 Software & Data Integrity — CLEAN
- DB restore scanner (`sql-restore-scan.ts`): extracts AND scans MySQL conditional-comment content (`/*!ddddd ... */`, :118) so version-gated payloads can't hide; strips comments + string/backtick/hex/binary literals (:120-132); masks ONLY exact-allowlisted app DROP TABLE statements FIRST (:34-37/:121) then catches all other DROP TABLE; 35+ dangerous classes (GRANT/REVOKE/USER-mut, DROP/TRUNCATE/DELETE, OUTFILE/DUMPFILE/LOAD DATA, SYSTEM/SHUTDOWN/SOURCE, DEFINER routines/triggers/views/events, PREPARE/EXECUTE, SET GLOBAL/@@global, INSTALL PLUGIN, CREATE SERVER, HANDLER, DO, CALL — :39-105).
- Full-file chunked scan (1 MB) with a 1 MB carry-tail (`SQL_SCAN_TAIL_BYTES`) so boundary-spanning statements are caught (`db-actions.ts:408-437`); header validation; advisory lock; minimal env (no HOME → no `~/.my.cnf`).

### A09 Security Logging Failures — CLEAN
- `sanitizeStderr(data, DB_PASSWORD, [DB_USER, DB_HOST, DB_NAME])` redacts on mysqldump/mysql stderr (`db-actions.ts:183/490`); LR audit-log failures logged at warn with structured payload; no secret VALUES logged; token verify hashes locally so plaintext never reaches a query param / slow-query log (`admin-tokens.ts:132-134`).

### A10 SSRF — CLEAN
- Only dynamic `fetch` is `og-photo-fetch.ts:52`. The OG-photo route pins `fetchOrigin` to the TRUSTED `siteConfig.url` (NOT `req.url`), with a dev-only fallback (`api/og/photo/[id]/route.tsx:111-116`); path component is a DB-sourced UUID derivative; per-attempt 10 s timeout + 1 MB byte cap; route is per-IP rate-limited. Inbound Host/X-Forwarded-Host cannot redirect the internal fetch.

---

## Privacy field guards — CLEAN
- `publicSelectFields` derived from `adminSelectFields` by destructure-omit (separate object reference — `data.ts:324-355`); compile-time `_privacyGuard` (`data.ts:416-417`) fails `tsc` if any of the 20 `PrivacySensitiveKeys` reappears.
- `publicMapSelectFields` (the ONLY public lat/long exposure) is `map_visible`-JOIN-gated and has its own `_mapPrivacyGuard` allowing exactly lat/long (`data.ts:427-430`).
- `npm test privacy-fields.test.ts` → 8 passed. `npm run typecheck` → clean (so both compile-time guards + the `_ColorKeysAreSettingKeys` color-key guard hold).

## Sanitizers — CLEAN
- `csv-escape.ts`: strips C0/C1, strips Unicode bidi/zero-width via shared `UNICODE_FORMAT_CHARS` global twin (closes the ZWSP-prefix bypass — JS `\s` does NOT match U+200B), collapses CR/LF, formula-prefix guard `/^\s*[=+\-@]/` with leading-whitespace tolerance, double-quote wrap+double.
- `og-sanitize.ts`: GLOBAL-flag `stripUnicodeFormatting` + C0 strip; one shared helper imported by both OG routes + the JSON-LD page.
- `validation.ts`: `UNICODE_FORMAT_CHARS = /[᠎​-‏‪-‮⁠⁦-⁩﻿￹-￻]/` covers all documented ranges; non-global `.test()` variant + global strip variant correctly separated (no `lastIndex` state bug).

## Path traversal / symlink — CLEAN
- `serve-upload.ts`: `ALLOWED_UPLOAD_DIRS` whitelist (jpeg/webp/avif), `SAFE_SEGMENT=/^[a-zA-Z0-9._-]+$/` per segment, explicit `.`/`..`/empty/length rejection, ext↔dir match, `lstat` symlink+non-file rejection, `realpath` containment (`resolvedPath.startsWith(resolvedRoot + sep)`) — layered defense-in-depth (`serve-upload.ts:133-184`).

## Rate limiting — CLEAN
- Public mutating + expensive-GET routes all pre-increment before work: semantic/similar search (`preIncrementSemanticAttempt` + rollback), OG (`preIncrementOgAttempt`), share/login/account buckets. Bounded maps with hard key caps. `lint:public-route-rate-limit` PASS.

---

## Lint-gate enforcement (RAN scanners against real files)
- `npm run lint:api-auth` → **PASS** (both admin routes OK).
- `npm run lint:action-origin` → **PASS** (all mutating actions enforce same-origin provenance).
- `npm run lint:public-route-rate-limit` → **PASS** (all public routes OK / no-mutating).

## Re-validated prior false-positives (re-refuted — guards present, NO new evidence to re-file)
- `color-detection.ts` NCLX `colr` reads — preceding bounds checks (depth/scan caps + `pos+size>buffer.length`).
- `gps-exif-strip.ts` ILOC walker — every read preceded by `pos+N>dataEnd`; counts capped.
- `gain-map-detection.ts` / `icc-extractor.ts` — preceding bounds checks confirmed.
- `affectedRows` optional-chaining — REFUTED again (handler checks `updateResult.affectedRows === 0` directly; LR/backfill paths check `affectedRows` per documented contract).

---

## Dependency Audit

`npm audit --omit=dev` → **2 moderate** (one advisory, two nested packages):

- **postcss < 8.5.10** — GHSA-qx2v-qp2m-jg93 (XSS via unescaped `</style>` in CSS stringify output), pulled transitively by **next**.
- **Resolution map:** the app's DIRECT `postcss` and ALL build-tool transitives (autoprefixer, tailwindcss/postcss-import/-js/-load-config/-nested, vite) resolve to **8.5.10 (FIXED)**. The ONLY vulnerable copy is **postcss@8.4.31 bundled under `node_modules/next/node_modules/postcss`** — internal to Next 16.2.6's own toolchain.

**Exploitability assessment in THIS app: NOT exploitable (POLISH, confidence High).**
- postcss runs at **build time** only (Tailwind/autoprefixer compilation). `grep` confirms ZERO runtime postcss usage in app code (`from 'postcss'` / `postcss(` — none in `src/`).
- The app never passes untrusted/runtime user input through postcss; CSS is author-controlled at build. The advisory's sink (stringifying attacker-controlled CSS into an HTML `<style>` context) has no reachable path here.
- All `dangerouslySetInnerHTML` sinks are JSON-LD via `safeJsonLd` (+ CSP nonce), not CSS.
- The `audit fix --force` remediation would DOWNGRADE next to 9.3.3 (a catastrophic breaking change) — strictly worse than the non-exploitable transitive. The correct path is the routine Next minor/patch bump (Next ships its own postcss; a future `next@16.2.x`/`16.3.x` will dedupe to 8.5.10+). No action required this cycle.

**Recommendation (DEFERRED, exit criterion):** re-file only if (a) a future code change introduces a runtime postcss/CSS-transform path on user input, OR (b) the advisory severity is reclassified to High/Critical. Otherwise clear it on the next routine Next.js upgrade.

---

## Verdict
- **NEW security DEFECTS: 0.** **POLISH (security): 0** actionable (postcss is non-exploitable + deferred).
- **Cross-confirmation for the lead: 1 correctness DEFECT (LR upload omits the 6 processing settings — `api/admin/lr/upload/route.ts:420-444`).** High confidence. Same class as CR-R9C6-01, owned by the code-reviewer/executor lane; no security/privacy angle (GPS strip is applied; none of the 6 is a security control).
- All in-scope security surfaces (auth/session, admin-auth chain, 8 API routes, path/symlink, Drizzle/raw-SQL, restore/backup + SQL scanner, SSRF, sanitizers, privacy guards, rate limiting, LR PAT route, 3 lint gates) verified clean against HEAD `feb63faa`.
