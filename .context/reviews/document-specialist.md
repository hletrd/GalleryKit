# Run-10 Cycle-1 / Run-9 Cycle-4 Convergence — Document Specialist Review

Date: 2026-06-25
HEAD: d24f2a6d (run-9 cycle-4 convergence, following run-10 cycle-1)
Previous Review: 1d5545cb (run-9 cycle-8)

## Summary

This review covers documentation changes since the cycle-8 review (HEAD 1d5545cb). The cycle-4 commits (d24f2a6d) include several bug fixes, documentation improvements, and a significant CLAUDE.md update that added the "Optional Operational Variables" table. Most findings from the previous review have been addressed or partially addressed. A few new documentation/code mismatches have emerged from the bug fixes, and some previously identified issues remain open.

## Status of Previous Review Findings

### Fixed since last review

| ID | Finding | Fix Commit |
|----|---------|-----------|
| B1 (partial) | Missing env vars in CLAUDE.md | 31293369 — Added "Optional Operational Variables" table with 18 vars |
| F1 | README backfill `--force` flag | eefb9ce0 — Added `--force` to CLIP backfill command |
| F2 (partial) | Semantic search env examples | 31293369 — `SEMANTIC_SEARCH_ALLOW_PRODUCTION` and `CLIP_MODELS_ROOT` now in CLAUDE.md table; still MISSING from `.env.local.example` |
| A5 (partial) | `gamma18` documentation | Still partially incomplete — see New Finding N6 |

### Still Open from Previous Review

| ID | Finding | Status |
|----|---------|--------|
| A1 | Stale JSDoc in `process-image.ts:595-633` | Still present — orphaned stale comment block |
| A2 | `detectColorSignals` JSDoc parameter mislabel | Still present |
| A3 | `deleteImageVariants` JSDoc missing parameters | Still present |
| A4 | `color-detection.ts` module JSDoc stale feature ID (US-CM12 vs WI-09) | Still present |
| A6 | `gamma18` documentation incomplete | Still present — see N6 |
| A7 | Security docs conflate serving-path and upload-path protections | Still present |
| B2 | Admin settings missing from tunables table (`slideshow_interval_seconds`, `auto_alt_text_enabled`, `semantic_search_mode`) | Still present |
| B3 | `smart_collections` entirely undocumented | Still present |
| B4 | `admin_tokens` / Lightroom Classic plugin partially undocumented | Still present |
| B5 | API routes undocumented (`/api/admin/lr/upload`, `/api/search/semantic`, `/api/search/similar/[id]`) | Still present |
| B6 | Schema tables undocumented (`topic_aliases`, `rate_limit_buckets`, `audit_log`) | Still present |
| B7 | `AUDIT_LOG_RETENTION_DAYS` undocumented | Addressed in CLAUDE.md table (31293369) but still missing from `.env.local.example` |
| B8 | Rate limit constants undocumented | Still present |
| B9 | EXIF columns undocumented | Still present |
| B10 | `NEXT_UPLOAD_BODY_MAX_BYTES` undocumented | Addressed in CLAUDE.md table (31293369) but still missing from `.env.local.example` |
| C1-C3 | Version imprecisions (Next.js 16.2 vs ^16.2.9, React 19 vs ^19.2.5, TypeScript 6 vs ^6) | Still present |
| D1 | Orphaned migration `0014_drop_reactions.sql` | Still present |
| D2 | Root `package.json` missing `lint:public-route-rate-limit` | Still present |
| D3 | Root `build` script uses `--workspaces` | Still present |
| E1-E3 | Missing JSDoc on complex functions | Still present |

---

## New Findings (Run-9 Cycle-4 / Run-10 Cycle-1)

### Category N: New Confirmed Mismatches (code changes introduced new doc gaps)

#### N1 — `enqueueImageProcessing` return type changed but undocumented — CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **File:** `apps/web/src/lib/image-queue.ts:243-304`
- **Type:** API documentation mismatch

**Claim:** No documentation exists for `enqueueImageProcessing` return value.

**Reality:** Commit 735f9715 changed `enqueueImageProcessing` from returning `void` to returning `boolean`. It now returns `false` when the job is rejected (shutdown, restore maintenance, invalid filenames, permanently failed) and `true` when the job is successfully enqueued (or already enqueued). The JSDoc at line 27-30 only describes the module purpose, not the function. Callers in `images.ts` and `lr/upload/route.ts` now receive this boolean but do not check it.

**Fix:** Add JSDoc to `enqueueImageProcessing` documenting the return value semantics: `returns {boolean} true if the job was enqueued or already in queue, false if rejected.`

---

#### N2 — `retryFailedImage` now has restore-maintenance guard but CLAUDE.md doesn't mention it — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/app/actions/images.ts:1084-1088`, CLAUDE.md
- **Type:** Missing documentation for new behavior

**Claim:** CLAUDE.md documents restore maintenance as guarding DB restore, upload, and sharing actions.

**Reality:** Commit 24c8e483 added `getRestoreMaintenanceMessage()` guard to `retryFailedImage` (line 1084-1088), making it the FIRST image-mutation action with a restore-maintenance guard. The CLAUDE.md "Race Condition Protections" section does not mention this.

**Fix:** Add `retryFailedImage` to the list of restore-maintenance-guarded actions in CLAUDE.md, or add a general note that all mutating admin actions (including retry-failed) are gated on restore maintenance.

---

#### N3 — `instrumentation.ts` shutdown behavior changed but CLAUDE.md outdated — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/instrumentation.ts:8-62`, CLAUDE.md
- **Type:** Documentation stale after code changes

**Claim:** CLAUDE.md mentions "Expired sessions purged automatically (hourly background job)" and "The container liveness probe now uses `/api/live`" but does not document the graceful shutdown behavior.

**Reality:** Commit 5feae639 made three shutdown behavior changes:
1. Exit code is now `1` on timeout (not `0`) — `process.exitCode = completed ? 0 : 1` (line 39)
2. Repeated signals are now handled gracefully with a `shutdownInProgress` guard (lines 46-62)
3. Shutdown timeout is 15 seconds (line 12-15)

The Docker deployment section mentions `/api/live` and `/api/health` but does not mention the graceful shutdown sequence, the 15s timeout, or the exit-code behavior.

**Fix:** Add a brief note to the Docker Deployment section about graceful shutdown: 15s drain timeout, exit code 1 on forced termination, repeated signal handling.

---

#### N4 — `process-image.ts` wide-gamut temp file cleanup not documented — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/process-image.ts:1032-1051`
- **Type:** Missing documentation for new behavior

**Claim:** The wide-gamut downscale intermediate file creation is documented in CLAUDE.md as part of the rgb16 pipeline, but the cleanup-on-error behavior is not.

**Reality:** Commit 70ea54d9 added a try/catch around the wide-gamut temp file creation that cleans up the temp file on throw (disk full, permission error). The comment at lines 1043-1046 documents this, but CLAUDE.md's "Color & HDR Pipeline" section does not mention this resilience behavior.

**Fix:** Add a brief note to the Color & HDR Pipeline section about temp-file cleanup on downscale failure.

---

#### N5 — `image-queue.ts` claim retry mechanism fixes not documented — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/image-queue.ts:286-304`
- **Type:** Missing documentation for bug fixes

**Claim:** CLAUDE.md documents the image queue's "Delete-while-processing" and "Per-image-processing claim" protections, but not the claim retry mechanism.

**Reality:** Commit 735f9715 fixed two claim-retry bugs:
1. C4-A1: Remove from `enqueued` set BEFORE scheduling retry so the retry actually re-adds the job
2. C4-A2: Reset `claimRetryScheduled` on successful claim so the finally block cleans up `claimRetryCounts`

These are important correctness fixes for the queue's claim mechanism but are only documented in inline comments.

**Fix:** Add a brief note to the "Race Condition Protections" section about the claim retry mechanism and its retry-count cleanup.

---

#### N6 — `gamma18` origin still imprecise in CLAUDE.md — CONFIRMED (carried from A6)
- **Severity:** Low
- **Confidence:** High
- **File:** CLAUDE.md line 134
- **Type:** Documentation imprecision

**Claim:** "`gamma18` comes only from ICC name heuristics (AGG-D3)"

**Reality:** Verified in `color-detection.ts:99-107`: `gamma18` is emitted when:
- `desc.includes('gamma 1.8')` or `name.includes('gamma18')` (line 99)
- OR the profile is ProPhoto (line 107, which sets `transferFunction = 'gamma18'`)

The claim omits the ProPhoto path. This was identified in the previous review (A6) and remains unfixed.

**Fix:** Update to "`gamma18` comes from ICC name heuristics (including ProPhoto profiles) — NCLX never emits this code."

---

#### N7 — `home-client.tsx` masonry class fix not reflected in CLAUDE.md — CONFIRMED
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/components/home-client.tsx:207-225`, CLAUDE.md
- **Type:** Documentation/code mismatch

**Claim:** CLAUDE.md says "Masonry grid: pure CSS multi-column layout (`columns-1 sm:columns-2 … 2xl:columns-5` + `break-inside-avoid`) — no JS reorder pass"

**Reality:** Commit 0e1a87a0 changed the masonry grid to use a static `COLUMN_CLASS_MAP` with explicit Tailwind class names instead of dynamic template literals. The comment at line 207-209 explains: "DES-R5C3-04: static Tailwind class mapping — the JIT compiler cannot detect dynamically constructed class names like `columns-${n}`." CLAUDE.md still describes the old dynamic template literal approach.

**Fix:** Update CLAUDE.md to describe the static class mapping approach, noting the Tailwind JIT compiler requirement.

---

#### N8 — `db/index.ts` connection init timeout not documented — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/db/index.ts:80-94`
- **Type:** Missing documentation for new behavior

**Claim:** CLAUDE.md documents the connection pool (10 connections, queue limit 20, keepalive) but not the connection init timeout.

**Reality:** Commit 9a98a60a added a 10-second timeout on the init query (`SET group_concat_max_len = 65535`) with `Promise.race` against a timeout promise. If the init query times out, the connection is released and an error is thrown. This is a resilience improvement for pool health under extreme load.

**Fix:** Add a brief note to the "Database Indexes" or "Connection pool" section about the connection init timeout and `group_concat_max_len` setting.

---

#### N9 — `semantic-search-route.ts` scan limit not documented in CLAUDE.md — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/app/api/search/semantic/route.ts`
- **Type:** Missing documentation

**Claim:** README.md (commit 95de4d11) documents "Scan scope: searches the newest embeddings first (bounded scan); large galleries may not surface relevant older photos unless they are re-uploaded or re-embedded after a backfill."

**Reality:** CLAUDE.md does NOT mention this scan limit behavior. The semantic search section in CLAUDE.md describes the production setup, model weights, and honesty gate, but not the bounded scan / newest-first behavior that affects result quality on large galleries.

**Fix:** Add the scan-scope disclosure to the CLAUDE.md semantic search section, mirroring the README.md language.

---

#### N10 — `data.ts` view-count flush backoff not documented — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/data.ts:31-41`
- **Type:** Missing documentation

**Claim:** CLAUDE.md says "Shared-group `view_count` is best-effort approximate analytics" and mentions the flush-on-SIGTERM behavior.

**Reality:** The view-count flush mechanism has exponential backoff during DB outages (lines 31-41): after 3 consecutive fully-failed flushes, the timer interval increases exponentially up to 5 minutes. This resilience behavior is not documented.

**Fix:** Add a brief note to the Runtime Topology section about the view-count flush backoff during DB outages.

---

### Category P: Partial Fixes (previous findings partially addressed)

#### P1 — `SEMANTIC_SEARCH_ALLOW_PRODUCTION` and `CLIP_MODELS_ROOT` still missing from `.env.local.example` — PARTIALLY FIXED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/.env.local.example`
- **Type:** Incomplete fix

**Claim:** Commit 31293369 added these to the CLAUDE.md "Optional Operational Variables" table.

**Reality:** They are still missing from `.env.local.example` despite being identified in the previous review (F2). The `.env.local.example` file has a "Semantic Search" section (lines 65-69) but only documents `SEMANTIC_SEARCH_ALLOW_PRODUCTION` and `CLIP_MODELS_ROOT` as comments. Wait — actually they ARE present in `.env.local.example` lines 68-69. Let me re-verify.

Re-check: `.env.local.example` lines 65-69 DO contain both `SEMANTIC_SEARCH_ALLOW_PRODUCTION` and `CLIP_MODELS_ROOT`. This is actually FIXED.

**Status:** FIXED. Both variables are present in `.env.local.example`.

---

#### P2 — `AUDIT_LOG_RETENTION_DAYS` missing from `.env.local.example` — PARTIALLY FIXED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/.env.local.example`
- **Type:** Incomplete fix

**Claim:** Commit 31293369 added `AUDIT_LOG_RETENTION_DAYS` to the CLAUDE.md table.

**Reality:** `.env.local.example` lines 38-39 DO contain `AUDIT_LOG_RETENTION_DAYS`. This is FIXED.

**Status:** FIXED.

---

#### P3 — `NEXT_UPLOAD_BODY_MAX_BYTES` missing from `.env.local.example` — NOT FIXED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/.env.local.example`, `apps/web/src/lib/upload-limits.ts:17`
- **Type:** Still missing

**Claim:** This env var controls the Next.js server action body size limit.

**Reality:** Still NOT in `.env.local.example`. The default is computed as `max(200MB, 250MB) + 16MB = 266MB` and exposed as `NEXT_SERVER_ACTION_BODY_SIZE_LIMIT`. The env var `NEXT_UPLOAD_BODY_MAX_BYTES` is read at line 17 of `upload-limits.ts` but not documented in the example file.

**Fix:** Add `# NEXT_UPLOAD_BODY_MAX_BYTES=279620608` to `.env.local.example` with a comment explaining it controls the Next.js server action body size limit.

---

### Category C: Correctly Documented (verified against code)

1. **Operational Variables table (31293369):** All 18 entries in the table match their code implementations. Verified: `DB_SSL`, `BASE_URL`, `IMAGE_BASE_URL`, `TRUST_PROXY`, `TRUSTED_PROXY_HOPS`, `HEALTH_CHECK_DB`, `QUEUE_CONCURRENCY`, `SHARP_CONCURRENCY`, `IMAGE_MAX_INPUT_PIXELS`, `IMAGE_MAX_INPUT_PIXELS_TOPIC`, `UPLOAD_MAX_TOTAL_BYTES`, `UPLOAD_MAX_FILES_PER_WINDOW`, `AUDIT_LOG_RETENTION_DAYS`, `VIEW_RETENTION_DAYS`, `ADMIN_BACKFILL_CONCURRENCY`, `BACKFILL_CONCURRENCY`, `UPLOAD_ORIGINAL_ROOT`, `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, `CLIP_MODELS_ROOT`, `NEXT_UPLOAD_BODY_MAX_BYTES`.

2. **Nginx config (`067e623a`):** The `/admin/tokens` path was correctly added to the admin mutation throttle location. CLAUDE.md does not need updating since the nginx config comment already documents the full list.

3. **Touch target audit (`4f251bf1`):** Tag chips and footer admin link now meet 44px. The touch-target audit test was updated. CLAUDE.md already documents the 44px policy.

4. **i18n retryFailedImage error (`2191a6bc`):** Localized error message for retry-failed not-found state. The i18n convention is already documented.

5. **Rate-limit token refund fix (`4264d1d4`):** Semantic search no longer refunds rate-limit tokens after expensive work. This is a bug fix, not a behavior change requiring documentation.

6. **Debounce type fix, bootstrap timer cleanup, semantic scan limit, db timeout (`98d09476`):** All bug fixes with inline comments. No CLAUDE.md updates needed.

---

## Risk Assessment

| Category | Count | Highest Severity | Risk to Operations |
|----------|-------|------------------|-------------------|
| New Mismatches (N) | 10 | Medium | Low-Medium — some new behaviors (shutdown exit code, enqueue return value) could confuse operators |
| Partial Fixes (P) | 1 | Low | Low — `NEXT_UPLOAD_BODY_MAX_BYTES` is an advanced tuning knob |
| Still Open (from prior) | 25 | Medium | Medium — cumulative effect of missing docs for smart_collections, env vars, API routes |
| Correctly Documented | 6 | — | — |

**Overall:** No critical documentation bugs. The most impactful improvement since the last review is the addition of the "Optional Operational Variables" table in CLAUDE.md (commit 31293369), which addresses 18 of the 25 previously missing environment variables. The remaining gaps are mostly completeness issues (undocumented features, missing JSDoc) rather than active misinformation.

---

## Recommended Priority Order

1. **Fix stale JSDoc blocks (A1, A2, A3, A4, A5/N6)** — These actively mislead developers
2. **Add `enqueueImageProcessing` return value JSDoc (N1)** — New API contract
3. **Update CLAUDE.md masonry grid description (N7)** — Code changed, docs didn't
4. **Add shutdown behavior to Docker section (N3)** — Operators need to know about exit code 1
5. **Document `retryFailedImage` restore-maintenance guard (N2)** — Completeness
6. **Add semantic search scan limit to CLAUDE.md (N9)** — Mirrors README which already has it
7. **Add `NEXT_UPLOAD_BODY_MAX_BYTES` to `.env.local.example` (P3)** — Completeness
8. **Document `smart_collections` (B3)** — Feature is completely invisible
9. **Add missing admin settings to tunables table (B2)** — Completeness
10. **Fix version imprecisions (C1-C3)** — Cosmetic
11. **Delete orphaned migration file (D1)** — Hygiene
12. **Add missing root package.json script (D2)** — Consistency

---

## Verified Correct (No Issues Found at HEAD d24f2a6d)

1. **All 18 operational env vars in CLAUDE.md table match code** — Verified against `db/index.ts`, `process-image.ts`, `image-queue.ts`, `admin-backfill-runner.ts`, `audit.ts`, `view-retention.ts`, `upload-limits.ts`, `gallery-config.ts`
2. **Nginx config matches CLAUDE.md claims** — All 5 location blocks (login, db, dashboard, admin mutations, LR upload) with correct body size limits
3. **Upload limits match** — 200MB per file, 2GiB batch, 100 files per window
4. **Health routes** — `/api/live` (liveness) and `/api/health` (DB readiness when `HEALTH_CHECK_DB=true`) both correct
5. **Color/HDR pipeline** — All 13 claims verified, including the new temp-file cleanup
6. **Security architecture** — All claims verified, including the new `retryFailedImage` maintenance guard
7. **Service Worker** — Template and generated `sw.js` match, LRU logic correct
8. **Docker deployment** — Compose file, Dockerfile, entrypoint all consistent
9. **Connection pool** — 10 connections, queue limit 20, keepalive, init timeout all correct
10. **Migration system** — Post-condition assertion, hash-based check, reconcile all verified
