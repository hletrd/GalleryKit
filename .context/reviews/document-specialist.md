# Document-Specialist Review — Cycle 13

**Date:** 2026-06-27
**HEAD:** 2a9976a1 (pre-cycle-12-code-commits; cycle-12 CLAUDE.md fixes AND code fixes are confirmed present)
**Agent:** document-specialist (Sonnet 4.6)

---

## Cycle 12 Doc Fixes — Verification

All three CLAUDE.md documentation fixes from the cycle 12 plan (Task 6, AGG-R12-03/06/07) are confirmed landed:

| Fix | CLAUDE.md line | Verified value | Source |
|-----|----------------|----------------|--------|
| `NEXT_UPLOAD_BODY_MAX_BYTES` default | line 109 | `278921216` | `upload-limits.ts` `DEFAULT_SERVER_ACTION_UPLOAD_BODY_BYTES` |
| `smart_collections` column | line 148 | `query_json` | `schema.ts:297` |
| Deployment Checklist step 3 site-config keys | lines 620-629 | flat snake_case: `title`, `description`, `url`, `locale`, `author`, `nav_title`, `home_link`, `footer_text`, `google_analytics_id` | `site-config.example.json` |

## Cycle 12 Code Fixes — Spot-Verification

| Task | File | Evidence |
|------|------|----------|
| Task 1: graceful shutdown + timer (AGG-R12-01) | `instrumentation.ts:21-65` | `shutdownTimer` captured, `.unref()`'d, cleared in `finally`; `process.exit()` called after drain |
| Task 3: db init-race timer (AGG-R12-04) | `db/index.ts:88-112` | `initTimer` captured, `.unref()`'d, cleared in `finally` around `Promise.race` |
| Task 5: semantic route comment (AGG-R12-08) | `api/search/semantic/route.ts:8` | Comment reads "Scans up to SEMANTIC_SCAN_LIMIT (2000)" — correct |

Tasks 2, 4, 7 not spot-checked in this pass (AVIF partial read, queue-guard hardening, prioritizeSecurityFields test). Those are code correctness tasks, not documentation accuracy tasks.

---

## New Findings — Cycle 13

### DOC-13-01 (MEDIUM): Admin token HTTP header name wrong

**CLAUDE.md claim (line 147):**
> "The plugin (`/api/admin/lr/upload`) accepts the token in an `X-Admin-Token` header"

**Actual code (`apps/web/src/lib/api-auth.ts:14`):**
```typescript
const TOKEN_HEADER = 'x-gallerykit-token';
```

The header is `x-gallerykit-token`, not `X-Admin-Token`. Any developer implementing the Lightroom Classic publish plugin or testing the PAT endpoint against CLAUDE.md would use the wrong header name and receive 401 errors with no obvious diagnostic.

**Fix:** Replace `X-Admin-Token` with `x-gallerykit-token` in the `admin_tokens` row in CLAUDE.md.

---

### DOC-13-02 (MEDIUM): Admin token format and length wrong

**CLAUDE.md claim (line 147):**
> "Each token is a 32-char random hex string scoped to one admin user"

**Actual code (`apps/web/src/lib/admin-tokens.ts:5,19-22,50`):**
```
TOKEN_PREFIX = 'gk_'                 // 3 chars
TOKEN_RANDOM_BYTES = 32              // 32 random bytes
TOKEN_PLAINTEXT_LENGTH = 3 + 43 = 46 // base64url(32 bytes) = 43 chars
plaintext = TOKEN_PREFIX + random.toString('base64url')
```
File header comment: "Tokens are issued in the format `gk_<base64url(32 random bytes)>` (43 chars for base64url)".

The token is:
- 46 characters total (not 32)
- base64url encoded (not hex)
- prefixed with `gk_` (not a bare random string)

Both the length and encoding description in CLAUDE.md are wrong. A developer adding token-length validation, format-checking in the Lightroom plugin, or writing migration tooling would use incorrect constraints.

**Fix:** Replace "32-char random hex string" with "46-char `gk_`-prefixed base64url string (`gk_` + base64url(32 random bytes))" in the `admin_tokens` row.

---

### DOC-13-03 (LOW): process-image.ts line citation points to wrong block

**CLAUDE.md claim (lines ~243-246):**
> "the encoder does NOT keep a single decoded instance across formats/sizes — it opens a fresh decode per output to eliminate shared-state contamination, trading decode reuse for correctness (`process-image.ts:1131-1135`)"

**Actual code:**
- Lines 1131-1135 are inside the hard-link / `copyFile` same-size deduplication block (handling `lastRendered.resizeWidth === resizeWidth`). Nothing there documents fresh-decode semantics.
- The WI-14 / R8-R8 comment that explains the fresh-sharp-per-format decision is at line 1157: `// WI-14 / R8-R8: fresh sharp instance per format for ALL paths, …`

**Fix:** Update the parenthetical cite from `process-image.ts:1131-1135` to `process-image.ts:1157`.

---

### DOC-13-04 (LOW): settings-hash.ts line range off by one at both ends

**CLAUDE.md claim:** "settings-hash.ts:41-53"

**Actual code:** The `COLOR_IMPACTING_KEYS` array is declared at lines 42-54 (one-indexed from file start).

Minor cosmetic drift; does not mislead about logic.

**Fix:** Update "41-53" to "42-54".

---

## Verified-Correct Claims (sample)

The following CLAUDE.md claims were checked against source and confirmed accurate:

| Claim | Source | Status |
|-------|--------|--------|
| `IMAGE_PIPELINE_VERSION = 7` defined at `gallery-config-shared.ts:21` | `gallery-config-shared.ts:21` | ✓ |
| `COLOR_IMPACTING_KEYS` = 9 entries | `settings-hash.ts:42-54` | ✓ |
| `HASH_LENGTH = 8` in `settings-hash.ts` | `settings-hash.ts:68` | ✓ |
| Pool: `connectionLimit=10`, `queueLimit=20`, keepAlive | `db/index.ts:31-36` | ✓ |
| `UPLOAD_MAX_TOTAL_BYTES` default = 2,147,483,648 (2 GiB) | `upload-limits.ts` | ✓ |
| `UPLOAD_MAX_FILES_PER_WINDOW` default = 100 | `upload-limits.ts` | ✓ |
| `IMAGE_MAX_INPUT_PIXELS` default = 268,435,456 (256 MiB pixels) | `process-image.ts:330` | ✓ |
| `IMAGE_MAX_INPUT_PIXELS_TOPIC` default = 67,108,864 (64 MiB pixels) | `process-image.ts:333` | ✓ |
| Argon2id: `memoryCost=65536`, `timeCost=3`, `parallelism=4` | `password-hashing.ts` | ✓ |
| `SEMANTIC_SCAN_LIMIT=2000`, `SEMANTIC_TOP_K_MAX=50`, default topK=20 | `clip-embeddings.ts:16-18` | ✓ |
| `OG_PHOTO_MAX_BYTES = 1 MB` (1024×1024) | `og-photo-fetch.ts:31` | ✓ |
| `HEAD_REVALIDATE_TIMEOUT_MS = 300` ms in service worker | `public/sw.js:38` | ✓ |
| `avif_effort` default = 6 (Sharp native default is 4) | `gallery-config-shared.ts:118` | ✓ |
| Blur placeholder: `.resize(16, undefined, {fit:'inside'})` | `process-image.ts:905` | ✓ (CLAUDE.md "16px" correct) |
| `MAX_BLUR_DATA_URL_LENGTH = 4096` | `blur-data-url.ts` | ✓ |
| `avif_10bit` present in `publicSelectFields` | `data.ts:358+` (not in omit list) | ✓ |
| React `cache()` wraps 10 data-access functions | `data.ts` | ✓ |
| Advisory lock names: all 6 match | `advisory-locks.ts:19-44` | ✓ |
| NCLX primaries/transfer/matrix maps | `color-detection.ts:171-225` | ✓ |
| `gamma18` from ICC name heuristics (ProPhoto path `color-detection.ts:99-107`) | line 107 | ✓ |
| Nginx body-size caps: 2M/64K/250M/216M/216M/2M | `nginx/default.conf` | ✓ |
| DB schema indexes (8 image indexes, image_views country+referrer) | `schema.ts:112-231` | ✓ |
| `smart_collections` at `schema.ts:293`, `query_json` column at `schema.ts:297` | confirmed | ✓ |
| Session: HMAC-SHA256, `timingSafeEqual` | `session.ts:87,108,117` | ✓ |
| `resolveBackfillConcurrency` formula → cap=2 at pool=10 | `admin-backfill-runner.ts` | ✓ |

---

## Summary Table

| ID | Severity | File | Description |
|----|----------|------|-------------|
| DOC-13-01 | MEDIUM | `CLAUDE.md:147` / `api-auth.ts:14` | Header name `X-Admin-Token` → actual `x-gallerykit-token` |
| DOC-13-02 | MEDIUM | `CLAUDE.md:147` / `admin-tokens.ts:5,19-22` | Token format "32-char hex" → actual 46-char base64url with `gk_` prefix |
| DOC-13-03 | LOW | `CLAUDE.md:~245` / `process-image.ts:1157` | Line cite 1131-1135 → actual WI-14 comment at line 1157 |
| DOC-13-04 | LOW | `CLAUDE.md` / `settings-hash.ts:42-54` | Line range "41-53" → actual 42-54 |

No CRITICAL or HIGH mismatches found. Cycle 12 doc fixes all confirmed landed. Verified-correct count: 30+ individual claims across security, image processing, database, configuration, and infrastructure surfaces.
