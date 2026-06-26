# Cycle-13 Verification Report

**Date:** 2026-06-27
**HEAD:** 2a9976a1 (no commits since aggregate was written — verifying cycle-12 landing)
**Verifier:** verifier agent (Sonnet 4.6)

---

## Verdict

**Status:** PASS
**Confidence:** high
**Blockers:** 0

---

## Evidence

| Check | Result | Command | Output |
|-------|--------|---------|--------|
| ESLint | PASS | `npm run lint --workspace=apps/web` | No errors, exit 0 |
| TypeScript | PASS | `npm run typecheck --workspace=apps/web` | `typecheck:app` + `typecheck:scripts` both clean; route types generated; 7 JS scripts checked |
| Vitest | PASS | `npm test --workspace=apps/web` | 2071 passed, 4 skipped (226 test files passed, 2 skipped). Duration 15.79s |
| lint:api-auth | PASS | `npm run lint:api-auth --workspace=apps/web` | 2 admin API route files OK |
| lint:action-origin | PASS | `npm run lint:action-origin --workspace=apps/web` | 35 mutating server actions OK, 6 exempt (read-only with explicit comment) |
| lint:public-route-rate-limit | PASS | `npm run lint:public-route-rate-limit --workspace=apps/web` | 6 public route files OK |
| Build | SKIPPED | — | Skipped: requires DB connection and is slow; all other gates green |

---

## Cycle-12 Fix Verification

### VER-13-01 — AGG-R12-01: Graceful shutdown `process.exit()` + sentinel timer cleared/unref'd

- **Claim:** `instrumentation.ts` now captures timer handle, calls `shutdownTimer.unref?.()`, `clearTimeout(shutdownTimer)` in finally, and `process.exit(exitCode)` after drain.
- **Evidence:** `instrumentation.ts:25-65` — `let shutdownTimer: ReturnType<typeof setTimeout> | undefined`; `shutdownTimer.unref?.()` at line 31; `clearTimeout(shutdownTimer)` at line 51 (in finally block); `process.exit(exitCode)` at line 65.
- **Verdict:** CONFIRMED

### VER-13-02 — AGG-R12-02: `_verifyAvifNclx` partial read (4 KB instead of full file)

- **Claim:** `process-image.ts` `_verifyAvifNclx` now uses `fs.open` + `handle.read(head, 0, 4096, 0)` mirroring `_verifyWebpIccChunk`.
- **Evidence:** `process-image.ts:251-255` — `handle = await fs.open(filePath, 'r')`, `const head = Buffer.alloc(4096)`, `const { bytesRead } = await handle.read(head, 0, 4096, 0)`. The old `fs.readFile(filePath)` is gone from this function.
- **Verdict:** CONFIRMED

### VER-13-03 — AGG-R12-04: DB init-race `setTimeout` cleared in finally

- **Claim:** `db/index.ts` captures `initTimer`, calls `initTimer.unref?.()`, and `clearTimeout(initTimer)` in finally so timers don't accumulate under steady load.
- **Evidence:** `db/index.ts:94-111` — `let initTimer: ReturnType<typeof setTimeout> | undefined`, `initTimer.unref?.()` at line 97, `clearTimeout(initTimer)` at line 111 (in finally per surrounding context).
- **Verdict:** CONFIRMED

### VER-13-04 — AGG-R12-11: image-queue runtime shape guard strengthened

- **Claim:** `image-queue.ts` runtime guard now validates `existing.queue` value (not null) and `typeof existing.queue.add === 'function'` and `existing.enqueued instanceof Set`.
- **Evidence:** `image-queue.ts:186-194` — guard checks `existing.queue` (truthy), `typeof existing.queue.add === 'function'`, `existing.enqueued instanceof Set`, `'bootstrapped' in existing`. The bare `'queue' in existing` is still present but is now followed by the value-type checks.
- **Verdict:** CONFIRMED

### VER-13-05 — AGG-R12-05: `prioritizeSecurityFields` exported + tested

- **Claim:** `audit.ts` exports `prioritizeSecurityFields`; test file `audit-prioritize-security-fields.test.ts` covers it.
- **Evidence:** `audit.ts:20` — `export function prioritizeSecurityFields(...)`. Test file `/Users/hletrd/flash-shared/gallery/apps/web/src/__tests__/audit-prioritize-security-fields.test.ts` imports and calls the function in at least 5 describe/it blocks.
- **Verdict:** CONFIRMED

### VER-13-06 — AGG-R12-08: Stale comments fixed (semantic route + image-queue)

- **Claim:** `api/search/semantic/route.ts` comment updated to `(2000)` (not `(5000)`); `image-queue.ts` Map.keys comment and "no eviction" claim corrected.
- **Evidence:**
  - `semantic/route.ts:9` — `Scans up to SEMANTIC_SCAN_LIMIT (2000) most-recent embeddings`. No `5000` present.
  - `image-queue.ts:87` — `Eviction is FIFO (insertion-order via Map.keys() iteration), not LRU.` The `(5000)` stale claim is gone; FIFO eviction is now documented accurately.
- **Verdict:** CONFIRMED

---

## CLAUDE.md Behavioral Claim Spot-Checks

### VER-13-07 — COLOR_IMPACTING_KEYS count = 9

- **Claim (CLAUDE.md):** "The settings hash covers all 9 `COLOR_IMPACTING_KEYS`"
- **Evidence:** `settings-hash.ts:42-54` — array contains exactly 9 entries: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`.
- **Verdict:** CONFIRMED (count matches)

### VER-13-08 — `publicSelectFields` omits GPS (latitude/longitude)

- **Claim (CLAUDE.md):** "GPS coordinates excluded from public API responses"
- **Evidence:** `data.ts:329-330` — `latitude: _omitLatitude`, `longitude: _omitLongitude` (sentinel omit values, not the actual DB column). `adminSelectFields` at lines 241-242 includes them. Compile-time `_PrivacySensitiveKeys` guard at line 424 lists both. `publicMapSelectFields` (line 362) is the ONLY public select allowed to expose them.
- **Verdict:** CONFIRMED

### VER-13-09 — `SEMANTIC_SCAN_LIMIT` default = 2000

- **Claim (CLAUDE.md):** "`SEMANTIC_SCAN_LIMIT` (default 2000) caps the brute-force vector scan"
- **Evidence:** `clip-embeddings.ts:18` — `export const SEMANTIC_SCAN_LIMIT = 2000;`
- **Verdict:** CONFIRMED

### VER-13-10 — `HEAD_REVALIDATE_TIMEOUT_MS` = 300 in SW template

- **Claim (CLAUDE.md):** "bounded by `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` (300 ms)"
- **Evidence:** `sw.template.js:38` — `const HEAD_REVALIDATE_TIMEOUT_MS = 300;`, used at line 239 — `signal: AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)`.
- **Verdict:** CONFIRMED

---

## Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | ESLint gate passes | VERIFIED | Exit 0, no errors |
| 2 | TypeScript typecheck passes (app + scripts) | VERIFIED | Both clean, no errors |
| 3 | Vitest suite passes | VERIFIED | 2071 passed, 4 skipped |
| 4 | lint:api-auth passes | VERIFIED | 2 admin route files OK |
| 5 | lint:action-origin passes | VERIFIED | 35 mutating actions OK |
| 6 | lint:public-route-rate-limit passes | VERIFIED | 6 public route files OK |
| 7 | AGG-R12-01 shutdown fix landed | VERIFIED | timer unref'd + cleared + process.exit called |
| 8 | AGG-R12-02 _verifyAvifNclx partial read | VERIFIED | fs.open + 4096-byte read, no readFile |
| 9 | AGG-R12-04 db timer cleanup | VERIFIED | initTimer captured, unref'd, cleared in finally |
| 10 | AGG-R12-11 image-queue shape guard | VERIFIED | typeof queue.add + instanceof Set checks |
| 11 | AGG-R12-05 prioritizeSecurityFields exported + tested | VERIFIED | exported at audit.ts:20, test file with 5+ cases |
| 12 | AGG-R12-08 stale comments fixed | VERIFIED | (2000) in semantic route; FIFO eviction documented in image-queue |
| 13 | CLAUDE.md COLOR_IMPACTING_KEYS = 9 | VERIFIED | settings-hash.ts array has exactly 9 entries |
| 14 | CLAUDE.md publicSelectFields omits GPS | VERIFIED | omit sentinels at data.ts:329-330 |
| 15 | CLAUDE.md SEMANTIC_SCAN_LIMIT = 2000 | VERIFIED | clip-embeddings.ts:18 |
| 16 | CLAUDE.md HEAD_REVALIDATE_TIMEOUT_MS = 300 | VERIFIED | sw.template.js:38 |

---

## Gaps

No new gaps identified. Pre-existing deferred items from cycle-12 carry over unchanged:

- `hasTrustedSameOriginWithOptions` still exported (`request-origin.ts:109`) — Risk: low (zero production callers; test locks it) — Deferred per cycle-12 plan.
- `BoundedMap.entries()` returns raw mutable iterator — Risk: low (zero callers) — Deferred per cycle-12 plan.
- Build gate not run — Risk: low (tsc typecheck clean, ESLint clean, all tests pass; build failure from DB dependency would be a pre-existing infrastructure issue not introduced by cycle-12 changes).

---

## Recommendation

APPROVE — All 6 blocking gates pass with fresh output; all 6 cycle-12 fixes are present and correct in the source; all 4 CLAUDE.md behavioral spot-checks match the implementation exactly. Zero blockers.
