# Aggregate review — Run-4 Cycle 12

Per-angle provenance files in this directory:
- `code-reviewer-debugger-tracer.md`
- `security-reviewer-critic-verifier.md`
- `perf-reviewer-architect.md`
- `test-engineer.md`
- `document-specialist.md`
- `designer.md`

NOTE: This cycle runs as a single orchestrator-spawned subagent; nested
Agent/Task spawning is unavailable in this context (same documented
constraint as run2/run3/run4-c1..c11). Each angle was executed as a distinct
full-inventory in-context pass; no angle sampled. Inventory: independent
line-level regression review of the cycle-11 fix commit (`17b18321`
view-count flush entry-null + re-arm) and its locking test; rotation to the
least-run-4-covered shutdown/maintenance surface — the restore quiesce path
(`image-queue.ts` quiesce/drain/bootstrap, `queue-shutdown.ts`,
`restore-maintenance.ts`, `db-actions.ts` restore window,
`upload-processing-contract-lock.ts`) — with the installed `p-queue@9.1.2`
source read line-by-line as the authoritative dependency reference; plus the
upload-quota path (tracker state/claim/settle), `serve-upload.ts`,
`session.ts`, `admin-tokens.ts`, `proxy.ts`, datetime helpers, and pattern
sweeps (other setTimeout-armed flush machines — none; all four `onIdle`
call sites and their queue lifecycles; floating promises in the queue job —
none).

## Context
C11 closed the view-count flush self-strand. C12's rotation found a sibling
self-wedging state machine one layer down: the DB-restore quiesce awaits an
event a paused non-empty p-queue can never emit, introduced 2026-05-06 by a
commit whose stated p-queue semantics were inverted.

## Cross-angle agreement
- **COR-R4C12-01** — flagged by code/debugger/tracer (deadlock + causal
  trace to `c6627ec8`), security/critic/verifier (admin-triggered process-wide
  self-DoS; falsifies the documented restore-recovery property; p-queue
  source-verified), perf/architect (2-of-10 pool connections leaked while
  hung; three `onIdle` consumers / two paused-queue orderings — converge on
  the drain order), test-engineer (every existing fake queue stubs an
  always-resolving `onIdle`, which is exactly why the regression passed the
  suite), document-specialist (CLAUDE.md "never wedges the next attempt"
  claim holds only for crashes, not hangs — code fix restores the claim),
  designer (UI presents the hang as an unbounded spinner; UI itself correct,
  no client-side timeout wanted). 6/6 angles.

## Merged finding list

| ID | Sev/Conf | Title | Source angles |
|----|----------|-------|---------------|
| COR-R4C12-01 | **HIGH/High (CONFIRMED)** | `quiesceImageProcessingQueueForRestore` (`lib/image-queue.ts:673-694`) runs `pause(); await queue.onIdle(); clear()`. p-queue 9.1.2 emits `idle` only when `size===0 && pending===0` (`#tryToStartAnother`; `clear()`), and a PAUSED queue can never drain `size` to 0 — so with ≥1 queued job (trivially reachable: batch-upload N≥2 photos at QUEUE_CONCURRENCY=1, then restore while processing), the await never resolves. The hung `restoreDatabase` action never reaches its `finally`: `endRestoreMaintenance()` never runs (uploads/processing/view-buffering suppressed process-wide), `LOCK_DB_RESTORE` + upload-contract lock connections (2 of 10) are held forever, and every later restore fails fast — recovery requires a container restart. Introduced by `c6627ec8` (2026-05-06), which replaced the original, deadlock-free `onPendingZero()` (emitted unconditionally at `pending===0`, pause-independent — the commit message asserted the opposite of p-queue's actual semantics). Fix: reorder to the proven drain shape `pause(); clear(); <state clears>; await onIdle()` — identical post-quiesce guarantee (no job running when the import starts; queued work intentionally dropped and re-discovered by the post-restore bootstrap), zero hang paths. | code, security, perf, test, document, designer |
| TEST-R4C12-01 | gap/High | No test pins quiesce call ORDER and every fake queue's `onIdle` always resolves (cannot represent a paused queue) — folds into COR-R4C12-01: add a behavioral order test + a paused-queue-semantics fake whose `onIdle` resolves only after `clear()`, failing FAST (reject, not hang) on regression | test |
| DOC-R4C12-01 | MED/High | CLAUDE.md "a crashed restore never wedges the next attempt" excludes the hang mode — resolved by the code fix, no doc edit needed (claim becomes true again); recorded for provenance | document |
| DOC-R4C12-02 | LOW/High | `c6627ec8` commit message documents inverted `onPendingZero` semantics — correction recorded in review + fix-commit body (history is immutable per repo policy) | document |
| DES-R4C12-A | resolved-by-backend-fix | Restore UI `isPending` spinner is unbounded under the hang; UI behavior is correct per its contract — no client-side timeout (would mask slow-but-legitimate large restores) | designer |

## Non-scheduled observations (recorded in the deferred ledger)
- **OBS-R4C12-E** (security angle, LOW/Medium) — `serve-upload.ts:209-211`
  If-None-Match comparison is exact-string (weak `W/` prefix included), not
  RFC 9110 weak comparison. Browsers echo tags verbatim; worst case is a
  full 200 instead of a 304 via a strength-rewriting intermediary.
- **OBS-R4C12-B** (security/critic, INFO — invariant note) — the upload
  quota check→claim span in `uploadImages` crosses awaits but is shielded by
  the EXCLUSIVE upload-processing-contract lock serializing whole upload
  actions; must be made contiguous if that lock is ever narrowed.
- **OBS-R4C12-C** (code angle, LOW/Medium) — claim-retry timers
  (`image-queue.ts:275`) are untracked and survive quiesce; currently safe
  via the maintenance gate + row re-check; note for future refactors.
- **OBS-R4C12-D** (code angle, INFO) — `data.ts:83` `!viewCountFlushTimer`
  is tautological after the c11 entry-null; harmless symmetry, no churn.

## Regression review of cycle-11 commit — SOUND
`17b18321` verified at line level: entry-null precedes the guard; the
isFlushing branch re-arms with backoff + `.unref()`; the finally guard
correctly skips when the early-branch already re-armed; empty-buffer paths
converge. The pattern does not recur elsewhere (`data.ts` is the only
setTimeout-armed flush machine in `src/`). No follow-on work.

## Standing deferrals re-audit (exit criteria un-triggered this cycle)
- DEF-R4C11-A (aria-live constant string) — `photo-navigation.tsx` untouched.
  Remains deferred (plan-294).
- DEF-R4C10-A (stripGpsFromOriginal extension trust), DEF-R4C10-B (OnThisDay
  server-calendar-day) — surfaces untouched. Remain deferred (plan-292).
- DEF-R4C1-01 / DEF-R4C2-01 / DEF-R4C3-01 (LR PAT breadth / scopes / English
  errors) — no LR surface change. Remain deferred.
- OPS-R4C6-01 (host nginx `/uploads/` block, MED/High preserved) — no host
  nginx maintenance this cycle. Remains deferred (plan-284 runbook intact).
- DEF-R4C8-A/B/C/D (paid-download GET bodies, interstitial 410, ImageZoom
  passive preventDefault, Tailwind `columns-${n}` safelist) — untouched.
  Remain deferred (plan-288).
- Histogram mode-cycle aria-label (since plan-286) — remains deferred.

## Gate baseline (clean tree)
- vitest baseline expected 1745 passed / 182 files (plan-293 record); all 8
  gates run during PROMPT 3 after the fix lands.

## HARD-SCOPE check
No finding proposes edit / culling / scoring / preset features. The one
scheduled fix restores the existing restore-window liveness guarantee.

## AGENT FAILURES
None. All angles completed in-context (single-subagent constraint documented
above); no spawn retries required.
