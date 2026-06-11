# Plan 298 — Run-4 Cycle 13 deferred findings ledger

**Source review:** `.context/reviews/run4-cycle13/_aggregate.md`

The scheduled finding (COR-R4C13-01, MED/High, correctness) is FIXED in
plan-297, not deferred, per the non-deferrable rule for correctness
findings. COR-R4C13-02 (LOW), TEST-R4C13-01 (gap), and DES-R4C13-A (MED)
all close with that same fix. This ledger records the cycle's non-scheduled
observations and re-audits the standing deferrals. Severity/confidence
preserved (no downgrades). Deferred work remains bound by repo policy
(GPG-signed commits, Conventional Commits + gitmoji, no `--no-verify`,
Node 24 / TS 6) when picked up.

## New deferrals this cycle (none are security/correctness/data-loss)

- **DOC-R4C13-01 — CLAUDE.md rename claim true-but-column-silent**
  (CLAUDE.md Race Condition Protections section; document angle,
  INFO/High). "Topic slug rename: Transaction wraps reference updates
  before PK rename" is accurate and never asserted column preservation, so
  there is no contradiction to fix. The carry contract is documented at the
  code site and in the plan-297 fix-commit body instead. Reason for
  deferral: doc edit would be churn duplicating the code comment. Exit
  criterion: the next CLAUDE.md edit to the Race Condition section should
  append "replacement row carries all non-form columns (`map_visible`,
  `image_filename`)" in passing.

- **DOC-R4C13-02 — CLAUDE.md never mentions the US-P21 per-topic map
  opt-in** (CLAUDE.md key-tables / Privacy sections; document angle,
  INFO/High — observation, not a mismatch: the schema list is name-level
  only). The public `/map` GPS surface is gated by `topics.map_visible`
  with a dual-layer guard (`lib/data.ts:1523-1550`), and the Privacy
  section's "GPS excluded from public API responses" is still true for all
  non-opted topics. Reason for deferral: no contradiction; adding feature
  docs is out of the review→fix loop's scope rules. Exit criterion: next
  CLAUDE.md edit touching the Privacy or schema sections mentions the
  per-topic map opt-in.

## Standing deferrals re-audit (all exit criteria un-triggered this cycle)

Diff since the cycle-12 review commit (`d2696975..HEAD` at review time)
touches only `data.ts` / `image-queue.ts` / tests / SW version / docs —
none of the deferral surfaces below.

- **DEF-R4C11-A** (plan-294) — `photo-navigation.tsx` aria-live region
  constant string. File untouched (last touch `dd456239` 2026-06-10).
  Remains deferred. (LOW/Medium)
- **DEF-R4C10-A** (plan-292) — `stripGpsFromOriginal` tier routing trusts
  the user-supplied extension; tier-2 still strips all metadata. No change
  to `gps-exif-strip.ts` call sites. Remains deferred. (LOW/Medium)
- **DEF-R4C10-B** (plan-292) — OnThisDay "today" is the server's calendar
  day. No change to `on-this-day-widget.tsx`. Remains deferred. (LOW/Medium)
- **DEF-R4C1-01** (plan-274) — LR route `revalidateAllAppData()` breadth.
  `p/[id]` and `g/[key]` still `revalidate = 0`. Remains deferred.
- **DEF-R4C2-01** (plan-276) — tokens UI grants all three scopes; sole
  consuming route remains `api/admin/lr/upload`. Remains deferred.
- **DEF-R4C3-01** (plan-278) — LR upload route error strings hardcoded
  English (machine-client surface). No LR localization consumer appeared.
  Remains deferred.
- **OPS-R4C6-01** (plan-284) — production host nginx lacks the repo's
  `/uploads/` location block (**MED/High preserved**). No host-level nginx
  maintenance this cycle; `next.config.ts headers()` remains the serving
  authority. Remains deferred with the plan-284 runbook intact.
- **DEF-R4C8-A/B** (plan-288) — paid-download GET error bodies unlocalized;
  interstitial double-submit plain 410. No change to `api/download/[imageId]`
  or `lib/download-interstitial.ts`. Remain deferred.
- **DEF-R4C8-C** (plan-288) — ImageZoom passive-listener `preventDefault`
  no-ops. No ImageZoom gesture refactor. Remains deferred.
- **DEF-R4C8-D** (plan-288) — dynamic Tailwind `columns-${n}` comment-only
  safelist. No Tailwind config change. Remains deferred.
- **Histogram mode-cycle aria-label** (carried since plan-286, LOW/Medium).
  Re-open criterion unchanged (SR-user feedback or fresh designer finding).
  Remains deferred.
- **OBS-R4C12-B** (plan-296, INFO invariant) — upload quota check→claim
  span remains shielded by the EXCLUSIVE upload-processing-contract lock;
  no lock-narrowing change this cycle. Remains recorded.
- **OBS-R4C12-C** (plan-296, LOW/Medium) — claim-retry timers still
  untracked; both guards (maintenance gate + row re-check) intact. Remains
  deferred.
- **OBS-R4C12-D** (plan-296, INFO) — `data.ts:83` tautological guard;
  no functional edit to `flushGroupViewCounts` this cycle. Remains deferred.
- **OBS-R4C12-E** (plan-296, LOW/Medium) — If-None-Match exact-string
  comparison; ETag format/conditional logic unchanged this cycle. Remains
  deferred.

## Archive action this cycle

plan-289 / plan-291 / plan-293 / plan-295 (run4 c9–c12 fix plans, all
fully implemented with deploy records) moved to `plan/done/` per the
archive convention. Deferred ledgers (plan-292/294/296 etc.) stay active.
