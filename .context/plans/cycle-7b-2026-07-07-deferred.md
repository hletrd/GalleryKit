# Run-10 Cycle 7 (loop-B) Deferred Findings — "cycle-7b"

Date: 2026-07-07
Aggregate source: `.context/reviews/cycle-7-2026-07-07/_aggregate.md`
Naming note: see `cycle-7b-2026-07-07-plan.md` — the peer loop's own cycle 7 owns the unsuffixed
filename; this register belongs to the loop whose prior registers are `cycle-{1..6}-2026-07-0*-deferred.md`.

Deferred items preserve original severity/confidence (never downgraded to justify deferral).
Per repo rules (CLAUDE.md, `.context/plans/README.md`): security/correctness/data-loss findings are
NOT deferred unless a specific repo rule permits, or the fix is blocked by a peer-owned file, a
product/operator decision, or missing measurement/test-infra.

## Deferred items

### DEF-C7-06code — boot-time `remotePatterns`-vs-runtime `IMAGE_BASE_URL` consistency probe (code half)

- Aggregate: C7-06 (architect C7-ARCH2). Severity/confidence: **MED / High** (mechanism verified
  against `.next/required-server-files.json`; real-world trigger unobserved).
- Citation: `apps/web/next.config.ts:8-28,117-121`; `apps/web/Dockerfile:92-97`;
  `apps/web/docker-compose.yml:7-9`.
- Reason: the failure fires only when (a) an operator actually configures `IMAGE_BASE_URL` (not
  configured in production today — same precondition as the deferred C4-25 SW-caching row and the
  C2-37res boot-validation row) AND (b) changes it via container restart instead of the documented
  rebuild deploy path. The DOC half (env-table rebuild-required callout, parallel to site-config's
  ARCH-03) IS scheduled this cycle (WP14) and removes the operator trap the finding describes. The
  code half (an instrumentation-time probe comparing `process.env.IMAGE_BASE_URL` against the baked
  `required-server-files.json` origins) adds boot-path complexity for a currently-unreachable
  misconfiguration; it also overlaps the deferred C2-37res "runtime IMAGE_BASE_URL boot-validation
  decision", which should be decided once, not twice.
- Not in the non-deferrable class: no security/correctness/data-loss impact — the failure mode is
  broken thumbnails on a misconfigured redeploy, fail-visible, recoverable by the documented deploy.
- Exit criterion: `IMAGE_BASE_URL` is actually configured in production (same trigger as C4-25 /
  C2-37res — decide the boot-validation story once for all three), OR an operator incident matching
  the restart-without-rebuild scenario.

## Scheduling disposition of everything else

All other 21 open aggregate findings are scheduled in `cycle-7b-2026-07-07-plan.md`
(WP1-WP14); C7-21 was closed by peer commit `b4f57c6f` before planning. No security-,
correctness-, or data-loss-class finding is deferred this cycle.
