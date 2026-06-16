# Document-Specialist Review — Run-6 Cycle-6

- **HEAD:** `4eb83aab`
- **Agent:** document-specialist
- **Date:** 2026-06-17
- **Angle:** Documentation/code mismatches — verify the load-bearing factual claims in the repo-root `CLAUDE.md` contract against actual code at HEAD. Code is treated as authoritative.

---

## Verdict: 0 actionable mismatches / 1 harmless INFO

The CLAUDE.md contract is accurate at HEAD `4eb83aab`. This is the CORRECT, converged outcome — the system has trended 11 → 45 → 14 → 5 → 1 across cycles 1-5, and cycle 6 finds **zero developer-misleading doc-vs-code mismatches**. I did not fabricate nitpicks. The single INFO below is a 4-line internal line-number offset of exactly the class the doc itself elsewhere labels "informational only."

### Methodological note (important for future cycles)

The `CLAUDE.md` delivered in the agent **system-reminder context was a STALE snapshot** (it said "all **5** COLOR_IMPACTING_KEYS" and "wraps **9** data-access functions"). The **on-disk `CLAUDE.md` at HEAD is newer and CORRECT** — it says "all **9**" (line 264, with the AGG-R7-08 correction note) and "wraps **10**" (line 361, including `getLatestImageForOgCached`). I verified strictly against the on-disk HEAD file, not the injected context. The orchestrator brief anticipated exactly this ("the doc at HEAD already says 9 … Confirm, don't fix back to 5") — confirmed.

---

## Facts re-verified at HEAD (all PASS)

| # | CLAUDE.md claim | Code (file:line) | Result |
|---|---|---|---|
| 1 | `IMAGE_PIPELINE_VERSION = 7` | `gallery-config-shared.ts:21` → `= 7`; re-exported `process-image.ts:315` | ✓ |
| 2 | 6 default image sizes `[640, 1536, 2048, 4096, 5120, 7680]` | `gallery-config-shared.ts:90` `DEFAULT_IMAGE_SIZE_VALUES` | ✓ exact |
| 3 | `COLOR_IMPACTING_KEYS` = **9 keys** | `settings-hash.ts:41-53` (5 color + 3 quality + `image_sizes`) | ✓ doc=9, code=9 |
| 4 | Admin tunable `force_srgb_derivatives` default `false` | `gallery-config-shared.ts:116` | ✓ |
| 5 | `allow_hdr_ingest` default `false` | `:119` | ✓ |
| 6 | `force_show_color_chips` default `false` | `:122` | ✓ |
| 7 | `wide_gamut_jpeg_chroma` default `'4:4:4'` | `:125` | ✓ |
| 8 | `avif_effort` default `6` | `:128` | ✓ |
| 9 | `sdr_jpeg_chroma` default `'4:2:0'` | `:131` | ✓ |
| 10 | `wide_gamut_max_source_pixels` default `50_000_000` | `:134` (`'50000000'`) | ✓ |
| 11 | `image_quality_webp=90`, `avif=85`, `jpeg=90` | `gallery-config-shared.ts:97-99` | ✓ exact |
| 12 | `strip_gps_on_upload` default `false` | `:101` | ✓ |
| 13 | 6 advisory-lock names (`gallerykit_db_restore`, `_upload_processing_contract`, `_topic_route_segments`, `_admin_delete`, `_color_pipeline_backfill`, `:image-processing:{jobId}`) | grep of `apps/web/src/**/*.ts` returns exactly these 6 stems | ✓ all present |
| 14 | Cache-Control `public, max-age=3600, must-revalidate`, NOT `immutable` — across 3 files | `serve-upload.ts:230,252`; `next.config.ts:71`; `nginx/default.conf:157` | ✓ all 3 agree, none immutable |
| 15 | serve-upload ETag `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"` | `serve-upload.ts:215` `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"` | ✓ exact |
| 16 | Two route handlers delegate to `serveUploadFile` (AGG-D2): `app/uploads/[...path]/route.ts` + `app/[locale]/(public)/uploads/[...path]/route.ts` | both files exist and import serve-upload | ✓ exact |
| 17 | i18n: `en.json` and `ko.json` SAME key set; ko has no `plural` blocks (DOC-R5C3-07) | en 840 leaf keys = ko 840; 0 keys differ | ✓ parity, asymmetry intentional, NOT flagged |
| 18 | Next.js 16.2 | `package.json` `next: ^16.2.3` | ✓ |
| 19 | React 19 | `react: ^19.2.5` | ✓ |
| 20 | TypeScript 6 | `typescript: ^6` | ✓ |
| 21 | Node 24+ | `engines.node: ">=24"` (root + apps/web) | ✓ |
| 22 | Argon2id memoryCost=65536, timeCost=3, parallelism=4 | `password-hashing.ts:11-14` | ✓ exact |
| 23 | Login rate-limit 5 attempts / 15-min window (per-IP + per-account) | `rate-limit.ts:62-63` `LOGIN_WINDOW_MS=15min`, `LOGIN_MAX_ATTEMPTS=5`; per-account `accountLoginRateLimit` (`auth-rate-limit.ts:19`, key `login_account`) | ✓ |
| 24 | Upload caps: 200 MiB/file, 2 GiB total, 100 files/window | `upload-limits.ts:1-3` (`200*1024*1024`, `2*1024^3`, `100`) | ✓ exact |
| 25 | SW image-derivative LRU cap 50 MB | `sw-cache.ts:19` `MAX_IMAGE_CACHE_BYTES = 50*1024*1024` | ✓ |
| 26 | Queue concurrency default 1, `QUEUE_CONCURRENCY` override | `image-queue.ts:168` `Number(process.env.QUEUE_CONCURRENCY) || 1` | ✓ |
| 27 | React `cache()` wraps **10** data-access fns; enumerates 9 `*Cached` + `getSeoSettings` | `data.ts`: 10 `= cache(` sites; the 9 `*Cached` exports match the doc list incl. `getLatestImageForOgCached` | ✓ doc=10, code=10 |
| 28 | 4 lint gates (`lint`, `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`) | `apps/web/package.json:14,22,23,24` | ✓ |
| 29 | `tagNamesAgg` = `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` | `data.ts:605`, reused at :734/:783/:833/:899 | ✓ exact |
| 30 | `_PrivacySensitiveKeys` / `_SensitiveKeysInPublic` compile-time guard; `publicSelectFields` derived from `adminSelectFields` | `data.ts:208,256-257,312,318` | ✓ |
| 31 | `COLOR_PIPELINE_DECISIONS` enum + `isP3Pipeline` client-safe | `color-pipeline-decisions.ts:22,32` | ✓ |
| 32 | Migration journal has non-monotonic `when` (some 2026, some 2025) | `_journal.json`: 22 entries, non-monotonic confirmed, years {2025, 2026} | ✓ exact |
| 33 | `migrate.js` post-condition: "Drizzle silently skipped N migration(s)"; `getAllJournalMigrations`/`reconcileLegacySchema`/`baselineAllJournalMigrations` | `migrate.js:144,247,642,713` | ✓ |
| 34 | SW version stamp = git short-SHA + `-p{IMAGE_PIPELINE_VERSION}` | `build-sw.ts:46` `${getCommitOrTimestamp()}-p${IMAGE_PIPELINE_VERSION}` | ✓ |
| 35 | Historical commit SHAs (`94c43393`, `2b6cfdb5`, `689822d4`, `aca754c`) | `git cat-file -e` — all EXIST | ✓ |

**Recent-commit descriptions:** CLAUDE.md does NOT embed a live "Recent commits" list (only references specific historical SHAs, all verified above). No staleness surface here. The git-log header in the session snapshot differs from any embedded list because there is none to drift.

---

## INFO-1 (non-actionable): `settings-hash.ts` line-range citation is 4 lines stale

- **Location:** `CLAUDE.md` line 264 — "covers all **9** `COLOR_IMPACTING_KEYS` (`settings-hash.ts:37-49`)".
- **Actual:** the `const COLOR_IMPACTING_KEYS = [ … ] as const;` array spans **lines 41-53** (`settings-hash.ts:41` declaration, `:53` close). The cited `37-49` points at the import block + start of the docstring's tail, not the array.
- **Why NOT actionable:** the symbol name `COLOR_IMPACTING_KEYS` is unambiguous and a developer opening the file lands on it instantly regardless of the 4-line offset. The count (9) and the key breakdown in the prose are CORRECT. The repo's own convention treats embedded line numbers as drift-prone and informational (cf. the migrator note at line ~380: "file/line drifts across drizzle-orm versions; informational only"). This does not mislead.
- **Optional cosmetic fix (only if a maintainer is already editing that paragraph):** change `settings-hash.ts:37-49` → `settings-hash.ts:41-53`. Not worth a standalone commit.
- **Confidence:** High (verified by direct line grep).

---

## Hard guards — respected
- Did NOT propose `import 'server-only'` on `@/db` (cycle-5 proved it breaks tsx backfill).
- Did NOT propose activating CLIP/semantic search.
- Did NOT re-report the `p/[id]/page.tsx` Repository-Structure shorthand (re-checked: still illustrative, INFO-only, no fix).
- Did NOT "fix" the COLOR_IMPACTING_KEYS count back to 5, nor add an ICU `plural` block to ko.json.

## Bottom line
The CLAUDE.md contract faithfully describes the code at HEAD `4eb83aab`. 35 load-bearing facts re-verified, all PASS. One harmless 4-line internal line-number drift (INFO-1), no fix required. **0 actionable doc-vs-code mismatches.**
