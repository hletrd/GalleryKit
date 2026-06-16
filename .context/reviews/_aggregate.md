# Aggregate Review — Run 6 / Cycle 4 (review-plan-fix loop)

**HEAD:** f8147868
**Date:** 2026-06-16
**Agents fanned out (11/11 returned, 0 failures):** code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer

This aggregate dedupes overlapping findings across all 11 agents, preserving the **highest** severity/confidence of any duplicate, and notes cross-agent agreement (multi-agent corroboration = higher signal). Per-agent files retained as-is for provenance.

---

## Headline

**Honest convergence, confirmed by independent re-verification.** Cycle 4 of a system that closed ~58 findings across runs 4–6. Ten of eleven agents returned **zero new actionable findings** from their angle and re-confirmed the prior-cycle closures + deferrals are factually correct at HEAD f8147868:

- **security-reviewer:** Risk LOW. 0 Crit / 0 High / 0 Med / 0 Low new. Three parallel deep audits (auth/crypto, injection/path/SSRF, privacy/data-layer) all CLEAN with file:line evidence. Lint gates read line-by-line and confirmed hardened.
- **perf-reviewer:** 0 new. The 10-commit cycle-3→4 delta has no perf-relevant logic change to any hot path; hot-path files byte-identical to prior review.
- **code-reviewer:** 0 actionable / 1 cosmetic nit. Debunked a batch of CLIP false-positives from its own Explore sub-agents (audit trail preserved in its file).
- **critic:** ACCEPT. All prior-cycle fixes verified correct AND complete; 4 core invariants challenged, all hold. 1 minor (the Switch comment drift).
- **verifier:** 10/10 load-bearing claims VERIFIED, 0 CONTRADICTED. 226 tests passed, typecheck clean. Switch geometry verified by box-model math; sidecar exit code verified at source.
- **architect:** 0 new. Client/server boundary clean across all 62 `'use client'` files (zero client→server-only chains). The AGG-C3-18 re-export trap is CLOSED and regression-pinned by `wide-gamut-predicate-wiring.test.ts`.
- **debugger:** 0 Crit/High/Med/Low new. Core failure surface (queue error paths, Sharp catch/finally cleanup, SW LRU, GPS-strip bounds, analytics `.catch()` guards, env coercion NaN-safety) mature and leak-free.
- **document-specialist:** 0 open mismatches. ~40 load-bearing CLAUDE.md claims verified accurate at HEAD; i18n parity programmatically confirmed (en=840 / ko=840 keys; en 5 plural blocks, ko 0 — exactly the DOC-R5C3-07 convention).
- **designer:** 0 Crit/High/Med/0 new Low (static-only — dev server couldn't boot without MySQL/env). Both prior-cycle UI fixes verified correct by geometry + contrast math; proactive contrast sweep of all raw color literals clears AA in both themes.

**The entire new surface is one test-quality cluster** (a real flaky test + two missing-regression-test gaps on the prior-cycle fixes) plus **one bounded LOW edge** in the prior-cycle sidecar backfill fix, plus **one zero-impact cosmetic comment drift** corroborated by 6 agents. No security/correctness/data-loss landmine survived verification.

---

## MERGED FINDINGS (deduped, severity = max across agents)

### HIGH

#### AGG-C4-01 — `image-queue-bootstrap.test.ts` is genuinely flaky under full-suite load (HIGH, High)
- **Agents:** test-engineer (TE-C4-01). Corroborated by orchestrator-owner re-verification (failed 2/2163 in run 1, passed 0/2165 in run 2 at the SAME HEAD with no code change → confirmed non-deterministic).
- **File:** `apps/web/src/__tests__/image-queue-bootstrap.test.ts:165` (and the heavy `await import('@/lib/image-queue')` at `:104` pulled inside each test's window).
- **Problem:** Test 2 ("continues scanning after the previous batch cursor…") does `await vi.waitFor(() => expect(limitMock).toHaveBeenCalledTimes(2))` with **no explicit timeout** → Vitest defaults `vi.waitFor` to ~1000 ms. The continuation that fires the 2nd `limit()` call is scheduled off a `queueOnIdle` promise resolution and re-runs the scan path; under a contended full 233-file suite run (sharp/clip/db transitive import graphs competing for CPU) the 2nd call can land after the 1s default. Verified empirically: isolated run passes 3/3 in ~3.4 s; full-suite run failed ~50% of the time in `image-queue-bootstrap.test.ts`. The repo **already has the fix pattern**: `admin-backfill-runner-*.test.ts` uses `vi.waitFor(..., { timeout: 20_000, interval: 25 })` + completion-signal polling, documented there as the R4C1 fix for this exact flake class. The bootstrap suite was never migrated.
- **Blast radius / harm:** A flaky gate is a LIVE problem — a real bootstrap-continuation regression (later rows starved, cursor logic broken) would be dismissed as "the usual flake," and a green CI run is no longer trustworthy. This is the highest-value finding of the cycle precisely because it degrades the gate the whole loop depends on.
- **Fix:** Add an explicit generous timeout + small interval to the `vi.waitFor` at `:165` (mirror the `admin-backfill-runner` pattern: `{ timeout: 20_000, interval: 25 }`). Optionally also assert on a deterministic completion signal (`getProcessingQueueState().bootstrapped === true`) rather than the call count, so the wait is keyed on the observable end-state. Do NOT inflate global test timeouts — fix the one under-specified wait.
- **Confidence:** High (root cause read in source; flake reproduced empirically at HEAD).

### MEDIUM

#### AGG-C4-02 — Switch geometry fix has no regression test pinning thumb-travel/track geometry (MEDIUM, High)
- **Agents:** test-engineer (TE-C4-02), tracer (TRC-C4-03 INFO — same gap).
- **File:** `apps/web/src/components/ui/switch.tsx:16,41-49`; gap = no test under `apps/web/src/__tests__/`.
- **Problem:** The cycle-3 fix for the "half-on switch" defect (AGG-C3-01, commit a3b8c557) rests on a silent Tailwind arithmetic coincidence: visible track `w-11` (44px) with `px-0.5` (→ 40px inner content box), `size-5` thumb (20px), `translate-x-full` (= 100% of the thumb's own 20px width = exactly the 40−20 remaining travel) → flush edge-to-edge. If a future edit changes the thumb to `size-6`, the track padding, or the travel class, the half-on defect silently returns: the touch-target audit (which only checks the ≥44px hit-zone) stays green, and the unit suite has nothing pinning the visible geometry. The defect that just cost a fix would regress invisibly.
- **Fix:** Add a source-inspection fixture (mirroring the touch-target-audit / sw-template-contract pattern) that reads `switch.tsx` and asserts the three load-bearing classes co-vary: visible-track inner width, thumb size, and travel must remain a consistent triple (e.g. assert the track is `w-11`+`px-0.5`, thumb is `size-5`, travel is `translate-x-full`; OR assert thumb-size and travel are derived from the same inner-width constant). The goal is to make a geometry regression a red test, not a visual surprise.
- **Confidence:** High (gap confirmed; the silent-coincidence failure mode is concrete).

#### AGG-C4-03 — Sidecar backfill `main()` exit-code path is the untested half of the cycle-3 fix (MEDIUM, High)
- **Agents:** test-engineer (TE-C4-03).
- **File:** `apps/web/scripts/backfill-color-pipeline.ts:439,453,464-470,485`; existing test `backfill-detection-failure-contract.test.ts` covers `reprocessRow`'s data branch only.
- **Problem:** The cycle-3 fix (AGG-C3-04, commit a033056d) added a `detectionFailures` counter and `process.exit(errors > 0 || detectionFailures > 0 ? 1 : 0)` at `:485` — that exit-code/summary behavior **is the entire point of the fix**, yet no test exercises `main()`'s counting or exit-code computation. `backfill-detection-failure-contract.test.ts` only pins that `reprocessRow` returns `derivativeOnly` (the data-integrity half). A regression in the counter increment, the WARN, or the exit-code expression would ship green.
- **Fix:** Extract a pure `computeBackfillExitCode({ errors, detectionFailures })` helper and unit-test the matrix (0/0→0, errors>0→1, detectionFailures>0→1, both→1). Optionally also unit-test the counter-increment branch selection. Keep the resume contract unchanged (no `pipeline_version` bump on detection failure — that is correct and already pinned).
- **Confidence:** High (coverage gap confirmed by reading the test vs the SUT).

### LOW (fix this cycle)

#### AGG-C4-04 — Sidecar `detectionFailures` not decremented for rows deleted mid-reencode → spurious non-zero exit (LOW, High)
- **Agents:** tracer (TRC-C4-01). Confirmed by orchestrator-owner direct read of the source.
- **File:** `apps/web/scripts/backfill-color-pipeline.ts:413-414` (flushBatch deleted-mid-reencode adjustment) vs `:439` (per-row `detectionFailures++`) vs `:485` (exit code).
- **Problem:** `detectionFailures++` fires per-row in the queue task when `result.derivativeOnly` is set (`:439`). Later, in batched `flushBatch`, rows whose `UPDATE … WHERE pipeline_version < CURRENT` affected 0 rows are identified as deleted-mid-reencode and `processed` is decremented + `deletedMidReencode` incremented (`:413-414`) — but `detectionFailures` is **never** walked back. So a row that (a) had color detection fail after a successful encode (→ `detectionFailures++`) AND (b) was then deleted before its derivative UPDATE committed will leave `detectionFailures > 0` even though the row no longer exists. The new `process.exit(errors > 0 || detectionFailures > 0 ? 1 : 0)` at `:485` then exits **non-zero for a row that is gone** — a CI/cron wrapper needlessly retriggers an idempotent backfill. Bounded, NOT data-integrity (the resume contract is intact; the row was correctly deleted). The **in-app runner is clean** — it returns `deleted-mid-reencode` before `detection-failed` as mutually-exclusive outcomes; the asymmetry exists only because the sidecar batches DB writes decoupled from the per-row encode.
- **Fix:** When `flushBatch` reclassifies a row as deleted-mid-reencode, also decrement `detectionFailures` if that row had been counted as a detection failure. Cleanest approach: track per-batch which `derivativeBatch` entries were detection-failures, and on the deleted-mid-reencode partition subtract the overlap from `detectionFailures` (and surface a `deletedMidReencode` count in the summary, which is already logged). Pairs naturally with AGG-C4-03's `main()` testability refactor — pin the corrected accounting with the same test.
- **Confidence:** High (asymmetry verified by direct source read; the in-app-runner contrast confirms it's a sidecar-only batching artifact).

#### AGG-C4-05 — `switch.tsx:14` header comment cites a travel form the code does not use (LOW/cosmetic, High — 6-agent corroboration)
- **Agents:** code-reviewer (NIT-1), critic (MINOR-1), verifier (NIT), tracer (TRC-C4-02), debugger (cosmetic nit), designer (noted). **6 independent agents flagged the same line** — highest cross-agent corroboration of the cycle, even though impact is zero.
- **File:** `apps/web/src/components/ui/switch.tsx:13-14` (top docblock) vs `:49` (code) + `:41-44` (correct inline comment).
- **Problem:** The top docblock added by the cycle-3 Switch fix says the thumb travels via `translate-x-[calc(100%-2px)]`, but the shipped code uses `translate-x-full`, and the inline comment at `:41-44` documents `translate-x-full` accurately. **The CODE is the correct value** — `translate-x-full` (100% of the thumb's own 20px width) is exactly right for the 40px inner box; `calc(100%-2px)` would actually under-travel by 2px and re-introduce a (tiny) gap. So the fix is: correct the **comment** to match the code, NOT the other way around. Zero runtime impact; pure comment-vs-code drift — ironic because it landed in the very commit that fixed a comment-drift trap elsewhere (the serve-upload ETag de-enumeration).
- **Fix:** Edit the `:13-14` header comment to cite `translate-x-full` (or remove the specific-class citation and defer to the inline comment). Do NOT touch the code.
- **Confidence:** High (fact) / cosmetic (impact). Worth the one-line fix purely because 6 agents independently tripped over it — it is actively misleading the next reader.

---

## DEFER candidates (re-confirmed from prior cycles — NOT re-reported as new)

Every agent re-validated the prior-cycle deferred register (`plan-353`) at HEAD and confirmed the reasoning is still factually correct. These remain deferred under their existing exit criteria; this cycle's deferred register (`plan-356`) carries them forward unchanged:

- **AGG-C3-08** (LOW) orphaned `original/{uuid}` on SIGKILL — disk-bloat only; tracer + debugger re-confirmed.
- **AGG-C3-09** (LOW) upload-tracker quota not released in outer `finally` — framework-only trigger; debugger re-confirmed reasoning sound.
- **AGG-C3-10** (LOW-MED perf) sRGB metadata-decode discard at `process-image.ts:1019-1022` — perf-reviewer re-checked anchor; code self-documents the tradeoff at `:1007-1013`.
- **AGG-C3-11/12/13** (LOW perf) admin OFFSET pagination / SW HEAD probe / misc filesort+unindexed+correlated-subquery+re-render — perf-reviewer re-checked every anchor at HEAD; all present, unchanged, deferral correct.
- **AGG-C3-14/15/16/17** (HIGH/MED structural) `@/lib/storage` dead weight / restore-flag process-local / `reconcileLegacySchema` mirror / `actions/images.ts` god-action + LR dup — architect re-confirmed each remains bound by CLAUDE.md's documented single-instance topology + storage-retention decision; both upload paths unchanged-since-baseline (no new divergence).
- **AGG-C3-19/20/21/22/23** (MED/LOW test) processing-claim race harness / untested admin-mutation actions / analytics-data tests / data-tag-names inline rebuild / e2e payment gaps — test-engineer re-confirmed all validly deferred.
- **AGG-C3-24..30** (LOW/INFO designer) timeline/year touch title / lightbox spinner role=status / histogram compute live region / 4→3 `outline-blue-500` / InfoBottomSheet empty pill / TopicManager DialogDescription / `ui/sheet.tsx` dead code — designer re-checked; reasoning holds. (Note: designer found the `outline-blue-500` scope shrank from 4 to 3 spots — `:189` already migrated to `ring-white/50` — a net-positive drift, not a new finding.)
- **AGG-C3-31/32/33** (MED operational / LOW defense-in-depth / LOW cosmetic security) git-history secret / SQL-restore comment bypass / admin-token `last_used_at` ordering — security-reviewer re-confirmed all three factually correct at HEAD; HEAD `.env.local.example` is placeholder-only with zero live secret literals.

**CLOSED — do NOT re-plan (re-verified at HEAD):** all 8 cycle-3 scheduled fixes (06a3c5e7..0ef29a10) landed correctly; settings-hash 9 keys; cache() 10 functions; OG SSRF pin; Stripe card-only pin; bidi/zero-width stripping; SW LRU; map LIMIT; serve-upload FD leak; CLIP embedding round-trip; the AGG-C3-18 re-export trap (closed + regression-pinned).

---

## DISPOSITION SUMMARY (for PROMPT 2 planning)

**FIX THIS CYCLE (concrete, verified, worth-fixing):**
- AGG-C4-01 — image-queue-bootstrap flake (HIGH) — the gate-trust fix; highest value.
- AGG-C4-02 — Switch geometry regression test (MED) — pins the just-fixed defect.
- AGG-C4-03 — sidecar `main()` exit-code test + extract helper (MED).
- AGG-C4-04 — sidecar `detectionFailures` deleted-mid-reencode decrement (LOW) — pairs with C4-03.
- AGG-C4-05 — switch.tsx:14 comment drift (LOW/cosmetic) — fix the comment, not the code.

**DEFER (carried forward unchanged):** AGG-C3-08..33 per `plan-353` (re-confirmed correct at HEAD by the relevant specialist agents). No NEW deferrals this cycle.

**HARD GUARD honored:** CLIP semantic search remains disabled-by-design; **no agent proposed activation**. Disable/heal logic re-verified correct (verifier: `gallery-config.ts:143-145` heals stored `production`→`disabled` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`).

---

## AGENT FAILURES

None. All 11 agents were dispatched in a single concurrent batch and all 11 returned successfully on the first attempt, each writing its per-agent file. No retries needed.
