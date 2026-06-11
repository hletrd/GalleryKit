# Aggregate review — Run-4 Cycle 11

Per-angle provenance files in this directory:
- `code-reviewer-debugger-tracer.md`
- `security-reviewer-critic-verifier.md`
- `perf-reviewer-architect.md`
- `test-engineer.md`
- `document-specialist.md`
- `designer.md`

NOTE: This cycle runs as a single orchestrator-spawned subagent; nested
Agent/Task spawning is unavailable in this context (same documented
constraint as run2/run3/run4-c1..c10). Each angle was executed as a distinct
full-inventory in-context pass; no angle sampled. Inventory: independent
line-level regression review of BOTH cycle-10 fix commits (`208a8c7e`
GPS post-EOI trailer; `a5455047` admin-delete audit detach); rotation to the
least-run-4-covered correctness surface — the shared-group view-count
buffered-flush state machine in `lib/data.ts` and its three callers; full
reads of the paid surface (checkout + download + sales refund), the
smart-collection save→public-compile path, analytics referrer/geo sanitizers,
atom-feed composer, OG photo route + fetch helper, and the rate-limit helper
family; plus pattern sweeps (unradixed parseInt — none; floating promises in
flush/tracker — none; `audit_log` FK columns) and a clean-tree gate baseline.

## Context
C10 closed a GPS-in-post-EOI-trailer leak and the audit-FK that blocked
deleting any admin who had logged in. C11's one scheduled finding is in the
adjacent, rarely-stressed view-count flush machine: a timer that fires during
an in-flight slow flush early-returns without clearing its own handle, after
which the flush stops self-draining entirely until the process exits.

## Cross-angle agreement
- **COR-R4C11-01** — flagged by code/debugger/tracer (state-machine trace),
  perf/architect (availability facet: buffer grows to cap then drops), and
  test-engineer (no entry-null/re-arm invariant in the fixture suite).
  Document-specialist notes the existing CLAUDE.md analytics caveat covers
  *undercount* but not *stops-draining*; the fix restores the documented
  async-flush contract so no doc edit is needed.

## Merged finding list

| ID | Sev/Conf | Title | Source angles |
|----|----------|-------|---------------|
| COR-R4C11-01 | LOW/High (path) · Med (trigger freq) | `flushGroupViewCounts` (`lib/data.ts:63-66`) early-returns on `isFlushing` WITHOUT nulling `viewCountFlushTimer`. A page view that arms a timer during a flush running longer than `BASE_FLUSH_INTERVAL_MS` (5s, reachable under DB slowness) leaves a stale non-null handle: the in-flight flush's finally-reschedule guard (`!viewCountFlushTimer`) then skips, and every future `bufferGroupViewCount` refuses to arm a timer — so the buffer stops draining, grows to the 1000-cap, and silently drops increments until process exit. Best-effort analytics, hence LOW, but a self-stranding state machine (not merely the documented outage undercount). Fix: hoist `viewCountFlushTimer = null` above the `isFlushing` guard and re-arm a timer on the early-return when the buffer is non-empty. | code, perf, test, document |
| TEST-R4C11-01 | gap/High | No fixture invariant pins the entry-null / isFlushing-rearm — folds into COR-R4C11-01 | test |
| DOC-R4C11-01 | LOW/High | CLAUDE.md analytics caveat covers undercount, not stranded-stop — no edit needed post-fix, recorded for provenance | document |
| DES-R4C11-A | LOW/Med | `photo-navigation.tsx:247` aria-live region holds a constant string, so it never re-announces on prev/next navigation (pre-existing a11y no-op) | designer |

## Non-scheduled observations (record in deferred ledger)
- **DES-R4C11-A** — constant aria-live string never announces navigation;
  needs an i18n placeholder contract change, out of single-fix scope.
  (designer, LOW/Medium)
- Standing carry-forwards from plan-292 re-audited below.

## Regression review of cycle-10 commits — both SOUND
- `208a8c7e` (GPS post-EOI trailer): EOI-marker uniqueness in entropy data
  confirmed; progressive multi-SOS safe; conservative false-positive on a
  >2-pad-byte single-image JPEG is the documented privacy-preserving
  trade-off. No regression.
- `a5455047` (admin-delete audit detach): `audit_log.target_id` carries no FK
  (`schema.ts:173`), so NULL-ing `user_id` is the complete detach — the
  delete cannot FK-fail on any other audit column. Fix complete.

## Standing deferrals re-audit (exit criteria un-triggered this cycle)
- **DEF-R4C10-A** (plan-292) — `stripGpsFromOriginal` trusts file extension.
  No change to `stripGpsFromOriginal` this cycle; privacy never compromised
  (tier-2 strips all). Remains deferred.
- **DEF-R4C10-B** (plan-292) — OnThisDay server-calendar-day. No change.
  Remains deferred.
- **DEF-R4C1-01 / DEF-R4C2-01 / DEF-R4C3-01** — LR PAT route breadth / token
  scopes / English error strings. No LR route change this cycle. Remain
  deferred.
- **OPS-R4C6-01** (plan-284) — production host nginx `/uploads/` block. No
  host nginx maintenance this cycle. Remains deferred (MED/High preserved).
- **DEF-R4C8-A/B/C/D** (plan-288) — paid-download GET error bodies
  unlocalized; interstitial double-submit plain 410; ImageZoom passive
  preventDefault; dynamic Tailwind `columns-${n}` safelist. No change to those
  surfaces. Remain deferred.
- **Histogram mode-cycle aria-label** (since plan-286). Remains deferred.

## Gate baseline (clean tree)
- vitest **1744/1744 PASS** (182 files).
- typecheck / eslint / scanners / build / e2e: run during PROMPT 3 after fixes.

## HARD-SCOPE check
No finding proposes edit / culling / scoring / preset features. The one
scheduled fix restores an existing best-effort-analytics async-flush
guarantee.

## AGENT FAILURES
None. All angles completed in-context (single-subagent constraint documented
above); no spawn retries required.
