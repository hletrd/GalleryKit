# Code Reviewer — Run-2 Cycle 2 (HEAD 317126cf)

Date: 2026-05-30. Angle: code quality, logic, SOLID, maintainability.
Scope focus per cycle context: the cycle-1 backfill fixes (`admin-backfill-runner.ts`,
`backfill-color-pipeline.ts`) for second-order effects, plus net-new findings.
Baseline: 155 test files / 1480 tests green; 3 lint gates clean (0 errors).

## CR2-01 — Detection-failure path: the two backfill implementations DIVERGE on the public `avif_10bit` column (MED, High) ⭐ second-order of cycle-1 AGG-01/AGG-02

The cycle-1 fixes (dbeca5bb, 37cca4c6) aligned the *success* path and the
`pipeline_version` semantics, but left a residual asymmetry on the
**detection-failure** branch — the exact branch AGG-01 touched.

- `admin-backfill-runner.ts:268-273` (in-app runner): on detection failure
  (encode succeeded, `detectColorSignals` threw), it issues an UPDATE that
  writes `was_downscaled` and `avif_10bit` (correctly leaving `pipeline_version`
  behind so the row is re-picked later).
- `backfill-color-pipeline.ts:163-168` (operator sidecar script): on the same
  detection-failure branch it returns `{ outcome: 'processed' }` with NO
  `signals`. In the queue handler (`:300-304`) a `processed` outcome with no
  `signals` is NOT pushed to `updateBatch`, so the script issues **NO UPDATE at
  all** — `avif_10bit` and `was_downscaled` stay at their pre-backfill values.

`avif_10bit` is a **public** field (`data.ts:254`, surfaced in the
delivered-bit-depth chip). This is the *identical* class of bug AGG-02 fixed for
the success path: "the documented sidecar backfill leaves a public value stale;
the in-app button writes it correctly → divergent DB state for identical input."
The cycle-1 contract test (`backfill-color-pipeline.test.ts:146-196`) only
exercises the success path, so this divergence is unguarded.

**Failure scenario:** A photographer re-encodes via the sidecar script. For an
image whose original triggers a `detectColorSignals` throw (corrupt ICC tag
table, truncated HEIF box, a sharp metadata edge), the re-encode produces fresh
bytes that flip `avif_10bit` 8↔10-bit, but the script writes nothing. The
public delivered-bit-depth chip shows the stale value until a *later* run
happens to re-detect successfully. The in-app button on the same image would
have updated `avif_10bit` immediately. Same input → divergent public DB state,
which is precisely the invariant AGG-02 set out to enforce.

**Confidence:** High — confirmed by reading both code paths and the queue
dispatch logic; the column-set asymmetry is unambiguous.

**Fix:** make the script's detection-failure branch persist the freshly-encoded
`was_downscaled` + `avif_10bit` (without advancing `pipeline_version`), mirroring
the runner. Either (a) return a partial signals object on the failure branch and
have `flushBatch` UPDATE only those two columns when the color signals are
absent, or (b) add a separate "derivative-only" update list. Extend the contract
test to lock the detection-failure column set on BOTH paths.

## CR2-02 — `void path;` dead-import keep-alive in admin-backfill-runner.ts (LOW, High)

`admin-backfill-runner.ts:404-408` imports `path` (`:41`) solely to `void` it,
with a comment that it "keeps the file's I/O cluster co-located … If a future
change re-adds path joining … the import is still here." This is speculative
generality (YAGNI): an unused import retained behind a `void` statement purely
on the chance a future edit might need it. ESLint's `no-unused-vars` would
normally flag the import; the `void path;` is a workaround that defeats the lint
signal. The companion script does NOT import `path` at all. Cleaner to drop both
the import and the `void` line; re-add `import path` if/when path joining
returns (it is a one-line change). LOW — purely hygiene, no behavior impact.

## Verified clean (no action)
- `runBackfill` try/finally release shape (R29-CRIT-1): correct — every state
  mutation + config read is inside the try, finally is the single release point.
- `triggerAdminBackfill` lock handoff (`lockConn = null` after handoff,
  fire-and-forget `.catch`): correct, no double-release, no leak.
- Success-path UPDATE column set: runner (`:239-252`) and script
  (`flushBatch :278-291`) now write the identical 10-column set incl.
  `avif_10bit`. AGG-02 success path verified closed.
- `getTopSharedGroupsByViews` (`analytics-data.ts:142-167`): parameterized,
  index-backed, `Number()` coercion correct. (Still untested — see test-engineer.)
