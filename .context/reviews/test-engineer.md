# Test-Engineer Deep Review — GalleryKit

**Cycle:** 3
**HEAD:** b1e9e0da
**Reviewer:** test-engineer (deep test-coverage / test-quality pass)
**Date:** 2026-06-16
**Scope:** 233 unit test files (`apps/web/src/__tests__/*.test.ts`) + 6 e2e files (`apps/web/e2e/*`), mapped against critical / security / concurrency code paths. Full inventory, not sampled.
**Baseline suite state (carried from cycle-2 run):** ~2145 passed, 2 skipped (CLIP weight-gate), 0 failed — suite is green and CLIP stays gated.

---

## Methodology

1. Inventoried all 233 unit tests + 6 e2e specs.
2. Swept every `__tests__` file for `fs` writes targeting repo-tracked paths (ORCH-C3-TMPDIR family).
3. Examined the concurrency / advisory-lock / backfill-cap tests for "exercises the race vs asserts a constant".
4. Verified the contract tests cited in CLAUDE.md for non-vacuity (tautology check).
5. Cross-referenced source files (`app/actions/*`, `app/api/**/route.ts`, `lib/*`) against test imports/readFileSync to find true coverage gaps; **manually re-verified** every gap (an automated explore pass over-reported — most "uncovered" files actually have a same-named test using a different import style).
6. Checked timing-flake markers (custom timeouts, real-timer sleeps, fake-timer usage), CLIP-disabled posture, e2e coverage.

**Overall test health: HEALTHY.** The suite is unusually disciplined: source-shape pins consistently document and prove their own non-vacuity ("removing X flips the assertion RED"), flake fixes poll authoritative signals instead of fixed setImmediate counts, contract tests are dense, and the CLIP-disabled posture is correctly asserted (no accidental activation). The findings below are real but mostly MEDIUM/LOW — there is no CRITICAL test defect at this HEAD. The dominant theme is **test-isolation hygiene** (the ORCH-C3-TMPDIR family is broader than the one injected file) and **a cluster of untested admin-mutation server actions**.

---

## FINDINGS

### TE-C3-01 — ORCH-C3-TMPDIR family: ~7 tests write binary derivatives into the LIVE `public/uploads/` serving tree instead of a redirectable tmpdir (MEDIUM, High confidence)

**Files / evidence:**
- `apps/web/src/__tests__/process-image-color-roundtrip.test.ts:30-49` — writes AVIF/WebP/JPEG derivatives to `UPLOAD_DIR_AVIF/WEBP/JPEG` (= `public/uploads/{avif,webp,jpeg}/`), 56 write-ops; cleanup is per-id `afterAll` unlink only.
- `apps/web/src/__tests__/process-image-exif-strip.test.ts:23,36-41,95-107` — same: output derivatives land in real `public/uploads/*`.
- `apps/web/src/__tests__/process-image-orientation.test.ts:23,36-44,82-97` — same.
- `apps/web/src/__tests__/backfill-color-pipeline.test.ts:21,34-40,64-65` — writes to real `public/uploads/{avif,webp,jpeg,original}/` (24 ops), incl. `UPLOAD_DIR_ORIGINAL`.
- `apps/web/src/__tests__/backfill-detection-failure-contract.test.ts:74`, `backfill-color-pipeline-deleted-mid-reencode.test.ts`, `admin-backfill-runner-deleted-mid-reencode*.test.ts`, `image-queue*.test.ts` — same family (lower write volume).

**Gap/defect:** These tests source their INPUT from `os.tmpdir()` (correct) but write their OUTPUT into the module-level `UPLOAD_DIR_*` constants, which resolve to the **real public serving directory** `public/uploads/`. Cleanup relies solely on `afterAll` unlinking by tracked id. On an interrupted run (Ctrl-C in dev, CI timeout kill, an exception before `afterAll`), stray `<uuid>.avif/.webp/.jpg` are stranded in `public/uploads/`. In a dev environment running `npm run dev` concurrently, a stranded derivative is **served at its public URL** until manually cleaned. `/public/uploads/*` is gitignored (`.gitignore:48`) so `git status` stays clean, which masks the leak rather than fixing it.

**Why it matters:** This is the same anti-pattern as the injected `process-topic-image.test.ts` finding, but broader (~7 files) and arguably worse because `public/uploads/` is the genuine production serving root, not a scratch resources dir. The fix is cheap and already supported by the source: `UPLOAD_ROOT` and `UPLOAD_ORIGINAL_ROOT` are env-redirectable (`apps/web/src/lib/upload-paths.ts:13,28`). No test sets them.

**Suggested fix:** In each affected test, set `process.env.UPLOAD_ROOT` (and `UPLOAD_ORIGINAL_ROOT`) to a per-suite `os.mkdtemp` dir BEFORE importing `@/lib/process-image` / `@/lib/upload-paths` (these constants capture at module-load, so use `vi.stubEnv` in a top-level statement + dynamic `await import()`, or a vitest `globalSetup` that points `UPLOAD_ROOT` at a tmp tree). Then a single `fs.rm(tmpRoot, {recursive:true})` in `afterAll` is leak-proof regardless of interruption, and the per-id unlink lists (which are also a maintenance burden — they hardcode size-suffix derivatives like `${id}_8.avif`) disappear. This converts a best-effort cleanup into a structurally-isolated one.

---

### TE-C3-02 — `process-topic-image.test.ts` still writes `<uuid>.webp` into repo-tracked `public/resources/`; orphans confirmed accumulating on interrupted runs (MEDIUM, High confidence)

**File:** `apps/web/src/__tests__/process-topic-image.test.ts:70-77, 102-122, 154-194`

**Evidence (verified live this cycle):** Two stray orphans currently sit in `apps/web/public/resources/` (`5fc407cf-7501-4c44-9d0a-c20036dd307c.webp`, `cc45270f-3d2b-4c24-929a-259c2ae9dbc8.webp`, both timestamped today 18:05). I ran the suite in isolation (`npx vitest run src/__tests__/process-topic-image.test.ts` → 12 passed) and **the two orphans survived** — proof they are stranded artifacts from a PRIOR interrupted run, and the test's own `afterAll` only unlinks files IT created this run (`writtenFiles` array, line 73-77), never sweeping pre-existing orphans.

**Status:** PARTIALLY mitigated by prior cycles. The success-path tests now register output filenames in `writtenFiles` and unlink in `afterAll` (AGG-R5C3-01 header comment), and `.gitignore:51-52` ignores `public/resources/*` except `.gitkeep`, so `git status` stays clean. **But the root cause is unaddressed:** `RESOURCES_DIR` is computed at module-load from `process.cwd()` (`apps/web/src/lib/process-topic-image.ts:12-20`) with NO env override, so the test cannot redirect it to a tmpdir, and binary artifacts still accumulate in the working tree on every interrupted run.

**Why it matters:** Same as TE-C3-01 — gitignore hides the symptom, not the defect. The orphans grow unboundedly across dev iterations; a developer running `npm run dev` could serve a stray test webp from `/resources/<uuid>.webp`.

**Suggested fix:** Add an env override to `process-topic-image.ts` (e.g. `RESOURCES_ROOT = process.env.TOPIC_RESOURCES_ROOT?.trim() || <cwd-derived>`), then point it at a tmpdir in the test (same dynamic-import pattern as TE-C3-01). As a stopgap that needs NO source change, have the test's `beforeAll` snapshot the existing `*.webp` set in `RESOURCES_DIR` as a baseline and the `afterAll` remove every webp not in the baseline — but the env-redirect is the correct fix.

---

### TE-C3-03 — No runtime test exercises the per-image processing CLAIM race (two workers, conditional `WHERE processed=false` UPDATE, loser detects + cleans up) (MEDIUM, High confidence)

**Files:**
- `apps/web/src/__tests__/advisory-locks.test.ts` (all 67 lines) — pins lock-name STRINGS + the per-image name builder only.
- `apps/web/src/__tests__/image-queue.test.ts`, `image-queue-permanent-failure*.test.ts` — verified via grep: NO test contains a two-worker / `affectedRows===0` / "already processed" / loser-cleanup runtime scenario (`grep` for `WHERE processed|affectedRows|claim|two worker|loser|winner` → only `state.claimRetryCounts.clear()` and unrelated brace-walker hits).
- `apps/web/src/__tests__/image-queue-delete-race-cleanup-wiring.test.ts` — explicitly a SOURCE-SCAN that acknowledges (lines 10-12) "the queue worker call path is hard to unit-isolate (it's inside the PQueue job), so... NO test that the queue actually passes `[]`."

**Gap/defect:** CLAUDE.md documents a load-bearing concurrency invariant: "two queue workers (e.g. across a restart boundary or a multi-process deployment) cannot both convert the same upload. Paired with a `WHERE processed = false` conditional UPDATE so the losing worker detects the already-processed state and cleans up its leftover variant files." `advisory-locks.test.ts` is APPROPRIATE for what `advisory-locks.ts` owns (it's a constants module), but the **acquisition SQL, the dedicated-connection scoping, the conditional-UPDATE loser-detection, and the leftover-variant cleanup** are the parts that could actually break — and none are exercised at runtime. A regression that (a) drops the `WHERE processed=false` guard, (b) acquires the lock on the wrong connection, or (c) skips the loser's variant cleanup would pass the entire suite green.

**Why it matters:** This is the protection against double-processing / orphaned-variant leaks in the multi-process / restart-boundary case — the highest-stakes concurrency claim in the codebase. It currently rests on source-shape pins + lock-name pins, with no behavioral coverage of the race outcome.

**Suggested fix:** Add a runtime test that simulates two concurrent `processImage` claims on the same jobId with a mocked `db.execute` whose conditional UPDATE returns `affectedRows: 1` for the first caller and `affectedRows: 0` for the second, and asserts (a) only the winner writes the processed row, (b) the loser invokes `deleteImageVariants` for its leftover files, (c) both attempt `getImageProcessingLockName(jobId)`. The advisory-lock GET_LOCK SQL itself can be unit-tested by mocking the dedicated pool connection and asserting the SQL text + that `release()` runs in `finally`. This complements (does not replace) the existing source-scan pins.

---

### TE-C3-04 — Untested admin-mutation server actions: `login`, `updatePassword`, `updateGallerySettings`, smart-collection CRUD, `backfillClipEmbeddings` (MEDIUM, High confidence)

**Files (verified NO test imports or reads their source):**
- `apps/web/src/app/actions/auth.ts:72` `login()`, `:259` `logout()`, `:282` `updatePassword()` — the orchestrating auth ACTIONS. (The primitives — `session.ts`, `auth-rate-limit.ts`, `password-hashing.ts` — are well-tested individually, but the action that wires them, applies the per-IP + per-account rate-limit buckets, and sets the cookie, is not. The many test hits on `actions/auth` are mocking `isAdmin` as a dependency, not testing auth.ts behavior.)
- `apps/web/src/app/actions/settings.ts:19` `getGallerySettingsAdmin()`, `:40` `updateGallerySettings()` — the admin mutation that persists every color-pipeline tunable (`force_srgb_derivatives`, `avif_effort`, `wide_gamut_max_source_pixels`, etc.). **Zero tests.**
- `apps/web/src/app/actions/collections.ts:14/61/107` `createSmartCollection` / `updateSmartCollection` / `deleteSmartCollection` — `smart-collections.test.ts` only imports from `@/lib/smart-collections` (the query/compile lib), NOT the mutating action. The action's `query_json` AST validation + same-origin guard path is untested.
- `apps/web/src/app/actions/embeddings.ts:48` `backfillClipEmbeddings()` — no behavioral test (CLIP backfill orchestration; reviewing its disabled posture is fine, the action itself is untested).

**Gap/defect:** These are mutating admin actions guarded by `requireSameOriginAdmin()`. The `lint:action-origin` gate (`check-action-origin.test.ts`) statically verifies each STORES and returns-early on the guard result, which is good structural coverage. But there is no BEHAVIORAL test that, e.g., `updateGallerySettings` rejects an invalid `avif_effort`, validates the value range, or that `login` actually consults BOTH rate-limit buckets and rolls back correctly on infra error (the rollback is tested at the lib layer in `auth-rate-limit-rollback.test.ts` / `auth-no-rollback-on-infrastructure-error.test.ts`, but not through the `login` action).

**Why it matters:** `updateGallerySettings` is the single mutation point for all color-pipeline behavior; a validation regression there silently mis-encodes every subsequent upload. `login` is the authentication entry point. A bug in the action-level wiring (e.g. validating the wrong field, persisting an out-of-range setting, applying only one rate-limit bucket) would not be caught.

**Suggested fix:** Add action-level tests with `@/db`, `@/lib/action-guards`, and rate-limit helpers mocked: (1) `updateGallerySettings` — assert it validates each `COLOR_IMPACTING_KEYS` value and rejects out-of-range / non-enum inputs before persisting; (2) `login` — assert both per-IP and per-account `preIncrement` are called, the cookie is set on success, and the rollback fires on a thrown DB error; (3) smart-collection CRUD — assert `query_json` AST validation rejects malformed conditions and the same-origin early-return fires. These are the same mock-and-call shape as the existing `topics-actions.test.ts` / `tags-actions.test.ts`.

---

### TE-C3-05 — `lib/analytics-data.ts` query builders (5 exported functions) have NO test (LOW, High confidence)

**File:** `apps/web/src/lib/analytics-data.ts:28` `getTopPhotosByViews`, `:62` `getTopTopicsByViews`, `:112` `getCountryBreakdown`, `:161` `getTopSharedGroupsByViews`, `:192` `getReferrerBreakdown` — 213 lines, **zero tests.** (`analytics.test.ts` imports `@/lib/analytics` — the bot/referrer/geoip helpers — NOT `analytics-data.ts`.)

**Gap/defect:** These build the time-windowed aggregation SQL behind the admin analytics dashboard (the `image_views(bot, viewed_at, country_code)` / `(... referrer_host)` composite indexes from migration 0021 exist specifically to serve these). The `TimeWindow` → date-range translation and the `GROUP BY country_code` / `referrer_host` shape are untested. A regression (wrong window boundary, missing `bot=false` filter letting bot traffic into the breakdown, ONLY_FULL_GROUP_BY violation) would surface only in production.

**Why it matters:** Lower stakes (analytics is best-effort, non-billing per CLAUDE.md), but the SQL-shape class of bug (ONLY_FULL_GROUP_BY) is exactly what `data-tag-names-sql.test.ts` exists to prevent elsewhere — and these queries have the same GROUP BY exposure with no equivalent guard.

**Suggested fix:** A `.toSQL()` inspection test (same pattern as `data-tag-names-sql.test.ts:244`) per function asserting: the `bot = false` (or `bot` index-aligned) predicate is present, the `GROUP BY` matches the SELECT non-aggregates, and the `TimeWindow` produces the expected `viewed_at >=` boundary for `30d`/`90d`/`all`.

---

### TE-C3-06 — `data-tag-names-sql.test.ts` runtime-SQL test rebuilds the query inline rather than compiling the REAL `getImagesLite` (LOW, Medium confidence)

**File:** `apps/web/src/__tests__/data-tag-names-sql.test.ts:244-266`

**Gap/defect:** The only test that actually COMPILES SQL (the `.toSQL()` case) constructs a fresh query INLINE inside the test (lines 250-258) and asserts the compiled string contains `group_concat(distinct` / `left join` / `group by`. This proves "Drizzle can compile this shape" — it does NOT prove "`getImagesLite` produces this shape at runtime." If `getImagesLite` were refactored to emit a subtly different (still-non-tautological-by-source-scan) query, the inline `.toSQL()` test would stay green because it never touches the real function.

**Mitigation in place:** The source-scan cases (lines 90-105, 107-119, 148-157) DO pin the real `getImagesLite`/`getImagesLitePage`/`getAdminImagesLite` bodies (LEFT JOIN + GROUP BY + `tagNamesAgg`, forbidding the raw-alias subquery and `blur_data_url`). So the contract is effectively held by the source-scan layer. This is a minor "the strongest test is detached from the SUT" note, not a hole.

**Why it matters:** Low — the source scans cover the runtime shape. But the inline-rebuild test gives a false sense of "runtime SQL is verified." The production NULL `tag_names` bug (cycle-1 NF-3, commit aca754c) that motivated this file was a RUNTIME failure; the regression guard for it is a SOURCE scan, with the one runtime-SQL test pointed at a hand-built query.

**Suggested fix:** Where feasible, import `getImagesLite` and call `.toSQL()` on the actual Drizzle builder it constructs (extract the query-building into a pure, mockable helper if the function's DB-execute coupling prevents direct `.toSQL()`). If the DB coupling is unavoidable, add a comment to line 244 clarifying the inline test verifies SHAPE-IS-COMPILABLE only and the source scans are the runtime-contract authority.

---

### TE-C3-07 — e2e gaps: no end-to-end coverage of the paid-download flow, license enforcement, or shared-group view counting (LOW, Medium confidence)

**Files:** `apps/web/e2e/{admin,public,origin-guard,test-fixes,nav-visual-check}.spec.ts` (6 specs, ~30 tests total).

**Coverage present (good):** admin login / wrong-password / protected-route redirect / topic CRUD / upload / GPS-toggle lock; public homepage / locale switch / search focus-trap / lightbox open-close / heading hierarchy / 404 / shared-link valid+invalid key; origin-guard cross-origin 403; mobile/desktop nav visibility; nav visual screenshots.

**Gaps (no e2e):**
- **Paid-download flow** (`api/download/[imageId]/route.ts`, 463 lines) — the single-use POST claim, the open-before-claim ordering, the GET interstitial CSP, and the "GET is claim-free so auto-HEAD is safe" behavior are pinned by SOURCE-SCAN (`download-route-method-contract.test.ts`) but never driven end-to-end. The customer-facing failure mode this guards against (mail-gateway HEAD burning a paid token with zero bytes) is exactly the kind of thing an e2e would catch that a source scan cannot (it depends on Next's framework auto-HEAD behavior at runtime).
- **License-tier gating** on download — no e2e that an unlicensed download is rejected vs a licensed one streams bytes.
- **Shared-group view-count increment** semantics (initial load increments, intra-share navigation does not) — documented as best-effort but with subtle "only on initial load without per-photo query param" logic; no e2e.
- **Stripe webhook → entitlement** path — the documented `async_payment_succeeded` gap (delayed payment methods never get an entitlement row) is a known-unfixed product limitation; an e2e or integration test asserting the CURRENT behavior (and failing loudly when plan-316 CRT-R5C1-04 wires it) would lock the contract.

**Why it matters:** Low for this review (e2e is opt-in / CI-gated per the spec guards), but the paid-download single-use claim is real-money-adjacent and currently has only source-shape coverage of a framework-dependent (auto-HEAD) behavior.

**Suggested fix:** Add an opt-in e2e (guarded like the existing `admin workflows (opt-in)` block) that: licenses/entitles a test image, issues GET (interstitial, no claim), then POST (claims, streams bytes), then a second POST (410 / already-claimed), asserting the token burns exactly once and only on byte delivery. This is the runtime complement to `download-route-method-contract.test.ts`.

---

## NOT DEFECTS (verified strong — recorded so they aren't re-flagged next cycle)

- **`advisory-locks.test.ts`** — appropriately pins exactly what its module owns (constants + name builder). The race-outcome gap (TE-C3-03) is in the CALLERS, not this file.
- **`admin-backfill-concurrency-cap.test.ts`** — thorough table-driven coverage of the pure `resolveBackfillConcurrency` arithmetic incl. the AGG-5 reserved-headroom invariant (line 66-75). It tests the formula, not connection acquisition — correct division of concern.
- **`migration-journal-monotonicity.test.ts`** — excellent and non-tautological: pins `when` monotonicity with a documented allowlist + a stale-allowlist guard + mirrors the real `migrate.js` missing-hash predicate + asserts the loud-fail throw still exists.
- **`data-tag-names-sql.test.ts`** — dense, mostly strong; the one detached runtime-SQL test is noted in TE-C3-06 as LOW.
- **`download-route-method-contract.test.ts`** — well-targeted source scan with clear rationale; complements (doesn't replace) the e2e gap in TE-C3-07.
- **`image-queue-delete-race-cleanup-wiring.test.ts`** — explicitly documents its non-vacuity ("removing `, []` flips RED") and honestly acknowledges it's a source-shape pin for a path that's hard to unit-isolate.
- **admin-backfill-runner flake mitigations** (`*-detection-failure.test.ts:178`, `*-fatal-counters.test.ts`, etc.) — the `vi.waitFor(() => !state.running, {timeout:20_000, interval:25})` pattern polls the AUTHORITATIVE completion signal (the `finally` reset) rather than a fixed setImmediate count. This is the CORRECT way to wait on a fire-and-forget runner with unmocked Sharp libuv I/O (documented R4C1 TEST-R4C1-06). Not flaky.
- **CLIP / semantic-search tests** — correctly assert the DISABLED / 503 posture (`semantic-search-route.test.ts:178-185`, `semantic-route-production.test.ts:32-35`); no accidental activation. Hard guard respected.
- **No real-timer `setTimeout` sleeps** anywhere in the suite; 7 files use `vi.useFakeTimers`. Timing-flake hygiene is good.
- **`os.tmpdir()` usage is correct** in the 17 files that use it for INPUT/scratch (color-detection, backup-download-route, check-action-origin, clip-model-manifest, process-image-p3-icc, process-image-variant-scan, save-original-unlink, etc.) — verified `tmpFile`/`tmpDir` resolve under `os.tmpdir()`, not repo paths.

---

## Severity / confidence summary

| ID | Finding | Severity | Confidence |
|----|---------|----------|------------|
| TE-C3-01 | ~7 tests write derivatives into live `public/uploads/` (env-redirect available, unused) | MEDIUM | High |
| TE-C3-02 | `process-topic-image.test.ts` writes `<uuid>.webp` into `public/resources/`; orphans confirmed accumulating | MEDIUM | High |
| TE-C3-03 | No runtime test of the per-image processing claim race / loser-cleanup | MEDIUM | High |
| TE-C3-04 | Untested admin-mutation actions: login/updatePassword/updateGallerySettings/smart-collection CRUD/backfillClipEmbeddings | MEDIUM | High |
| TE-C3-05 | `lib/analytics-data.ts` 5 query builders untested (GROUP BY shape exposure) | LOW | High |
| TE-C3-06 | `data-tag-names-sql.test.ts` runtime-SQL test detached from real `getImagesLite` | LOW | Medium |
| TE-C3-07 | e2e gaps: paid-download single-use claim, license gating, shared-group view count, webhook→entitlement | LOW | Medium |

**Closed-item discipline:** Confirmed against current HEAD — the prior-cycle ORCH-C3-TMPDIR mitigations (gitignore `/public/resources/*` + `/public/uploads/*`, `process-topic-image` `afterAll` registration, the `data-tag-names` / `sw-template` / `privacy-fields` / `backfill-color-pipeline` / `admin-backfill-runner-detection-failure` contract tests) are all present and effective for `git status` cleanliness. TE-C3-01/-02 are the NOT-fully-closed residue (working-tree binary leak persists despite git-cleanliness), not re-reports.
