# Verifier Report — GalleryKit R5C1

**Date:** 2026-06-11  
**Scope:** CLAUDE.md claim vs actual code verification — no sampling; every documented claim checked against file+line evidence.

---

## Findings

### VER-R5C1-01 — Settings-hash coverage description is stale (MEDIUM)

**Claim (CLAUDE.md line 257):**
> "The settings hash (P4-E2) covers `wide_gamut_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`"

**Actual code (`apps/web/src/lib/settings-hash.ts` lines 34-46):**
```
COLOR_IMPACTING_KEYS = [
    'wide_gamut_jpeg_chroma',
    'sdr_jpeg_chroma',
    'avif_effort',
    'force_srgb_derivatives',
    'wide_gamut_max_source_pixels',
    'image_quality_webp',
    'image_quality_avif',
    'image_quality_jpeg',
    'image_sizes',
]
```
Nine keys, not three. Six keys (`sdr_jpeg_chroma`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`) are undocumented in this specific claim.

**Severity:** MEDIUM  
**Confidence:** confirmed  
**Classification:** Documentation drift — the settings-hash.ts docblock itself (lines 7–9) also only lists the original 3 keys, so the drift exists in two places.

---

### VER-R5C1-02 — ETag formula in CLAUDE.md contains `settingsHash.slice(0,8)` but code uses `${settingsHash}` directly (LOW)

**Claim (CLAUDE.md line 257):**
> `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash.slice(0,8)}"`

**Actual code (`apps/web/src/lib/serve-upload.ts` line 201):**
```typescript
const etag = `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`;
```
No `.slice(0,8)` call. The result is functionally identical because `settings-hash.ts` already returns exactly 8 hex characters (`HASH_LENGTH = 8`, line 48), but the formula in CLAUDE.md is misleading — it implies the caller truncates, when the truncation happens inside the library.

**Severity:** LOW  
**Confidence:** confirmed  
**Classification:** Minor documentation inaccuracy.

---

### VER-R5C1-03 — SESSION_SECRET description inconsistency: CLAUDE.md says "random-64-char-hex", validation accepts min 32 chars (LOW)

**Claim (CLAUDE.md "Environment Variables" section):**
> `SESSION_SECRET=<random-64-char-hex>`

**Actual validation (`apps/web/src/lib/session.ts` lines 20–32):**
```typescript
if (envSecret && envSecret.length >= 32) { ... }
// Production: throws if < 32 chars
'SESSION_SECRET env var is required in production (min 32 chars).'
```
The minimum enforced is 32 characters, not 64. `openssl rand -hex 32` correctly produces 64 hex chars, so the example command is fine — but "64-char-hex" is not enforced and the description could mislead users who supply a 32–63 char secret that passes validation. The `.env.local.example` comment says `generate-with: openssl rand -hex 32` which is consistent with 64 chars; the inconsistency is only in the CLAUDE.md body text.

**Severity:** LOW  
**Confidence:** confirmed  
**Classification:** Documentation imprecision.

---

### VER-R5C1-04 — i18n key parity: en.json / ko.json are in sync (PASS)

**Claim (implied by i18n documentation):** Both language files should have matching key sets.

**Actual:** Python flatten check — EN keys: 829, KO keys: 829, missing in KO: 0, missing in EN: 0.

**Severity:** N/A — no finding  
**Confidence:** confirmed  
**Classification:** Verified correct.

---

### VER-R5C1-05 — IMAGE_PIPELINE_VERSION = 7 (PASS)

**Claim (CLAUDE.md line 92):** `IMAGE_PIPELINE_VERSION = 7`

**Actual (`apps/web/src/lib/gallery-config-shared.ts` line 21):** `export const IMAGE_PIPELINE_VERSION = 7;`

sw.js stamp: `SW_VERSION = '46aa87f3-p7'` — consistent.

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-06 — Rate-limit buckets: per-IP + per-account(acct:<sha256-prefix>), 5 attempts / 15-min (PASS)

**Claim (CLAUDE.md "Authentication & Sessions"):**
> per-IP (5 attempts / 15-min window) and per-account (`acct:<sha256-prefix>` key, same 5/15-min limits)

**Actual (`apps/web/src/lib/rate-limit.ts`):**
- `LOGIN_WINDOW_MS = 15 * 60 * 1000` (line 62)
- `LOGIN_MAX_ATTEMPTS = 5` (line 63)
- `ACCOUNT_RATE_LIMIT_PREFIX = 'acct:'` (line 111)
- Key: `acct:` + `sha256(normalizedUsername).slice(0, ACCOUNT_RATE_LIMIT_HASH_LENGTH)` where `ACCOUNT_RATE_LIMIT_HASH_LENGTH = 45 - 5 = 40` chars (lines 110–112, 148–152)

CLAUDE.md says "sha256-prefix" which is accurate (it is a sha256 digest prefix). All limits confirmed.

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-07 — Advisory lock names match documented set (PASS)

**Claim (CLAUDE.md "Race Condition Protections" / "Advisory-lock scope note"):**
Lists: `gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit:image-processing:{jobId}`

**Actual (`apps/web/src/lib/advisory-locks.ts`):**
All six are exported as named constants. Confirmed identical.

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-08 — ETag formula in settings-hash.ts docblock also only lists 3 keys (MEDIUM, same issue as VER-R5C1-01)

**File:** `apps/web/src/lib/settings-hash.ts` lines 7–9 (module docblock):
```
 *   - `wide_gamut_jpeg_chroma` (4:4:4 / 4:2:0 chroma subsampling)
 *   - `avif_effort` (encoder effort 0-9)
 *   - `force_srgb_derivatives` (gamut-collapse override)
```
The in-file docblock is the primary documentation for this module; it predates the later additions of 6 more keys and was never updated. Same drift as VER-R5C1-01, but in the source file itself.

**Severity:** MEDIUM  
**Confidence:** confirmed  
**Classification:** Source-code documentation drift.

---

### VER-R5C1-09 — Path traversal prevention claims (PASS)

**Claim:** `SAFE_SEGMENT` regex + `ALLOWED_UPLOAD_DIRS` whitelist + `resolvedPath.startsWith()` containment + `lstat()` symlink rejection

**Actual (`apps/web/src/lib/serve-upload.ts`):**
- `ALLOWED_UPLOAD_DIRS = new Set(['jpeg', 'webp', 'avif'])` (line 15)
- `SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/` (line 16)
- `resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)` (line 172)
- `stats.isSymbolicLink()` check at line 167

All four mechanisms confirmed.

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-10 — Backfill column set matches CLAUDE.md (PASS)

**Claim (CLAUDE.md):** `pipeline_version`, `icc_profile_name`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `color_pipeline_decision`, `was_downscaled`, `avif_10bit`

**Actual (both `scripts/backfill-color-pipeline.ts` lines 313–322 and `admin-backfill-runner.ts` lines 224–249):** All 10 columns are SET in both code paths. Test `backfill-color-pipeline.test.ts` (AGG-02) asserts the exact column set at line 180–189.

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-11 — SW template HTML offline fallback: 24 h TTL, 50-entry cap, admin render header (PASS)

**Claims:**
- 24 h TTL on HTML offline cache
- 50-entry cap
- `x-gk-admin-render: 1` header from proxy.ts

**Actual:**
- `HTML_MAX_AGE_MS = 24 * 60 * 60 * 1000` (sw.template.js line 32)
- `MAX_HTML_ENTRIES = 50` (sw.template.js line 33)
- `response.headers.set('x-gk-admin-render', '1')` in proxy.ts line 129

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-12 — DB connection pool: 10 connections, queue limit 20, keepalive (PASS)

**Claim:** "Connection pool: 10 connections, queue limit 20, keepalive enabled."

**Actual (`apps/web/src/db/index.ts`):**
- `connectionLimit: 10` (line 19)
- `queueLimit: 20` (line 20)
- `enableKeepAlive: true` (line 23)

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-13 — Session purge "hourly background job" (PASS)

**Claim:** "Expired sessions purged automatically (hourly background job)"

**Actual (`apps/web/src/lib/image-queue.ts` line 656–661):**
```typescript
state.gcInterval = setInterval(() => { ... }, 60 * 60 * 1000); // every hour
```
The interval calls `purgeExpiredSessions()`. Confirmed.

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-14 — Cache-Control: `public, max-age=3600, must-revalidate`, NOT immutable (PASS)

**Claim:** "derivatives use `Cache-Control: public, max-age=3600, must-revalidate` — deliberately NOT `immutable`"

**Actual (`apps/web/next.config.ts` line 66):**
```typescript
{ key: 'Cache-Control', value: 'public, max-age=3600, must-revalidate' },
```
No `immutable`. Nginx config also confirmed at separate locations.

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-15 — CLAUDE.md nginx body cap claims match actual nginx config (PASS)

**Claim:** "2 MiB default, 64 KiB for login, 250 MiB for `/admin/db` restore, 216 MiB for admin dashboard uploads"

**Actual (`apps/web/nginx/default.conf`):**
- Global: `client_max_body_size 2M` (line 31)
- Login: `client_max_body_size 64K` (line 58)
- DB restore: `client_max_body_size 250M` (line 75)
- Admin uploads: `client_max_body_size 216M` (line 92)

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-16 — blur-data-url: 4 KB cap, MIME contract, wiring tests exist (PASS)

**Claims:** `isSafeBlurDataUrl` / `assertBlurDataUrl`, 4 KB cap, tests at `process-image-blur-wiring.test.ts` and `images-action-blur-wiring.test.ts`

**Actual:**
- `MAX_BLUR_DATA_URL_LENGTH = 4096` (`apps/web/src/lib/blur-data-url.ts` line 45)
- Both test files exist and are not stubs

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-17 — GPS stripping: Sharp `withMetadata()` warning is accurate (PASS)

**Claim:** "Never use Sharp `withMetadata()` for stripping — in Sharp 0.33+ it KEEPS input EXIF"

**Actual (`apps/web/src/lib/process-image.ts` lines 1455–1472):** Code contains the warning comment and uses `keepIccProfile()` instead. No `withMetadata()` calls in the GPS-strip path.

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-18 — avif_effort default 6 (PASS)

**Claim (CLAUDE.md Admin Tunables table):** `avif_effort` default `6`

**Actual (`apps/web/src/lib/gallery-config-shared.ts` line 128):**
```typescript
avif_effort: '6',
```

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-19 — tag_names GROUP_CONCAT pattern (PASS)

**Claim (CLAUDE.md "Performance Optimizations"):** Uses `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` via `tagNamesAgg` constant

**Actual (`apps/web/src/lib/data.ts` line 601):**
```typescript
const tagNamesAgg = sql<string | null>`GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY ${tags.name})`;
```

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-20 — `_PrivacySensitiveKeys` compile-time guard and `SENSITIVE_KEYS` fixture parity (PASS)

**Claim:** Compile-time guard enforces admin-only fields; fixture test at `privacy-fields.test.ts` locks the contract.

**Actual:**
- `_PrivacySensitiveKeys` type guard at `data.ts` line 417–419
- `_SensitiveKeysInPublic` type produces TS error if any sensitive key leaks into publicSelectFields
- `privacy-fields.test.ts` `SENSITIVE_KEYS` fixture contains 16 keys and tests both directions (admin has them, public doesn't)

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-21 — HMAC-SHA256 session tokens, timingSafeEqual (PASS)

**Claim:** "Session tokens: HMAC-SHA256 signed, verified with `timingSafeEqual`"

**Actual (`apps/web/src/lib/session.ts`):**
- `createHmac('sha256', secret)` at line 87
- `timingSafeEqual` at line 117

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-22 — OG image backslash rejection (SEC-R4C20-01) (PASS)

**Claim (git log):** `fix(seo): reject backslash in OG image URL same-origin gate (SEC-R4C20-01)`

**Actual (`apps/web/src/lib/seo-og-url.ts` lines 10–18):** Comment confirms backslash rejection in relative branch. Code present and documented.

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-23 — Migration post-condition assertion throws on silently-skipped migrations (PASS)

**Claim:** `throw new Error(\`Drizzle silently skipped N migration(s): tag1, tag2, …\`)`

**Actual (`apps/web/scripts/migrate.js` line 707):**
```javascript
`[Migration] Drizzle silently skipped ${missing.length} migration(s): ${tags}. `
```
Post-condition assertion confirmed.

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-24 — check-action-origin.ts scans for requireSameOriginAdmin and @action-origin-exempt (PASS)

**Claim (CLAUDE.md "Lint Gates"):** Scans for `requireSameOriginAdmin()`, accepts `@action-origin-exempt: <reason>`, rejects aliased exports.

**Actual (`apps/web/scripts/check-action-origin.ts`):**
- `@action-origin-exempt` check at line 104
- `requireSameOriginAdmin` detection at lines 112, 306
- Aliased export rejection at line 320

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-25 — admin-backfill-runner-detection-failure.test.ts: no pipeline_version bump on detection failure (PASS)

**Claim:** "never strand stale color metadata at the current version"

**Actual (`apps/web/src/__tests__/admin-backfill-runner-detection-failure.test.ts` lines 193–196):**
```typescript
// CONTRACT: no UPDATE on the detection-failure path may set pipeline_version.
expect(text).not.toContain('pipeline_version');
```

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-26 — data-tag-names-sql.test.ts and other claimed test files exist (PASS)

Files verified to exist:
- `data-tag-names-sql.test.ts` — EXISTS
- `admin-backfill-runner-detection-failure.test.ts` — EXISTS
- `process-image-blur-wiring.test.ts` — EXISTS
- `images-action-blur-wiring.test.ts` — EXISTS
- `backfill-color-pipeline.test.ts` — EXISTS
- `sw-template-contract.test.ts` — EXISTS
- `privacy-fields.test.ts` — EXISTS
- `touch-target-audit.test.ts` — EXISTS

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-27 — CLAUDE.md documented commands match package.json scripts (PASS)

**Claim:** `npm run dev`, `npm run build`, `npm run db:push`, `npm run db:seed`, `npm run init`, `npm run lint --workspace=apps/web`

**Actual (root `package.json`):** All root-level commands present (`dev`, `build`, `lint`, `test`, `test:e2e`). Apps/web scripts include `db:push`, `db:seed`, `init`.

Minor: CLAUDE.md says `npm run init` under "run from apps/web" — root package.json does not have `init` but `apps/web/package.json` does. This is consistent with the "run from apps/web" qualifier.

**Severity:** N/A — no finding  
**Confidence:** confirmed

---

### VER-R5C1-28 — SESSION_SECRET min-length: CLAUDE.md says "64-char-hex" but code enforces min 32 chars (LOW, same as VER-R5C1-03)

See VER-R5C1-03 — production enforcement is `length >= 32`, not 64.

---

## Summary

| ID | Severity | Description |
|----|----------|-------------|
| VER-R5C1-01 | MEDIUM | settings-hash coverage in CLAUDE.md describes 3 keys; actual code hashes 9 keys |
| VER-R5C1-08 | MEDIUM | settings-hash.ts module docblock also lists only 3 keys (same drift, in source) |
| VER-R5C1-02 | LOW | ETag formula in CLAUDE.md says `settingsHash.slice(0,8)`; code uses `${settingsHash}` (same result but misleading) |
| VER-R5C1-03 | LOW | CLAUDE.md says "random-64-char-hex" for SESSION_SECRET; enforcement is min 32 chars |

**CRIT:** 0  
**HIGH:** 0  
**MEDIUM:** 2  
**LOW:** 2  
**Passing claims verified:** 24 of 28 checks

## Recommendation

APPROVE with two documentation fixes:

1. **VER-R5C1-01 + VER-R5C1-08 (MEDIUM):** Update the CLAUDE.md ETag/cache-invalidation paragraph and the `settings-hash.ts` module docblock to list all 9 `COLOR_IMPACTING_KEYS`. The operational consequence of the stale description is that a developer reading the docs would not know that `image_quality_*` or `image_sizes` changes also invalidate the ETag — they would expect manual workarounds that are already handled automatically.

2. **VER-R5C1-02 (LOW):** Correct CLAUDE.md ETag formula to `${settingsHash}` (no `.slice`), or add a note that the 8-char truncation happens inside `settings-hash.ts`.

3. **VER-R5C1-03 (LOW):** Either update CLAUDE.md to say "min-32-char secret" or leave the `openssl rand -hex 32` recommendation but remove the "64-char-hex" characterisation to avoid confusion when operators supply a valid 32–63 char secret.

No functional defects found. All contracts, test files, constants, and behavioral claims are verified against actual code.
