# Test engineering review — Run-4 Cycle 1

Angle: gate failures, flaky tests, coverage gaps. Baseline: `npm test --workspace=apps/web`
on clean tree = **2 failed / 1501 passed (1503)**; all four lint gates green
(eslint, api-auth, action-origin, public-route-rate-limit).

## Findings

### TEST-R4C1-06 — Flaky: `admin-backfill-runner-detection-failure.test.ts` (BLOCKING gate)
- **Severity/Confidence: HIGH (gate-blocking) / High**
- **Where:** `apps/web/src/__tests__/admin-backfill-runner-detection-failure.test.ts:169-171`.
- **Why:** the drain `for (let i = 0; i < 10; i++) await new Promise(setImmediate)` assumes
  the fire-and-forget runner completes within 10 macrotask turns. The test intentionally
  leaves `sharp` unmocked (comment lines 83-89), so `sharp(path).metadata()` does real
  libuv threadpool I/O whose rejection latency is machine-dependent. On a slow machine the
  `UPDATE` (product code `admin-backfill-runner.ts:267-272` — verified correct) hasn't run
  when assertions fire: `updateCalls.length = 0`.
- **Fix (root-cause, not masking):** replace the fixed drain with
  `await vi.waitFor(() => expect(readAdminBackfillState().running).toBe(false), { timeout: ..., interval: ... })`
  — the runner's `finally` (line 340) is the authoritative completion signal the test
  already asserts at the end. The contract assertions themselves stay untouched.

### TEST-R4C1-07 — Timeout: `serve-upload.test.ts` first test (BLOCKING gate)
- **Severity/Confidence: HIGH (gate-blocking) / High**
- **Where:** `apps/web/src/__tests__/serve-upload.test.ts:25-36` (timeout in 15000ms), root
  cause in `apps/web/src/lib/serve-upload.ts:7`.
- **Why:** first `await import('@/lib/serve-upload')` transitively cold-transforms+loads
  `process-image` → sharp + color pipeline, purely to read `IMAGE_PIPELINE_VERSION`, which
  is defined in client-safe `gallery-config-shared.ts:21`.
- **Fix:** change `serve-upload.ts` to import the constant from
  `@/lib/gallery-config-shared` (product fix — also removes sharp from the image-serving
  route's module graph); update the test's own `@/lib/process-image` import (line 43) to
  `@/lib/gallery-config-shared` so the suite no longer loads the encoder graph at all.
- **Implementation addendum:** the import fix alone cut the standalone run from 34 s to
  6.5 s, but under full-suite CPU contention the REMAINING cold chain
  (next/server + `@/db` → drizzle + mysql2) still hit 20.8 s. Added a `beforeAll`
  transform-cache warm-up (120 s hook timeout, followed by `vi.resetModules()`) so the
  one-time cost is attributed to setup, never to the first test's 15 s budget.

## Coverage gaps (new tests required with this cycle's fixes)
1. **LR route insert-failure cleanup** — no test exercises a rejected `db.insert` on
  `/api/admin/lr/upload`; assert original deleted + tracker settled + 500 JSON
  (extend the harness in `__tests__/lr-upload-hdr-gate.test.ts`).
2. **LR route `user_filename` sanitization** — control-char / path-segment / empty-name
  rejection parity.
3. **Token label sanitization** — `createLrToken` rejects bidi/zero-width labels
  (policy-lock test, mirrors existing `sanitize` fixtures).
4. **LR enqueue payload carries camera_model/capture_date** — lock the caption-input
  parity.
5. **lr-tokens expiresAt validation** — Invalid-Date / past-date rejection.

## Suite health notes
- 1501 passing tests, 157 files; runtime 244 s dominated by `import 813.95s` —
  the gallery sits on a network-shared volume; the serve-upload fix (above) removes the
  worst single-file import cost. No other test exceeded its budget.
- No suppressed/xfail-style tests found; 11 `eslint-disable` sites outside tests are
  pre-audited (lineage comments present).
