# Document-Specialist Review — Cycle 7 (run-9 follow-on)

**Angle:** documentation-vs-code mismatches. Authoritative docs = on-disk `CLAUDE.md` + `AGENTS.md` at HEAD `d0920957` (clean tree). Verified each precise CLAUDE.md claim against the actual code. Did NOT trust the doc — read the code on both sides.

> **Note on the task brief:** The brief was seeded from a STALE CLAUDE.md snapshot (it expected "settings hash covers 5 COLOR_IMPACTING_KEYS" and "wraps 9 data-access functions"). The on-disk CLAUDE.md at HEAD has already been corrected past those (AGG-R7-08 fixed the key count to 9; the cache count reads 10). I verified against the on-disk file, so several "expected mismatches" from the brief are actually MATCH at HEAD. This is the valuable result: the docs are well-maintained.

---

## Verdict summary

**1 real finding, LOW severity** (the pre-known AGENTS.md `.context/plans/` imprecision). Everything else verified MATCH. No security/correctness doc mismatch.

| id | sev | conf | one-line | CLAUDE/AGENTS line | code |
|----|-----|------|----------|--------------------|------|
| DOC-C7-01 | LOW | high | AGENTS.md says `.context/plans/` "is gitignored" but tracked historical artifacts (README.md, done/*.md) exist in it | AGENTS.md:40 | `.gitignore:19-21` ignores `.context/*` + un-ignores only `reviews/`; `git ls-files .context/plans` returns tracked `README.md`, `done/*.md` |

---

## HIGH-VALUE CHECKS (all verified against code)

### Check 1 — IMAGE_PIPELINE_VERSION = 7 — **MATCH**
- CLAUDE.md (`process-image.ts` key-files row): `IMAGE_PIPELINE_VERSION = 7`.
- Code: `process-image.ts:303` re-exports `IMAGE_PIPELINE_VERSION` from `gallery-config-shared.ts`; `gallery-config-shared.ts:21` = `export const IMAGE_PIPELINE_VERSION = 7;`. The doc's per-file mention is a re-export, but the value is correct.

### Check 2 — Touch-target `<Link>`/`<a>` max- lookbehind (commit 26f68430) — **MATCH**
- CLAUDE.md "**`max-` ceiling exemption (all interactive tag classes)**" paragraph (~L510) explicitly states the lookbehind was added Button (AGG-C4-01/`40a65aef`) → select (AGG-C5-02/`07a838d6`) → `<Link>`/`<a>` (AGG-C6-04), and that "The does-not-flag self-check block carries `max-` negative fixtures for each tag class."
- Code `touch-target-audit.test.ts`:
  - `(?<!max-)` lookbehind on `<Button>` (L302-367), native `<select>` (L415-419), `<Link>` (L440-453), `<a>` (L459-472). `<Link>`/`<a>` are real FORBIDDEN-array entries (4 patterns each), gated on the ≥44 override lookahead `(?:h-1[12]|min-h-1[12]|size-1[12])`.
  - Does-not-flag self-check (L944-1003) carries `max-` ceiling fixtures for Button (977-983), `<button>` (984-985), `<select>` (990-993), `<Link>` (1000-1001), `<a>` (1002-1003).
- The on-disk CLAUDE.md correctly documents the `<Link>`/`<a>` addition (NOT just `<select>`; the brief's stale snapshot mentioned only `<select>`).

### Check 3 — GPS-strip WebP RIFF now wired (was dead before b6c4f915) — **MATCH**
- CLAUDE.md (Privacy section): "lossless byte-level GPS-IFD / GPS-bearing-XMP neutralization for JPEG / TIFF / HEIF-AVIF-HEIC / **WebP** via `gps-exif-strip.ts`".
- Code: `gps-exif-strip.ts:554` `export function stripGpsFromWebpBuffer` (RIFF EXIF chunk → TIFF scrub, L549-576). Reachability: `process-image.ts:23` imports it and `process-image.ts:1537` calls `scrubbed = stripGpsFromWebpBuffer(input)` in the strip dispatcher. The WebP path IS now reachable (not dead), and unit-tested (`strip-gps-from-original.test.ts:211,241,250`). Doc claim is now TRUE.

### Check 4 — COLOR_IMPACTING_KEYS count — **MATCH** (brief's "says 5" was stale)
- CLAUDE.md ETag/cache section L263: "covers all **9** `COLOR_IMPACTING_KEYS` (`settings-hash.ts:37-49`)" then enumerates 5 color + 3 quality + `image_sizes`, with "(AGG-R7-08 corrected the count from a stale '5')".
- Code `settings-hash.ts`: `COLOR_IMPACTING_KEYS` array = exactly 9 entries (`wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`). Module docstring also says "over the 9 settings". **Count reconciled: 9 = 9.** `HASH_LENGTH = 8`.

### Check 5 — React cache() count "10 data-access functions" — **MATCH** (brief's "9" was stale)
- CLAUDE.md L357: "wraps **10** data-access functions" — lists 9 `*Cached` exports + `getSeoSettings`.
- Code `data.ts`: exactly 10 `= cache(...)` exports: `getSmartCollectionBySlugCached` (1332), `getImageCached` (1595), `getLatestImageForOgCached` (1597), `getTopicBySlugCached` (1598), `getTopicsCached` (1599), `getTagsCached` (1600), `getTopicsWithAliasesCached` (1601), `getImageByShareKeyCached` (1603), `getSharedGroupCached` (1608), `getSeoSettings` (1649). 9 Cached + getSeoSettings = 10. The list in the doc enumerates all 9 Cached names correctly.

### Check 6 — Backfill: both entry points persist the SAME column set — **MATCH**
- CLAUDE.md (Backfill section): both paths persist "`pipeline_version`, `icc_profile_name`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `color_pipeline_decision`, `was_downscaled`, `avif_10bit`" (10 columns).
- Code `admin-backfill-runner.ts:559-568` UPDATE sets all 10: `pipeline_version`, `icc_profile_name`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `color_pipeline_decision`, `was_downscaled`, `avif_10bit`.
- Code `scripts/backfill-color-pipeline.ts:212-220` writes the same 10 (camelCase signal keys → same DB columns, + `pipeline_version` bump). Sets match.

### Check 7 — Infra spot-checks — **ALL MATCH**
- **Advisory locks:** all 6 names present in code (`apps/web/src`, excluding tests): `gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit:image-processing:{jobId}`. Matches the CLAUDE.md advisory-lock-scope list.
- **Login rate limits:** `rate-limit.ts:62` `LOGIN_WINDOW_MS = 15*60*1000` (15 min); `:63` `LOGIN_MAX_ATTEMPTS = 5`; per-account `acct:` prefix (`rate-limit.ts:111`, `auth.ts:115`) keyed on `createHash('sha256')` (`rate-limit.ts:150`). CLAUDE.md "per-IP (5/15-min) and per-account (`acct:<sha256-prefix>`, same 5/15-min)" — exact.
- **Upload caps:** `upload-limits.ts` — `MAX_UPLOAD_FILE_BYTES = 200*1024*1024` (200 MiB), `DEFAULT_MAX_TOTAL_UPLOAD_BYTES = 2 GiB`, `DEFAULT_MAX_FILES_PER_WINDOW = 100`, env-overridable. Exact match to CLAUDE.md.
- **nginx body caps:** `nginx/default.conf` — `2M` default (L31), `64K` login/`/admin$` (L58), `250M` `/admin/db` (L75), `216M` `/admin/dashboard` (L92). Exact match.

---

## ADDITIONAL CLAUDE.md CLAIMS VERIFIED (all MATCH)

- **Argon2 params** (`password-hashing.ts:11-14`): argon2id, memoryCost 65_536 (64 MiB), timeCost 3, parallelism 4 — exactly as CLAUDE.md Security Architecture states.
- **QUEUE_CONCURRENCY default 1** (`image-queue.ts:166` `Number(process.env.QUEUE_CONCURRENCY) || 1`) — matches "default concurrency: 1".
- **avif_effort default 6** (`gallery-config-shared.ts:128` `avif_effort: '6'`, comment "default 6 — Sharp's native default is 4") — matches the admin-tunables table and R28-CP-LOW-1 note.
- **MAX_BLUR_DATA_URL_LENGTH = 4096** (`blur-data-url.ts:45`) — matches the "capped at 4096 chars (~3 KB decoded)" claim in the Image Processing Pipeline section.
- **ui/button.tsx floors every size variant ≥44px** (`ui/button.tsx:24-29`: default/sm `min-h-11`, lg `min-h-12`, icon/icon-sm `size-11`, icon-lg `size-12`) — matches the touch-target belt-and-braces claim.
- **Migration 0021 analytics indexes** (`drizzle/0021_analytics_breakdown_indexes.sql` contains the `image_views(bot, ...)` indexes) — matches the Database Indexes section "(migration 0021)".
- **Four lint gates** (`lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`, `lint`) documented and described accurately vs the scanner-coverage prose.

---

## FINDING DETAIL

### DOC-C7-01 (LOW, high confidence) — AGENTS.md `.context/plans/` "is gitignored" is imprecise
- **AGENTS.md:40:** "`.context/reviews/` is the running history of audits (committed). `.context/plans/` is gitignored — local plan-management artifacts only."
- **Code/repo reality:**
  - `.gitignore:19-21`: `.context/*` then `!.context/reviews/` + `!.context/reviews/**`. So `.context/plans/` matches the ignore rule going forward.
  - BUT `git ls-files .context/plans` returns tracked files: `.context/plans/README.md`, `.context/plans/done/00-security-pass-1.md`, `.context/plans/done/01-ux-pass-1.md`, … — committed before the ignore rule (or force-added). The directory contains tracked historical artifacts despite the ignore rule.
  - Separately, the LIVE plans in this loop live at repo-root `/plan/` (e.g. `plan/plan-341-...md`), NOT `.context/plans/`, which is consistent with AGENTS.md treating `.context/plans/` as legacy/local-only.
- **Why LOW, not higher:** This is a historical-artifact nuance, not a code contradiction with a security/correctness contract. The forward gitignore rule is accurate; the imprecision is that "is gitignored" reads as "nothing tracked there" when tracked legacy files remain. Pre-known item from the brief.
- **Suggested doc tweak (optional):** "`.context/plans/` is gitignored going forward (legacy plan artifacts committed before the rule remain tracked); current plans live in `/plan/`." Not blocking.

---

## CONVERGENCE STATEMENT

The on-disk CLAUDE.md and AGENTS.md at HEAD `d0920957` are accurate against the code on every high-value claim I checked: pipeline version, the 9-key COLOR_IMPACTING_KEYS count + ETag formula, the 10 cache()-wrapped data functions, the touch-target `<Link>`/`<a>` max- lookbehind + does-not-flag fixtures, the WebP GPS-strip wiring, the dual backfill 10-column set, all 6 advisory-lock names, login rate-limit buckets, upload caps, nginx body caps, Argon2 params, queue concurrency, avif effort, blur cap, button floors, and migration 0021. The single finding is the pre-known LOW AGENTS.md `.context/plans/` wording. No new security/correctness doc mismatch found. Docs are heavily and correctly maintained.
