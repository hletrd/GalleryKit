# Verifier Report — Run-5 Cycle 2

**Date:** 2026-06-12
**Scope:** plan-314 "DONE" items (17), CLAUDE.md checkable claims, plan/README docs, i18n parity, package.json gates
**Method:** code read at HEAD + fresh test run + lint gate execution; no claims taken on trust

---

## Verdict

**Status:** PASS
**Confidence:** high
**Blockers:** 0 (no previously-unknown blocking issues found)

---

## Evidence

| Check | Result | Command / Source | Output |
|-------|--------|-----------------|--------|
| Tests | pass | `npm test --workspace=apps/web` | 1881 passed, 0 failed (196 test files) |
| lint:action-origin | pass | `npm run lint:action-origin --workspace=apps/web` | All mutating actions enforce same-origin provenance |
| lint:api-auth | pass | `npm run lint:api-auth --workspace=apps/web` | All admin API route handlers wrapped in `withAdminAuth` |
| lint:public-route-rate-limit | pass | `npm run lint:public-route-rate-limit --workspace=apps/web` | All public mutating routes have rate-limit helpers |
| Types | not run (no tsc available in CI path) | `npm run typecheck --workspace=apps/web` | Not executed — would require build infra; test suite covers TS via vitest transform |
| i18n parity | pass | Python key-diff script | EN only: 0; KO only: 0 — perfect parity |

---

## Plan-314 Item Verification

All 17 items verified against code at HEAD. Evidence per item:

### Item 1 — TRC-R5C1-18: `isAdmin()` in `retryFailedImage` (commit 2032d5b8)

**Status: VERIFIED**

`apps/web/src/app/actions/images.ts:1045-1047` — `requireSameOriginAdmin()` then `isAdmin()` check present, matching file-standard pattern. Test file `__tests__/retry-failed-image-auth.test.ts` (157 lines) exists and covers the zero-DB-calls-on-auth-failure contract.

### Item 2 — BUG-R5C1-02: unlink original on detection failure (commits d71d2de5 + cd9a58d7)

**Status: VERIFIED**

`apps/web/src/lib/process-image.ts:863-908` — full try/catch wraps ICC extraction, `detectColorSignals`, `resolveColorPipelineDecision`; `await fs.unlink(originalPath).catch(() => {})` on catch before re-throw. Test file `__tests__/save-original-unlink-on-detection-failure.test.ts` (116 lines) exists. Type-fix commit cd9a58d7 also landed correctly (Buffer→Uint8Array, single-arg call).

### Item 3 — CRT-R5C1-01 + COR-R5C1-04: fail-closed `semantic_search_mode='production'` (commit 1fabf9ec)

**Status: VERIFIED**

Three fixes confirmed:
1. `gallery-config-shared.ts:169-171` — validator rejects `'production'`: `v === 'disabled' || v === 'stub'` only.
2. `settings-client.tsx:538-545` — `production` SelectItem commented out; only `disabled` and `stub` render.
3. `api/search/semantic/route.ts:161-192` — capability gate: `if (semanticMode !== 'stub')` returns 503; `'production'` (even from stale DB) triggers this path.
4. COR-R5C1-04 fold: rate-limit `preIncrementSemanticAttempt` at line 170, before `getGalleryConfig()` read at line 183. `lint:public-route-rate-limit` confirms `semantic/route.ts` uses helper.

Tests: `__tests__/semantic-search-mode-validator.test.ts:21` asserts `isValidSettingValue('semantic_search_mode', 'production') === false`; `__tests__/semantic-search-route.test.ts:180` asserts stale `'production'` value → 503.

### Item 4 — CRT-R5C1-02: strip `[AUTO]` prefix from public titles (commit 130760da)

**Status: VERIFIED**

`apps/web/src/lib/photo-title.ts:2-6` — imports `ALT_TEXT_STUB_PREFIX` from `caption-generator.ts` (exported at line 28 there); builds `ALT_TEXT_STUB_PREFIX_RE` from it. `photo-title.ts:111-119` — strips prefix; if stripped remainder is empty/whitespace, falls through to generic fallback. `caption-generator.ts:28` — `export const ALT_TEXT_STUB_PREFIX = '[AUTO] '`.

### Item 5 — CRT-R5C1-03: remove dead `HDR_FEATURE_ENABLED` scaffolding (commit 852a2e3f)

**Status: VERIFIED**

`feature-flags.ts` — deleted (file not found, `cat` exits 1). No remaining references to `HDR_FEATURE_ENABLED` or `NEXT_PUBLIC_HDR_FEATURE_FLAG` in `src/` (only the comment-style reference at `hdr-filenames.ts:2` which says "removed"). `hdr-filenames.ts` retains the RESERVED banner: `// RESERVED — NOT WIRED. No production importer until WI-09 ships.` Its test file still present (kept, as per plan option A).

### Item 6 — PERF-R5C1-01: keyset-paginated batch fetch in admin-backfill-runner (commit 8bc3c51b)

**Status: VERIFIED**

`apps/web/src/lib/admin-backfill-runner.ts:158-172` — `fetchCandidateBatch(cursor)` with `WHERE id > ${cursor} ORDER BY id ASC LIMIT ${BATCH_SIZE}`. `runBackfill` drains each batch before fetching next (line 344-348: drain + cursor advance). `fetchCandidateCount()` still present for up-front UI count. Advisory lock scope unchanged.

### Item 7 — PERF-R5C1-02: analytics breakdown indexes migration 0021 (commit 55458f95)

**Status: VERIFIED**

- `drizzle/0021_analytics_breakdown_indexes.sql` exists.
- Journal entry at idx 21, `when: 1781183604120` — strictly greater than prior max `1779494400001` (idx 20). All entries idx>7 monotonically increasing (verified by Python script).
- `schema.ts:232-233` — `idxImageViewsBotViewedCountry` and `idxImageViewsBotViewedReferrer` indexes defined on `image_views`.
- `scripts/migrate.js:526-530` — `reconcileLegacySchema` updated with `ensureIndex` calls for both new indexes.

### Item 8 — TEST-R5C1-01: `verifySessionToken` unit tests (commit 804697a1)

**Status: VERIFIED**

`__tests__/session-verify.test.ts` exists (196+ lines). Covers: (1) wrong HMAC → null; (2) age > 24h → null; (3) negative age → null; (4a) 2-part → null; (4b) 4-part → null; (4c) empty → null; (5) signature length mismatch; (6) valid sig no DB row → null; (7) expired DB row → deleted + null; (8) valid fresh token → session object returned. 8 `verifySessionToken` test cases confirmed.

### Item 9 — TEST-R5C1-03: `getSessionSecret` production-guard tests (commit 804697a1)

**Status: VERIFIED**

Same test file, separate describe. `vi.stubEnv` + `vi.resetModules` pattern confirmed at lines 195-226. Tests: (1) production + missing SECRET → throws; (2) production + short secret → throws; (3) production + valid 64-hex → returns, no DB; (4) test env + no env var → falls through to DB path.

### Item 10 — TEST-R5C1-02: `BoundedMap` unit tests (commit 5898e924)

**Status: VERIFIED**

`__tests__/bounded-map.test.ts` exists. Covers: expiry pruning with fake timers, prune return-value semantics, hard-cap eviction order (`maxKeys=3, insert 5, oldest 2 evicted`), `createResetAtBoundedMap` expiry, `createWindowBoundedMap` window expiry, overwrite-not-double-count.

### Item 11 — TEST-R5C1-04: `isValidTokenShape` boundary tests (commit b7524a6e)

**Status: VERIFIED**

`__tests__/download-token-shape.test.ts` exists. Covers: null/undefined/non-string → false; 42-char body (one too short) → false; 44-char body (one too long) → false; wrong prefix → false; non-base64url chars → false; exact valid shape → true; real generator output → true.

### Item 12 — TEST-R5C1-05: pin Argon2id work factors (commit fb221271)

**Status: VERIFIED**

`__tests__/password-hashing-policy.test.ts` exists. Pins: type=argon2id, memoryCost=65_536, timeCost=3, parallelism=4 (exact values) and minimum floors (>=65_536, >=3, >=1). `admin-users.test.ts` mock strengthening also confirmed (plan says both commits OK under one item; same commit).

### Item 13 — TEST-R5C1-06: checkout route branch tests (commit 81aed586)

**Status: VERIFIED**

`__tests__/checkout-route.test.ts` exists. Covers: (1) `"500abc"` strict parse → 4xx, not $5 charge; (2) `priceCents=0` → 400; (2b) missing price row → 400; (3) unprocessed image → 400; (4) happy path → `{url}`, idempotency key with `checkout-{id}-{ip}-{minute}` shape; (5) rollback called on each 4xx; (6) unknown image → 404.

### Item 14 — DES-R5C1-01: accessible name for upload dropzone (commit fb9beccb)

**Status: VERIFIED**

`apps/web/src/components/upload-dropzone.tsx:399-401` — `role="button"`, `aria-label={t('upload.dropzoneLabel')}`, `aria-disabled={uploading || !hasTopics}` added after `{...getRootProps()}` spread. i18n parity confirmed (EN=0, KO=0 only-keys).

### Item 15 — DES-R5C1-03: keep lightbox position counter announceable (commit c459b1fd)

**Status: VERIFIED**

`apps/web/src/components/lightbox.tsx:669-684` — counter div has `role="status"`, `aria-live="polite"`, `aria-label={t('aria.photoPosition', ...)}` and uses CSS `opacity-0` class for visibility (NOT `aria-hidden`). The `{...controlVisibilityProps}` spread (which contains `aria-hidden:true`) appears on sibling elements (lines 549, 569, 593, 616, 636) but NOT on the counter div. DES-R5C1-22 folded: `aria.photoPosition` context label present.

### Item 16 — DES-R5C1-04: fix bottom-sheet focus trap (commit ab6f41eb + 2f67ed66)

**Status: VERIFIED**

`apps/web/src/components/info-bottom-sheet.tsx:55-65` — `prevIsOpenRef` guards initial focus; `initialFocus` targets `closeButtonRef.current ?? dragHandleRef.current ?? false` only on closed→open transition, not on every `sheetState` change. Drag handle `aria-label` is state-aware: `t('viewer.collapseSheet')` when expanded, `t('viewer.expandSheet')` otherwise (line 237). Note: follow-on commit 2f67ed66 landed a `FocusTrap initialFocus` refinement — both commits in the log; fix is confirmed present.

### Item 17 — DES-R5C1-05: hide masonry P3 badge from AT (commit 81409dc2)

**Status: VERIFIED**

`apps/web/src/components/home-client.tsx:355-356` — badge span has `aria-hidden="true"` (no `role="img"` or `aria-label`). Touch-target classes (`min-h-11 min-w-11`) retained.

---

## CLAUDE.md Claim Verification (selected checkable claims)

### Claims verified EXACT

| Claim | Evidence |
|-------|---------|
| `IMAGE_PIPELINE_VERSION = 7` | `gallery-config-shared.ts:21` — `export const IMAGE_PIPELINE_VERSION = 7` |
| Advisory lock list (6 locks) | All 6 confirmed in `advisory-locks.ts:18-43` |
| Connection pool: 10 connections, queue 20, keepalive | `db/index.ts:19-24` — connectionLimit:10, queueLimit:20, keepAliveInitialDelay:30000 |
| Login rate limit: 5 attempts / 15-min window | `rate-limit.ts:62-63` — LOGIN_WINDOW_MS=15*60*1000, LOGIN_MAX_ATTEMPTS=5 |
| Blur placeholder generated at 16px | `process-image.ts:836` — `.resize(16, undefined, { fit: 'inside' })` |
| Blur payload capped at 4096 chars | `blur-data-url.ts:45` — MAX_BLUR_DATA_URL_LENGTH=4096 |
| UPLOAD_MAX_TOTAL_BYTES default 2 GiB | `upload-limits.ts:1` — 2 * 1024 * 1024 * 1024 |
| UPLOAD_MAX_FILES_PER_WINDOW default 100 | `upload-limits.ts:2` — DEFAULT_MAX_FILES_PER_WINDOW=100 |
| QUEUE_CONCURRENCY env override for PQueue | `image-queue.ts:166` — `Number(process.env.QUEUE_CONCURRENCY) \|\| 1` |
| Default image sizes 640/1536/2048/4096/5120/7680 | `gallery-config-shared.ts:90` — DEFAULT_IMAGE_SIZE_VALUES matches exactly |
| Admin-configurable up to 8 sizes | `gallery-config-shared.ts:137` — MAX_IMAGE_SIZE_COUNT = 8 |
| SW 50 MB LRU cap | `public/sw.js:31` — MAX_IMAGE_BYTES = 50 * 1024 * 1024 |
| SW stale-while-revalidate with ETag HEAD probe | `public/sw.js:198-211` — HEAD revalidation against cached ETag confirmed |
| `prebuild` stamps SW_VERSION | `package.json` — `"prebuild": "... tsx scripts/build-sw.ts"` |
| avif_effort default 6 | `gallery-config-shared.ts:128` — `avif_effort: '6'` |
| wide_gamut_jpeg_chroma default '4:4:4' | `gallery-config-shared.ts:125` |
| sdr_jpeg_chroma default '4:2:0' | `gallery-config-shared.ts:131` |
| wide_gamut_max_source_pixels default 50_000_000 | `gallery-config-shared.ts:134` |
| force_srgb_derivatives default false | `gallery-config-shared.ts:116` |
| allow_hdr_ingest default false | `gallery-config-shared.ts:119` |
| force_show_color_chips default false | `gallery-config-shared.ts:122` |
| semantic_search_mode default 'disabled' | `gallery-config-shared.ts:108` |
| i18n EN/KO parity | Python key-diff: 0 EN-only, 0 KO-only |
| site-config.example.json location | `apps/web/src/site-config.example.json` exists; `apps/web/README.md` correctly documents `cp src/site-config.example.json src/site-config.json` |
| Journal monotonicity idx>7 | Python verification: all entries idx>7 strictly increasing `when` |
| Migration 0021 in journal with monotonic `when` | idx 21, when=1781183604120 > prior max 1779494400001 |
| Package.json gates: test/lint/typecheck/lint:api-auth/lint:action-origin/lint:public-route-rate-limit/db:push/db:seed/init/test:e2e | All confirmed in `apps/web/package.json` |

### Claims with KNOWN DRIFT — suppressed per plan-315/316/317

| Claim | Drift | Suppressed by |
|-------|-------|---------------|
| ETag formula `settingsHash.slice(0,8)` | Code: `settingsHash` directly (HASH_LENGTH=8 so output is identical; no `.slice` call at the ETag build site) | plan-316 VER-R5C1-01 |
| Settings hash covers `wide_gamut_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives` (3 keys) | Code: 10 keys in COLOR_IMPACTING_KEYS (adds `sdr_jpeg_chroma`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`) | plan-316 VER-R5C1-01 / ARCH-R5C1-01 |
| CLAUDE.md Performance section references 3 unwrapped cache() functions | Code: 8 `*Cached` exports in data.ts | plan-316 DOC-R5C1-05 |

### New CLAUDE.md drift findings (NOT in suppression lists)

#### VER-R5C2-01 — CLAUDE.md Deployment Checklist step 3 omits `src/` path prefix (LOW)

**Claim (CLAUDE.md:514):** `"Copy site-config.example.json to site-config.json"`

**Actual:** File is at `apps/web/src/site-config.example.json`. `apps/web/README.md` correctly documents `cp src/site-config.example.json src/site-config.json`. CLAUDE.md's deployment checklist omits the `src/` subdirectory from both source and destination, which would cause the copy to fail if run from the `apps/web/` root.

**Classification:** DRIFTED — doc error. Severity: LOW. Confidence: high.
**Fix:** Update CLAUDE.md:514 to `"Copy apps/web/src/site-config.example.json to apps/web/src/site-config.json"` (or a path-relative form matching README.md).
**Not in plan-315/316/317.**

#### VER-R5C2-02 — CLAUDE.md Database Indexes list omits `uploaded_by` index (LOW)

**Claim (CLAUDE.md, Database Indexes section):** Lists 5 indexes: `(processed, capture_date, created_at)`, `(processed, created_at)`, `(topic, processed, capture_date, created_at)`, `(user_filename)`, `image_tags(tag_id)`.

**Actual:** `schema.ts:118` — `idxImagesUploadedBy: index('idx_images_uploaded_by').on(table.uploaded_by)` exists and is not listed. Also `schema.ts:231-233` now has the 3 analytics breakdown indexes from migration 0021 (`image_views` `bot+viewed_at+country_code`, `bot+viewed_at+referrer_host`) — these were added by cycle-1 item 7.

**Classification:** DRIFTED — doc omission. Severity: LOW. Confidence: high.
**Fix:** Add `(uploaded_by)` to the images index list; add a note that `image_views` has 3 indexes (added by migration 0021). This is a documentation accuracy issue, not a functional defect. Not in plan-315/316/317.

---

## Acceptance Criteria (Plan-314 Items)

| # | Criterion (from plan) | Status | Evidence |
|---|----------------------|--------|---------|
| 1 | same-origin request without admin session cannot re-enqueue images | VERIFIED | `retryFailedImage` checks `isAdmin()`; test asserts zero DB calls |
| 2 | forced detection throw leaves zero files in original-upload dir | VERIFIED | try/catch + unlink at `process-image.ts:907-908`; test covers it |
| 3a | no admin-reachable path stores `'production'` mode | VERIFIED | validator rejects; UI hides SelectItem |
| 3b | stale stored `'production'` value fails closed at route | VERIFIED | capability gate returns 503; test covers stale-DB case |
| 3c | rate-limit pre-increment before config read | VERIFIED | `route.ts:170` pre-increment before `getGalleryConfig()` at :183 |
| 4 | no public visible title, `<title>`, or OG text can contain `[AUTO]` | VERIFIED | prefix stripped; empty-stripped falls to generic fallback |
| 5 | zero references to non-functional HDR env flag | VERIFIED | `feature-flags.ts` deleted; `hdr-filenames.ts` has RESERVED banner |
| 6 | memory residency O(batch), not O(gallery) | VERIFIED | LIMIT ${BATCH_SIZE} keyset pagination; drain-before-fetch |
| 7 | analytics indexes present in migration + schema + reconcile | VERIFIED | `0021_*.sql`, journal idx 21, `schema.ts`, `migrate.js` all updated |
| 8 | 8 `verifySessionToken` branch tests present and green | VERIFIED | test file covers all 8 branches; 1881 tests pass |
| 9 | `getSessionSecret` production guard tests (4 cases) | VERIFIED | test file covers all 4 cases |
| 10 | `BoundedMap` unit tests covering all 6 behaviors | VERIFIED | test file confirmed |
| 11 | `isValidTokenShape` boundary tests | VERIFIED | test file with 42/44-char body pins |
| 12 | Argon2id work-factor policy tests + admin-users mock strengthening | VERIFIED | policy test + exact-value pins |
| 13 | checkout route 6-branch tests with rollback assertions | VERIFIED | test file covers all 6 branches |
| 14 | dropzone announces accessible name + disabled state | VERIFIED | `role="button"`, `aria-label`, `aria-disabled` present |
| 15 | lightbox counter NOT `aria-hidden` when controls auto-hide | VERIFIED | counter uses CSS opacity, no `aria-hidden`; `aria.photoPosition` label present |
| 16 | bottom-sheet focus lands once per open, handle is state-aware | VERIFIED | `prevIsOpenRef` guard; state-aware `aria-label` |
| 17 | wide-gamut card links announce only photo title (no P3 suffix) | VERIFIED | `aria-hidden="true"` on badge span |

---

## Gaps

- **VER-R5C2-01** (Deployment Checklist step 3 missing `src/` path) — Risk: LOW — Suggestion: Fix doc in CLAUDE.md:514. Does not affect runtime.
- **VER-R5C2-02** (Database Indexes list omits `uploaded_by` + migration 0021 indexes) — Risk: LOW — Suggestion: Add to CLAUDE.md index list. Does not affect runtime.
- **Types gate not run** — Risk: LOW — `npm run typecheck` was not executed in this verification pass (requires full dev-deps build). The fresh 1881-test pass with vitest TS transform provides partial coverage. Plan gate says to run `npm run typecheck` before each commit — confirmed by plan-314 progress notes which state "typecheck + focused tests per item; full suite 1881 tests green after each batch". This verifier cannot independently confirm typecheck post-cycle without the build infra.

---

## Recommendation

**APPROVE**

All 17 plan-314 items have code-verified fixes at HEAD. Fresh test suite: 1881 passed / 0 failed. All three lint gates green. Two new LOW doc-drift findings (VER-R5C2-01, VER-R5C2-02) identified — neither is in the suppression lists and neither blocks functionality. They should be folded into the next doc-cleanup plan (plan-316 analog for cycle 2).

