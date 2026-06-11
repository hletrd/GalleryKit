# Plan 292 — Run-4 Cycle 10 deferred findings ledger

**Source review:** `.context/reviews/run4-cycle10/_aggregate.md`

Both scheduled findings (SEC-R4C10-01, COR-R4C10-01) are FIXED, not deferred,
per the non-deferrable rule for privacy/correctness. This ledger records the
2 LOW observations deferred this cycle and re-audits the standing deferrals.
Severity/confidence preserved (no downgrades). Deferred work remains bound by
repo policy (GPG-signed commits, Conventional Commits + gitmoji, no
`--no-verify`, Node 24 / TS 6) when picked up.

## New deferrals this cycle (none security/correctness/data-loss)

- **DEF-R4C10-A — `stripGpsFromOriginal` tier routing trusts the
  user-supplied extension** (`apps/web/src/lib/process-image.ts:1494-1505`;
  code angle, LOW/Medium). PNG bytes uploaded as `.jpg` fail the JPEG magic
  check and fall to the tier-2 `jpeg({quality:95})` re-encode (alpha
  flattened, lossy); an APNG re-encode keeps only the first frame, when
  `strip_gps_on_upload` is ON. Privacy is NEVER compromised (tier 2 strips
  all metadata); only fidelity of deliberately-mislabeled files suffers, and
  only for the admin's own uploads. This is a continuation of DEF-R4C9-B.
  Reason for deferral: self-inflicted edge with zero privacy impact; a
  content-sniffing dispatch is a behavior change to a test-locked surface and
  deserves its own pass. Exit criterion: any real upload hits the tier-2 warn
  log with a content/extension mismatch, or the next change to
  `stripGpsFromOriginal`. (Carries DEF-R4C9-B forward unchanged.)

- **DEF-R4C10-B — OnThisDay "today" is the server's calendar day**
  (`apps/web/src/components/on-this-day-widget.tsx:14-16`; designer angle,
  LOW/Medium). The widget's MM-DD flips at midnight in the container TZ (UTC
  in the shipped compose), so e.g. KST visitors see the previous day's
  anniversaries until 09:00 local. Reason for deferral: inherent SSR
  limitation; the correct fix is a product decision (admin "gallery time
  zone" setting, or a client-side date island that forfeits SSR) — a feature
  change, out of HARD-SCOPE for this loop. Exit criterion: a wrong-day report
  from the gallery owner, OR a gallery-timezone admin setting landing for any
  other reason. (Carries DEF-R4C9-A forward unchanged.)

## Standing deferrals re-audit (all exit criteria un-triggered this cycle)

- **DEF-R4C1-01** (plan-274) — LR route `revalidateAllAppData()` breadth.
  Checked: `p/[id]` and `g/[key]` still export `revalidate = 0`. Remains
  deferred.
- **DEF-R4C2-01** (plan-276) — tokens UI grants all three scopes. Checked:
  sole consuming route remains `api/admin/lr/upload`
  (`allowTokenScope: 'lr:upload'`). Remains deferred.
- **DEF-R4C3-01** (plan-278) — LR upload route error strings hardcoded
  English (machine-client surface). Checked: no LR plugin localization, no
  browser consumer appeared. Remains deferred.
- **OPS-R4C6-01** (plan-284) — production host nginx lacks the repo's
  `/uploads/` location block (original severity MED/High preserved). Checked:
  no host-level nginx maintenance this cycle; `next.config.ts headers()`
  remains the serving authority (live prod probe this cycle confirmed the
  image cache-control + security headers are present). Remains deferred with
  the plan-284 runbook intact.
- **DEF-R4C8-A/B** (plan-288) — paid-download GET error bodies unlocalized;
  interstitial double-submit plain 410. Checked: no change to
  `api/download/[imageId]` or `lib/download-interstitial.ts` this cycle.
  Remain deferred.
- **DEF-R4C8-C** (plan-288) — ImageZoom passive-listener `preventDefault`
  no-ops. Checked: no ImageZoom gesture refactor. Remains deferred.
- **DEF-R4C8-D** (plan-288) — dynamic Tailwind `columns-${n}` comment-only
  safelist. Checked: no Tailwind config change. Remains deferred.
- **Histogram mode-cycle aria-label** (carried since plan-286, LOW/Medium).
  Re-open criterion unchanged (SR-user feedback or fresh designer finding).
  Remains deferred.
