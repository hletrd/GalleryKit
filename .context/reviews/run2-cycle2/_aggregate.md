# Aggregate Review — Run-2 Cycle 2 (HEAD 317126cf)

Date: 2026-05-30
Method: single-orchestrator deep review across 8 specialist angles (Task-based
subagent fan-out unavailable in this nested context, same as cycle 1 → all
angles executed directly, one provenance file per angle). Baseline: 155 test
files / 1480 tests passing (green); all 3 lint gates clean (0 errors, 1
pre-existing `<img>` warning = DEF-09). Scope per cycle context: cycle-1 backfill
fixes (`admin-backfill-runner.ts`, `backfill-color-pipeline.ts`) for second-order
effects, plus net-new findings.

Per-angle files (provenance, kept as-is): `code-reviewer.md`, `debugger.md`,
`architect.md`, `test-engineer.md`, `security-reviewer.md`, `perf-reviewer.md`,
`designer.md`, `document-specialist.md`, `critic-verifier-tracer.md`.

## Headline

ONE confirmed net-new MED finding, a direct **second-order effect of the cycle-1
fixes**: the two backfill implementations now agree on `pipeline_version` and the
success-path column set (cycle-1 closed those) but DISAGREE on the
**detection-FAILURE** branch — the in-app runner persists the PUBLIC `avif_10bit`
(+ admin-only `was_downscaled`) on detection failure, while the operator sidecar
script writes NOTHING. Same input → divergent public DB state, the exact invariant
AGG-02 set out to enforce, now leaking through the one branch AGG-02 didn't touch.
Four angles independently converged (code-reviewer, debugger, architect-as-DEF-01-
trigger, critic-verifier-tracer). Everything else is verified-clean or an
unchanged cycle-1 carryover deferral.

## Merged findings (deduped, highest severity/confidence retained)

### AGG2-01 — Backfill detection-failure branch diverges on the public `avif_10bit` column (MED, High) ⭐ multi-angle, second-order of cycle-1
Flagged by: code-reviewer (CR2-01), debugger (DBG2-01), critic-verifier-tracer
(CVT2-01), document-specialist (DOC2-01); architect (ARCH2-01) ties it to the
DEF-01 third-drift re-open trigger.
- `admin-backfill-runner.ts:268-273` (in-app runner): on detection failure it
  UPDATEs `was_downscaled` + `avif_10bit` (correctly leaving `pipeline_version`
  behind).
- `backfill-color-pipeline.ts:163-168` (sidecar script): on the same branch it
  returns `{ outcome: 'processed' }` with NO `signals`; the queue handler
  (`:300-304`) skips rows without signals, so it issues NO UPDATE — `avif_10bit`
  (PUBLIC, `data.ts:254`) and `was_downscaled` stay at pre-backfill values.
- Result: identical input, divergent public DB state, until a later run
  re-detects successfully. This is the AGG-02 class of bug surviving on the one
  branch the cycle-1 fix didn't cover.
- **Fix (scheduled this cycle):** make the script's detection-failure branch
  persist the derivative-only columns (`avif_10bit`, `was_downscaled`) WITHOUT
  advancing `pipeline_version`, mirroring the runner. Then the CLAUDE.md
  equivalence note (DOC2-01) stays true as written.

### AGG2-02 — Contract test gap: no lock on the detection-FAILURE column set (MED-enabling, High) ⭐ bundles with AGG2-01
Flagged by: test-engineer (TST2-01). The cycle-1 contract test only covers the
success path; the detection-failure branch is unguarded, which is how AGG2-01
slipped in. **Fix (scheduled):** extend `backfill-color-pipeline.test.ts` (and the
runner's detection-failure test) to assert the detection-failure column set on
both paths, mirroring the `data-tag-names-sql.test.ts` contract-lock pattern.

### AGG2-03 — `void path;` dead-import keep-alive (LOW, High)
Flagged by: code-reviewer (CR2-02). `admin-backfill-runner.ts:41,404-408` imports
`path` only to `void` it on speculative future need. Hygiene only. **Fix
(scheduled, trivial):** drop the unused import + the `void path;` line.

## Carryover deferrals (re-verified, severity preserved, NOT re-opened this cycle)
All still satisfy their cycle-1 exit criteria (none fired except DEF-01's
third-drift trigger, addressed via the targeted AGG2-01 fix rather than a full
unification):
- DEF-01 (unify backfill cores): third drift HAS appeared (AGG2-01). Per the
  recorded exit criterion this is eligible to re-open; this cycle does the
  proportionate targeted alignment + contract lock and keeps the full extraction
  deferred, with a note that the NEXT structural change to either file should do
  the unification. (architect ARCH2-01)
- DEF-02 (page candidate fetch), DEF-03 (batch runner UPDATEs), DEF-04 (atomic
  progress counters): unchanged, LOW, exit criteria not fired. (perf-reviewer)
- DEF-05 (backfill completion UX), DEF-07 (WideGamutHint single-gamut dismiss):
  unchanged, LOW. (designer)
- DEF-06 (raw error to admin client): unchanged, acceptable under all-admins-
  trusted model; exit criterion (non-root admin role) not fired. (security-reviewer)
- DEF-08 (`getTopSharedGroupsByViews` untested): unchanged, LOW; carried as
  TST2-02. (test-engineer)
- DEF-09 (pre-existing `<img>` lint warning): unchanged, warning not error.

## Verified-clean (no action — recorded so the loop doesn't re-litigate)
- Cycle-1 AGG-01 runner fix: CORRECT (pipeline_version stays behind on detection
  failure; regression test locks it).
- Cycle-1 AGG-02 script fix: CORRECT on success path (column set == image-queue.ts).
- `runBackfill` try/finally release + `triggerAdminBackfill` lock handoff
  (R29-CRIT-1): correct, no leak, no double-release.
- All backfill SQL parameterized (drizzle template); no injection.
- 3 lint gates clean (api-auth, action-origin, eslint); 155 files / 1480 tests green.
- analytics `getTopSharedGroupsByViews`: parameterized, index-backed, correct
  Number() coercion (still untested — DEF-08/TST2-02).

## Severity tally
- MED: 1 confirmed (AGG2-01) + 1 MED-enabling test (AGG2-02, folds into AGG2-01).
- LOW: AGG2-03 (dead import) + carryover deferrals (DEF-02..09, TST2-02).
- INFO / verified-clean: ~8.

Total distinct net-new actionable findings: **1 MED + 1 LOW** (plus the bundled
MED-enabling test). No CRIT/HIGH. No security/data-loss escalation (AGG2-01 is
data-consistency on a public display field, not data-loss; not deferrable as a
correctness item → SCHEDULED, not deferred).

## AGENT FAILURES
None. Task-based subagent fan-out was unavailable in this nested execution
context (same as cycle 1); all 8 review angles were executed directly by the
orchestrator and written to per-angle provenance files. No angle was dropped.
