# Document-Specialist Review — Doc-vs-Code Correctness (Run 6 / Cycle 4)

**HEAD:** f8147868
**Date:** 2026-06-16
**Working tree:** clean (only `.context/reviews/perf-reviewer.md` modified by a sibling agent)
**Scope:** CLAUDE.md / AGENTS.md / inline-comment / runbook accuracy vs the ACTUAL code at HEAD. Precise file:line verification, trusted to overrule agents working from stale snapshots.

---

## HEADLINE: ZERO open doc/code mismatches. All three cycle-3 doc fixes landed; both prior CLOSED items stayed closed. Honest convergence.

This cycle's job was to (a) verify the three scheduled cycle-3 doc fixes actually landed, (b) re-confirm the two items I verified CLOSED last cycle did not regress, and (c) run a fresh section-by-section pass of CLAUDE.md's load-bearing factual claims against the code. **Result: every audited claim (~40 distinct facts) matches the code exactly. No new drift. No regression.**

---

## CYCLE-3 FIXES — VERIFIED LANDED

### ✅ AGG-C3-05 / F1 — settings-hash `max-age=86400` docstring → now `max-age=3600, must-revalidate`
- **Commit:** f603cd3f ("fix stale max-age + de-enumerate ETag key list in comments").
- **Now at `settings-hash.ts:20-24`:** docstring reads *"keep the old bytes for `Cache-Control max-age=3600, must-revalidate` (AGG-C3-05: was a stale `max-age=86400` here; R8-R7 reduced the served value to 3600 across serve-upload.ts, next.config.ts, and nginx/default.conf — the 86400 surfaces are s-maxage / SWR on the OG routes only)."* Correct, and even self-documents the prior drift + the legitimate 86400 surfaces. **CLOSED.**

### ✅ AGG-C3-06 — serve-upload.ts ETag comment re-enumerated the 9 keys it warned against
- **Commit:** f603cd3f.
- **Now at `serve-upload.ts:197-202`:** comment reads *"The authoritative list is COLOR_IMPACTING_KEYS in settings-hash.ts — intentionally NOT re-enumerated here because an inline copy drifts (AGG-D1; AGG-C3-06 removed the inline 9-key list that had crept back in — see that constant for the current membership)."* No inline key list remains. **CLOSED.**

### ✅ AGG-C3-07 / F2 — Stripe `async_payment_succeeded` cross-ref label drift
- **Commit:** 22d02262 ("cross-ref Stripe async-payment gate lineage in entitlements note").
- **Now at `CLAUDE.md:122`:** the note ADDS the current code lineage — *"tracked in-code as Cycle 3 RPF / P262-01 / C3-RPF-01 + Cycle 4 RPF / P264-03 / C4-RPF-03"* — which matches the webhook route comments verbatim (`stripe/webhook/route.ts:91` "Cycle 3 RPF / P262-01 / C3-RPF-01", `:100` "Cycle 4 RPF / P264-03 / C4-RPF-03"). It RETAINS "plan-316 CRT-R5C1-04" but recontextualizes it correctly as the name of the **future deferred handler work** ("until plan-316 CRT-R5C1-04 ships the `async_payment_succeeded` handler"), not as the tracking ID for the *current* gate. plan-316 is a real file (`plan/plan-316-run5-cycle1-low-docs.md`), and CRT-R5C1-04 is consistently used across the review corpus (tracer.md:241, test-engineer.md:125) as the future-handler ID. The webhook code comment at `:99` independently says "a future cycle should add a handler for `checkout.session.async_payment_succeeded`". This is now **consistent, not drift. CLOSED.**
- The behavioral claim (async-paid genuinely NOT handled; card-only pin closes it operationally) remains accurate — webhook gates `payment_status === 'paid'` at `:105` and rejects `'unpaid'` async sessions.

---

## TWO PRIOR-CLOSED ITEMS — VERIFIED STILL CLOSED (did not regress)

### ✅ settings-hash "covers N keys"
- `settings-hash.ts:4` docstring: *"over the **9** settings"*. `COLOR_IMPACTING_KEYS` array (`:41-53`) = exactly **9** entries (5 color + `image_quality_webp`/`avif`/`jpeg` + `image_sizes`). CLAUDE.md:264 says 9. Consistent. The "5" no longer exists in any prose claim.

### ✅ React cache() "wraps N data-access functions"
- `data.ts` has **exactly 10** `= cache(` call sites (verified by `grep -c`): `getSmartCollectionBySlugCached`(1332), `getImageCached`(1608), `getLatestImageForOgCached`(1610), `getTopicBySlugCached`(1611), `getTopicsCached`(1612), `getTagsCached`(1613), `getTopicsWithAliasesCached`(1614), `getImageByShareKeyCached`(1616), `getSharedGroupCached`(1621), `getSeoSettings`(1662). CLAUDE.md:361 says 10 and lists `getLatestImageForOgCached`. Consistent.

### ✅ AGG-C3-04 (sidecar backfill exit code) — bonus verification (code fix, not doc)
- `backfill-color-pipeline.ts:485` now `process.exit(errors > 0 || detectionFailures > 0 ? 1 : 0)`; `:342` tracks `detectionFailures`, `:464/:470` surface it in the summary + a WARN line. The CLAUDE.md backfill section's description (re-encode-then-detection-fail leaves `pipeline_version` behind so a later run retries) matches `:439-444` + `:470`. Accurate.

---

## FRESH SECTION-BY-SECTION VERIFICATION — every claim accurate

### Versions & constants
| Claim (CLAUDE.md) | Code | Verdict |
|---|---|---|
| `IMAGE_PIPELINE_VERSION = 7`, DEFINED in `gallery-config-shared.ts:21`, re-exported in process-image.ts (CLAUDE.md:92) | `gallery-config-shared.ts:21` = `7`; `process-image.ts:315` re-exports it; `:313` comment confirms. The precise "defined here / re-exported there" wording is correct. | ✅ |
| `pipeline_version` current: 7 (CLAUDE.md:140) | matches constant | ✅ |
| Default image sizes `[640, 1536, 2048, 4096, 5120, 7680]` | `gallery-config-shared.ts:90` `DEFAULT_IMAGE_SIZE_VALUES` | ✅ |
| `avif_effort` default 6 | `:128` `'6'` | ✅ |
| `wide_gamut_max_source_pixels` 50M | `:134` `'50000000'` | ✅ |
| `force_srgb_derivatives`/`allow_hdr_ingest`/`force_show_color_chips` default false | `:116/:119/:122` | ✅ |
| `image_quality_webp/avif/jpeg` 90/85/90 | `:97/:98/:99` | ✅ |
| Argon2 memoryCost=65536, timeCost=3, parallelism=4, argon2id | `password-hashing.ts:11-14` | ✅ |
| QUEUE_CONCURRENCY default 1 | `image-queue.ts:168` | ✅ |
| Pool 10 conns / queueLimit 20 / keepalive | `db/index.ts:23/:33/:35` | ✅ |
| Blur cap 4096 chars | `blur-data-url.ts:45` | ✅ |
| Upload caps 200 MiB / 2 GiB / 100 files | `upload-limits.ts:3/:1/:16` | ✅ |

### Rate limiting
- Login "5 attempts / 15-min window": `rate-limit.ts:62` (`LOGIN_WINDOW_MS = 15*60*1000`), `:63` (`LOGIN_MAX_ATTEMPTS = 5`). Per-account bucket reuses same window (`auth-rate-limit.ts:19`). ✅

### Cache-Control trio (the AGG-C3-05 surface)
- All three layers emit `public, max-age=3600, must-revalidate`, none emit 86400 or `immutable`: `next.config.ts:71`, `serve-upload.ts:230` + `:252`, `nginx/default.conf:157`. The `next.config.ts:64-65` + `serve-upload.ts:193-195` comments correctly explain the deliberate non-`immutable` choice (backfill rewrites bytes in place). ✅

### ETag formats
- `serve-upload.ts:215`: `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"` — matches CLAUDE.md:264 char-for-char. ✅

### Advisory locks (all 6 names match)
- `advisory-locks.ts`: `LOCK_DB_RESTORE='gallerykit_db_restore'`(:19), `LOCK_UPLOAD_PROCESSING_CONTRACT='gallerykit_upload_processing_contract'`(:22), `LOCK_TOPIC_ROUTE_SEGMENTS='gallerykit_topic_route_segments'`(:25), `LOCK_ADMIN_DELETE='gallerykit_admin_delete'`(:34), `gallerykit:image-processing:${jobId}`(:41), `LOCK_COLOR_PIPELINE_BACKFILL='gallerykit_color_pipeline_backfill'`(:44). All 6 documented names present and exact. ✅

### Color & HDR pipeline
- Encoder decision enum `COLOR_PIPELINE_DECISIONS` (`color-pipeline-decisions.ts:23-29`) = `srgb`, `srgb-from-unknown`, `p3-from-displayp3`, `p3-from-dcip3`, `p3-from-adobergb`, `p3-from-prophoto`, `p3-from-rec2020` — matches the CLAUDE.md decision-matrix rows exactly. ✅

### Privacy guard
- `_PrivacySensitiveKeys` + `_SensitiveKeysInPublic` compile-time guard at `data.ts:417-419`. ✅
- `uploaded_by` FK `ON DELETE SET NULL` at `schema.ts:94` + index `idx_images_uploaded_by` (:118). ✅

### Schema tables & analytics indexes
- `admin_tokens`(schema.ts:196), `image_embeddings`(273), `entitlements`(290), `smart_collections`(312) all present. ✅
- `image_views` indexes `(bot, viewed_at, country_code)`(:232) and `(bot, viewed_at, referrer_host)`(:233) — migration 0021. ✅

### tag_names aggregation
- `tagNamesAgg` at `data.ts:605` = `GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY ${tags.name})`, used by all 5 masonry-list queries (:734/:783/:833/:899/:923) + smart-collection (:1359). Matches CLAUDE.md. ✅

### CSV / Unicode-formatting security ranges
- `csv-escape.ts:14-20,46-49` strips U+202A-202E, U+2066-2069, U+200B-200F, U+2060, U+FEFF, U+180E, U+FFF9-FFFB — exactly the ranges in the CLAUDE.md DB-security note. ✅
- `validation.ts:58` `UNICODE_FORMAT_CHARS = /[᠎​-‏‪-‮⁠⁦-⁩﻿￹-￻]/` + `containsUnicodeFormatting`(:73) — matches the admin-string-validation note. ✅

### Service Worker / PWA
- `sw.js:26` `SW_VERSION = 'dd26e742-p7'` (git short-SHA + `-p` + IMAGE_PIPELINE_VERSION=7); `build-sw.ts:46` produces `${commit}-p${IMAGE_PIPELINE_VERSION}`; template placeholder `__SW_VERSION__` at `sw.template.js:26`. Format matches CLAUDE.md (the committed SHA differs from the older `5b5de9d3-p7` commit-message stamp, which is expected — it re-stamps per build). ✅
- `x-gk-admin-render` header set in `proxy.ts:129` — matches the SW offline-fallback personalization note. ✅

### Migration & Schema-Drift Runbook (vs migrate.js)
- `getAllJournalMigrations`(:144), `reconcileLegacySchema`(:247), `baselineAllJournalMigrations`(:642), `prepareLegacyDatabaseIfNeeded`(:659), `journalCovered = migrations.every((m) => haveHashes.has(m.hash))`(:683), loud-fail `"[Migration] Drizzle silently skipped N migration(s): …"`(:713). All match the documented permanent fix. ✅

### Backfill operational command (CLAUDE.md:313)
- Env vars `BACKFILL_CONCURRENCY=2` (script honors at `:329`, default 2) + `UPLOAD_ORIGINAL_ROOT=/app/data/uploads/original` (read by `upload-paths.ts:27-28`). `gallerykit_color_pipeline_backfill` advisory lock on a dedicated connection (`:266-268`), `--force-reencode` flag (`:244/:300`). Command structure consistent with runtime. ✅

### Health endpoints
- `/api/live` route present; `/api/health` gates DB probe on `HEALTH_CHECK_DB !== 'true'` (`api/health/route.ts:18`). ✅

### i18n key-parity convention (DOC-R5C3-07)
- Programmatic check: **en = 840 keys, ko = 840 keys, zero asymmetry in the key set** (`only in en: []`, `only in ko: []`). en has 5 `plural` blocks; ko has 0. Exactly matches the documented intentional asymmetry (en uses ICU `{count, plural, …}`, ko uses fixed `{count}장`/`{count}개`). Do NOT "fix" ko. ✅

### CLIP semantic search (HARD GUARD honored)
- `image_embeddings` table is a documented stub (schema.ts:273); verified docs-vs-disabled-behavior only. Did NOT propose activation. ✅

---

## SUMMARY

- **Open doc/code mismatches: 0.**
- **Cycle-3 scheduled doc fixes (AGG-C3-05, AGG-C3-06, AGG-C3-07): all 3 verified landed and correct.**
- **Prior CLOSED items (settings-hash 9 keys, cache() 10 functions): verified NOT regressed.**
- **~40 distinct load-bearing CLAUDE.md/AGENTS.md/runbook claims spot-checked against code at HEAD f8147868 — every one accurate.** CLAUDE.md remains unusually well-maintained; the self-documenting drift-history annotations (e.g. "AGG-C3-05: was a stale 86400 here") are doing their job.
- **Note on F2/AGG-C3-07 nuance:** "plan-316 CRT-R5C1-04" was retained in CLAUDE.md but is now correctly used to name the *future deferred handler*, not the current gate; the current code lineage was added alongside it. This is consistent with the webhook code comments and the review corpus. Resolved, not drift.

**Verdict: honest convergence on the documentation surface. Nothing to plan this cycle from doc/code mismatch.**
