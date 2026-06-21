# Test Engineer Review — Run-9 Cycle-5

**Date:** 2026-06-21
**HEAD:** e34c04cf (at session start)
**Scope:** Vitest unit tests in `apps/web/src/__tests__/` (226 files, 2054 tests + 4 skipped)
**Run result:** 224 passed | 2 skipped (model-weight-dependent) — 0 failures

---

## Summary

**ZERO new DEFECTS — convergence.**

No test was found that masks a real bug, asserts nothing meaningful, passes for the wrong reason, or creates a broken gate. No flaky-by-design patterns were found beyond the already-known `TE-R9C3-01` residual (upload-tracker-state, already hardened with `beforeAll` + `beforeEach` double-clear). All security-critical gates are intact.

---

## Files Reviewed This Cycle (~50 files sampled across all risk tiers)

### Authentication & Session
- `session.test.ts` — `hashSessionToken` SHA-256 shape, `generateSessionToken` format. Solid.
- `session-verify.test.ts` — 8 branches of `verifySessionToken` (wrong HMAC, expired age, future clock, 2/4 parts, empty, short sig, no DB row, expired DB row, valid); 6 branches of `getSessionSecret` (prod missing, prod short, prod valid, dev DB-backed, dev INSERT-IGNORE+re-fetch, dev persistence-failure throw). Uses `vi.resetModules()` in `beforeEach` to clear module-level `cachedSessionSecret` singleton — no flake risk. Solid.
- `auth-rate-limit.test.ts` — IP + account bucket independence, `count=1→DELETE` vs `count>1→decrement`, DB-failure rollback, `beforeEach` clears all three Maps. Solid.
- `password-hashing-policy.test.ts` — Argon2id work factors pinned exactly (memoryCost=65536, timeCost=3, parallelism=4) + minimum floors. Solid.
- `admin-tokens.test.ts` — `generateToken`/`hashToken`/`tokenHashesEqual`/`isWellFormedToken`/`normalizeScopes`/`tokenHasScope` (US-P53). Solid.

### Action Security Gates
- `check-action-origin.test.ts` — Fixture-based coverage for `scripts/check-action-origin.ts` scanner. Covers function-declaration + arrow forms, guard-in-helper fail, dead-branch fail, mutation-before-guard fail, non-mutating-before-guard pass, revalidation-before-guard fail, exempt comment on MUTATING body = FAIL (R4C2 SEC-R4C2-02). Solid.
- `check-api-auth.test.ts` — `withAdminAuth` wrapper gate for all admin API routes. Solid.
- `check-public-route-rate-limit.test.ts` — Rate-limit pre-increment requirement on mutating public routes. Solid.

### Image Processing & Queue
- `image-queue.test.ts` — Path-traversal rejection before queueing, state management via `getProcessingQueueState()`, `beforeEach` clears enqueued/retryCounts/claimRetryCounts. Solid.
- `process-image-exif-strip.test.ts` — Real Sharp pipeline (not mocked); synthetic JPEG with GPS (37N/122W), Make=Canon, serial numbers; AVIF derivatives verified not to leak EXIF. Solid.

### Admin Backfill
- `admin-backfill-runner-batching.test.ts` — SQL-content dispatch (not call-order), cursor advancement across multi-batch runs, `vi.waitFor()` for deterministic completion (no `setTimeout` sleeps). Solid.
- `admin-backfill-runner-leak.test.ts` — R29-CRIT-1: early `getGalleryConfig()` throw leaves `state.running=false`, releases advisory lock, populates `state.lastError`. Solid.
- `admin-backfill-runner-detection-failure.test.ts` — No `pipeline_version` bump on detection failure. Solid.
- `admin-backfill-runner-deleted-mid-reencode.test.ts` — `affectedRows:0` → cleanup called, outcome='deleted-mid-reencode'. Solid.
- `admin-backfill-concurrency-cap.test.ts` — `resolveBackfillConcurrency` formula: `floor((poolLimit-reserved-1)/2)`, cap=2 at poolLimit=10, floor at 1 for small pools, fractional inputs, NaN inputs. Solid.

### Color Detection & Pipeline
- `color-detection.test.ts` — All 5 NCLX matrix codes pinned including matrix=8→'ycgco' (AGG-R7C1-01 fix). Solid.
- `settings-hash.test.ts` — All 9 `COLOR_IMPACTING_KEYS` individually verified. Solid.
- `icc-chromaticity.test.ts` — Byte-for-byte synthetic ICC profile fixtures (wtpt/rXYZ/gXYZ/bXYZ in s15Fixed16). Solid.

### Semantic Search
- `semantic-route-production.test.ts` — `embedTextReal` called in production mode, 503 when disabled. Solid.
- `gallery-config-semantic-production.test.ts` — `isValidSettingValue` accepts disabled/stub/production, rejects others. Solid.
- `clip-embedding-column-roundtrip.test.ts` — MEDIUMBLOB Buffer roundtrip; demonstrates old base64 path failure (non-vacuity: 2732≠2048); null for wrong-length/null/undefined/number. Solid.

### Security & Validation
- `validation.test.ts` — `isValidSlug`, `isValidFilename` (path-traversal, slashes), `isValidTopicAlias` (dots, slashes, whitespace), `containsUnicodeFormatting`, `stripUnicodeFormatting`. Solid.
- `csv-escape.test.ts` — CRLF collapse, C0/C1 strip, formula-injection prefix, leading-whitespace-after-collapse bypass (C7R-RPL-01). Solid.
- `content-security-policy.test.ts` — nonce over unsafe-inline in production, GA4 wildcard domains, no `doubleclick`/`googlesyndication` creep, dev unsafe-inline/eval retained. Solid.
- `sanitize-for-og-global.test.ts` — Shared `sanitizeForOg` import by all three consumers. Solid.
- `privacy-fields.test.ts` — 20 SENSITIVE_KEYS symmetry. Solid.

### Infrastructure & Misc
- `rate-limit.test.ts` — `normalizeIp` (IPv4/IPv6/port stripping/invalid), `getRateLimitBucketStart`, share/search rate limits. `afterEach` clears `searchRateLimit` Map + resets share state. Solid.
- `view-retention.test.ts` — Chunked DELETE math. Solid.
- `sw-template-contract.test.ts` — `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` in both template + generated `sw.js`. Solid.
- `touch-target-audit.test.ts` — Per-file KNOWN_VIOLATIONS counting, multi-line normalizer. Solid.
- `backfill-color-pipeline.test.ts` — 9-column contract. Solid.

---

## Flaky-Test Assessment

No new sources of flakiness found. Specific patterns checked and verified safe:

| Pattern | Files | Verdict |
|---|---|---|
| Module-level singleton (session secret cache) | `session-verify.test.ts` | `vi.resetModules()` in `beforeEach` — safe |
| Global state symbol (backfill state) | `admin-backfill-runner-leak.test.ts` | Reset in `beforeEach` via `globalThis[Symbol.for(...)]` — safe |
| In-memory Maps (rate limits) | `rate-limit.test.ts`, `auth-rate-limit.test.ts` | `afterEach`/`beforeEach` clears — safe |
| `vi.waitFor()` polling | `admin-backfill-runner-*.test.ts` | No wall-clock sleeps — safe |
| 4 skipped tests | `clip-offline-load.test.ts`, `clip-semantic-integration.test.ts` | Correctly skipped — require real model weights not in CI |

---

## Coverage Gaps (POLISH — Deferrable)

These are gaps where coverage would add value but NO existing test masks a bug:

1. **`verifySessionToken` race on concurrent module-singleton init** — the `sessionSecretPromise` singleton could theoretically race on first call from two concurrent requests; not a reachable path in Vitest single-thread environment but untested. Low risk.

2. **`auth-rate-limit` — IP+account combined exhaustion** — tests cover each bucket independently but not the scenario where both buckets trip simultaneously (different code path in the login handler). Low risk.

3. **`admin-backfill-runner` — `flushBatch` sidecar path** (AGG-C4-02: delete-mid-reencode cleanup) — the in-app runner is covered by `admin-backfill-runner-deleted-mid-reencode.test.ts` but the sidecar `flushBatch` branch in `scripts/backfill-color-pipeline.ts` has no parallel fixture test. Polish only.

None of these constitute a DEFECT: no test passes for the wrong reason and no gate is broken.

---

## Carried Deferrals (not re-filed)

- TE-R7C2-03 (e2e coverage for P3 color roundtrip)
- TE-R7C2-04 (e2e coverage for HDR badge visibility)
- TE-R7C2-05 (visual regression for masonry layout)
- TE-R9C3-01 residual (upload-tracker-state cross-test bleed, already hardened)

---

## Verdict

**ZERO new DEFECTS. Test surface is healthy. Convergence confirmed.**

All security-critical gates (auth, HMAC verification, Argon2id work factors, admin action origin checks, API auth wrappers, rate limiting, CSV injection, Unicode format char rejection, privacy field separation, EXIF strip) are covered by tests that assert real behavior with meaningful values. No tautological tests, no wrong expected values, no timing-based flakes identified beyond those already documented.
