# Test-Engineer Review — Run 6 / Cycle 5

**ZERO new actionable findings. Honest convergence: every cycle-4 test fix verified CLOSED at HEAD, every recent code fix already ships with a non-vacuous regression test, no new flake class found, full suite green under a slow/contended run (the exact condition that previously triggered the cycle-4 flake).**

**HEAD:** 2f603716 (branch master, working tree CLEAN before this write)
**Date:** 2026-06-16
**Angle:** test coverage gaps on recent fixes, genuinely flaky tests, security-invariant pinning, assertions that don't assert.

---

## Test-run result

`npm test --workspace=apps/web` (single run, this HEAD):

| Metric | Result |
|--------|--------|
| Test files | **233 passed / 1 skipped (234)** |
| Tests | **2178 passed / 2 skipped (2180)** |
| Duration | **205.76s** (transform 138.68s, import 732.84s, tests 86.25s) |

The 205s duration is on the SLOW end of the observed range — and is precisely the high-contention condition under which the cycle-4 bootstrap flake (TE-C4-01) used to fail ~50% of the time. `image-queue-bootstrap.test.ts` passed clean under this slow run. That is strong empirical confirmation the cycle-4 flake fix held.

**The 1 skipped file / 2 skipped tests are a legitimate env-gate, not a silently-disabled real test:** `clip-semantic-integration.test.ts:31` does `const d = RUN ? describe : describe.skip` keyed on `CLIP_INTEGRATION === '1'` (model weights unavailable in CI). This is the ONLY skip in the entire suite (`grep describe.skip|it.skip` → 1 file). Per the HARD GUARD I do not flag CLIP being disabled.

---

## Cycle-4 fixes — VERIFIED CLOSED at HEAD (do NOT re-report)

The cycle-4 review's three findings (TE-C4-01/02/03 + the LOW AGG-C4-04) all landed in f8147868..HEAD and are correctly + completely tested:

### TE-C4-01 — flaky bootstrap wait — **CLOSED, empirically verified held**
- `6ab40644` rewrote `image-queue-bootstrap.test.ts:173` from a bare `vi.waitFor(...)` to `vi.waitFor(() => { expect(limitMock).toHaveBeenCalledTimes(2); expect(getProcessingQueueState().bootstrapped).toBe(true); }, { timeout: 20_000, interval: 25 })` — the proven R4C1 admin-backfill-runner pattern, plus keying on the deterministic `bootstrapped` end-state.
- **Suite-wide flake-class sweep is now CLEAN:** I enumerated every `vi.waitFor` call site (9 across 6 files). ALL carry an explicit `{ timeout, interval }` (eight at `{20_000, 25}`, one batching helper at `{5000}` which completes fast). Zero bare default-timeout waits remain. There are ZERO real-timer sleeps in any test (`setTimeout(resolve` / `new Promise(...setTimeout` → 0 hits) — the suite uses `vi.waitFor` + fake timers, not arbitrary sleeps. This was the cycle-4 headline flake class; it is fully eradicated, not merely patched in one file.

### TE-C4-02 — Switch geometry regression test — **CLOSED, non-vacuous**
- `9a262e3f` added `switch-geometry-contract.test.ts` (99 lines). It pins the load-bearing triple (track `w-11`+`px-0.5`+`h-6`, thumb `size-5`, travel `translate-x-0`/`data-[state=checked]:translate-x-full`) AND forbids the AGG-C3-01 regression (`not.toMatch(translate-x-5)`). The docblock explicitly documents the test is proven non-vacuous (flipping thumb→`size-6`, travel→`translate-x-5`, or dropping `px-0.5` each flips an assertion RED). This is a correct source-inspection pin in the established `touch-target-audit` / `sw-template-contract` idiom.

### TE-C4-03 + AGG-C4-04 — sidecar exit code + detectionFailures walk-back — **CLOSED**
- `1fd350be` extracted two pure exported helpers and unit-tested both matrices in `backfill-color-pipeline-deleted-mid-reencode.test.ts`:
  - `computeBackfillExitCode({errors, detectionFailures})` — full matrix `{0,0}→0`, `{2,0}→1`, `{0,3}→1`, `{1,1}→1` (behavioral, not source-match).
  - `countDeletedMidReencodeDetectionFailures(derivativeResults)` — `[{1},{0},{0}]→2`, `[{1},{1}]→0`, `[]→0` (behavioral).
  - Source-shape pins that `flushBatch` decrements via the helper and `main()` routes `process.exit` through `computeBackfillExitCode`.
- I read the SUT (`backfill-color-pipeline.ts:397-461`): `updateResults` pushes all success `items` first (`:422`) then all `derivativeItems` (`:431`), so `updateResults.slice(items.length)` (`:454`) recovers exactly the detection-failure partition. Offset is correct.

---

## Recent code fixes (prompt commit list) — each already has a non-vacuous regression test

All five referenced commits predate cycle-4 (run-6 cycle-1 / run-5 cycle-3) and are ancestors of HEAD. Each shipped WITH its guard:

| Commit | Fix | Regression test (verified present + non-vacuous) |
|--------|-----|--------------------------------------------------|
| `170297ed` | strip ALL bidi in OG/JSON-LD (`/g` flag) | `sanitize-for-og-global.test.ts` — pins multi-char strip behaviorally **and** structurally forbids `.replace(UNICODE_FORMAT_CHARS,` in all 3 consuming files. Exemplary; hardened further in run-8 lineage. |
| `13ae79ca` | report real `processed` + surface fatal errors | `admin-backfill-runner-fatal-counters.test.ts` + `admin-backfill-status-shape.test.ts` |
| `5b5de9d3` | gate backfill-status mount fetch + drop unused import | `photo-title-stub-prefix-strip.test.ts` + `client-server-only-boundary.test.ts` |
| `bb463062` | pin journal when-monotonicity + silent-skip post-condition | `migration-journal-monotonicity.test.ts` — pins forward monotonicity (with documented idx-7 allowlist + anti-drift guard), the post-condition predicate shape, AND the loud-fail `Drizzle silently skipped` throw in `migrate.js`. Directly closes the CLAUDE.md-documented production footgun. |
| `8b979687` | refresh SW_VERSION stamp | build-artifact stamp; covered by `sw-template-contract.test.ts` |

The `6ab40644`/`9a262e3f`/`1fd350be` cluster is the cycle-4 fixes (covered above).

---

## Considered and deliberately NOT raised (avoiding convergence churn)

- **Sidecar `flushBatch` `slice(items.length)` partition offset is not directly behaviorally tested** (only the helper + a source-shape pin). I assessed this and it does NOT meet the worth-adding-a-test bar: (a) the identical detection-failure∩deleted-mid-reencode semantic IS behaviorally locked on the PRODUCTION path (`admin-backfill-runner-deleted-mid-reencode-detection-failure.test.ts` forces `detectColorSignals` to throw AND `affectedRows:0`, then asserts outcome `deleted-mid-reencode`, no version bump, banner down); (b) the sidecar is the secondary `--rm`-container path; (c) the push-order assumption is documented in the `:445-453` comment; (d) an end-to-end sidecar test would require mocking the whole `db.transaction`+queue closure for marginal delta over the existing production-path behavioral test. Forcing it would be exactly the "more coverage would be nice" churn the convergence mandate forbids. **No finding.**
- **Prior-cycle deferred test register (AGG-C3-19..23):** processing-claim race harness, untested admin-mutation actions, `analytics-data.ts` tests, `data-tag-names` inline rebuild, e2e payment gaps — all re-confirmed validly deferred under unchanged exit criteria. No new disposition.

---

## Disposition

| ID | Severity | Conf | Status |
|----|----------|------|--------|
| (none) | — | — | Zero new actionable findings. |

**Summary count by severity:** 0 Critical / 0 High / 0 Medium / 0 Low.

**Test run:** `npm test --workspace=apps/web` → **233 files / 2178 tests passed, 1 file / 2 tests skipped (env-gated CLIP integration), 0 failed** in 205.76s. Cycle-4 bootstrap flake fix verified held under a contended slow run; no new flake class; all recent code + UI fixes carry non-vacuous regression tests; suite-wide `vi.waitFor` audit clean; no `.only` leaks; no real-timer sleeps. **HARD GUARD honored — did not propose activating CLIP semantic search.**
