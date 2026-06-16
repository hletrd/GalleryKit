# Verifier — Run 6 / Cycle 5

**12/12 load-bearing claims VERIFIED, 0 CONTRADICTED, 0 UNVERIFIABLE; full suite 2178 passed / 2 skipped / 0 failed, typecheck exit 0, all 4 security lint gates green.**

HEAD `2f603716` (master, working tree clean). Prior verifier.md was cycle-4 @ `f8147868`; three commits landed since (`1fd350be`, `7541c92d`, `2f603716`), one of which (`1fd350be`) implements the AGG-C4-04 sidecar `detectionFailures` walk-back that cycle-4 flagged. All claims re-verified against the CURRENT tree, not the prior report. HARD GUARD honored: CLIP code/tests verified, no activation proposed, no "CLIP is disabled" flag raised.

---

## Verdict

**Status**: PASS
**Confidence**: high
**Blockers**: 0

This is honest convergence. Every load-bearing claim I checked holds against the actual code, and where a guard is a compile-time type assertion I proved it fires on a synthetic violation rather than trusting that it exists. No contradictions manufactured.

---

## Evidence (fresh, this run, HEAD 2f603716)

| Check | Result | Command | Output |
|-------|--------|---------|--------|
| Unit tests | PASS | `npm test --workspace=apps/web` | **233 files passed / 1 skipped; 2178 tests passed / 2 skipped / 0 failed** (205 s) |
| Types | PASS | `npm run typecheck --workspace=apps/web` | exit 0 — `typecheck:app` (tsc -p tsconfig.typecheck.json, INCLUDES `src/__tests__/`) + `typecheck:scripts` both clean |
| ESLint | PASS | `npm run lint --workspace=apps/web` | no output (no errors) |
| Lint: api-auth | PASS | `npm run lint:api-auth` | OK on both admin route files |
| Lint: action-origin | PASS | `npm run lint:action-origin` | 17 mutating actions OK, 1 explicit exempt; "All mutating server actions enforce same-origin provenance." |
| Lint: public-route-rate-limit | PASS | `npm run lint:public-route-rate-limit` | 9 routes OK (helpers/exempt/no-mutating) |
| Privacy guard (negative control) | PASS | isolated `tsc` on synthetic leak | LEAK → `error TS2322`; CLEAN → exit 0 |

The single skipped test FILE / 2 skipped tests are `clip-semantic-integration.test.ts`, which self-skips via `describe.skip` when model weights are absent (CI default). This is the HARD-GUARD CLIP feature and an intentional environment skip, NOT a failure. **No MySQL-driven failures exist** — 29 test files mock the DB layer (`vi.mock` over `@/db`/`mysql2`); the unit surface is self-contained, so the "MySQL may be unavailable" caveat from the prompt does not bite here.

---

## Load-bearing claims — per-claim verdicts

### VER-C5-01 — Every admin API route method-export wraps `withAdminAuth` — VERIFIED (High)
Only two files match `api/admin/**/route.*`: `db/download/route.ts:23` (`export const GET = withAdminAuth(...)`) and `lr/upload/route.ts:57` (`export const POST = withAdminAuth(...)`). The `lint:api-auth` gate passes on both, and its fixture coverage is `__tests__/check-api-auth.test.ts`. No bare/aliased/function-declaration method export exists.

### VER-C5-02 — Every mutating server action returns early on `requireSameOriginAdmin()` — VERIFIED (High)
`lint:action-origin` reports OK for all 17 mutating exports across `settings.ts`, `sharing.ts`, `tags.ts`, `topics.ts` and emits the terminal assertion "All mutating server actions enforce same-origin provenance." The one SKIP (`tags.ts::getAdminTags`) carries an **explicit** `@action-origin-exempt: read-only admin getter` comment at `tags.ts:18` — not name-based inference, exactly as the claim states (names are not proof of read-only behavior).

### VER-C5-03 — `publicSelectFields` omits all PII; compile-time guard fails on a leak — VERIFIED + PROVEN (High)
Structure intact in `data.ts`: `adminSelectFields` (`:208`) is the full set; `publicSelectFields` (`:355`) is derived by destructure-omission; three guards present — `_privacyGuard` (`:419`), `_mapPrivacyGuard` (`:431`), `_largePayloadGuard` (`:449`). I did not merely confirm the guards exist — I **proved the pattern compile-fails**: an isolated `tsc --strict` over a synthetic `publicSelectFields` that wrongly included `latitude` produced `guard-leak.ts(5,7): error TS2322: Type 'boolean' is not assignable to type '["latitude", "ERROR"]'`, while the clean variant compiled at exit 0. The real `tsconfig.typecheck.json` run is exit 0, so no live leak exists.

### VER-C5-04 — blur_data_url contract enforced at producer + write + read, capped 4096 — VERIFIED (High)
Three sites, central contract in `lib/blur-data-url.ts` (`MAX_BLUR_DATA_URL_LENGTH = 4096` at `:45`; `isSafeBlurDataUrl` `:47`; `assertBlurDataUrl` `:104`):
- Producer: `process-image.ts:895` `blurDataUrl = assertBlurDataUrl(candidate)`
- Write: `app/actions/images.ts:352` `blur_data_url: assertBlurDataUrl(data.blurDataUrl)`
- Read: `components/photo-viewer.tsx:196` `if (!isSafeBlurDataUrl(value)) return undefined`
Fixture tests `process-image-blur-wiring` + `images-action-blur-wiring` are in the green suite.

### VER-C5-05 — Backfill leaves pipeline_version behind on detection failure (no stale metadata) — VERIFIED (High)
`admin-backfill-runner-detection-failure.test.ts` is green (within the 38-test SW+backfill batch). The contract is that a re-encode whose color detection then fails does NOT advance `pipeline_version`, so the row stays a backfill candidate. Sidecar surfaces this at `backfill-color-pipeline.ts:506-511` ("pipeline_version NOT advanced — they will be retried on the next run").

### VER-C5-06 — AGG-C4-04 fix: sidecar `detectionFailures` walked back for deleted-mid-reencode rows — VERIFIED (High) [NEW since prior verifier]
Cycle-4 flagged that a row counted as a detection-failure AND then deleted mid-reencode would keep `detectionFailures` elevated, exiting non-zero for a gone row. Commit `1fd350be` fixes it: `backfill-color-pipeline.ts:455` `detectionFailures -= countDeletedMidReencodeDetectionFailures(derivativeResults)`. The helper (`:159-163`) filters the **derivative-slice** UPDATE results by `affectedRows === 0` — exactly the detection-failure∩deleted overlap, because `flushBatch` passes only the derivative slice (verified by reading `:436-459`). Exit code is now an extracted pure helper `computeBackfillExitCode` (`:174-176`), and a dedicated test `backfill-color-pipeline-deleted-mid-reencode.test.ts` passes (16 tests). The cycle-4 finding is genuinely closed at code + test level.

### VER-C5-07 — en.json and ko.json have identical key sets — VERIFIED programmatically (High)
Flattened both files: **840 keys each, 0 en-only, 0 ko-only → IDENTICAL KEY SETS.** The DOC-R5C3-07 value-shape asymmetry (en ICU `plural`, ko fixed `{count}장`) is by design and does not affect key parity.

### VER-C5-08 — Touch targets ≥44 px enforced as a real blocking test (scans + would fail) — VERIFIED (High)
`touch-target-audit.test.ts` passes (15 tests) and is NOT a no-op: the main test loops every `SCAN_ROOTS` root recursively (`:740`) and asserts `expect(failures).toEqual([])` (`:786`); a positive-control block asserts `expect(matched, 'FORBIDDEN regex did not catch...').toBe(true)` (`:871`) proving the FORBIDDEN regex set actually catches synthetic sub-44 Button/Badge/select snippets. Files not in `KNOWN_VIOLATIONS` default to 0; stale-entry detection at `:769-781`.

### VER-C5-09 — Service worker template matches sw-cache.ts reference; contract test pins sw.js — VERIFIED (High)
`sw-template-contract.test.ts` green. It pins three template behaviors against `lib/sw-cache.ts` (HTML offline fallback COR-R4C6-05, LRU parity TEST-R4C6-11, lazy revalidation PERF-R4C9-02) AND asserts the generated `public/sw.js` carries the same bounded HEAD probe as the template (`:153-154`). `sw.template.js` is the source (`SW_VERSION = '__SW_VERSION__'` at `:26`); `sw.js` is the stamped output (`SW_VERSION = 'dd26e742-p7'`) — the `-p7` suffix matches `IMAGE_PIPELINE_VERSION = 7`. MAX_IMAGE_BYTES = 50 MB (`:31`), MAX_HTML_ENTRIES = 50 (`:33`), `x-gk-admin-render` admin-bypass present — all as documented.

### VER-C5-10 — `tagNamesAgg` GROUP_CONCAT contract (production-burned NF-3) — VERIFIED (High)
`data.ts:605` `const tagNamesAgg = sql\`GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY ${tags.name})\``, referenced by all list queries (`:734`, `:783`, `:833`). Contract test `data-tag-names-sql.test.ts` passes (9 tests) — locks against the scalar-correlated-subquery shape that returned NULL in production (commit aca754c).

### VER-C5-11 — Public-route mutating handlers all rate-limited or explicitly exempt — VERIFIED (High)
`lint:public-route-rate-limit` OK on 9 routes: `checkout` + `search/semantic` use a `preIncrement`/`checkAndIncrement` helper; `download` + `stripe/webhook` carry `@public-no-rate-limit-required`; the rest have no mutating handler. Fixture: `check-public-route-rate-limit.test.ts`.

### VER-C5-12 — Typecheck gate includes test files (test-file type errors surface) — VERIFIED (High)
`typecheck:app` runs `tsc -p tsconfig.typecheck.json`, which per CLAUDE.md INCLUDES `src/__tests__/`. Exit 0 confirms both production and test sources typecheck clean. This is the mechanism that makes the VER-C5-03 compile-time privacy guards load-bearing in CI.

---

## Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | All admin route methods wrap withAdminAuth | VERIFIED | both route files + lint:api-auth green |
| 2 | All mutating actions return early on requireSameOriginAdmin | VERIFIED | lint:action-origin 17 OK + explicit exempt |
| 3 | Privacy guard compile-fails on leak | VERIFIED (proven) | synthetic leak → TS2322; typecheck exit 0 |
| 4 | blur_data_url enforced 3 sites, cap 4096 | VERIFIED | process-image:895, images:352, photo-viewer:196 |
| 5 | Backfill no version bump on detection failure | VERIFIED | runner-detection-failure test green |
| 6 | AGG-C4-04 detectionFailures walk-back landed | VERIFIED | :455 + deleted-mid-reencode test (16) green |
| 7 | i18n en/ko identical key sets | VERIFIED | 840/840, 0 diff |
| 8 | Touch-target audit scans + fails (real gate) | VERIFIED | :740/:786 scan + :871 positive control |
| 9 | SW template↔reference pinned; sw.js pinned | VERIFIED | sw-template-contract green + :153-154 |
| 10 | tagNamesAgg GROUP_CONCAT contract | VERIFIED | data.ts:605 + data-tag-names-sql (9) green |
| 11 | Public mutating routes rate-limited/exempt | VERIFIED | lint:public-route-rate-limit 9 OK |
| 12 | Typecheck includes test files | VERIFIED | tsconfig.typecheck.json exit 0 |

---

## Gaps

**None blocking. No contradictions.**

Carry-forward note only (NOT a new finding): prior cycle's NIT — `switch.tsx:13-14` header docblock cites `translate-x-[calc(100%-2px)]` while the code correctly uses `translate-x-full`. I did not re-verify this cycle (cosmetic comment-vs-code drift, 6-agent corroborated in cycle 4, zero runtime impact). If touched, fix the comment to match the code, never the reverse. Deferred items AGG-C3-08..33 remain validly deferred under their existing exit criteria; I found no reason to reopen any.

---

## Recommendation

**APPROVE** — 12/12 load-bearing behavioral claims hold against the actual code at HEAD `2f603716`, with 2178 fresh tests passing, a clean `tsconfig.typecheck.json` typecheck (the gating mechanism for the compile-time privacy/large-payload guards), all four security lint gates green, and the cycle-4 AGG-C4-04 sidecar walk-back independently verified correct at both source (`:455` + helper logic) and test (`backfill-color-pipeline-deleted-mid-reencode`, 16 tests) level. The privacy guard was not taken on faith — it was proven to compile-fail on a synthetic leak. The lone skipped suite is the CLIP integration test self-skipping for absent model weights (intentional, env-gated), and DB-dependent logic is mocked, so there are no hidden env failures. HARD GUARD honored. Honest convergence confirmed — 0 contradictions is the correct and desirable result for this cycle.
