# Document-Specialist Review — Doc/Code Mismatch Pass

**HEAD:** `1dde9b1e` (`docs: 📝 correct cache() count + og:image/JSON-LD comment honesty`)
**Date:** 2026-06-13
**Working tree:** CLEAN at start.
**Angle:** documentation-code mismatches. CLAUDE.md / AGENTS.md / inline code comments audited against the ACTUAL code at current HEAD. Code is ground truth.
**Method:** read CLAUDE.md + AGENTS.md in full; for each concrete factual claim (counts, line cites, enum values, defaults, constants, invariants) grep/read the cited code and compare.

---

## Headline

**The doc surface has fully converged.** Across ~35 distinct concrete claims verified this cycle — including every item on the high-value checklist plus a broad fresh sweep — **zero net-new doc/code mismatches** were found. All four prior-cycle (commit `1dde9b1e`) doc-honesty fixes RE-VERIFIED ACCURATE against the code they document. One borderline git-mechanics imprecision in AGENTS.md is recorded as an OBSERVATION (not counted) because the operative claim holds.

This is the expected honest-convergence outcome the prompt anticipated: the doc has been scrubbed across many cycles and the low-hanging mismatches are gone.

> **Note on the prompt's checklist framing:** the prompt's high-value list said to verify CLAUDE.md "React cache() wraps 10" and "COLOR_IMPACTING_KEYS '5 keys'". The current CLAUDE.md already says **10** (line 357) and **9** keys (line 263, corrected by AGG-R7-08) — both correct against code. The "5 keys" expectation in the prompt reflects an older doc state; the doc is ahead of the prompt and matches code.

---

## RE-VERIFIED — prior-cycle (`1dde9b1e`) doc fixes confirmed ACCURATE against code

| Prior fix | Doc location | Code ground truth | Verdict |
|---|---|---|---|
| **AGG-C4-06** React `cache()` count 9->10 + add `getLatestImageForOgCached` | CLAUDE.md:357 says "wraps **10** data-access functions" and enumerates `getImageCached, getLatestImageForOgCached, getTopicBySlugCached, getTopicsCached, getTagsCached, getTopicsWithAliasesCached, getImageByShareKeyCached, getSharedGroupCached, getSmartCollectionBySlugCached` (9 `*Cached`) + `getSeoSettings` | `data.ts` has **13** `cache(` tokens, of which 3 are in comments (867, 1604, 1613); the **10** real wrappers are the 9 `*Cached` exports (1332, 1595, 1597-1601, 1603, 1608) + `getSeoSettings` (1649). `getLatestImageForOgCached` present at 1597. | ACCURATE — count is 10, name present, enumeration exact |
| **AGG-C4-07(a)** home `og:image` comment honesty (no "site OG card"; -> `og_image_url`/site-root HTML, never base JPEG) | `(public)/page.tsx:98-118` comment: "point the home OG `<meta og:image>` at the per-photo OG ROUTE (`/api/og/photo/${id}`) … `pickFirstAvailablePhotoBuffer` and, when no SIZED derivative is on disk … the admin-configured `og_image_url`, or to the site homepage HTML if that setting is empty (AGG-C4-07 — NOT a freshly-generated 'site OG card')" | `og:image` URL built at :118 = `absoluteImageUrl('/api/og/photo/${latestImage.id}', seo.url)`; id from `getLatestImageForOgCached` (:93). OG route falls through sized derivatives then 302s to `og_image_url`/site root. | ACCURATE — matches the route's actual fallback chain |
| **AGG-C4-07(b)** JSON-LD sanitize-asymmetry comment | `(public)/p/[id]/page.tsx:217-227` comment: "`name`/`description`/`keywords` and breadcrumb `topic_label` … intentionally NOT wrapped in sanitizeForOg, while EXIF PropertyValues ARE … (1) emitted via `safeJsonLd` … (2) write-time validator-gated (`containsUnicodeFormatting`) … EXIF … NOT validator-gated, so they get the extra sanitizeForOg pass" | Code: `name: displayTitle` (:228), `description: image.description` (:229), `keywords` (:230), breadcrumb `topic_label` (:257) — NO sanitizeForOg. EXIF: camera (:233), lens (:234), exposure (:237) — `sanitizeForOg(...)`. Both blocks emitted via `safeJsonLd` (:275, :282). | ACCURATE — the per-field wrapping in code exactly matches the comment |
| **AGG-R8c3-02** JSON-LD page imports shared `sanitizeForOg` (no local copy) | `(public)/p/[id]/page.tsx:14` `import { sanitizeForOg } from '@/lib/og-sanitize'`; CLAUDE.md:101,181 "imported by … the JSON-LD photo page" / "all three consumers import the shared helper" | 3 non-test importers of `@/lib/og-sanitize`: `og/route.tsx:5`, `og/photo/[id]/route.tsx:8`, `(public)/p/[id]/page.tsx:14`. Exactly 3. | ACCURATE |
| **AGG-C4-07(c)** `COLOR_IMPACTING_KEYS` line cite + count | CLAUDE.md:263 "all **9** `COLOR_IMPACTING_KEYS` (`settings-hash.ts:37-49`)" + enumerates 5 color + 3 quality + `image_sizes` | `settings-hash.ts:37` `const COLOR_IMPACTING_KEYS = [` … `:49` `] as const;` — **9** entries: `wide_gamut_jpeg_chroma, sdr_jpeg_chroma, avif_effort, force_srgb_derivatives, wide_gamut_max_source_pixels, image_quality_webp, image_quality_avif, image_quality_jpeg, image_sizes`. `HASH_LENGTH = 8` (:51). | ACCURATE — count 9, line range 37-49 exact, enumeration exact |

---

## FRESH SWEEP — additional concrete claims verified ACCURATE (no mismatch)

Every claim below was checked against code this cycle and MATCHES:

**Versions / constants**
- `IMAGE_PIPELINE_VERSION = 7` — `gallery-config-shared.ts:21` (definition), re-exported `process-image.ts:303`. CLAUDE.md:92 ("DEFINED in `gallery-config-shared.ts:21` and re-exported here") + :139 ("current: 7"). EXACT.
- `MAX_BLUR_DATA_URL_LENGTH = 4096` — `blur-data-url.ts:45`. CLAUDE.md:222 ("4096 chars").
- `OG_PHOTO_MAX_BYTES = 1024*1024` (1 MB) — `og-photo-fetch.ts:31`. CLAUDE.md:102.
- Argon2id, memoryCost `65_536`, timeCost `3`, parallelism `4` — `password-hashing.ts:11-14`. CLAUDE.md:153. EXACT.

**Color / HDR pipeline**
- `COLOR_PIPELINE_DECISIONS` enum = `srgb, srgb-from-unknown, p3-from-displayp3, p3-from-dcip3, p3-from-adobergb, p3-from-prophoto, p3-from-rec2020` (7 values) — `color-pipeline-decisions.ts:22-30`. CLAUDE.md decision matrix (240-247) lists exactly these 7.
- Admin tunable defaults — `gallery-config-shared.ts` DEFAULTS block: `avif_effort='6'` (:128), `wide_gamut_max_source_pixels='50000000'` (:134), `wide_gamut_jpeg_chroma='4:4:4'` (:125), `sdr_jpeg_chroma='4:2:0'` (:131), `force_srgb_derivatives='false'` (:116), `allow_hdr_ingest='false'` (:119), `force_show_color_chips='false'` (:122). Default sizes `[640,1536,2048,4096,5120,7680]` (:90). CLAUDE.md tunables table (277-283) + :218. ALL MATCH.
- ISOBMFF walker bounds: `MAX_SCAN_BYTES = 1024*1024`, `MAX_DEPTH = 5` — `color-detection.ts:218-219`. CLAUDE.md:232 ("max box depth 5, max scan 1 MB").
- NCLX primaries map `11: 'dci-p3'`, `12: 'p3-d65'` — `color-detection.ts:171-172`. CLAUDE.md:232 ("11=DCI-P3, 12=Display P3").
- `force_show_color_chips` CSS: `:root[data-force-show-color-chips="true"] .gamut-p3-badge`/`.hdr-badge` — `globals.css:199-200`. CLAUDE.md:271.

**DB schema / indexes / migrations**
- All 8 documented `images`/`image_views`/`image_tags` indexes present — `schema.ts:114-118,132,232-233`: `(processed,capture_date,created_at)`, `(processed,created_at)`, `(topic,processed,capture_date,created_at)`, `(user_filename)`, `(uploaded_by)`, `image_tags(tag_id)`, `image_views(bot,viewed_at,country_code)`, `image_views(bot,viewed_at,referrer_host)`. CLAUDE.md:201-208. ALL MATCH.
- Migration `0021_analytics_breakdown_indexes.sql` creates the two `image_views` breakdown indexes. CLAUDE.md:207-208 ("migration 0021").
- migrate.js runbook: `getAllJournalMigrations` (:144, `folderMillis: entry.when`, `sha256` hash :156-157), `reconcileLegacySchema` (:247), `baselineAllJournalMigrations` (:642), `prepareLegacyDatabaseIfNeeded` (:659), `runMigrations` (:698) with "Drizzle silently skipped N migration(s)" throw (:713). CLAUDE.md:384-386. ALL functions present and behave as documented.

**Rate limits / caps / nginx**
- Login rate limit: `LOGIN_WINDOW_MS = 15*60*1000` (`rate-limit.ts:62`), `LOGIN_MAX_ATTEMPTS = 5` (:63). CLAUDE.md:158 ("5 attempts / 15-min window").
- Upload caps: `MAX_UPLOAD_FILE_BYTES = 200*1024*1024` (`upload-limits.ts:3`), `DEFAULT_MAX_TOTAL_UPLOAD_BYTES = 2 GiB` (:1), env var `UPLOAD_MAX_TOTAL_BYTES` (:15), `UPLOAD_MAX_FILES_PER_WINDOW` default 100 (:16). CLAUDE.md:457 references the env var name `UPLOAD_MAX_TOTAL_BYTES` (correct — it is the env var, not the constant `MAX_TOTAL_UPLOAD_BYTES`).
- nginx body caps: 2M default (`nginx/default.conf:31`), 64K login/admin (:58), 250M /admin/db (:75), 216M /admin/dashboard (:92). CLAUDE.md:458 ("2 MiB / 64 KiB / 250 MiB / 216 MiB"). ALL MATCH.

**Backfill**
- 10-column write set: pipeline_version, icc_profile_name, color_primaries, transfer_function, matrix_coefficients, is_hdr, has_gain_map, color_pipeline_decision (`admin-backfill-runner.ts:543-549,559-561`), was_downscaled (:567,596), avif_10bit (:568,597) = 10. CLAUDE.md:291. EXACT.
- Concurrency cap math: `BACKFILL_RESERVED_LIVE_CONNECTIONS = max(3, ceil(poolLimit/2))` (:105-106); `cap = max(1, floor((limit-reserved-1)/2))` (:139); at LIMIT=10 -> RESERVED=5, cap=**2** (in-code comment :122). CLAUDE.md:294. EXACT arithmetic match.
- Both UPDATE branches guard `affectedRows` + cleanup (AGG-R8c3-03/AGG-C4-02). CLAUDE.md:291 ("Both paths ALSO guard the delete-during-reencode race identically … `deleteImageVariants(dir, fn, [])`") — consistent with the runner code.

**Service Worker / PWA**
- `HEAD_REVALIDATE_TIMEOUT_MS = 300` (`sw.template.js:38`), `MAX_IMAGE_BYTES = 50 MB` (:31), `HTML_MAX_AGE_MS = 24 h` (:32), `MAX_HTML_ENTRIES = 50` (:33). CLAUDE.md:369-370 ("300 ms", "50 MB LRU cap", "24 h TTL; 50-entry cap"). ALL MATCH.

**Infra / misc**
- Connection pool: `POOL_CONNECTION_LIMIT = 10` (`db/index.ts:23`), `queueLimit: 20` (:33), `enableKeepAlive: true` (:35). CLAUDE.md:210.
- Health: `HEALTH_CHECK_DB !== 'true'` gate at `health/route.ts:18`. CLAUDE.md:461.
- Stripe webhook handles `checkout.session.completed` (`stripe/webhook/route.ts:88`) but NOT `async_payment_succeeded` (noted as future TODO :92-99). CLAUDE.md:122 warning. ACCURATE.
- OG card 1200x630: `og/route.tsx:205-206` + `og/photo/[id]/route.tsx:204-205`. CLAUDE.md:102.
- i18n plural: en `photosCount` uses ICU `{count, plural, one {# photo} other {# photos}}` (`en.json:825`); ko uses fixed `{count}장` (`ko.json:147,149,150`, no plural block). CLAUDE.md:477 convention. MATCHES.
- Touch-target audit AGG-C4-01 fix: `(?<!max-)` negative lookbehind on all bare `h`/`w` scale-token branches (`touch-target-audit.test.ts:301-337`) with explanatory header (:293-296). The `max-h-10`/`max-w-9` false-positive is fixed. (confirms the prior-cycle AGG-C4-01 regex fix landed)
- `process-image.ts` fresh-instance-per-format cite (CLAUDE.md:219 "`process-image.ts:1019-1097`"): fresh `sharp(inputPath, …)` resize at :1023 (preamble comment ~:1015) inside `processImageFormats` (:946); the cited range brackets the actual fresh-decode block. Acceptable region cite.

---

## OBSERVATION (recorded, NOT counted as a net-new mismatch)

**AGENTS.md:40 — "`.context/plans/` is gitignored — local plan-management artifacts only."** This is *imprecise* but not materially wrong:
- `.gitignore:19-23` is `.context/*` with `!.context/reviews/` un-ignore. So the **rule** matches `.context/plans/`, and a NEW file (e.g. `99-brand-new-plan.md`) WOULD be ignored (`git check-ignore` confirms). The forward-looking intent ("local artifacts") holds.
- BUT `.context/plans/` currently has **59 TRACKED files** (`README.md`, the entire `done/` subtree, the `35/36/37/48-*.md` specs) committed before the ignore rule was added — `git ls-files .context/plans` lists them. Once tracked, `.gitignore` does not untrack, so "is gitignored" is only true for new/untracked paths, not the historical tracked set.

**Why not counted:** this is a git-mechanics nuance about a *historical artifact*, not a doc claim that contradicts a code value or invariant. The `.gitignore` rule genuinely exists and governs new files (the operative meaning). Tightening the prose to "newly-created plan files are gitignored; pre-existing plan docs remain tracked" would be a nicety, not a correctness fix. Confidence that this is a real reportable mismatch: LOW. Recorded for completeness only.

---

## What I did NOT find (explicitly stress-tested, clean)

- No count drift (cache 10, COLOR_IMPACTING_KEYS 9, decision enum 7, backfill 10 columns, 8 indexes, 3 og-sanitize consumers — all exact).
- No line-cite drift (settings-hash 37-49, IMAGE_PIPELINE_VERSION gallery-config-shared.ts:21 — both exact; process-image 1019-1097 acceptable region).
- No default-value drift (every admin tunable default, Argon2 params, rate-limit numbers, nginx caps, SW timeouts/caps, pool config — all match).
- No invariant-description drift (JSON-LD asymmetry, og:image fallback chain, HDR honesty gating, advisory-lock scope, migration runbook behavior — all match code).
- No stale enum/mapping (NCLX primaries 11/12, transfer map references — match).
- The just-landed `1dde9b1e` batch did NOT introduce any new inaccuracy; all four fixes describe the code correctly.

---

NET-NEW DOC MISMATCHES THIS CYCLE: 0
