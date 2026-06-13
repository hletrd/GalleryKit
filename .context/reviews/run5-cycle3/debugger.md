# Debugger Review — Run-5 Cycle-3

**Date:** 2026-06-12
**Reviewer lane:** Debugger
**Diff under extra scrutiny:** `aa5266b5..HEAD` (21 run-5 cycle-2 commits)
**Suppression list checked:** plan-315, plan-316, plan-317, plan-322, _aggregate.md (run5-cycle2). BUG-R5C2-06 disproven status noted and not re-raised.

---

## FINDINGS

---

### BUG-R5C3-01 [HIGH / High / confirmed]

**Test leak: `processTopicImage` valid-image tests write real `.webp` files into `public/resources/` with no cleanup**

- **File:** `apps/web/src/__tests__/process-topic-image.test.ts:88-106`
- **Writes to:** `apps/web/public/resources/<uuid>.webp` (Vitest cwd = `apps/web`)
- **Problem:** The two successful-path tests ("returns a `<uuid>.webp` filename for a valid JPEG" at line 88 and "returns a `<uuid>.webp` filename for a valid PNG" at line 97) call the real `processTopicImage` function backed by a real Sharp pipeline. Each call writes a UUID-named `.webp` file to `apps/web/public/resources/`. The `afterAll` cleanup block (line 146-149) only removes files that were pushed into `createdFiles[]`, which is populated only by the `cleanOrphanedTopicTempFiles` describe block (lines 157, 171). The `processTopicImage` describe block never pushes the returned `filename` into `createdFiles`, so those UUID `.webp` files are never deleted.
- **Evidence:** 32 UUID `.webp` files currently present in `apps/web/public/resources/`, all ~540 bytes (512×512 VP8), consistent with successive test runs. These are confirmed test artifacts: `file` output shows "RIFF Web/P image, VP8 encoding, 512x512".
- **Reproduction:** Run `npm test --workspace=apps/web` — two new UUID `.webp` files appear in `public/resources/` after every run.
- **Secondary problem:** `public/resources/` is NOT in `.gitignore` (only `public/uploads/*` is gitignored, per `apps/web/.gitignore:48`). These test-generated files are untracked by git and, once committed accidentally, would ship topic-image files into source control or Docker build context.
- **Fix:** In the `processTopicImage` describe, capture the returned filename and delete it in an `afterEach` or `afterAll`:
  ```ts
  const createdProcessFiles: string[] = [];
  // after processTopicImage call:
  createdProcessFiles.push(path.join(resourcesDir, filename));
  // afterAll: Promise.all(createdProcessFiles.map(f => fs.unlink(f).catch(() => {})))
  ```
  Additionally add `apps/web/public/resources/*` (with a `!.gitkeep` exception) to `apps/web/.gitignore` so production topic images are gitignored the same way uploads are.
- **Verification:** After fix, running the test suite leaves `public/resources/` empty (or containing only `.gitkeep`).

---

### BUG-R5C3-02 [HIGH / High / confirmed]

**Deslop commit 62532c77 replaced the cross-module constant comparison with a tautology — the test now always passes regardless of whether `caption-generator` exports the correct prefix**

- **File:** `apps/web/src/__tests__/caption-generator.test.ts:65-69`
- **Problem:** Before the deslop pass, the test imported `ALT_TEXT_STUB_PREFIX` from `caption-generator` as `CONSTANTS_PREFIX` and asserted `ALT_TEXT_STUB_PREFIX === CONSTANTS_PREFIX`, verifying that the re-export from `caption-generator` matched the canonical value in `caption-constants`. The deslop commit (62532c77) removed the import of `ALT_TEXT_STUB_PREFIX` from `caption-generator` (correctly, since the re-export was deleted from the module) but left the assertion as `expect(ALT_TEXT_STUB_PREFIX).toBe(ALT_TEXT_STUB_PREFIX)` — a self-comparison that is trivially always true.
- **Code at line 68:** `expect(ALT_TEXT_STUB_PREFIX).toBe(ALT_TEXT_STUB_PREFIX);`
- **What was lost:** The test was supposed to detect drift between the value in `caption-constants` and the value used inside `caption-generator.ts`. The ARCH-R5C2-02 intent — catching a future wrong constant in the generator — is now completely hollow. A future change that makes `generateCaptionStub` use a different string literal would not be caught by this test.
- **Reproduction:** The test passes in all states, including if `generateCaptionStub` is changed to prefix with `"[WRONG] "`.
- **Fix:** Restore the cross-module verification. Since `caption-generator` no longer re-exports the constant, the test must instead verify it indirectly: call `generateCaption(BASE_INPUT, true)` and assert `result!.startsWith(ALT_TEXT_STUB_PREFIX)` (which is already tested at line 40), or import `ALT_TEXT_STUB_PREFIX` from `caption-constants` and compare it against the actual prefix visible in the output string. The simplest restoration: assert `result!.slice(0, ALT_TEXT_STUB_PREFIX.length) === ALT_TEXT_STUB_PREFIX` using the value from `caption-constants` as the expected reference. Delete the vacuous `expect(ALT_TEXT_STUB_PREFIX).toBe(ALT_TEXT_STUB_PREFIX)` line entirely.

---

### BUG-R5C3-03 [MED / High / confirmed]

**`public/resources/` directory not gitignored — topic cover images written by the live server will pollute git working tree**

- **File:** `apps/web/.gitignore` (missing entry); compare `apps/web/.gitignore:48` (`/public/uploads/*` is present)
- **Problem:** `processTopicImage` writes cover images for admin-created topics to `apps/web/public/resources/<uuid>.webp`. On the dev machine this directory is populated by either the running app or test runs. `public/uploads/` has a correct gitignore rule; `public/resources/` does not. This means any developer running the app locally or running the test suite will see `public/resources/` as untracked files in `git status`, and a `git add .` or `git commit -A` will accidentally include topic cover images (potentially containing PII or private photos) in commits. In CI (where `git status` is checked), this would appear as unexpected working-tree modifications.
- **Current evidence:** `git status --porcelain` shows `?? apps/web/public/resources/` with 32 UUID `.webp` files.
- **Fix:** Add to `apps/web/.gitignore`:
  ```
  /public/resources/*
  !/public/resources/.gitkeep
  ```
  Create `apps/web/public/resources/.gitkeep` as a tracked placeholder (matching the convention for `public/uploads/`). This is a one-line gitignore fix.

---

### BUG-R5C3-04 [MED / High / confirmed]

**`acquireImageProcessingClaim` in `admin-backfill-runner.ts` leaks a DB connection when `rows[0]?.acquired` is not `1` (lock not acquired) — the connection is released, but on the error path the lock may not be released from the server**

- **File:** `apps/web/src/lib/admin-backfill-runner.ts:195-211`
- **Problem:** When `GET_LOCK(?, 0)` returns `0` (lock held by another connection) or `null` (error), the function releases the connection (`lockConn.release()` at line 209) and returns `null`. This is correct — no lock was acquired so no release is needed. However there is a subtler issue: when the query at line 198 throws (e.g. DB error mid-query), the catch block at line 205-208 calls `lockConn.release()` and re-throws. This is correct behavior.

  The actual bug is different: in `releaseImageProcessingClaim` (line 213-219), there is no catch around the `RELEASE_LOCK` query — only a `finally` that calls `lockConn.release()`. If `RELEASE_LOCK` throws (e.g. the connection was killed mid-run), the advisory lock on the MySQL server side will eventually be released when the connection is closed by the pool, but the `finally` block calls `lockConn.release()` which returns the connection to the pool rather than destroying it. If the underlying connection was in a broken state, a subsequent pool user may receive a broken connection. This is LOW on its own.

  The more significant issue: in `reprocessOne` (line 286-395), if `acquireImageProcessingClaim` throws (the `connection.getConnection()` call throws — pool exhausted), the error propagates up through `reprocessOne` uncaught, exits the queue task's try/catch (line 460-487), and increments `errors++` at line 486. This is correct — but the `runBackfill` loop does NOT check whether the error was a transient pool-exhaustion vs a permanent image error, and does not back off. A sustained pool-exhaustion during backfill will spin `BATCH_SIZE` concurrent `connection.getConnection()` calls in the PQueue, each failing immediately and each incrementing `errors`. With concurrency=1, this is bounded, but it's still a tight spin loop on a broken pool.
- **Severity:** MED — no data corruption, but sustained pool-exhaustion during backfill produces rapid error-log spam and may worsen pool recovery.
- **Fix:** In `reprocessOne`, wrap the `acquireImageProcessingClaim` call in a try/catch that specifically handles `ECONNREFUSED` / pool-exhausted errors by returning `{ ok: false, reason: 'locked' }` (treated as skip, no version bump) rather than letting the error escape.

---

### BUG-R5C3-05 [MED / Med / likely]

**`preIncrementSemanticAttempt` uses `'unknown'` as a bucket key — all proxy-misconfigured clients share one 30/min semantic search quota**

- **File:** `apps/web/src/app/api/search/semantic/route.ts:190-192`; `apps/web/src/lib/rate-limit.ts:186-189`
- **Problem:** When `TRUST_PROXY` is not configured, `getClientIp()` returns the string `'unknown'`. The semantic route then calls `preIncrementSemanticAttempt('unknown', now)`, which uses `'unknown'` as the bucket key. All users behind the proxy share one 30-request-per-minute quota — one active user exhausts the quota for all others. The checkout route (TRC-R5C1-16 / fixed in cycle 2 commit fc4abdcd) addressed this by omitting the idempotency key for `'unknown'` IP — the same honesty fix should be documented or applied here.
- **Note:** This is a pre-existing pattern across several routes (OG, share-key, semantic), not a regression introduced in cycle 2. The checkout fix sets a precedent. The semantic route does not have an analogous way to "omit" rate limiting — the rate limit is a security control, not an idempotency key.
- **Reproduction:** On a deployment without `TRUST_PROXY=true`, 30 semantic searches from any single client exhaust the rate limit for all clients for 60 seconds.
- **Fix (documentation):** Add a comment in `semantic/route.ts` and in the rate-limit.ts SECURITY warning noting the shared-bucket effect for semantic search (mirrors the checkout fix's TRUST_PROXY note). If rate-limit-per-request-fairness is required, consider using a fingerprint (Accept-Language + User-Agent hash) as a fallback bucket key — but this is a design decision, not a one-line fix. At minimum, document the behavior.
- **Status:** needs-manual-validation — depends on whether the deployment sets `TRUST_PROXY`.

---

### BUG-R5C3-06 [MED / Med / confirmed]

**`ensureDir` singleton in `process-topic-image.ts` resets on failure but the failure propagates — a second call after a transient EACCES will correctly retry, but the module-level `dirPromise = null` reset in the catch is a race with concurrent `processTopicImage` calls**

- **File:** `apps/web/src/lib/process-topic-image.ts:29-37`
- **Problem:** The `ensureDir` singleton pattern:
  ```ts
  dirPromise = fs.mkdir(...).then(() => {}).catch((e) => {
      dirPromise = null;
      throw e;
  });
  ```
  If two concurrent `processTopicImage` calls arrive while `dirPromise` is null (first call, or after a failed first call), BOTH observe `dirPromise === null`, BOTH call `fs.mkdir`, and BOTH set `dirPromise` to their own promise. Only the last assignment wins. If the first mkdir succeeds but the second fails (race on the existing directory — `fs.mkdir` with `recursive: true` does NOT throw on EEXIST, so this is safe for the normal case), no issue. However if `fs.mkdir` throws for a non-ENOENT reason (EACCES, ENOSPC), both callers reset `dirPromise = null` in their catch blocks but only one error propagates to each caller. The second caller's `dirPromise` assignment is overwritten by the first caller's `dirPromise = null` in the catch, but by this point the second caller has already awaited its own promise chain. The net effect: the singleton is not truly singleton in the concurrent-failure scenario. The production deployment uses `QUEUE_CONCURRENCY=1` so this is unlikely in practice, but the pattern is fragile for any future concurrency increase.
- **Severity:** MED in theory, LOW in practice for the single-writer topology.
- **Fix:** Standard singleton-with-reset pattern: set `dirPromise` atomically before the async call and only reset to null if the SAME promise is still current:
  ```ts
  const p = fs.mkdir(...).then(() => {}).catch((e) => {
      if (dirPromise === p) dirPromise = null;
      throw e;
  });
  dirPromise = p;
  ```

---

### BUG-R5C3-07 [LOW / High / confirmed]

**`apps/web/src/__tests__/caption-generator.test.ts:11` retains explicit `vi.mock('server-only', ...)` that is now redundant (and potentially confusing) after `vitest.config.ts` added a global alias**

- **File:** `apps/web/src/__tests__/caption-generator.test.ts:11`; `apps/web/vitest.config.ts:12-14`
- **Problem:** Commit `fed77250` added a global `'server-only'` → stub alias in `vitest.config.ts:13`. The `caption-generator.test.ts` file still has an explicit `vi.mock('server-only', () => ({}))` at line 11. This is not a bug — `vi.mock` takes precedence over aliases, so the stub is correctly applied. But the explicit mock is now dead weight that misleads maintainers into thinking the alias is insufficient, and leaves a maintenance burden if the stub behavior ever needs to change (two places to update).
- **Fix:** Remove the now-redundant `vi.mock('server-only', () => ({}))` line from `caption-generator.test.ts`.
- **Note:** This was partially addressed by the deslop commit (which removed `vi.mock('server-only')` from `bulk-update-images.test.ts` and `retry-failed-image-auth.test.ts`) but missed `caption-generator.test.ts`.

---

### BUG-R5C3-08 [LOW / High / confirmed]

**`session.ts` shape assertion for `timestamp` fires AFTER crypto — but `timestamp` used in `parseInt` before the numeric shape assertion is `string`, so NaN injection via a valid-HMAC token with non-numeric timestamp is caught correctly. However the `random` shape assert at line 124 uses `/^[0-9a-f]{32}$/` which is post-HMAC — this is correct. No actual bug here.**

- Investigated: `apps/web/src/lib/session.ts:99-135`. The shape assertions at lines 124-125 are correctly placed after HMAC verification to prevent timing oracle use. `parseInt(timestamp, 10)` is a no-throw operation (returns `NaN` for non-numeric input) and `!Number.isFinite(NaN)` correctly catches it at line 129. The timestamp check at line 130-133 is also correct. This investigation is VERIFIED SAFE — no finding.

---

## SPECIAL ITEM: `public/resources/` UUID `.webp` files

**Writer identified:** `apps/web/src/lib/process-topic-image.ts` (production code) and `apps/web/src/__tests__/process-topic-image.test.ts` (test leak via real Sharp pipeline).

**Classification:** Test artifact leak (BUG-R5C3-01) compounded by missing gitignore entry (BUG-R5C3-03). The production code is correct — it writes to `RESOURCES_DIR` which is intentionally `public/resources/`. The 32 files present are from test runs, not from a misconfigured route. No route misconfiguration detected.

**Not a security issue:** The files are 512×512 WebP test blobs generated from synthetic solid-color Sharp sources, not real photos or PII.

---

## VERIFIED CLEAN (cycle-2 regression sweep)

| Area | Verdict |
|---|---|
| `cfe7f1c9` e2e fix — wrong-password alert filter | Correct. Filters by `hasText: 'Invalid credentials'` to avoid strict-mode Next.js route announcer collision. The fix is minimal and does not change test semantics. |
| `62532c77` deslop — `server-only` mock removal from bulk-update/retry tests | Correct for those files. Global alias in `vitest.config.ts` makes them redundant. |
| `62532c77` deslop — `ALT_TEXT_STUB_PREFIX_RE` re-export removal from `photo-title.ts` | The re-export was dropped from `photo-title.ts` (line formerly at :124). `photo-title.ts` itself imports from `caption-constants` directly (line 2). No external import of `ALT_TEXT_STUB_PREFIX_RE` from `photo-title` was found in the codebase — clean. |
| `62532c77` deslop — `export { ALT_TEXT_STUB_PREFIX }` removal from `caption-generator.ts` | No external import of `ALT_TEXT_STUB_PREFIX` from `caption-generator` found in source. The test file was updated in the same commit. The only remaining consumer of the constant imports from `caption-constants`. Clean. |
| `6d17ca58` — `caption-constants.ts` + `server-only` guard | `caption-generator.ts` now has `import 'server-only'` (line 19) and imports `ALT_TEXT_STUB_PREFIX` from `caption-constants`. `photo-title.ts` imports from `caption-constants` directly. No circular dependency or bundle-bleed path detected. AGG-R5C2-02 correctly resolved. |
| `3b5d9f20` — `applyAltSuggested` prefix strip | `stripStubPrefix` called at the copy site in `images.ts`. `photo-title.ts:46` now uses `/\s+/` + `filter(Boolean)` for `formatTitleAsTags`. Both AGG-R5C2-07 and AGG-R5C2-12 confirmed fixed. |
| `a5e787ee` — per-image lock + observability in admin backfill | Lock acquire/release pattern is correct. `acquireImageProcessingClaim` (line 195-211) releases the connection on both success-false (lock not acquired) and error paths. `reprocessOne` correctly wraps the full encode→detect→UPDATE window in `finally { releaseImageProcessingClaim() }`. AGG-R5C2-08 and AGG-R5C2-10 confirmed fixed. |
| `3b48e185` — deterministic SQL-dispatch batching test | The test now dispatches on SQL content and uses `vi.waitFor`. AGG-R5C2-03 confirmed fixed. |
| `fc4abdcd` — checkout unknown-IP idempotency key | `stripeOptions` is empty object (no `idempotencyKey`) when `ip === 'unknown'`. TRC-R5C1-16 confirmed fixed. |
| `5700f184` — semantic search honesty posture | Route docstring matches the gate (`!== 'stub'` → 503). Visitor disclaimer in `search.tsx:445`. Settings `'production'` warning replaced with stale-value explanation. `semanticSearchModeProduction` key removed from en/ko. AGG-R5C2-01 confirmed fixed. |
| `24f607de` — session token shape assert (AGG-R5C2-30) | `random` and `signature` shape asserts placed post-HMAC at lines 124-125. AGG-R5C2-30 confirmed fixed. |
| `24f607de` — `_MapSensitiveKeys` derived guard (AGG-R5C2-32) | `type _MapSensitiveKeys = Exclude<PrivacySensitiveKeys, 'latitude' \| 'longitude'>` at `data.ts:429`. Derives from canonical `PrivacySensitiveKeys`. AGG-R5C2-32 confirmed fixed. |
| `eb4432f0` — session-verify test isolation | `vi.doMock` in `beforeEach`, `vi.resetModules()` in `afterEach`, unique `randomBytes(16)` per token. AGG-R5C2-14 confirmed fixed. |
| `eb4432f0` — sw-cache deterministic sleep | Needs separate verification by test-engineer; out of scope for debugger lane. |
| Semantic route `'unknown'` IP shared bucket | Pre-existing pattern; not introduced in cycle-2. Documented as BUG-R5C3-05 for operator awareness. |
| `formatTitleAsTags` split fix | `photo-title.ts:46` uses `/\s+/` + `filter(Boolean)`. AGG-R5C2-12 confirmed fixed. |
| `ensureDir` singleton | Fragile but functionally safe for single-writer topology. Documented as BUG-R5C3-06 (MED). |
| Bootstrap re-enqueue `capture_date`/`camera_model` threading | Fields present in `ImageProcessingJob` (lines 132-133), selected in bootstrap query (lines 615-616), passed to `enqueueImageProcessing` (lines 637-638), used in caption hook (line 386). Correct. |

---

## BUG-SURFACE AREAS COVERED

1. Cycle-2 commits (21 commits, aa5266b5..HEAD) — regression sweep
2. `process-topic-image.ts` + its new test — test isolation and gitignore
3. `admin-backfill-runner.ts` — lock acquire/release, error propagation, pool exhaustion
4. `image-queue.ts` — bootstrap re-enqueue field threading, embedding hook
5. `caption-generator.ts` / `caption-constants.ts` / `photo-title.ts` — deslop behavioral drift
6. `session.ts` — shape assertion placement and timing oracle
7. `rate-limit.ts` / `semantic/route.ts` — unknown-IP shared bucket
8. `gallery-config.ts` — semanticSearchMode resolver
9. `vitest.config.ts` — global server-only alias interaction with explicit mocks
10. `data.ts` — privacy guard correctness
11. `public/resources/` — writer identification, gitignore gap
12. e2e fixes — strict-mode alert filter correctness
13. `use-display-capability.ts` — snapshot stability (verified clean)

---

## SUMMARY

| Severity | Count | IDs |
|---|---|---|
| HIGH | 2 | BUG-R5C3-01, BUG-R5C3-02 |
| MED | 4 | BUG-R5C3-03, BUG-R5C3-04, BUG-R5C3-05, BUG-R5C3-06 |
| LOW | 1 | BUG-R5C3-07 |
| Verified safe (session shape assert) | 1 | BUG-R5C3-08 (not a bug) |
