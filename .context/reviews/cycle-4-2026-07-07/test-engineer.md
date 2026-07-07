# Test-Engineer Lane — Run-10 Cycle 4 (2026-07-07)

Scope: `e08b6f97..ec433dc4` (17 commits, cycle-3's implementation). Angle: test
coverage gaps, flaky/brittle tests, contract-test drift, TDD opportunities.
Context read: `.context/reviews/cycle-3-2026-07-07/_aggregate.md`,
`.context/plans/cycle-3-2026-07-07-plan.md`.

All findings below are validated from code (file:line) and, where noted,
empirically via an instrumented scratch test run against the real module
(created, executed, then deleted — no repo files were left modified). No
repo files were modified as part of this review.

## Headline

Cycle-3 closed its own review's genuine coverage gaps well (TEST3-01/02/04/05
all got real behavioral tests, not string pins). But two of cycle-3's OWN
new/touched tests have drifted from the implementation they claim to pin —
one is empirically a false positive right now (TEST4-01), the other never
tested its own stated claim (TEST4-02). Both are HIGH-signal because they
create false confidence in exactly the kind of security/correctness-adjacent
surface (fd lifecycle, cache freshness) this repo cares most about.

---

## TEST4-01 — HIGH / Confirmed (empirically reproduced): stale fd-close test is now a false positive

**Location:** `apps/web/src/__tests__/serve-upload.test.ts:114-149`, testing
`apps/web/src/lib/serve-upload.ts` (post `fc9e4407`, PERF3-07/C3-29).

The test `'closes the file handle before returning non-stream 304 and HEAD
responses (C35-PERF-01)'` asserts, for a 304 response, a wildcard-304
response, and a HEAD response, that `closeSpies.at(-1)` was called once.

But `fc9e4407` changed 304 and HEAD to serve entirely from a **path-based**
`stat()` (`serve-upload.ts:217`) with **no file descriptor opened at all** —
`open()` is now called only once per test run, on the initial full GET
(`serve-upload.ts:296`, reached only past the `method === 'HEAD'` early
return at line 280). `closeSpies` is a plain array that the test never
resets between sub-requests, so `closeSpies.at(-1)` after the 304/wildcard/
HEAD calls is still pointing at the **first GET's** spy object — which was
already closed once by the initial `await first.text()`. The three
assertions pass, but they are checking a stale reference; nothing about the
304/HEAD paths is being verified.

**Empirical verification:** built a throwaway instrumented copy of this test
(`open()` call counter) and ran it against the live module — `open()` fires
exactly once across GET → 304 → wildcard-304 → HEAD. Confirms 304/HEAD never
open a descriptor post-fix, so this test cannot detect a regression in those
branches (e.g., if a future edit accidentally opened-and-leaked an fd on the
304 path, this test would still show green).

**Proposed fix:**
```ts
// 304/HEAD must not touch the filesystem via an fd at all:
expect(openMock).toHaveBeenCalledTimes(1); // only the initial GET
// ...and the one fd that WAS opened (the GET) must still close exactly once:
expect(closeSpies[0]).toHaveBeenCalledTimes(1);
```
Rename the test (it no longer "closes the file handle before 304/HEAD" —
it now "never opens a file handle for 304/HEAD, and still closes the GET's
handle after streaming"). This is the same class of drift the cycle-3
aggregate already flagged for `d07c6d32` (source-text re-pin only, no
behavioral check) — here it's worse, because the test *looks* behavioral
(mocks `open`/spies `close`) but the specific assertions no longer exercise
what the title claims.

**Severity:** HIGH — this file is on the security-relevant path check-list
(fd/TOCTOU race safety is explicitly documented in CLAUDE.md's ETag section);
a silently-broken regression test here is worse than no test.
**Confidence:** Confirmed (read + empirically reproduced).

---

## TEST4-02 — MEDIUM / Confirmed: micro-cache test doesn't test its own stated claim

**Location:** `apps/web/src/__tests__/gallery-config-uncached-microcache.test.ts:91-108`
(added in `1dff18d6`, C3-16), testing `apps/web/src/lib/gallery-config.ts:203-235`.

Test title: `'does not cache a failed read (fallback config is not pinned for
the TTL)'`. What it actually does: mocks a DB read failure, calls
`getGalleryConfigUncached()` once, then **manually calls
`_uncachedConfigCacheReset()`** (line 106) immediately before asserting
recovery. The test's own inline comment hedges: *"(The resolver catch
returns defaults without setting the cache? If the implementation caches
fallback values for the short TTL that is also acceptable freshness-wise...)"*
— i.e., the author wasn't sure which behavior is real, and wrote an
assertion that passes either way.

Tracing the actual code: `_getGalleryConfig()` (`gallery-config.ts:176-183`)
**catches internally and resolves with default values — it never rejects**.
The micro-cache wrapper (`gallery-config.ts:214-224`) only skips caching on
an actual `throw`/rejection from `_getGalleryConfig()`, which cannot happen.
So a DB read failure's fallback config **is** cached for the full 2 s TTL —
the opposite of the test's title. The manual reset at line 106 masks this:
it forces a fresh read regardless of whether the fallback was cached, so the
test passes today and would keep passing even if a future refactor changed
the caching behavior in either direction.

**Proposed fix:** remove the manual reset and assert the real contract
directly:
```ts
it('caches a fallback config for the TTL, then re-reads on the next window', async () => {
    // DB down -> fallback served
    selectMock.mockReturnValue({ from: () => ({ where: () => Promise.reject(new Error('db down')) }) });
    const fallback = await getGalleryConfigUncached();
    // DB recovers, but within TTL a second call must NOT re-read (fallback is cached)
    mockSettingsRows([{ key: 'image_quality_webp', value: '91' }]);
    const stillFallback = await getGalleryConfigUncached();
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(stillFallback.imageQualityWebp).toBe(fallback.imageQualityWebp);
    // after TTL, the recovered value is observed
    vi.advanceTimersByTime(2_100);
    const recovered = await getGalleryConfigUncached();
    expect(recovered.imageQualityWebp).toBe(91);
});
```
Also correct the CLAUDE.md-adjacent doc comment on the accessor (currently
silent on the fallback-caching detail) — an operator debugging "why does a
DB blip pin bad image quality settings for 2 seconds" deserves the
documented answer, and it's a fine trade-off, just an undocumented one.

**Severity:** MEDIUM (freshness-window bug is minor and probably acceptable,
but the test provides zero regression protection either way).
**Confidence:** Confirmed (read + traced the non-throwing catch path).

---

## TEST4-03 — LOW-MED / Confirmed: ossification metric update (C3-25 exit criterion)

Recount at HEAD (`ec433dc4`) using the same method as cycle-3's aggregate
(test files that `readFileSync` their own source and assert via
`toContain`/`toMatch` regex, vs. total test files):

| Cycle | Source-text files | Total test files | Ratio |
|---|---|---|---|
| cycle-2 end | 139 | 307 | 45.3% |
| cycle-3 end (prior aggregate) | 143 | 330 | 43.3% |
| **cycle-4 (this HEAD)** | **145** | **335** | **43.3%** |

**Did WP12 (`8b2dd1d2`) reduce the trend?** Partially, and only in kind, not
in count. WP12 made two EXISTING scanner tests structurally safer (brace-
balanced nginx location parser instead of `indexOf` boundary hacks; CSP test
relaxed from exact rule-count pinning to shape assertions) — a real
fragility fix. But cycle-3 also **added** new pure source-text test files in
the same cycle:
- `apps/web/src/__tests__/optimistic-image-retry.test.ts` (C3-24) — 4 tests,
  100% regex against `optimistic-image.tsx` source. Its own docstring
  concedes: *"the repo has no jsdom/RTL harness for component behavior
  tests"* — a structural (not author-negligence) reason this class keeps
  growing.
- `apps/web/src/__tests__/similar-route-embedding-copy.test.ts` (C3-06) — 2
  tests, regex against `route.ts` and `clip-embeddings.ts`.
- `single-writer-guard.test.ts`'s `'instrumentation.ts wiring'` describe
  block (2 of its 17 tests are regex against `instrumentation.ts`, the rest
  are genuinely behavioral — a good hybrid pattern).
- `migrate-pending-migrations.test.ts`'s `'migrate.js source contracts'`
  describe block (2 tests) — but this file's headline addition (the mixed-
  batch test) is genuinely behavioral, another good hybrid example.

Net: the ratio held flat rather than climbing (a mild improvement over
cycle-2→cycle-3's climb), but the absolute count of source-text tests still
grew by 2 net files this cycle, and the exit criterion ("reduce the trend")
was not met in absolute terms. The recurring root cause named accurately by
`optimistic-image-retry.test.ts` itself — no component-behavior test harness
(jsdom/RTL) — is the actual lever; until that's addressed, every future
component-level fix in a hard-to-reach branch (unreachable trap removal,
wiring checks, etc.) will keep landing as a source-text pin by necessity,
not by choice. **Recommendation for a future cycle:** evaluate adding a
minimal RTL/jsdom harness (even scoped to a handful of pure-logic hooks
extracted from components) as a WP, since the pattern is now well-documented
across 3+ cycles and several commits have explicitly apologized for its
absence in code comments.

**Severity:** LOW-MED (trend, not a single bug). **Confidence:** Confirmed (counted directly).

---

## TEST4-04 — LOW / Likely: e2e single-session refactor trades diagnostic granularity for flake-avoidance, root fragility remains

**Location:** `apps/web/e2e/swipe-visual-reset.spec.ts` (post `24c46745`).

`24c46745` merged two previously-separate tests (sub-threshold snap-back;
threshold in-place-navigation + visual reset) into one `test(...)` with one
`page.goto`, to stay under the shared-group route's rate limiter. This is a
reasonable, well-justified fix for the immediate flake, but:

1. **Reduced diagnostic granularity.** If phase 1 (snap-back) regresses, the
   test fails before phase 2 (in-place navigation) ever runs — a CI failure
   now reads as "swipe test failed" instead of distinguishing which of the
   two behaviors broke, for as long as this merged shape persists.
2. **The root fragility is still there, one level up.** The limiter this
   spec avoids re-triggering is `shareRateLimit`
   (`apps/web/src/lib/rate-limit.ts:97`, `SHARE_MAX_REQUESTS = 60`/min,
   keyed per-IP) — a **process-global** in-memory counter with **no e2e-
   reachable reset**. `resetShareRateLimitForTests()`
   (`rate-limit.ts:356-358`) exists but only helps in-process Vitest; it
   cannot be called from Playwright, which drives a separate server
   process. `apps/web/e2e/public.spec.ts` independently has 3 more tests
   hitting `/g/`/`/s/` routes against the SAME counter for the SAME full
   suite run (`playwright.config.ts:57-58`: `fullyParallel: false`,
   `workers: 1`, so it's a sequential shared budget across the whole spec
   file set, not a true parallel-worker race as the commit message frames
   it — the actual driver is the shared grid's viewport-entry RSC
   prefetches consuming the same counter, which the commit message also
   names). Any future e2e test added against `/g/`or `/s/` routes can
   reintroduce the exact same flake class, and there's no structural guard
   (env-gated bypass, higher e2e-only limit, or reset hook) preventing it.

**Proposed follow-up (not urgent):** add a test-mode bypass for the share
probe limiter (e.g., skip when `NODE_ENV==='test'` and request originates
from `127.0.0.1`, mirroring patterns already used elsewhere in the repo for
test-only escape hatches), then split the merged test back into two for
independent failure signals.

**Severity:** LOW (mitigated the immediate flake; the residual is
architectural, not a live bug). **Confidence:** Likely (grep-confirmed
counter sharing + config; did not reproduce an actual flake under load).

---

## TEST4-05 — LOW / Likely: photo-navigation's "any in-place switch path" claim only tested via swipe

**Location:** `apps/web/src/components/photo-navigation.tsx:112`
(`useLayoutEffect` keyed on `[prevId, nextId]`, added in `9c45e933`).

The commit message for `9c45e933` explicitly frames the layout-effect fix as
covering "ANY in-place photo switch path (buttons/keyboard too)," not just
swipe. And indeed, `goToPhoto` — reached identically from the swipe
success branches AND the chevron `onClick` handlers at
`photo-navigation.tsx:291` and `:305` — always calls `onSelectId(id)`, which
in the shared-group view is wired to the same in-place `setCurrentImageId`
that originally reproduced DBG3-01.

The only test added, `swipe-visual-reset.spec.ts`, exercises exclusively the
**swipe-gesture** trigger via synthetic `TouchEvent`s. No test drives a
button-click (or keyboard) in-place navigation on the shared-group fixture
and asserts the edge-indicator/progress-bar visuals reset. Since the fix is
effect-driven (keyed on id identity, not on which handler fired), it's
likely this path is already correct — but it is exactly the "fix one
sibling, miss the next" pattern this repo's own CLAUDE.md documents as a
recurring theme (see the Touch-Target Audit section's multi-line-tag
history). A one-line addition to the existing e2e spec — click the visible
next-chevron button instead of dispatching a touch swipe, on the same
shared-group fixture, and assert the same indicator-opacity-0 outcome —
would close this cheaply.

**Severity:** LOW (mechanism strongly suggests it already works).
**Confidence:** Likely (read the code path; did not execute a live browser
check for the click path).

---

## TEST4-06 — LOW / Likely: single-writer-guard has two untested lower-order invariants

**Location:** `apps/web/src/lib/single-writer-guard.ts`, tested by
`apps/web/src/__tests__/single-writer-guard.test.ts` (17 tests, otherwise
thorough and correctly uses `vi.useFakeTimers()` / `advanceTimersByTimeAsync`
throughout — no real-clock waits found).

Two invariants stated in the source comments have no regression test:
1. **`.unref()` on both timers** (`single-writer-guard.ts:119` keepalive,
   and the reprobe `setTimeout` in `startSingleWriterGuard`) — the doc
   comment says these "must not hold the process open," but no test spies
   on `setInterval`/`setTimeout`'s returned handle to confirm `.unref` was
   actually invoked. A future refactor that silently dropped `.unref?.()`
   would not be caught.
2. **`stopSingleWriterGuard()` called during the ~25 s reprobe window**
   (between initial contention and the scheduled `reprobeOnce()`) is never
   exercised. `clearReprobe()` exists specifically to cover this shutdown
   race, but no test calls `stopSingleWriterGuard()` mid-window and then
   asserts the reprobe never fires (e.g., that `createConnectionMock` isn't
   called a second time after `vi.advanceTimersByTimeAsync(25_000)`).

**Severity:** LOW (both are narrow edge cases in an already well-tested
file). **Confidence:** Likely (absence-of-test confirmed by reading; not
independently verified that a regression would actually manifest).

---

## TEST4-07 — LOW / Needs-validation: migrate.js's accepted "loud failure" trade-off is unexercised

**Location:** `apps/web/scripts/migrate.js:857-871` (C3-01 fix, `285a4538`).

The fix's own comment accepts a specific trade-off: when the above-cursor
pending tail is left un-baselined and `reconcileLegacySchema` already
mirrors its DDL, `drizzle.migrate()` "can fail loudly on duplicate DDL... a
loud deploy failure the operator resolves by hand is strictly better than
silently dropping committed migration SQL." `main()`'s error handling
(`migrate.js:918-936`) is structurally sound for propagating that failure
(`process.exitCode = 1`), confirmed by reading — but no test in
`migrate-pending-migrations.test.ts` or `migrate-reconcile-coverage.test.ts`
exercises this specific scenario end-to-end (mocked `drizzle.migrate()`
rejecting on duplicate-DDL, verifying `main()` surfaces it rather than
swallowing it). This is a reasonable scope boundary — it sits close to
integration-test territory given the existing mock strategy only records
query calls rather than modeling `drizzle.migrate()`'s SQL execution — but
it is the exact bet the cycle-3 fix is making, and it's currently unproven.

**Severity:** LOW (defense-in-depth already exists at the `main()` level;
this would only add proof the specific new trade-off path reaches it).
**Confidence:** Needs-validation.

---

## Verified-clean (do not re-derive next cycle)

- **C3-01 migrate.js mixed-batch fix** (`migrate-pending-migrations.test.ts`
  "MIXED batch" test, lines ~139-160): genuinely behavioral, drives the real
  `prepareLegacyDatabaseIfNeeded` with a mocked connection and asserts only
  the below-cursor hash is inserted. TEST3-03 is properly closed, not just
  string-pinned (the file mixes a source-text describe block for the
  wiring/comment invariants with real behavioral tests for the logic — a
  good pattern other files should follow).
- **C3-02/C3-03 single-writer-guard** (17 tests): thorough, correct fake-
  timer usage throughout (no real `setTimeout` waits), covers acquire/
  contend/reprobe/keepalive-failure/error-paths/idempotency/instrumentation
  wiring. Only the two narrow gaps in TEST4-06 remain.
- **C3-07 embedding-scan cursor persistence**
  (`image-queue-embedding-bootstrap-cap.test.ts`, cursor-persistence
  describe block): genuine 2-invocation test proving resume-past-prefix and
  wraparound-to-0-on-clean-completion, not a source pin.
- **WP9 retry-timer tracking + clamp warning**
  (`image-queue-gc-timer-reinit.test.ts`'s retry-timer describe block):
  genuine spy-based tests (`clearTimeout`/`clearInterval` call assertions),
  not string matching.
- **WP11 coverage batch** (`not-found-layout-restore-maintenance.test.ts`,
  `clip-inference.test.ts`, `csp-nonce.test.ts`,
  `settings-normalization.test.ts`): all four are 100% behavioral — zero
  `readFileSync` usage across any of them. TEST3-01/04/05 are cleanly
  closed, not converted into ossification-metric contributors.
- **TEST3-02 (photo-navigation zero behavioral tests)**: closed by a real
  Playwright spec dispatching synthetic `TouchEvent`s and asserting DOM
  state — see TEST4-05 for the one remaining narrow gap (non-swipe trigger
  path), but the "zero tests" finding itself is resolved.
- **Flakiness spot-check**: ran `single-writer-guard.test.ts`,
  `image-queue-embedding-bootstrap-cap.test.ts`,
  `gallery-config-uncached-microcache.test.ts`, and
  `image-queue-gc-timer-reinit.test.ts` three times each (30 tests/run) —
  30/30 passed every run, no order-dependence or timing flakiness observed.
  Fake-timer usage across all four is correct (`vi.useFakeTimers()` /
  `vi.advanceTimersByTimeAsync()` paired with `vi.useRealTimers()` in a
  `finally`), no real-clock `setTimeout` waits found in any of the cycle-3
  additions.

---

## Summary

| ID | Severity | Confidence | Title |
|---|---|---|---|
| TEST4-01 | HIGH | Confirmed (reproduced) | `serve-upload.test.ts` fd-close assertion for 304/HEAD is a false positive post-PERF3-07 |
| TEST4-02 | MEDIUM | Confirmed | Micro-cache "does not cache a failed read" test doesn't test its own claim; fallback IS cached |
| TEST4-03 | LOW-MED | Confirmed | Ossification ratio flat (145/335, 43.3%) but count still growing; root cause (no component-behavior harness) unaddressed |
| TEST4-04 | LOW | Likely | e2e single-session merge trades diagnostic granularity for flake-avoidance; root shared rate-limit fragility remains |
| TEST4-05 | LOW | Likely | photo-navigation in-place-reset fix untested via button/keyboard trigger, only swipe |
| TEST4-06 | LOW | Likely | single-writer-guard: untested `.unref()` invariant + stop-during-reprobe-window race |
| TEST4-07 | LOW | Needs-validation | migrate.js's accepted loud-failure trade-off (duplicate-DDL on pending tail) unexercised end-to-end |
