# Document-Specialist Review — Doc↔Code Accuracy

**Repo:** GalleryKit @ /Users/hletrd/flash-shared/gallery (Next.js 16.2 / React 19 / TS6 photo gallery)
**Date:** 2026-06-13
**Run/cycle:** run-8 cycle-2 of the review-plan-fix loop.
**HEAD:** `77867144` (build(sw): re-stamp SW_VERSION after run-7 cycle-1 test de-flake). Working tree CLEAN, synced with origin/master.
**Authoritative source = CODE** (plus official framework version docs where versions are claimed).
**Mandate:** verify the run-7 doc-drift fixes actually landed, then fresh-sweep CLAUDE.md / AGENTS.md / README / plan docs / code comments for claims the code contradicts at HEAD.

---

## Part 1 — Prior doc-drift batch (AGG-R7-08 + DOC-05): VERIFIED CORRECTED AT HEAD

Commit `10d77324` ("docs: correct COLOR_IMPACTING_KEYS count, Sharp-instance wording, pipeline-version + backfill env-var docs") claimed to fix the run-7 AGG-R7-08 batch. **All four sub-items + the separate DOC-05 file-header drift are now genuinely corrected at HEAD.** None should be re-reported.

| Sub-item | Prior claim | Status at HEAD | Evidence |
|---|---|---|---|
| **(a) COLOR_IMPACTING_KEYS count** | CLAUDE.md said "5"; settings-hash.ts docstring said 3 | **CORRECTED** | `CLAUDE.md:260` now says "all **9** `COLOR_IMPACTING_KEYS` (`settings-hash.ts:34-46`)" and enumerates the 5 color + 3 quality + `image_sizes`. `settings-hash.ts:6-12` docstring now lists all 9 (color/quality/size). The array at `settings-hash.ts:37-48` has exactly 9 entries; `buildHashFromConfig` (69-82) folds all 9. Match. |
| **(b) "Single Sharp instance with clone()"** | CLAUDE.md:216 overstated decode reuse, contradicted its own :246 | **CORRECTED** | `CLAUDE.md:216` now reads "Per-format **fresh** `sharp(inputPath, …)` instance (WI-14 …), with `clone()` used only WITHIN a format" + an explicit "does NOT keep a single decoded instance across formats/sizes" note citing `process-image.ts:1019-1097`. Agrees with `:246` and the code reality. |
| **(c) IMAGE_PIPELINE_VERSION location** | CLAUDE.md:92 attributed the definition to process-image.ts | **CORRECTED** | `CLAUDE.md:92` now says "`IMAGE_PIPELINE_VERSION` (currently 7) is DEFINED in `gallery-config-shared.ts:21` and re-exported here". Code: `gallery-config-shared.ts:21` `export const IMAGE_PIPELINE_VERSION = 7;`; `process-image.ts:303` re-exports. Value **7** correct. |
| **(d) backfill env-var docs** | CLAUDE.md only showed sidecar `BACKFILL_CONCURRENCY`; missing in-app `ADMIN_BACKFILL_CONCURRENCY` + cap arithmetic | **CORRECTED** | `CLAUDE.md:291-292` now documents BOTH: in-app `ADMIN_BACKFILL_CONCURRENCY` (default 1, clamped to `max(1, floor((POOL_LIMIT − RESERVED − 1)/2))` with `RESERVED = max(3, ceil(POOL_LIMIT/2))` → **2** at pool=10) vs sidecar `BACKFILL_CONCURRENCY` (default 2, uncapped). Formula matches `admin-backfill-runner.ts:105-142` exactly. |
| **DOC-05 (file-header `= 4`)** | `admin-backfill-runner.ts:28-35` header still asserted old cap `floor((LIMIT-2)/2)=4` | **CORRECTED** | `admin-backfill-runner.ts:32-37` header now states `cap = max(1, floor((POOL_CONNECTION_LIMIT - RESERVED - 1) / 2))` with `RESERVED = max(3, ceil(POOL_CONNECTION_LIMIT / 2))` → cap = 2. Agrees with the function docblock (108-128) and the code (129-142). The companion `db/index.ts:16-17` comment also carries the new RESERVED formula. No remaining self-contradiction. |

The `DOC-06` (plan-330 mis-citing "3" vs "5") nit from the prior review is moot now that CLAUDE.md and the docstring are both authoritative-9.

**Conclusion for Part 1:** zero residual drift from the run-7 batch.

---

## Part 2 — Fresh sweep at HEAD

Each high-specificity CLAUDE.md / AGENTS.md claim category was checked against code. All CORRECT (no finding) unless flagged.

### Verified CORRECT (no finding)

1. **Key Files & Patterns table — all 28 paths exist.** Every file in the table resolves on disk (schema.ts, process-image.ts, color-detection.ts, color-primaries.ts, color-pipeline-decisions.ts, icc-extractor.ts, icc-chromaticity.ts, gain-map-detection.ts, use-display-capability.ts, settings-hash.ts, hdr-filenames.ts, data.ts, proxy.ts, auth-rate-limit.ts, db-actions.ts, db/download/route.ts, site-config.json, password-hashing.ts, blur-data-url.ts, gps-exif-strip.ts, csv-escape.ts, validation.ts, lightbox-color-pip.tsx, advisory-locks.ts, admin-backfill.ts, admin-backfill-runner.ts, backfill-color-pipeline.ts, photo-viewer.tsx). Plus sw-cache.ts, sw.template.js, build-sw.ts, migrate.js.
2. **Admin tunable defaults (color/HDR table) — all 7 match `gallery-config-shared.ts:96-135`.** force_srgb_derivatives=false, allow_hdr_ingest=false, force_show_color_chips=false, wide_gamut_jpeg_chroma='4:4:4', sdr_jpeg_chroma='4:2:0', avif_effort=6, wide_gamut_max_source_pixels=50000000 (50 MP). Default sizes `[640, 1536, 2048, 4096, 5120, 7680]` (line 90); `MAX_IMAGE_SIZE_COUNT=8` (line 137) ⇒ "up to 8 sizes" correct.
3. **Framework versions — match CLAUDE.md and the global latest-version rule.** `apps/web/package.json`: `next ^16.2.3` (installed 16.2.6), `react ^19.2.5` (19.2.5), `react-dom ^19.2.5`, `typescript ^6` (6.0.2), `engines.node >=24`. "Next.js 16.2, React 19, TypeScript 6, Node 24+" accurate; no stale pin.
4. **Database index list — all 8 documented `images`/join indexes match `schema.ts`.** (processed, capture_date, created_at) :114, (processed, created_at) :115, (topic, processed, capture_date, created_at) :116, (user_filename) :117, (uploaded_by) :118, image_tags(tag_id) :132, image_views(bot, viewed_at, country_code) :232, image_views(bot, viewed_at, referrer_host) :233. "migration 0021" attribution correct (`drizzle/0021_analytics_breakdown_indexes.sql`).
5. **Connection pool — `db/index.ts:23-36`.** POOL_CONNECTION_LIMIT=10, queueLimit=20, enableKeepAlive=true. "10 connections, queue limit 20, keepalive enabled" correct.
6. **Advisory-lock names — all 6 match `advisory-locks.ts`.** gallerykit_db_restore :18, gallerykit_upload_processing_contract :21, gallerykit_topic_route_segments :24, gallerykit_admin_delete :33, gallerykit_color_pipeline_backfill :43, gallerykit:image-processing:{jobId} :39-40.
7. **Argon2 params — `password-hashing.ts:11-14`.** argon2id, memoryCost=65_536 (64 MiB), timeCost=3, parallelism=4. Match.
8. **`images` color/HDR columns — all present in `schema.ts:45-112`.** color_space, icc_profile_name, bit_depth, color_pipeline_decision, color_primaries, transfer_function, matrix_coefficients, is_hdr, has_gain_map, was_downscaled, pipeline_version, avif_10bit, uploaded_by with `references(adminUsers.id, { onDelete: 'set null' })` (matches "R17-L2 / ON DELETE SET NULL").
9. **Schema table list — all named tables exist.** adminTokens, imageViews, topicViews, sharedGroupViews, imageEmbeddings, entitlements, smartCollections (+ images/topics/tags/imageTags/adminUsers/sessions/sharedGroups).
10. **`QUEUE_CONCURRENCY` default 1** — `image-queue.ts:166` `Number(process.env.QUEUE_CONCURRENCY) || 1`.
11. **React `cache()` wraps exactly 9 functions** — `data.ts` has 9 `= cache(...)` definitions (8 `*Cached` exports + `getSeoSettings`). ":354 wraps 9 data-access functions" exact.
12. **SW image-cache LRU cap 50 MB** — `sw.template.js:31` MAX_IMAGE_BYTES = 50*1024*1024; `sw-cache.ts:19` MAX_IMAGE_CACHE_BYTES = 50*1024*1024.
13. **Blur data URL cap 4096 chars** — `blur-data-url.ts:45` MAX_BLUR_DATA_URL_LENGTH = 4096.
14. **Upload caps — `upload-limits.ts`.** Env var `UPLOAD_MAX_TOTAL_BYTES` (line 15, default 2 GiB), `UPLOAD_MAX_FILES_PER_WINDOW` (line 16, default 100), MAX_UPLOAD_FILE_BYTES=200 MiB (line 3), MAX_RESTORE_FILE_BYTES=250 MiB (line 4), SERVER_ACTION_BODY_OVERHEAD_BYTES=16 MiB (line 5 ⇒ 200+16=216 MiB admin nginx cap). All match. (The env var CLAUDE.md cites — `UPLOAD_MAX_TOTAL_BYTES` — is correct; the internal constant `MAX_TOTAL_UPLOAD_BYTES` differs but is never cited, so no drift.)
15. **Histogram canvas 256-px cap** — `histogram.tsx:87,105` down-scale to 256-px canvas; 256-bin arrays 122-124.
16. **Public-route `revalidate = 0`** — confirmed on 9 `(public)` route files (page, p/[id], [topic], g/[key], s/[key], c/[slug], timeline, year/[year], map). "public photo, topic, shared, and home pages set revalidate=0" accurate.
17. **Original-upload private path** — `upload-paths.ts:31-32` resolves `data/uploads/original/` under `UPLOAD_ORIGINAL_ROOT`. Matches "private upload store under data/uploads/original/".
18. **Stripe `async_payment_succeeded` gap** — `api/stripe/webhook/route.ts:88,105` handles only `checkout.session.completed` + `payment_status==='paid'`; `async_payment_succeeded` still unimplemented (noted future at :99). Matches the CLAUDE.md `entitlements`-table warning and the deferred-to-plan-316 disposition.
19. **AGENTS.md** — git-workflow, deploy (gallery.atik.kr / ubuntu@atik.kr), schema-migration runbook, quality gates (4 lint scripts + typecheck + build + vitest), touch-target/Color-HDR conventions consistent with CLAUDE.md and code. No contradictions.

---

## OPEN / NEW findings

**None at MED or above.** The two items below are LOW, doc-internal, and would not cause an operator to take a harmful action.

### DOC-1 — AGENTS.md test-count "1300+" understates the real suite (LOW, doc-only)

- **Doc:** `AGENTS.md:36` — "`npm test --workspace=apps/web` — Vitest **1300+** unit tests".
- **Reality:** the run-7 aggregate (`.context/reviews/_aggregate.md:12`) measured **~2026** unit tests passing this cycle. "1300+" is technically still true (2026 ≥ 1300) but materially understated — a reader sizing the suite or a CI timeout budget off this number is misled by ~35%.
- **Discrepancy:** stale lower bound; not a contradiction, but a number a maintainer would want current.
- **Suggested correction:** bump to "2000+ unit tests" (or drop the count and say "the full Vitest suite") to avoid re-staling each cycle.
- **Confidence:** Medium (the 2026 figure is from the prior aggregate, not a live `npm test` run this review). Doc-only ⇒ LOW severity.

### DOC-2 — AGENTS.md hardcodes the deploy SSH key `~/.ssh/atik.pem`; CLAUDE.md + `.env.deploy.example` keep it config-driven (LOW, doc-only)

- **Doc:** `AGENTS.md:18` — "The deploy host is `gallery.atik.kr` (`ubuntu@atik.kr` over SSH key `~/.ssh/atik.pem`)."
- **Reality:** CLAUDE.md describes deploy as reading the gitignored `.env.deploy` (host/key/script derived from it) and only ever shows `ssh ubuntu@atik.kr` (no key). `.env.deploy.example` uses generic placeholders (`DEPLOY_KEY=~/.ssh/example.pem`). The concrete key path lives only in AGENTS.md; not contradicted by CLAUDE.md (which omits the key), but it bakes an operator-specific path into a checked-in doc rather than pointing at `.env.deploy`.
- **Discrepancy:** minor inconsistency in where deploy credentials are sourced (hardcoded in AGENTS.md vs config-file in CLAUDE.md/.env.deploy). Not harmful — a key path, not a key — but it can drift from the real `.env.deploy` value.
- **Suggested correction:** in AGENTS.md, replace the hardcoded key with "see `.env.deploy` (`DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_KEY`)" to match CLAUDE.md's config-driven framing.
- **Confidence:** High (mechanical doc comparison). Doc-only ⇒ LOW severity.

---

## Summary

- **Part 1:** the entire run-7 doc-drift batch (AGG-R7-08 sub-items a/b/c/d + the separate DOC-05 `admin-backfill-runner.ts` file-header `=4` drift) is **fully corrected at HEAD** by commit `10d77324`. The `db/index.ts:16-17` comment carrying the same formula is also current. Re-report none.
- **Part 2 (fresh sweep):** 19 high-specificity claim categories verified against code — file paths, color/HDR + image-size defaults, framework versions, the 8 documented indexes, pool config, the 6 advisory locks, Argon2 params, the color/HDR schema columns, the schema table list, queue concurrency, the 9 `cache()` wrappers, SW/blur/upload caps, histogram cap, public `revalidate=0`, original-upload path, the Stripe `async_payment_succeeded` gap, and AGENTS.md — **all accurate.**
- **Open/new:** only **DOC-1** (AGENTS.md "1300+" test count is a stale lower bound vs ~2026 actual, LOW) and **DOC-2** (AGENTS.md hardcodes the deploy SSH key path instead of pointing at `.env.deploy`, LOW). Both doc-internal, neither operationally harmful. No MED+ doc/code mismatch found this cycle.
