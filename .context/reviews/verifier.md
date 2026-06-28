# Cycle 22 Verifier Report

**Date:** 2026-06-29  
**Verifier:** oh-my-claudecode:verifier (Sonnet 4.6)  
**Verdict:** PASS — 0 blockers

---

## 1. Quality Gates

| Gate | Command | Exit Code | Summary |
|------|---------|-----------|---------|
| ESLint | `npm run lint --workspace=apps/web` | 0 | No lint errors (c22-baseline-lint.log) |
| TypeScript | `npm run typecheck --workspace=apps/web` | 0 | 0 type errors; tsc + scripts (c22-baseline-typecheck.log) |
| Vitest | `npm test --workspace=apps/web` | 0 | 241 passed, 2 skipped (243 files), 2195 tests (c22-baseline-vitest.log) |
| lint:api-auth | `npm run lint:api-auth --workspace=apps/web` | **0** | 2 admin routes verified (run fresh) |
| lint:action-origin | `npm run lint:action-origin --workspace=apps/web` | **0** | 42 exports checked; all OK/SKIP-exempt (run fresh) |
| lint:public-route-rate-limit | `npm run lint:public-route-rate-limit --workspace=apps/web` | **0** | 6 route files checked; all OK (run fresh) |

All 6 gates green. The 3 security lints were run independently (not from the baseline logs).

---

## 2. Cycle-21 Fix Verification (commits 0e475ba1 → a60baa8f)

### T1 — Focus-visible scanner + 20 sibling fixes

**Scanner test:**  
`apps/web/src/__tests__/focus-visible-links-scan.test.ts` — EXISTS (262 lines, commit 842ffbfa).

`KNOWN_VIOLATIONS` map at line 55 has one entry: `'components/search.tsx': 0` (role=option exemption, value 0 = no uncovered violations). All other files default to 0. The test would fail if any `<Link>/<a>/<button>` with a standalone `hover:` token lacks a `focus-visible:`/`focus:ring`/`focus-within:` indicator. **Non-vacuous.**

**Sibling fixes:**  
Commit 0e475ba1 modified 15 files, adding `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` to 20 elements across:
- `components/` (admin-header, footer, histogram, home-client, info-bottom-sheet, nav-client, on-this-day-widget, photo-viewer, topic-empty-state)
- `app/[locale]/` (error.tsx, not-found.tsx, analytics-client.tsx, s/[key]/page.tsx, year/[year]/page.tsx)

### T2 — topics.ts uses Number() not parseInt()

`apps/web/src/app/actions/topics.ts`:
- Line 111: `let order = Number(orderStr);` (comment: "R21C21 T2 (DBG21-01)")
- Line 217: `let order = Number(orderStr);` (same comment)

**VERIFIED** — both occurrences converted. parseInt('1e3', 10) === 1 (truncates); Number('1e3') === 1000 (correct).

### T3 — data.ts eviction deletes viewCountRetryCount

`apps/web/src/lib/data.ts` line ~172:
```
// R21C21 T3 (C21-RVW-01): also drop the evicted group's retry
viewCountRetryCount.delete(oldestKey);
```
This runs inside the `while (viewCountBuffer.size > MAX_VIEW_COUNT_BUFFER_SIZE)` overflow loop, so an evicted group's stale retry count is cleaned up atomically with the buffer eviction. **VERIFIED** — the delete is present and in the correct location.

### T4 — clip-embeddings.ts reads env vars for SEMANTIC_SCAN_LIMIT / SEMANTIC_TOP_K_MAX

`apps/web/src/lib/clip-embeddings.ts` lines 30–31:
```ts
export const SEMANTIC_TOP_K_MAX = envPositiveInt(process.env.SEMANTIC_TOP_K_MAX, 50);
export const SEMANTIC_SCAN_LIMIT = envPositiveInt(process.env.SEMANTIC_SCAN_LIMIT, 2000);
```
Comment at line 18: "R21C21 T4 (CRIT21-02)". The semantic search route (`app/api/search/semantic/route.ts`) imports both constants from this module and applies them at lines 47–48 and 258. **VERIFIED** — env-wired with correct defaults matching CLAUDE.md.

### T5 — process-image-max-input-pixels-env.test.ts

`apps/web/src/__tests__/process-image-max-input-pixels-env.test.ts` — EXISTS (commit 9c3cd64d... wait, commit 9d8cff7b).

Test suite: `describe('IMAGE_MAX_INPUT_PIXELS_TOPIC env parsing (R21C21 T5)')`. Non-vacuous assertions:
- `expect(await loadTopicCap('64e6')).toBe(64_000_000)` — proves Number() parse (parseInt would return 64)
- `expect(await loadTopicCap('33554432')).toBe(33_554_432)` — integer string passes through
- `expect(await loadTopicCap(undefined)).toBe(DEFAULT_TOPIC_PIXELS)` — fallback to 67_108_864

**VERIFIED** — would catch a revert to parseInt on the scientific-notation case.

### T6 — 4 CLAUDE.md doc edits (commit a60baa8f)

All four documented in the commit message, verified in CLAUDE.md:

| Edit | Location | Status |
|------|----------|--------|
| DOC21-G1: color_space/icc_profile_name/bit_depth labeled admin-only | CLAUDE.md lines 158–160 | VERIFIED — each row now reads `admin-only — ...` |
| DOC21-G2: New Race-Condition-Protections bullet for gallerykit_topic_route_segments (all 3 ops) | CLAUDE.md line 378 | VERIFIED — "wraps createTopic, updateTopic, AND createTopicAlias" |
| DOC21-M1: Advisory-lock scope note "topic create/rename/alias mutations" | CLAUDE.md line 390 | VERIFIED — "topic create/rename/alias mutations" replaces "topic renames" |
| DOC21-G3: SHARP_CONCURRENCY formula documented | CLAUDE.md line 98 | VERIFIED — "max(1, floor((cpuCount-1)/3))" with explicit cpuCount-1 cap |

---

## 3. Behavioral Spot-Checks (CLAUDE.md claims vs. code)

| # | Claim | File:Line | Status |
|---|-------|-----------|--------|
| 1 | COLOR_IMPACTING_KEYS count = 9 | `apps/web/src/lib/settings-hash.ts:45–56` | **MATCH** — 9 keys: wide_gamut_jpeg_chroma, sdr_jpeg_chroma, avif_effort, force_srgb_derivatives, wide_gamut_max_source_pixels, image_quality_webp, image_quality_avif, image_quality_jpeg, image_sizes |
| 2 | settings-hash HASH_LENGTH = 8 | `apps/web/src/lib/settings-hash.ts:71` | **MATCH** — `const HASH_LENGTH = 8;` |
| 3 | Login rate limit: 5 attempts / 15-min window, per-IP AND per-account | `apps/web/src/lib/rate-limit.ts:60–61` | **MATCH** — `LOGIN_MAX_ATTEMPTS = 5`, `LOGIN_WINDOW_MS = 15 * 60 * 1000`; both IP and `acct:` buckets incremented at `apps/web/src/app/actions/auth.ts:117–130` |
| 4 | Per-account key: `acct:<sha256-prefix>` | `apps/web/src/lib/rate-limit.ts:99,136–140` | **MATCH** — `ACCOUNT_RATE_LIMIT_PREFIX = 'acct:'` + `createHash('sha256').update(...).digest('hex').slice(...)` |
| 5 | IMAGE_PIPELINE_VERSION = 7 | `apps/web/src/lib/gallery-config-shared.ts:21` | **MATCH** — `export const IMAGE_PIPELINE_VERSION = 7;` |
| 6 | publicSelectFields omits latitude/longitude/filename_original/user_filename | `apps/web/src/lib/data.ts:340–341, 364–370` | **MATCH** — explicitly destructured into `_omit*` variables and excluded from the public object |
| 7 | SHARP_CONCURRENCY default: max(1, floor((cpuCount-1)/3)); explicit value capped at cpuCount-1 | `apps/web/src/lib/process-image.ts:44,48` | **MATCH** — `Math.max(1, Math.floor((cpuCount - 1) / 3))` and `Math.min(envConcurrency, Math.max(1, cpuCount - 1))` |
| 8 | Advisory lock names: gallerykit_db_restore, gallerykit_upload_processing_contract, gallerykit_topic_route_segments, gallerykit_admin_delete | `apps/web/src/lib/advisory-locks.ts:19,22,25,34` | **MATCH** — all 4 exported string constants match CLAUDE.md |

No mismatches found.

---

## 4. Test Non-Vacuity Summary

| Test | Would Fail On Revert? | Evidence |
|------|-----------------------|---------|
| `focus-visible-links-scan.test.ts` | YES — hover-styled control without focus-visible token fails the gate | Lines 207–211: `issues.length > allowed` check |
| `process-image-max-input-pixels-env.test.ts` | YES — `loadTopicCap('64e6')` returns 64 (wrong) with parseInt, 64_000_000 (correct) with Number() | Line 35: `expect(await loadTopicCap('64e6')).toBe(64_000_000)` |

---

## 5. Gaps

None identified. All cycle-21 acceptance criteria are VERIFIED.

---

## Verdict: PASS

All 6 quality gates green (exit 0). All cycle-21 fixes (T1–T6) are present and correct. All 8 behavioral claims MATCH the code. No blockers.
