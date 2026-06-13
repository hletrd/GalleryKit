# Document-Specialist Review — Documentation-Code Mismatches

**Date:** 2026-06-13
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**HEAD reviewed:** `ce0029aa` (working tree clean except `.context/reviews/*.md`)
**Angle:** Validate every concrete factual claim in CLAUDE.md / AGENTS.md / code comments / recent commit messages against the actual code at HEAD. Flag claims the code does NOT do (or no longer does).

**Context honored:** The prior aggregate is run-8 cycle-3 (`ada92ba5`). Commit `5f097262` ("sync CLAUDE.md with run-8 AGG-R8 code batch") landed the four AGG-R8c3-14 doc items. I VERIFIED those four doc updates against code (all accurate — see VERIFIED-CLEAN) and did NOT re-report them. The two critic-flagged fixes (AGG-R8c3-01 inaccurate commit claim, AGG-R8c3-02 third og-sanitize copy) were re-checked at HEAD: both fixes landed AND their own new comments are now accurate.

**Net result:** 0 falsehoods in the four freshly-updated sections. **2 genuinely-open doc/comment mismatches** (both LOW, both pre-existing the c3 fix batch — not introduced by `5f097262`) + **1 minor stale line citation**. Everything else spot-checked MATCHES.

---

## Findings by severity

### LOW

#### DOC-DS-1 — CLAUDE.md `cache()` count is stale ("9") and omits the freshly-added `getLatestImageForOgCached` (10th)

- **Doc location:** `CLAUDE.md:357` (Performance Optimizations -> React `cache()` bullet): *"**React `cache()`** wraps **9** data-access functions for SSR deduplication — every `data.ts` export ending in `Cached` (`getImageCached`, `getTopicBySlugCached`, `getTopicsCached`, `getTagsCached`, `getTopicsWithAliasesCached`, `getImageByShareKeyCached`, `getSharedGroupCached`, `getSmartCollectionBySlugCached`) plus `getSeoSettings`"* — 8 enumerated `Cached` + `getSeoSettings` = 9.
- **Code location:** `apps/web/src/lib/data.ts` — there are now **10** `cache()`-wrapped exports:
  1. `getSmartCollectionBySlugCached` (`:1332`)
  2. `getImageCached` (`:1595`)
  3. **`getLatestImageForOgCached` (`:1597`)** <- NOT listed in CLAUDE.md
  4. `getTopicBySlugCached` (`:1598`)
  5. `getTopicsCached` (`:1599`)
  6. `getTagsCached` (`:1600`)
  7. `getTopicsWithAliasesCached` (`:1601`)
  8. `getImageByShareKeyCached` (`:1603`)
  9. `getSharedGroupCached` (`:1608`)
  10. `getSeoSettings` (`:1649`)
- **Mismatch:** `getLatestImageForOgCached` was added THIS cycle by commit `e9040d17` ("perf(home): use a minimal id+title query for the OG card") — the AGG-R8c3-05 fix. It is `cache(getLatestImageForOg)` (`data.ts:1597`, source fn at `:873`) and is consumed by the home `generateMetadata` (`(public)/page.tsx:93`). The CLAUDE.md perf bullet was not updated alongside the code, so the count "9" and the enumeration are both one short. Same class of incompleteness as AGG-R8c3-14 (doc prose lagging the code batch), just for a different function in a different section that the `5f097262` doc patch did not touch.
- **Correction:** Bump "9" -> "10" and add `getLatestImageForOgCached` to the enumerated list.
- **Confidence:** High (enumerated all 10 `cache(` wraps in `data.ts`; confirmed `getLatestImageForOgCached` is `cache()`-wrapped and consumed by the home metadata path).
- **Severity rationale:** Doc-only; no runtime impact. LOW.

#### DOC-DS-2 — Home `og:image` comment overstates the fallback ("falls back to the site OG card") — `pickFirstAvailablePhotoBuffer` has no base-JPEG last resort, and the null path 302-redirects to HTML when `og_image_url` is unset (= the still-open AGG-R8c3-16(c) / CRT-3)

- **Doc/comment location:** `apps/web/src/app/[locale]/(public)/page.tsx:104-108` (the AGG-R8-02 home-og comment): *"...it iterates configured sizes server-side via `pickFirstAvailablePhotoBuffer` and **falls back to the site OG card** when no derivative is on disk yet (mid-backfill / legacy / post-reconfigure), so a freshly-uploaded `latestImage` is still safe."* CLAUDE.md:102 echoes the mechanism ("on-disk size fallback via `pickFirstAvailablePhotoBuffer`").
- **Code location:**
  - `apps/web/src/lib/og-photo-fetch.ts:44-67` — `tryFetchPhotoBuffer` builds `sizedFilename = baseFilename.replace(/\.jpg$/i, '_${size}.jpg')`, i.e. it only ever requests **sized** derivatives (`_640.jpg`, `_1536.jpg`, ...). It NEVER tries the base `filename_jpeg` itself.
  - `pickFirstAvailablePhotoBuffer` (`:75-86`) returns `null` once every configured size misses — there is no base-JPEG last-resort attempt.
  - On `null`, the route (`api/og/photo/[id]/route.tsx:109-114`) calls `buildFallbackResponse(req, ..., seo.og_image_url || undefined)`.
  - `buildFallbackResponse` (`:235-259`) 302-redirects to `ogImageUrl` if the admin configured `seo.og_image_url`, **else 302-redirects to the site root `/` — i.e. an HTML page, NOT a "site OG card"** (the Satori `/api/og` site card is never the fallback target).
- **Mismatch:** "falls back to the site OG card" is inaccurate on two counts: (1) there is no base-JPEG fallback, so a base-only legacy "latest" photo (a row whose sized `_NNN.jpg` derivatives are absent) misses every size; (2) when `og_image_url` is unset, the fallback is the site homepage HTML, not an OG card. The critic flagged exactly this (AGG-R8c3-16(c) / CRT-3). The plan-335 DONE table (`plan/plan-335-run8-cycle3-fixes.md:127`) shows only AGG-R8c3-16(a) and 16(b) were scheduled and closed — **16(c) was never picked up**, so the inaccurate comment survives unchanged at HEAD.
- **Caveat (why it stays LOW, not MED):** The comment's "freshly-uploaded `latestImage` is still safe" is true for the common case — the encoder writes all configured sized derivatives on upload, so a normally-processed recent photo always has a sized JPEG to serve. The gap is the legacy/base-only edge plus the imprecise word "card" for the redirect target. No served-byte defect; honesty-only.
- **Correction:** Reword to "...falls back to the admin-configured site OG image URL (or, if none is set, 302-redirects to the site homepage) when no **sized** derivative is on disk; note `pickFirstAvailablePhotoBuffer` tries only `_NNN.jpg` sizes, not the base JPEG." Optionally pin with a test (the route's null->fallback branch).
- **Confidence:** High (read the full fallback chain end-to-end: `tryFetchPhotoBuffer` filename construction, `pickFirstAvailablePhotoBuffer` null contract, `buildFallbackResponse` both branches; confirmed 16(c) absent from plan-335 DONE table).
- **Severity rationale:** Comment-honesty only, non-exploitable, common case is fine. LOW.

#### DOC-DS-3 — Stale line citation: `COLOR_IMPACTING_KEYS` array is at `settings-hash.ts:37-49`, CLAUDE.md cites `:34-46`

- **Doc location:** `CLAUDE.md:263` — *"...covers all **9** `COLOR_IMPACTING_KEYS` (`settings-hash.ts:34-46`)..."*
- **Code location:** `apps/web/src/lib/settings-hash.ts:37` (`const COLOR_IMPACTING_KEYS = [`) through `:49` (`] as const;`). Lines `34-36` are the imports (`db`, `adminSettings`, `inArray`, `GalleryConfig`) — the cited `:34-46` starts 3 lines early (on an import) and ends 3 lines before the array closes.
- **Mismatch:** Line-range citation drifted by ~3 lines (the count "9" itself is CORRECT — verified the array has exactly 9 keys: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`).
- **Correction:** `settings-hash.ts:37-49`.
- **Confidence:** High.
- **Severity rationale:** Cosmetic line-citation drift; the substantive claim (9 keys, the names) is accurate. LOW.

---

## VERIFIED-CLEAN (claims I checked against code at HEAD `ce0029aa` and found ACCURATE)

### The four freshly-updated sections from `5f097262` (AGG-R8c3-14) — all accurate, NOT re-reported

- **SW 300 ms HEAD bound (CLAUDE.md:369, DOC-1):** `const HEAD_REVALIDATE_TIMEOUT_MS = 300;` and `signal: AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` present in BOTH the template (`public/sw.template.js:38,230`) AND the generated, committed `public/sw.js:38,230`. The doc's "bounded by `AbortSignal.timeout(300 ms)`" matches.
- **Touch-target raw-checkbox scanner (CLAUDE.md:513, DOC-2):** `scanRawCheckboxes` exists (`__tests__/touch-target-audit.test.ts:636`, wired at `:623`) with regex `/<input\b[^>]*\btype=["'](?:checkbox|radio)["']/` (`:644`).
- **Touch-target scale-token scanner (CLAUDE.md:514):** FORBIDDEN regexes at `:342-355` match `(?:min-h|min-w|size|h|w)-(?:[1-9]|10)` on `<Button>`/`<button>` (string + `cn()`), with the `h-1[12]`/`size-1[12]` >=44 override lookahead.
- **OG-sanitize runtime layer (CLAUDE.md:181, DOC-3):** `apps/web/src/lib/og-sanitize.ts` exports `sanitizeForOg` = `(stripUnicodeFormatting(value) ?? '').replace(OG_C0_CONTROL_CHARS, '')` — strips Unicode formatting AND C0 control chars. Imported by ALL THREE consumers: `api/og/route.tsx:5`, `api/og/photo/[id]/route.tsx:8`, AND the JSON-LD page `(public)/p/[id]/page.tsx:14` (commit `0028ede4` migrated the third copy; its comment at `:10-13` correctly states the prior local copy lacked C0 strip). The "all three consumers" claim is now true. (AGG-R8c3-02 CLOSED)
- **Home `og:image` -> per-photo OG route (CLAUDE.md:102, DOC-4):** `(public)/page.tsx:114` sets `url: absoluteImageUrl('/api/og/photo/${latestImage.id}', seo.url)` at 1200x630, using `getLatestImageForOgCached` (`:93`). Matches. (AGG-R8c3-02 / AGG-R8-02)

### The two critic-flagged fixes — fixes landed AND their new comments are accurate

- **NCLX code-2 isHdr side-effect (AGG-R8c3-01, commit `22387f32`):** The corrective comment at `color-detection.ts:389-401` is ACCURATE — it explicitly states *"the commit message's 'no delivered-byte impact' was inaccurate"*, documents the isHdr-flip -> `images.ts` upload-rejection mechanism, and references the pinning test `color-detection.test.ts ("nclx code-2 transfer + PQ-named ICC -> isHdr true")`. The per-field `!== undefined` guards (`:384-386`) and `isHdr = transferFunction === 'pq' || 'hlg'` (`:401`) match the doc's behavior description. (the inaccurate claim is corrected, not perpetuated)

### Constants, defaults, and tables (independently re-verified at the new HEAD)

- **`IMAGE_PIPELINE_VERSION = 7`** — defined at `gallery-config-shared.ts:21`, re-exported via `process-image.ts`. CLAUDE.md:92,139 correct.
- **`COLOR_IMPACTING_KEYS` = 9 keys** — `settings-hash.ts:37-49`; `HASH_LENGTH = 8` (`:51`). The "9" count (CLAUDE.md:263) and the enumerated names (5 color + 3 quality + `image_sizes`) all match. (only the line citation drifted — DOC-DS-3)
- **Admin color/HDR tunable defaults (CLAUDE.md:277-283):** `avif_effort: '6'` (`gallery-config-shared.ts:128`), `wide_gamut_jpeg_chroma: '4:4:4'` (`:125`), `sdr_jpeg_chroma: '4:2:0'` (`:131`), `wide_gamut_max_source_pixels: '50000000'` (`:134`), `force_srgb_derivatives`/`allow_hdr_ingest`/`force_show_color_chips` all default `false`.
- **Backfill column set (CLAUDE.md:291):** `admin-backfill-runner.ts` UPDATEs persist `pipeline_version` (`:559`), `icc_profile_name` (`:560`), `color_primaries` (`:561`), `transfer_function`/`matrix_coefficients`/`is_hdr`/`has_gain_map`/`color_pipeline_decision` (`:543-549`), `was_downscaled` (`:567,596`), `avif_10bit` (`:568,597`). All 10 documented columns present.
- **Advisory-lock list (CLAUDE.md:353):** All 6 documented names present in code: `gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit:image-processing:{id}`. (Note: `gallerykit_forwarded_proto` is an **nginx map variable** in `nginx/default.conf`, NOT a MySQL advisory lock — correctly absent from the doc list; no finding.)
- **Argon2 params (CLAUDE.md:153):** `argon2id`, `memoryCost: 65_536`, `timeCost: 3`, `parallelism: 4` (`password-hashing.ts:11-14`).
- **Connection pool (CLAUDE.md:210):** `POOL_CONNECTION_LIMIT = 10` (`db/index.ts:23`), `queueLimit: 20` (`:33`), `enableKeepAlive: true` (`:35`).
- **Upload caps (CLAUDE.md:457):** `DEFAULT_MAX_TOTAL_UPLOAD_BYTES = 2 GiB`, `DEFAULT_MAX_FILES_PER_WINDOW = 100` (`upload-limits.ts:1-2`); 200 MB per-file enforced via `MAX_UPLOAD_FILE_BYTES`.
- **nginx body caps (CLAUDE.md:458):** `2M` default (`nginx/default.conf:31`), `64K` login (`:58`), `250M` `/admin/db` (`:75`), `216M` admin uploads (`:92`). All four exact.
- **Blur cap (CLAUDE.md:222):** `MAX_BLUR_DATA_URL_LENGTH = 4096` (`blur-data-url.ts:45`).
- **`_PrivacySensitiveKeys` / `_SensitiveKeysInPublic` guard (CLAUDE.md:104,190):** present at `data.ts:417-419` with the compile-time `extends never ? true : [ERROR...]` shape.
- **Migration runbook fn names (CLAUDE.md:384-386):** `getAllJournalMigrations` (`migrate.js:144`), `reconcileLegacySchema` (`:247`), `baselineAllJournalMigrations` (`:642`), `prepareLegacyDatabaseIfNeeded` (`:659`), `runMigrations` (`:698`), and the "Drizzle silently skipped N migration(s)" throw (`:713`).
- **`data.ts` listing-fn line citations** (used to ground DOC-DS-1/2): `getImagesLite` at `:728`, `getImagesLitePage` at `:818`, `getLatestImageForOg` at `:873`.
- **SW version stamp NOT a finding:** `sw.js` carries `SW_VERSION = 'ee0f38bd-p7'` (a non-HEAD short-SHA). EXPECTED — `scripts/build-sw.ts:46` stamps `git rev-parse --short HEAD` at prebuild/commit time of `sw.js`, not on every subsequent commit. The committed `sw.js` content is current (the 300 ms bound from `9b7bb240` is present), and CLAUDE.md:367's instruction ("regenerate and commit `sw.js` after editing the template") was honored — `sw.js` was last regenerated at `ee0f38bd`, after the template's last edit at `9b7bb240`.

### AGENTS.md

- Test-count claim "**2000+** unit tests" (AGENTS.md:36) — consistent with the aggregate's measured `2060/2060`.
- Quality-gate list, schema-migration steps, deploy/sidecar rules — all consistent with CLAUDE.md and the gate scripts.

---

## Notes for the aggregator

- **Both open findings are LOW and doc/comment-only** (per the prompt's "doc-only fixes are LOW severity but must still be recorded"). DOC-DS-1 and DOC-DS-2 are pre-existing relative to the c3 fix batch — NOT regressions introduced by `5f097262`. DOC-DS-2 is the still-open tail of AGG-R8c3-16(c) / CRT-3 (the only sub-item of AGG-R8c3-16 that plan-335 did not schedule).
- **No falsehoods** in the freshly-updated CLAUDE.md sections; the `5f097262` doc sync is accurate against code. The prior-cycle VERIFIED-CLEAN doc assertions (IMAGE_PIPELINE_VERSION, COLOR_IMPACTING_KEYS=9, Argon2, pool, caps, advisory locks, backfill columns) all still hold at the new HEAD.
- **One trivially-fixable real fix exists** here: DOC-DS-1 (add `getLatestImageForOgCached` to the `cache()` enumeration + bump 9->10) — it documents a function this very cycle added but forgot to list.
