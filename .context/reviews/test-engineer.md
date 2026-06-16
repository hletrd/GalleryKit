# Test Engineer Review — Run 6 / Cycle 7

**HEAD:** `a7758ef0`
**Agent:** test-engineer
**Date:** 2026-06-17

## Verdict: 0 actionable coverage gaps. 0 flaky tests. 0 vacuous tests. Suite green.

**Unit suite:** `2194 passed | 2 skipped | 0 failed` (234 files passed / 1 skipped = 235),
exit 0. Ran the full suite TWICE (51.7s then 26.4s) plus the cycle-6 trio in
isolation — fully deterministic, no contention flake, identical pass/skip counts
both runs. The 2 skips = the intentional CLIP env-gate. The two cycle-6 commits
(`5af25dc7` HDR contrast, `204e8594` boundary classifier) both ship their own
non-vacuous regression tests IN THE SAME COMMIT, and I mutation-proved the
contrast test catches a `text-white` regression. No HEAD-verified coverage gap,
flaky test, or vacuous test warrants a code change.

Convergence trend: 11 → 45 → 14 → 5 → 1 → 0 → **0**. An honest 0/0 is the correct
and expected outcome for cycle 7.

---

## What I verified

### 1. Full suite green + deterministic across 2 runs (no flake)
```
npm test --workspace=apps/web   (run 1)  → 2194 pass / 2 skip / 0 fail   51.73s
npm test --workspace=apps/web   (run 2)  → 2194 pass / 2 skip / 0 fail   26.44s
```
Identical counts; the 2× wall-clock variance is import/transform jitter under
load, not a correctness signal. Exit 0 both times. Count rose from cycle-6's
2181 → 2194 (+13) exactly accounting for the two cycle-6 commits' new tests
(hdr-badge-contrast +12 it, boundary +1 it).

### 2. The 2 skipped tests are the intentional CLIP env-gate (HARD GUARD #2)
`clip-semantic-integration.test.ts:30-31`:
```
const RUN = process.env['CLIP_INTEGRATION'] === '1';
const d = RUN ? describe : describe.skip;   // "Default CI (no model weights) skips"
```
Correctly staying skipped. NOT a gap. I did NOT propose activating CLIP /
semantic_search.

### 3. Both cycle-6 commits have adequate, non-vacuous regression coverage

**`5af25dc7` (HDR badge contrast → `hdr-badge-contrast.test.ts`, 12 it / mutation-proven):**
- 4 sites × 3 assertions: gradient-present non-vacuity guard, negative pin
  (`not.toMatch(/\btext-white\b/)`), positive pin (`text-amber-950`), AND an
  explicit forbid of the `text-amber-900` trap (4.01:1 at the orange-400 stop).
- Grep-confirmed all 4 sites use the single-line double-quoted
  `className="...from-amber-300 to-orange-400...text-amber-950..."` form the test
  regex inspects — none escapes coverage. The amber→orange gradient appears in
  EXACTLY these 4 files repo-wide (no 5th uncovered badge).
- **Mutation test (performed):** reverting `info-bottom-sheet.tsx` to `text-white`
  flipped exactly 2 assertions RED (the `text-white` pin + the `text-amber-950`
  pin); restored cleanly. The coverage is genuinely load-bearing, not decorative.

**`204e8594` (boundary classifier → `client-server-only-boundary.test.ts`, +1 it):**
- The AGG-C6-02 fix adds a `ts.forEachChild` recursive descent capturing the two
  value-import forms the prior statement-only AST walk dropped: dynamic
  `import('@/lib/data')` (CallExpression + ImportKeyword) and
  `import db = require('@/db')` (ImportEqualsDeclaration), de-duped via Set.
- The new `it(...AGG-C6-02)` is non-vacuous: 9 cases incl. nested-in-function
  dynamic import, `import x = require()`, non-aliased ignore (`react`,
  `node:path`), and static+dynamic de-dupe (`toEqual(['@/db'])`).
- The dynamic specifier flows through the SAME `extractAliasedImports` →
  `resolveAliasedModule` path the real-tree walk uses, and the `@/db`-recognized-
  as-server-only-equivalent integration pin exercises that path end-to-end, so
  the walk WILL follow a dynamic edge transitively (not just detect the leaf).
- Trigger surface grep-confirmed EMPTY at HEAD (only the test fixture itself uses
  dynamic `@/lib`/`@/db` import; no real `'use client'` module does), so this was
  correctly LOW — latent future-coverage hardening, now closed.
- `@/db/index.ts` correctly left WITHOUT `import 'server-only'` (HARD GUARD #1 —
  `server-only@0.0.1` throws under tsx, breaking the backfill sidecar + DB
  init/seed scripts; the `mysql2`-in-closure check closes the gap risk-free). I
  did NOT propose adding `server-only` to `@/db`.

### 4. `switch.tsx` is effectively comment-only since the cycle-4 baseline; its test is current
The `f8147868..HEAD` diff for `switch.tsx` looked like a real CSS change
(`translate-x-[calc(100%-2px)]` → `translate-x-full`) but tracing the history,
the `translate-x-full` behavior change actually landed in cycle-3 `a3b8c557` and
was already present at the cycle-4 baseline `f8147868`. The only delta in the
window is the comment-text fix `24159f36`. `switch-geometry-contract.test.ts`
(cycle-4 AGG-C4-02) pins the load-bearing triple — visible-track `w-11`+`px-0.5`+
`h-6`, thumb `size-5`, and `translate-x-full` — and explicitly forbids the old
half-on `translate-x-5`. Current and matching code; non-vacuous (the docstring
records that flipping any of the three flips an assertion RED).

### 5. Only non-test source changed since cycle-4 baseline = the 4 HDR files + comment-only switch
`git diff --name-only f8147868..HEAD` over `src/**/*.{ts,tsx}` minus tests yields
exactly: the 4 HDR badge files (covered) + `switch.tsx` (comment-only, covered).
Every recent source change still ships with a paired regression test.

### 6. No flaky / non-deterministic patterns
- **Zero** raw-timer sleeps (`new Promise(r => setTimeout(...))`) anywhere in
  `__tests__/` (grep count 0).
- **Every** `vi.waitFor` carries an explicit options object — verified each of the
  8 multi-line calls (the single-line grep miss was a false alarm; the
  `{ timeout, interval }` is on the following line). 7 use `{ timeout: 20_000,
  interval: 25 }` (the `6ab40644` hardening), 1 uses `{ timeout: 5000 }`. No bare
  unbounded wait.
- The boundary scan's de-flake (AGG-R8-01: read+parse memoization + 60s explicit
  timeout) is intact and is a correct fix, not a suppression — the assertion runs
  to completion and still reds on a real leak.

### 7. High-risk security/data-loss invariants densely + non-vacuously covered
- Every critical lib has ≥1 referencing test file: `serve-upload` (4), `data`
  (84), `process-image` (37), `validation` (37), `color-detection` (11),
  `blur-data-url` (5), `settings-hash` (2), `auth-rate-limit` (2),
  `advisory-locks` (2), `gps-exif-strip`/`session-token`/`password-hashing`/
  `csv-escape` (1 dedicated dense file each).
- **Stripe async-payment gap (CLAUDE.md-documented operational gap) is fully
  test-pinned:** `checkout-route.test.ts:211` pins
  `payment_method_types).toEqual(['card'])` (card-only mitigation), and the
  webhook `payment_status !== 'paid'` gate is pinned in
  `cycle3-rpf-source-contracts.test.ts` + `cycle4-rpf-source-contracts.test.ts`.
  The two operational walls the tracer cited are both regression-locked.
- All 12 CLAUDE.md locked-contract tests re-confirmed present from cycle-6.

---

## HARD GUARDS respected
1. Did NOT propose `import 'server-only'` on `@/db` (proven to break tsx backfill;
   the mysql2-closure approach is the safe substitute, left in place).
2. Did NOT touch / propose activating the 2 self-skipping CLIP integration tests.
3. Did NOT re-report any cycle-1–6 item. All claims verified against HEAD
   `a7758ef0` (2 full suite runs + isolation run + a mutation test).

## Bottom line
The test surface is mature and self-defending. The two cycle-6 fixes each carry
their own non-vacuous regression test (contrast coverage mutation-proven). The
suite is green and deterministic across repeated runs, there are zero
flaky/sleep/unbounded-wait patterns, and the security-critical + data-loss
invariants are pinned with substantive fixtures. **No test changes recommended
this cycle.**
