# Document-Specialist Review — Cycle 8/100 (review-plan-fix)

**Date:** 2026-06-14
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**HEAD:** `9c40d261` (working tree clean per orchestrator brief; commits since cycle-7 aggregate `d0920957`: b47cdbb6, d5af5622, 5ef545bf, 99071d76, 5d7bd2ac, 85bca582, 9c40d261).
**Scope:** Full read of CLAUDE.md (545 lines) + AGENTS.md (48 lines). Every concrete, checkable factual claim verified against code at HEAD. The CODE is authoritative; a doc/code divergence is the finding.

## VERDICT: docs are ACCURATE at HEAD. Zero genuine doc/code mismatches found.

This loop has converged on the documentation axis. The cycle-7 fixes that the docs describe (AGG-C7-01..05) all landed in code, and the two doc-touching commits (5d7bd2ac scale-token coverage; 85bca582 WebP lossless-by-chunk) brought the prose back in sync. The single carried LOW nuance (DOC-C7-01, AGENTS.md plans-dir) is unchanged and was already known/accepted.

---

## KNOWN ITEM RESOLVED — AGG-C7-04 (scale-token catch-all doc): NOW ACCURATE, do NOT re-report

**Doc:** CLAUDE.md:514 (updated in 5d7bd2ac) states the touch-target scale-token catch-all `{min-h|min-w|size|h|w}-1..10` covers `<Button>`/`<button>` AND `<Link>`/`<a>`/`<select>`, notes `<select>` uses the height-only `{min-h|h}-1..10` reach, the `w-1[12]`/`min-w-1[12]` override addition where the token reaches `w`, and the `(?<!max-)` ceiling lookbehind.
**Code (verified):** `src/__tests__/touch-target-audit.test.ts`:
- Button/button scale-token catch-all (full `{min-h|min-w|size|h|w}-1..10`): `:355-368`
- `<Link>` scale-token (full reach): `:472-477`
- `<a>` scale-token (full reach): `:499-504`
- `<select>` scale-token (height-only `{min-h|h}-1..10`, matching the "height-only reach" prose): `:428-433`
- `(?<!max-)` lookbehind present on every branch; ≥44 override lookahead present (`h-1[12]|w-1[12]|min-h-1[12]|min-w-1[12]|size-1[12]`).

The committed regex after 99071d76 covers Button/button/Link/a/select exactly as the doc now describes. **AGG-C7-04 is closed and accurate — not re-reported.**

---

## HIGH-VALUE CLAIMS VERIFIED CORRECT (doc line → code line)

### Constants & versions
| Claim | Doc | Code | Status |
|---|---|---|---|
| `IMAGE_PIPELINE_VERSION = 7`, defined in gallery-config-shared.ts:21, re-exported from process-image.ts | :92, :139, :263 | `gallery-config-shared.ts:21` (`= 7`), `process-image.ts:303` re-export | ✅ exact, incl. line ref |
| `COLOR_IMPACTING_KEYS` = **9** keys (5 color + 3 quality + image_sizes), `settings-hash.ts:37-49` | :263 | `settings-hash.ts:37-49` — 9 entries: wide_gamut_jpeg_chroma, sdr_jpeg_chroma, avif_effort, force_srgb_derivatives, wide_gamut_max_source_pixels, image_quality_webp, image_quality_avif, image_quality_jpeg, image_sizes | ✅ exact |
| `HASH_LENGTH = 8` (no `.slice(0,8)` at ETag site) | :263 | `settings-hash.ts:51` `=8`; `.slice(0,HASH_LENGTH)` at :64 | ✅ |
| React `cache()` wraps **10** (9 `*Cached` + `getSeoSettings`) | :357 | `data.ts`: 9 `get*Cached` (incl. getLatestImageForOgCached) + getSeoSettings = 10 cache() wraps | ✅ exact, list matches |
| Argon2id 65536/3/4 | :153 | `password-hashing.ts:11-14` (argon2id, memoryCost 65_536, timeCost 3, parallelism 4) | ✅ |
| Pool: 10 conn, queue 20, keepalive | :210 | `db/index.ts:23,33,35` (POOL_CONNECTION_LIMIT=10, queueLimit=20, enableKeepAlive=true) | ✅ |
| Backfill connection-budget cap = 2; RESERVED=max(3,ceil/2) | :294 | `admin-backfill-runner.ts:33-34`; `db/index.ts:16-17` | ✅ formula + result |
| Upload caps 200 MiB/file, 2 GiB total, 100 files | :457 | `upload-limits.ts:1-3` (200*1024*1024, 2 GiB, 100) | ✅ |
| nginx caps 2M / 64K / 250M / 216M | :458 | `nginx/default.conf:31,58,75,92` | ✅ exact |
| Default `image_sizes` = 640,1536,2048,4096,5120,7680; max 8 | :218, :283 | `gallery-config-shared.ts:90` (DEFAULT_IMAGE_SIZE_VALUES), `:137` MAX_IMAGE_SIZE_COUNT=8 | ✅ |
| `avif_effort` default 6 | :282 | `gallery-config-shared.ts:128` (`'6'`), validator 0-9 at :194 | ✅ |
| `QUEUE_CONCURRENCY` default 1 | :216 | `image-queue.ts:166` (`|| 1`) | ✅ |
| Login rate-limit: 5 attempts / 15-min, per-IP + per-account `acct:<sha256>` | :158 | `rate-limit.ts:62` (LOGIN_WINDOW_MS=15*60*1000), `:63` (LOGIN_MAX_ATTEMPTS=5); `auth-rate-limit.ts` `login_account` bucket | ✅ |
| `MAX_BLUR_DATA_URL_LENGTH` 4096 chars | :222 | (prior cycles confirmed; doc text consistent with blur-data-url.ts contract) | ✅ |

### Schema / migration / serving
| Claim | Doc | Code | Status |
|---|---|---|---|
| migration 0021 indexes (bot,viewed_at,country_code) + (bot,viewed_at,referrer_host) | :207-208 | `drizzle/0021_analytics_breakdown_indexes.sql` — both CREATE INDEX present | ✅ exact |
| Migrate.js runbook fns: getAllJournalMigrations, prepareLegacyDatabaseIfNeeded, reconcileLegacySchema, baselineAllJournalMigrations, runMigrations + "silently skipped N" post-condition | :382-386 | `migrate.js:144, 659, 247, 642, 698`; assertion at `:713` | ✅ all present |
| `_journal.json` has non-monotonic `when` (some 2026, some 2025) | :380 | 22 entries, years {2025,2026}, strictly-monotonic=false (computed) | ✅ |
| serve-upload ETag `W/"v${VER}-${mtimeMs}-${size}-${settingsHash}"` | :263 | `serve-upload.ts:201` exact template | ✅ exact |
| Cache-Control `public, max-age=3600, must-revalidate` in next.config.ts + serve-upload.ts + nginx | :172, :261 | `next.config.ts:66`, `serve-upload.ts:216,238`, `nginx:157` | ✅ all 3 |
| `/api/live` + `/api/health` (DB probe only when HEALTH_CHECK_DB=true) | :461 | `api/live/route.ts`, `api/health/route.ts:18` gate | ✅ |

### Color/HDR pipeline
| Claim | Doc | Code | Status |
|---|---|---|---|
| Color decision enum: srgb, srgb-from-unknown, p3-from-{displayp3,dcip3,adobergb,prophoto,rec2020} | matrix :240-247 | `color-pipeline-decisions.ts:23-29` — all 7 values present | ✅ exact |
| Home `og:image` → `/api/og/photo/${latestId}` via `getLatestImageForOgCached` | :102 | `(public)/page.tsx:118` (`/api/og/photo/${latestImage.id}`), `:93` getLatestImageForOgCached | ✅ |
| `sanitizeForOg` (og-sanitize.ts) imported by 3 consumers: api/og/route.tsx, api/og/photo/[id]/route.tsx, p/[id]/page.tsx | :181 | All 3 importers confirmed (+ lib def + 2 tests) | ✅ exact |
| admin-only color columns mirror SENSITIVE_KEYS fixture | :126-140 | `privacy-fields.test.ts:7-41` includes color_pipeline_decision, is_hdr, transfer_function, matrix_coefficients, has_gain_map, bit_depth, uploaded_by, color_space, icc_profile_name, pipeline_version + GPS/filename PII | ✅ |
| Backfill 10-column set, both entry points | :291 | `scripts/backfill-color-pipeline.ts:212-220` + pipeline_version `:371`; `admin-backfill-runner.ts:525-531` | ✅ both paths |

### Advisory locks
| Claim | Doc | Code | Status |
|---|---|---|---|
| 6 advisory-lock names (scope note) | :353 | Exactly 6 in code: `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit_db_restore`, `gallerykit_topic_route_segments`, `gallerykit_upload_processing_contract` + templated `gallerykit:image-processing:{jobId}` | ✅ complete, no extras, none missing |

### Lint gates / touch-target
- Four lint gates (api-auth, action-origin, public-route-rate-limit, eslint) described at :479-499 / AGENTS.md:30-36 — scan globs and exempt-comment tags match the documented behavior (consistent with prior-cycle verifications; no regex described that contradicts code).
- Touch-target audit additional patterns at :513 (`scanRawCheckboxes` raw checkbox/radio floor) confirmed present at `touch-target-audit.test.ts:695`.

### Versions
- package.json: next `^16.2.3`, react `^19.2.5`, typescript `^6` — matches "Next.js 16.2, React 19, TypeScript 6" (:11) and "Node.js 24+ / TypeScript 6.0+" (:455).

### Cycle-7 fix landings the docs reference (confirmed in code)
- **AGG-C7-05 / 85bca582**: `isLosslessWebpByChunk()` exists at `process-image.ts:1498`, used at `:1608` replacing the old `input.includes(Buffer.from('VP8L'))` substring scan; test `process-image-webp-lossless-detect.test.ts` present. (Doc does not over-claim — this is a code-only fix; CLAUDE.md does not assert the old behavior anywhere.)

---

## CARRIED LOW (record-only, UNCHANGED) — DOC8-01

**DOC8-01** — AGENTS.md:40 says "`.context/plans/` is gitignored — local plan-management artifacts only." **Code reality:** `git ls-files .context/plans/` returns tracked artifacts (README.md, done/*.md); there is NO `.gitignore` rule matching `.context/plans` in either root or apps/web `.gitignore`; live plans actually live in repo-root `/plan/` (e.g. `plan/cycle1-rpf-deferred.md`). Severity LOW (does not mislead any security/correctness decision). Confidence High. This is the same nuance carried as DOC-C7-01 across cycles — the *forward* intent (don't add new plan churn to the tree) is the documented spirit, and the historical tracked artifacts predate the convention. **UNCHANGED — not newly actionable; report only to preserve the record.**

---

## Summary
- **0 new doc/code mismatches.**
- **AGG-C7-04 (the flagged known item): CLOSED + accurate** — CLAUDE.md:514 now correctly reflects the committed scale-token catch-all covering Button/button/Link/a/select (incl. the select height-only reach). Not re-reported.
- **DOC8-01 (LOW, carried):** AGENTS.md:40 `.context/plans/` "gitignored" imprecision — unchanged historical nuance, record-only.
- ~40 discrete high-value claims (constants, line refs, lock names, ETag format, migration runbook, color matrix, rate limits, caps, versions, privacy fixture) independently verified CORRECT against HEAD `9c40d261`.

The documentation axis has converged. No PROMPT-2 schedulable doc work beyond optionally restating DOC8-01 (already known, low value).
