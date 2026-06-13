# Document-Specialist Review — Run-5 Cycle-3

**Date:** 2026-06-12
**Reviewer:** document-specialist lane
**Baseline diff:** `aa5266b5..HEAD` (cycle-2 commits)
**Suppression honoured:** plan-315, plan-316, plan-317, plan-322; cycle-2 aggregate cross-checked.

---

## VERIFIED CLEAN (cycle-2 fixes confirmed applied)

- **AGG-R5C2-04** (HIGH) Firefox `color-gamut` MQ claim: browser matrix row now shows `✓ (FF 110+)` and R10-H4 prose correctly states Firefox 110+ reaches the MQ branch. Code comment at `use-display-capability.ts:64,103` matches. **FIXED.**
- **AGG-R5C2-20** NCLX transfer code 1: CLAUDE.md now shows `1=BT.709 (labelled 'srgb' — practical SDR approximation; 13=sRGB IEC61966-2-1 is the canonical code; full mapping in color-detection.ts NCLX_TRANSFER_MAP)`. **FIXED.**
- **AGG-R5C2-21** SW no-store/no-cache wording: sw.template.js comment now says "Next.js emits no-cache response headers"; CLAUDE.md SW section updated accordingly. **FIXED.**
- **AGG-R5C2-22** serving-precedence inversion: CLAUDE.md now reads "Next resolves requests in order: headers() config → filesystem (pages + public/) → route handlers". **FIXED.**
- **AGG-R5C2-23** Stripe async_payment_succeeded: CLAUDE.md schema table line for `entitlements` now has operator warning. **FIXED.**
- **AGG-R5C2-47** DB index list: `uploaded_by` and migration-0021 `image_views` indexes now listed. **FIXED.**
- **AGG-R5C2-48** WCAG 2.5.8 reference added alongside 2.5.5. **FIXED.**
- **AGG-R5C2-49** withMetadata GPS note: CLAUDE.md now says "keeps most input metadata (EXIF/XMP/IPTC) including GPS coordinates". **FIXED.**
- **AGG-R5C2-51** drizzle migrator line ref marked "(internal reference; file/line drifts across drizzle-orm versions; informational only)". **FIXED.**
- i18n en.json / ko.json: exactly 832 keys each, zero missing on either side. **PARITY CONFIRMED.**
- Argon2id work factors: CLAUDE.md `memoryCost=65536 / 64 MiB, timeCost=3, parallelism=4` matches `password-hashing.ts:11-14`. **CORRECT.**
- IMAGE_PIPELINE_VERSION = 7: matches `gallery-config-shared.ts:21`. **CORRECT.**
- nginx body-size limits (2 MiB global / 64 KiB login / 250 MiB DB restore / 216 MiB uploads): matches `nginx/default.conf`. **CORRECT.**
- Advisory lock scope note lists all 6 lock names matching `advisory-locks.ts` exports. **CORRECT.**
- Default image sizes [640,1536,2048,4096,5120,7680]: matches `gallery-config-shared.ts:90`. **CORRECT.**
- site-config.json path in Key Files table (`apps/web/src/site-config.json`): correct.
- Deployment Checklist step 2 (`openssl rand -hex 32`): SESSION_SECRET min-32-char enforcement confirmed in `session.ts:32,45`. **CORRECT.**

---

## FINDINGS

### DOC-R5C3-01
- **Severity:** MED
- **Confidence:** confirmed
- **Status:** confirmed
- **Doc location:** `CLAUDE.md` line 260 (ETag/cache-invalidation section)
- **Code file:** `apps/web/src/lib/settings-hash.ts:34-38,48,61`; `apps/web/src/lib/serve-upload.ts:201`
- **Claim vs reality:**
  CLAUDE.md states: `serve-upload.ts emits W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash.slice(0,8)}"` and says the hash "covers `wide_gamut_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`".
  Reality (1): `settings-hash.ts` already truncates internally (`HASH_LENGTH=8`, `digest('hex').slice(0,HASH_LENGTH)`) so `getServingColorSettingsHash()` returns exactly 8 chars. The call site at `serve-upload.ts:201` uses `${settingsHash}` with NO `.slice(0,8)`. The `.slice(0,8)` in the CLAUDE.md formula is spurious — it implies a 64-char hash being sliced, which is incorrect.
  Reality (2): `COLOR_IMPACTING_KEYS` in `settings-hash.ts:34-38` has **5** keys: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`. CLAUDE.md names only 3, omitting `sdr_jpeg_chroma` and `wide_gamut_max_source_pixels`.
- **Impact:** A maintainer following the doc formula might add a spurious `.slice()` at a new call site; the incomplete key list could lead to a setting being omitted from future COLOR_IMPACTING_KEYS additions.
- **Note:** This finding is in plan-316 suppression list (VER-R5C1-01) as a MED scheduled fix. Re-reporting as **still open** because the fix has NOT been applied at HEAD.
- **Suggested correction:** Replace `.slice(0,8)` with no-slice in the formula (the 8-char truncation is inside the library); replace the 3-key enumeration with "5 keys: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels` (see `settings-hash.ts:COLOR_IMPACTING_KEYS`)".

---

### DOC-R5C3-02
- **Severity:** MED
- **Confidence:** confirmed
- **Status:** confirmed
- **Doc location:** `CLAUDE.md` line 266 (WideGamutHint paragraph); browser matrix row at line 316
- **Code file:** `apps/web/src/lib/use-display-capability.ts:64,103`
- **Claim vs reality:**
  CLAUDE.md line 266: "Uses `useDisplayCapability` (NOT raw matchMedia) so **Firefox 124+** doesn't false-positive the hint."
  Reality: The hook's comments at lines 64 and 103 say "Firefox **110+** supports (color-gamut: p3) MQ". The browser matrix itself (line 316) correctly shows `✓ (FF 110+)` and R10-H4 prose (lines 322-325) correctly describes Firefox 110+ behavior.
  The WideGamutHint prose paragraph was partially updated by the AGG-R5C2-04 fix but the lead sentence on line 266 was left with "124+", creating an internal inconsistency within the same file.
- **Impact:** A maintainer reading only the WideGamutHint bullet sees "124+" and may believe the hint is still non-functional on FF 110–123, potentially making incorrect product decisions about Firefox support messaging.
- **Suggested correction:** Change line 266 to "so **Firefox ≤ 109** doesn't false-positive the hint" (the MQ fallback guards those older versions correctly; FF 110+ uses the MQ path like Chrome/Safari).

---

### DOC-R5C3-03
- **Severity:** MED
- **Confidence:** confirmed
- **Status:** confirmed
- **Doc location:** `CLAUDE.md` line 350 (Performance Optimizations section)
- **Code file:** `apps/web/src/lib/data.ts:1299,1562-1573,1614`
- **Claim vs reality:**
  CLAUDE.md: "React `cache()` wraps `getImage`, `getTopicBySlug`, `getTopicsWithAliases` for SSR deduplication"
  Reality: `data.ts` exports **9 `cache()`-wrapped functions** ending in `Cached` or wrapped at export:
  `getSmartCollectionBySlugCached`, `getImageCached`, `getTopicBySlugCached`, `getTopicsCached`, `getTagsCached`, `getTopicsWithAliasesCached`, `getImageByShareKeyCached`, `getSharedGroupCached`, `getSeoSettings` (wrapped inline).
  The doc names only 3, silently omitting 6.
- **Note:** This is plan-316 DOC-R5C1-05 (LOW, scheduled). Re-reporting as still open at HEAD.
- **Impact:** A developer adding a new cacheable query will not see the established pattern, potentially missing cache deduplication or duplicating logic.
- **Suggested correction:** "React `cache()` wraps 9 data-access functions (all exports ending in `Cached` plus `getSeoSettings` — see `data.ts:1299,1562-1614`) for SSR deduplication."

---

### DOC-R5C3-04
- **Severity:** LOW
- **Confidence:** confirmed
- **Status:** confirmed
- **Doc location:** `CLAUDE.md` Deployment Checklist step 3 (line 517)
- **Code file:** `apps/web/src/site-config.example.json` (actual path)
- **Claim vs reality:**
  CLAUDE.md step 3: "Copy `site-config.example.json` to `site-config.json`"
  Reality: Both files live at `apps/web/src/site-config.example.json` and `apps/web/src/site-config.json`. The doc omits the `apps/web/src/` prefix.
- **Note:** This is plan-316 DOC-R5C1-03 (MED, scheduled). Re-reporting as still open at HEAD.
- **Impact:** An operator running the checklist from the repo root will not find `site-config.example.json` at the stated path and the build will fail-fast with a confusing missing-file error.
- **Suggested correction:** "Copy `apps/web/src/site-config.example.json` to `apps/web/src/site-config.json`"

---

### DOC-R5C3-05
- **Severity:** LOW
- **Confidence:** confirmed
- **Status:** confirmed
- **Doc location:** `CLAUDE.md` line 219 (Image Processing Pipeline step 9)
- **Code file:** `apps/web/src/lib/blur-data-url.ts:42,45`
- **Claim vs reality:**
  CLAUDE.md: "the payload is capped at **4 KB**"
  Reality: `MAX_BLUR_DATA_URL_LENGTH = 4096` is a **character** cap, not a byte cap. 4096 base64 chars decode to ~3072 bytes (≈3 KB). The unit is wrong.
- **Note:** This is plan-316 DOC-R5C1-24 (LOW, scheduled). Re-reporting as still open at HEAD.
- **Impact:** Minor — a developer dimensioning storage or network budget using "4 KB" will over-estimate by ~33%.
- **Suggested correction:** "the payload is capped at 4096 chars (~3 KB decoded)"

---

### DOC-R5C3-06
- **Severity:** LOW
- **Confidence:** confirmed
- **Status:** confirmed
- **Doc location:** `CLAUDE.md` line 363 (Service Worker / PWA section heading)
- **Code file:** `apps/web/public/sw.template.js:9,60`
- **Claim vs reality:**
  CLAUDE.md heading: "HTML offline fallback (deliberate `no-store` exemption, R4C6 COR-R4C6-05)"
  Reality: sw.template.js line 9 says "Next.js emits **no-cache** response headers"; `isSensitiveResponse()` at line 60 checks `cc.includes('no-store')`. The heading says `no-store` but the template's own comment describes the dynamic routes as emitting `no-cache`. The body text in CLAUDE.md correctly says "Next.js emits no-cache" (matching the AGG-R5C2-21 fix), but the **section heading** still says `no-store`.
- **Impact:** The section heading contradicts the body text within the same paragraph, causing confusion about which Cache-Control directive triggers the SW exemption.
- **Suggested correction:** Change heading to "HTML offline fallback (deliberate Cache-Control exemption, R4C6 COR-R4C6-05)" or "... (`no-cache` exemption ...)".

---

### DOC-R5C3-07
- **Severity:** LOW
- **Confidence:** confirmed
- **Status:** confirmed
- **Doc location:** `apps/web/messages/en.json` vs `apps/web/messages/ko.json` — 5 keys
- **Code files:** `en.json`, `ko.json`
- **Claim vs reality:**
  5 translation keys use ICU plural format in EN (`{count, plural, one {...} other {...}}`) but simple interpolation in KO (`{count}개`):
  - `upload.hdrWarning`
  - `upload.wideGamutDownscaleWarning`
  - `search.resultsCount`
  - `serverActions.someImagesNotFound`
  - `timeline.photosCount`
  This is NOT a missing key (keys are present in both), but a format inconsistency: EN leverages ICU plural rules for grammatical number while KO uses fixed strings with `{count}` interpolation. Korean grammar does not require plural agreement, so the KO forms are linguistically correct. However, for `search.resultsCount` and `timeline.photosCount` the EN string uses `#` (not `{count}`) inside the plural clause — next-intl's ICU plural `#` is implicit; the KO string passes `{count}` explicitly. This is consistent with next-intl's per-locale format support.
- **Impact:** Near-zero runtime risk (next-intl handles both forms). However, a future locale addition must know to use locale-appropriate plural syntax rather than blindly copying the EN pattern. Not documented anywhere.
- **Suggested correction (LOW, optional):** Add a comment at the top of each message file noting "KO uses fixed-form strings with explicit {count} where EN uses ICU plural; this is intentional per Korean grammar."

---

## VERIFIED CLEAN SPOT-CHECKS (plan-319/320/321 claims)

Six plan-319/320/321 doc claims spot-checked:

1. **AGG-R5C2-01 semantic disclaimer** — `search.tsx:440-445` has the `semanticExperimentalHint` paragraph. Route docstring rewritten. **CONFIRMED.**
2. **AGG-R5C2-20 NCLX transfer code 1** — CLAUDE.md correctly notes code 1 labelled 'srgb', code 13 canonical. **CONFIRMED.**
3. **AGG-R5C2-21 no-store/no-cache wording** — sw.template.js comment and CLAUDE.md body text use "no-cache". **CONFIRMED.** (Heading inconsistency logged as DOC-R5C3-06.)
4. **AGG-R5C2-22 serving precedence** — CLAUDE.md corrected to headers() → filesystem → route handlers. **CONFIRMED.**
5. **AGG-R5C2-23 async_payment_succeeded** — operator warning added to entitlements row. **CONFIRMED.**
6. **AGG-R5C2-47 index list** — `(uploaded_by)` and migration-0021 analytics indexes present. **CONFIRMED.**

---

## SURFACES COVERED

- `CLAUDE.md` (all sections): browser matrix, ETag/cache, advisory-lock list, env var docs, commands, schema table list, image-pipeline description, lint-gate descriptions, testing section, performance optimizations, PWA/SW section, deployment checklist, color/HDR pipeline, blur contract, Argon2 section, GPS/privacy section
- `apps/web/messages/en.json` vs `ko.json`: key parity (832 each), placeholder variable mismatches, ICU plural format consistency
- `apps/web/src/lib/settings-hash.ts`: COLOR_IMPACTING_KEYS list and HASH_LENGTH
- `apps/web/src/lib/serve-upload.ts`: ETag formula at call site
- `apps/web/src/lib/use-display-capability.ts`: Firefox version comments
- `apps/web/src/lib/data.ts`: cache()-wrapped export count
- `apps/web/src/lib/blur-data-url.ts`: MAX_BLUR_DATA_URL_LENGTH
- `apps/web/src/lib/gallery-config-shared.ts`: IMAGE_PIPELINE_VERSION, default image sizes
- `apps/web/src/lib/password-hashing.ts`: Argon2id parameters
- `apps/web/src/lib/session.ts`: SESSION_SECRET min-length enforcement
- `apps/web/src/lib/advisory-locks.ts`: all lock name constants
- `apps/web/nginx/default.conf`: body-size limits
- `apps/web/docker-compose.yml`: environment variable declarations
- `apps/web/.env.local.example`: documented vs missing env vars
- `apps/web/src/site-config.example.json`: actual file location vs CLAUDE.md path
- `apps/web/public/sw.template.js`: Cache-Control handling, no-store vs no-cache
- `apps/web/src/components/search.tsx`: semantic disclaimer (plan-319 spot-check)
- Plan-319/320/321 doc claims: 6 spot-checks performed

---

## SUMMARY TABLE

| ID | Severity | Confidence | Status | Brief description |
|---|---|---|---|---|
| DOC-R5C3-01 | MED | confirmed | confirmed | CLAUDE.md ETag formula has spurious `.slice(0,8)` + names only 3 of 5 COLOR_IMPACTING_KEYS (plan-316 VER-R5C1-01 not yet applied) |
| DOC-R5C3-02 | MED | confirmed | confirmed | CLAUDE.md WideGamutHint line 266 still says "Firefox 124+" — body correctly says FF 110+; partial fix from AGG-R5C2-04 missed this line |
| DOC-R5C3-03 | MED | confirmed | confirmed | CLAUDE.md Performance lists 3 cache()-wrapped functions; code has 9 (plan-316 DOC-R5C1-05 not yet applied) |
| DOC-R5C3-04 | LOW | confirmed | confirmed | Deployment Checklist step 3 omits `apps/web/src/` prefix for site-config.example.json (plan-316 DOC-R5C1-03 not yet applied) |
| DOC-R5C3-05 | LOW | confirmed | confirmed | CLAUDE.md blur cap says "4 KB" but limit is 4096 chars (~3 KB decoded) (plan-316 DOC-R5C1-24 not yet applied) |
| DOC-R5C3-06 | LOW | confirmed | confirmed | SW section heading says "no-store exemption" but body and sw.template.js comment say "no-cache"; internal inconsistency created by AGG-R5C2-21 partial fix |
| DOC-R5C3-07 | LOW | confirmed | confirmed | i18n: 5 keys use ICU plural in EN but simple {count} interpolation in KO — linguistically valid but undocumented convention |
