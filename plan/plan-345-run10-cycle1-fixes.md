# Plan 345 — Run-10 Cycle-1 (orchestrator cycle 8/100) — Scheduled Fixes

**Created:** 2026-06-14
**HEAD at planning:** `9c40d261` (working tree clean, in sync with origin/master)
**Source:** `.context/reviews/_aggregate.md` (cycle-8 fan-out) + per-agent reviews
**Status:** COMPLETE — both items DONE (Item 2 `aa8a6f8a`, Item 1 committed below). All gates green; deployed per-cycle.

## Context

Cycle-8 deep review (11 agents) produced **2 genuinely-new findings**, both LOW / LOW-MED, continuing the convergence trend (12→13→17→9→5→6→5→2). No CRITICAL/HIGH/MEDIUM new defect from any agent. The cycle-7 fix batch (AGG-C7-01..05) was independently re-verified CLOSED and non-vacuous at HEAD by 9 agents (incl. verifier proving the WebP-XMP test RED by hand). This plan schedules the only two NEW items worth a change this cycle.

Both items are small. AGG-C8-01 is a TEST addition (no production code change) closing an entropy-test gap on a security-relevant primitive; AGG-C8-02 is a one-line doc edit. Repo policy applies to both when implemented: GPG-signed commits (`-S`), conventional-commit + gitmoji, no `Co-Authored-By`, `git pull --rebase` before push, fine-grained commits, all gates green before commit.

---

## Item 1 — AGG-C8-01: add a modulo-bias / distribution regression test for `generateBase56`

**Severity:** LOW-MED | **Confidence:** High | **Agents:** test-engineer (TE8-01)
**Status:** DONE

### Problem

`apps/web/src/lib/base56.ts:6-28` (`generateBase56`) is the SOLE share-key generator for BOTH photo shares (`actions/sharing.ts:127`, `PHOTO_SHARE_KEY_LENGTH`) and group shares (`actions/sharing.ts:239`, `GROUP_SHARE_KEY_LENGTH`) — it mints unguessable public-access tokens. It correctly implements rejection sampling: it rejects random bytes `>= 224` because `256 % 56 = 32`, and the top 32 byte-values `[224, 255]` would otherwise map disproportionately onto the first 32 of the 56 characters, biasing the distribution. The rejection loop (`do … while (randomValue >= 224)`) is the load-bearing correctness mechanism for uniform key entropy.

But `apps/web/src/__tests__/base56.test.ts` asserts only:
- length (`:5-9`),
- valid charset (`:11-16`),
- successive-differ (`:18-22`).

A regression that replaced the rejection-sampling loop with a bare `randomBytes(length)[i] % 56` would STILL pass all three assertions (correct length, valid charset, different each call) while weakening entropy. Test-engineer empirically simulated the naive variant: char-frequency max/min ratio **1.316** (biased) vs **1.057** for the correct rejection-sampled code. There is currently no test that would go RED on this regression.

### Failure scenario

A future "simplification" PR removes the rejection loop. All existing base56 tests stay green. Weakened-entropy share keys ship. Brute-force / enumeration of unlisted `/s/<key>` and `/g/<key>` URLs becomes marginally easier — and no test catches it. This is the same "security property invisible to the test" family the loop has repeatedly found (GPS-scrub branch coverage gaps in cycles 6-7).

### Fix

Add ONE deterministic distribution test to `apps/web/src/__tests__/base56.test.ts`:
- Generate a large sample (e.g. 200,000 chars via repeated `generateBase56` calls, or one big `generateBase56(200000)`).
- Tally per-character frequency across `BASE56_CHARS`.
- Assert the max/min char-frequency ratio is below a threshold that the correct code passes comfortably but a naive `%56` fails (e.g. `< 1.20` — correct code ≈ 1.057, naive ≈ 1.316).
- Optionally also assert every one of the 56 chars appears at least once at that sample size.

The test must be deterministic-enough to not flake: a 200k sample makes the correct-code ratio tightly bounded (well under 1.20) by the law of large numbers; pick the threshold with margin (1.20 gives ≈0.14 absolute headroom below the naive 1.316 and ≈0.14 above the correct 1.057). If any residual flake risk remains at 200k, raise the sample to 500k rather than loosening the threshold (root-cause, don't mask).

**Acceptance:** new test passes on current (rejection-sampled) code; would go RED if the rejection loop were removed (verify by a throwaway local mutation, then revert). `npm test --workspace=apps/web` green. `npm run typecheck --workspace=apps/web` green (it includes `src/__tests__/`).

### Progress

- [x] Add distribution test to `base56.test.ts` (500k-sample char-frequency, `max/min ratio < 1.20`, every-char-appears)
- [x] Verify GREEN on current rejection-sampled code (ratio ~1.04-1.06; isolated run 10/10 pass)
- [x] Verify RED against a naive `%56` mutation (local, reverted; base56.ts confirmed byte-identical to HEAD afterward) — the new test FAILED with `expected 1.3124... to be less than 1.2`, while the other 9 length/charset/differ tests stayed GREEN (proving they were blind to the regression)
- [x] Gates green (full vitest + typecheck)
- [x] Commit + push (GPG-signed, conventional + gitmoji)

**Implemented:** commit `__ITEM1_SHA__` — added a deterministic 500k-sample char-frequency distribution test to `base56.test.ts`. Empirically validated thresholds (500k samples, run 5×): correct rejection-sampled code ratio 1.0378-1.0601, naive `%56` ratio ~1.30; the 1.20 threshold sits safely between (non-flaky on correct code). RED-on-revert proven by mutating away the `while (randomValue >= 224)` loop. No production code change.

---

## Item 2 — AGG-C8-02: correct CLAUDE.md touch-target `SCAN_ROOTS` description

**Severity:** LOW | **Confidence:** High | **Agents:** critic (CRIT8-01)
**Status:** DONE

### Problem

`CLAUDE.md:505` (touch-target section, the "walks every `.tsx`/`.jsx` file under `SCAN_ROOTS`" sentence) describes `SCAN_ROOTS` as "`components/` + the admin route group `app/[locale]/admin/`".

**Ground-truth correction during implementation:** the critic's finding (CRIT8-01) claimed the real array ALSO includes "root-level `[locale]/{error,not-found,layout,loading}.tsx`". On reading the actual source this is INCORRECT — there is no such entry. The real `SCAN_ROOTS` at `apps/web/src/__tests__/touch-target-audit.test.ts:79-83` is exactly THREE directories: `componentsDir` (`components/`, `:43`), `adminDir` (`app/[locale]/admin/`, `:44`), and `publicDir` (`app/[locale]/(public)/`, `:51`). So the genuine doc gap is narrower than reported: the doc omits ONLY the `app/[locale]/(public)/` public route group (added to the test as R27-UX-LOW-1, cycle-4). The fix follows the CODE, not the inaccurate review claim.

This is the SAFE-direction inverse of a doc over-claim: the doc claims LESS coverage than the gate actually enforces, so nothing ships UNGUARDED because of it. Pure doc completeness.

### Fix

Update the `SCAN_ROOTS` description in CLAUDE.md:505 to add the third entry the test array actually scans: `app/[locale]/(public)/`. Final list: `components/` + `app/[locale]/admin/` + `app/[locale]/(public)/`. (Do NOT add the non-existent root-level locale files.)

**Acceptance:** CLAUDE.md sentence matches the live 3-entry `SCAN_ROOTS` array. No code change. (Docs-only.)

### Progress

- [x] Read the live `SCAN_ROOTS` array at fix time — confirmed 3 entries (`componentsDir`/`adminDir`/`publicDir`); critic's "root-level locale files" claim refuted
- [x] Update CLAUDE.md:505 to add `app/[locale]/(public)/`
- [x] Commit + push (GPG-signed, conventional + gitmoji)

**Implemented:** commit `aa8a6f8a` — CLAUDE.md:505 sentence updated from "`components/` + the admin route group `app/[locale]/admin/`" to add "+ the public route group `app/[locale]/(public)/`". Matches the live 3-entry array.

---

## Out of scope (deferred — see plan-346-run10-cycle1-deferred.md)

All record-only / re-confirmed-deferred tail items (TE8-02 mirror test, DBG8-NC-02 animated-lossless WebP note, CR8-01 stray probe already-deleted, DOC8-01 AGENTS.md gitignore nuance, the real-encode test-isolation flake, and the architecture/perf/designer/security/debugger re-confirmed deferrals AGG-C8-R5..R10) are recorded in the deferred plan with severity preserved and exit criteria stated. None is a non-deferrable security/correctness/data-loss finding.
