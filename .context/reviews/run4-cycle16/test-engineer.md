# Run-4 Cycle 16 — test-engineer angle

Single-subagent in-context pass. Focus: which of this cycle's
findings shipped BECAUSE no gate could see them, and what lock
closes each class (not just each instance).

## Gap analysis per finding

### TEST-R4C16-01 — no lock on AlertDialogAction settle-before-close (folds into COR-R4C16-01)

The c14 fix (`82e35324`) landed behavior-only — no test asserts the
preventDefault idiom, so five sibling call sites stayed broken and
nothing stops call site #7 from shipping broken next month. Class
lock: `__tests__/alert-dialog-action-settle.test.ts` —
source-inspection fixture in the repo's established style
(normalize multi-line JSX openings the way
`touch-target-audit.test.ts` does, then for each `<AlertDialogAction`
opening require `preventDefault(` within its `onClick={...}` body OR
an `@alert-dialog-auto-close-ok: <reason>` marker comment in the
preceding 10 lines). Must ship proven-failing against the pre-fix
tree (expect 5 violations), then green post-fix with exactly one
marker (db/page.tsx).

### TEST-R4C16-02 — CSP test pins the too-narrow GA set (folds into COR-R4C16-02)

`__tests__/content-security-policy.test.ts` exists and asserts the
CURRENT (wrong) host list — the test encodes the bug. Update the
expectations to the Google-documented analytics-tier set and add a
negative assertion that no advertising hosts (doubleclick) creep in.

### TEST-R4C16-03 — nothing locks the image-url base resolution boundary (folds into COR-R4C16-03)

`image-url` tests (if any) run in a node-ish env where
`process.env` works, so they can never catch the client-bundle gap.
New tests must cover the resolver's three branches explicitly:
(a) no document → env value; (b) document with
`data-image-base` → dataset value (trailing-slash normalized);
(c) document without the attribute → ''. Plus a source fixture
asserting the locale layout stamps `data-image-base` on `<html>` —
otherwise a layout refactor silently severs the injection and every
unit test stays green.

### TEST-R4C16-04 — touch-target audit blind to native `<select>` (folds into DES-R4C16-04)

The c15 extension covered `<Button>`, `<button>`, and asChild
`<Badge>`; `upload-dropzone.tsx:368` demonstrates the next escape
hatch: a native `<select className="...h-10...">`. Extend FORBIDDEN
with `<select` h-8/h-9/h-10 literal + cn() patterns (with the
established ≥44 override lookahead), extend the multi-line normalizer
tag set to `select`, add violation + compliant fixtures, prove the
extension catches exactly the one pre-fix violation.

### TEST-R4C16-05 — zoom anchor math untestable inline (folds into UX-R4C16-06)

The wheel-path anchor arithmetic lives inline in a DOM handler —
unreachable by unit tests, which is WHY the double-tap path could
diverge to zero-anchor unnoticed. Extract
`anchoredZoomPosition(currentLevel, newLevel, anchorPct, position)`
into `lib/image-zoom-math.ts` (which already has a test file
covering clampPan/clampZoom/wheelStep — verified) and cover: zoom-in
anchored off-center, zoom toward existing pan, clamp saturation,
ratio-1 identity.

## Test-suite health observations

- Baseline at cycle-15 close: 185 files / 1770 tests, all green
  (plan-301 progress log). No flaky tests observed in recent cycle
  logs.
- The e2e suite (20 passed / 2 skipped) does not exercise admin
  dialogs — the COR-R4C16-01 class is invisible to it; the
  source-inspection lock is the right level (e2e for six dialogs
  would be slow and brittle).
- `db/seed.ts` (OBS-R4C16-A) is dead and untested — if it is ever
  revived it will hang (open pool). Its deletion (deferred, owner
  sign-off) should remove it from the inventory rather than add
  tests.

## Verdict

Five test gaps, all folding into this cycle's five scheduled fixes —
each fix must land WITH its lock in the same commit, proven failing
first where the repo convention demands it (audit extension,
settle lock).
