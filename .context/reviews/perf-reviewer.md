# perf-reviewer — Cycle 3 (HEAD `839d98c`, 2026-04-26)

## Findings

### PR3-LOW-01 — `bufferGroupViewCount` schedule timing during back-off is non-obvious

- **File:** `apps/web/src/lib/data.ts:22-26, 38-41, 91-94`
- **Confidence:** Medium / **Severity:** Low

`bufferGroupViewCount` schedules timer with `getNextFlushInterval()`, which
respects current `consecutiveFlushFailures`. After a flush succeeds, the
counter resets to 0 inside `flushGroupViewCounts` finally-block but only
if `succeeded > 0`. Behavior is correct but the timing surface is
non-obvious for a debugger reading `data.ts`. Recommend a short docstring
on `bufferGroupViewCount` explaining the back-off contract.

### PR3-INFO-01 — touch-target audit reads every .tsx synchronously each test run

- **File:** `apps/web/src/__tests__/touch-target-audit.test.ts:233-272`
- **Confidence:** High / **Severity:** Informational

`fs.readdirSync` + `fs.readFileSync` per file. ~120 .tsx files = ~30 ms.
Acceptable. After CR3-MED-01 fix the multi-line normalization adds one
regex per file (still fine). No action.

## Verdict

1 NEW LOW, 1 NEW INFO.
