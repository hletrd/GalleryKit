# Plan 296 — Run-4 Cycle 12 deferred findings ledger

**Source review:** `.context/reviews/run4-cycle12/_aggregate.md`

The scheduled finding (COR-R4C12-01, HIGH) is FIXED, not deferred, per the
non-deferrable rule for correctness findings. This ledger records the
non-scheduled observations from this cycle and re-audits the standing
deferrals. Severity/confidence preserved (no downgrades). Deferred work
remains bound by repo policy (GPG-signed commits, Conventional Commits +
gitmoji, no `--no-verify`, Node 24 / TS 6) when picked up.

## New deferrals this cycle (none are security/correctness/data-loss)

- **OBS-R4C12-E — If-None-Match weak-comparison nonconformance**
  (`apps/web/src/lib/serve-upload.ts:209-211`; security angle, LOW/Medium).
  The 304 short-circuit compares ETag list members as exact strings
  including the `W/` prefix instead of RFC 9110 §8.8.3.2 weak comparison.
  Browsers echo the server's weak tag verbatim, so the conditional path
  works for every real client today; the worst miss is a full 200 instead
  of a 304 through a (hypothetical) strength-rewriting intermediary —
  correctness and privacy unaffected. Reason for deferral: no observable
  impact with real clients; touching the serving hot path for a
  conformance-only nit is not worth regression risk in a single-fix cycle.
  Exit criterion: evidence of a client/CDN sending a strength-modified tag,
  OR any change to the ETag format/serving conditional logic (fix alongside).

- **OBS-R4C12-B — upload quota check→claim atomicity is lock-shielded, not
  intrinsic** (`apps/web/src/app/actions/images.ts:196-252`; security/critic
  angle, INFO — invariant note, not a defect). The window/byte checks and
  the claim are separated by awaits (statfs, topic SELECT), which would be a
  TOCTOU quota bypass — except the EXCLUSIVE
  `upload-processing-contract` advisory lock (acquired at `images.ts:170`,
  held for the whole action) serializes upload actions on this instance and
  across instances on one MySQL server, making the interleaving unreachable.
  Reason for deferral: not a reachable defect today. Exit criterion: any
  change that narrows the contract lock (shared mode, settings-writes-only
  scope, or early release) MUST first make the check→claim span contiguous
  (no await between) — re-open this item in that PR.

- **OBS-R4C12-C — claim-retry timers survive quiesce untracked**
  (`apps/web/src/lib/image-queue.ts:275-278`; code angle, LOW/Medium).
  Per-job claim-retry `setTimeout` handles are not stored in
  `ProcessingQueueState`, so quiesce/shutdown cannot cancel them; one may
  fire mid- or post-restore. Currently harmless: the re-enqueue re-checks
  `isRestoreMaintenanceActive()` and the row's `processed = false` claim
  before any work. Reason for deferral: no defect reachable while both
  guards exist; adding handle tracking is bookkeeping churn. Exit criterion:
  removal/weakening of either guard, or a real-world report of a post-restore
  duplicate-processing attempt.

- **OBS-R4C12-D — tautological `!viewCountFlushTimer` in the c11 early-return
  branch** (`apps/web/src/lib/data.ts:83`; code angle, INFO). Always true
  after the entry-null three lines above; kept for symmetry with the other
  two arm sites. Reason for deferral: zero behavioral impact; a churn-only
  edit would invalidate the c11 fixture slice for no gain. Exit criterion:
  next functional edit to `flushGroupViewCounts` (clean up in passing).

## Standing deferrals re-audit (all exit criteria un-triggered this cycle)

- **DEF-R4C11-A** (plan-294) — `photo-navigation.tsx` aria-live region holds
  a constant string. Checked: file untouched this cycle. Remains deferred.
  (LOW/Medium)
- **DEF-R4C10-A** (plan-292) — `stripGpsFromOriginal` tier routing trusts
  the user-supplied extension. Checked: no change to `gps-exif-strip.ts`
  call sites; tier-2 still strips all metadata. Remains deferred. (LOW/Medium)
- **DEF-R4C10-B** (plan-292) — OnThisDay "today" is the server's calendar
  day. Checked: no change to `on-this-day-widget.tsx`. Remains deferred.
  (LOW/Medium)
- **DEF-R4C1-01** (plan-274) — LR route `revalidateAllAppData()` breadth.
  Checked: `p/[id]` and `g/[key]` still `revalidate = 0`. Remains deferred.
- **DEF-R4C2-01** (plan-276) — tokens UI grants all three scopes. Checked:
  sole consuming route remains `api/admin/lr/upload`
  (`allowTokenScope: 'lr:upload'`). Remains deferred.
- **DEF-R4C3-01** (plan-278) — LR upload route error strings hardcoded
  English (machine-client surface). Checked: no LR plugin localization or
  browser consumer appeared. Remains deferred.
- **OPS-R4C6-01** (plan-284) — production host nginx lacks the repo's
  `/uploads/` location block (MED/High preserved). Checked: no host-level
  nginx maintenance this cycle; `next.config.ts headers()` remains the
  serving authority. Remains deferred with the plan-284 runbook intact.
- **DEF-R4C8-A/B** (plan-288) — paid-download GET error bodies unlocalized;
  interstitial double-submit plain 410. Checked: no change to
  `api/download/[imageId]` or `lib/download-interstitial.ts`. Remain deferred.
- **DEF-R4C8-C** (plan-288) — ImageZoom passive-listener `preventDefault`
  no-ops. Checked: no ImageZoom gesture refactor. Remains deferred.
- **DEF-R4C8-D** (plan-288) — dynamic Tailwind `columns-${n}` comment-only
  safelist. Checked: no Tailwind config change. Remains deferred.
- **Histogram mode-cycle aria-label** (carried since plan-286, LOW/Medium).
  Re-open criterion unchanged (SR-user feedback or fresh designer finding).
  Remains deferred.
