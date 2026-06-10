# Plan 290 — Run-4 Cycle 9 deferred findings ledger

**Source review:** `.context/reviews/run4-cycle9/_aggregate.md`
All 4 fix clusters are scheduled in `plan/plan-289-run4-cycle9-fixes.md`.
The security finding (SEC-R4C9-01) is fixed, not deferred, per the
non-deferrable rule. This ledger records (a) the 2 LOW observations
deferred this cycle, (b) the fresh re-audit of standing deferrals.
Severity/confidence preserved (no downgrades). Deferred work remains
bound by repo policy (GPG-signed commits, Conventional Commits +
gitmoji, no `--no-verify`, Node 24 / TS 6 toolchain) when picked up.

## New deferrals this cycle (none security/correctness/data-loss)

- **DEF-R4C9-A — OnThisDay "today" is the server's calendar day**
  (`apps/web/src/components/on-this-day-widget.tsx:14-16`; designer
  angle, LOW/Medium). The widget's MM-DD flips at midnight in the
  container TZ (UTC in the shipped compose), so e.g. KST visitors see
  the previous day's anniversaries until 09:00 local. Reason for
  deferral: inherent SSR limitation; the correct fix is a product
  decision (admin "gallery time zone" setting, or a client-side date
  island that forfeits SSR) — a feature change, not a defect fix, and
  out of HARD-SCOPE for this loop. Exit criterion: a wrong-day report
  from the gallery owner, OR a gallery-timezone admin setting landing
  for any other reason (reuse it here in the same change).
- **DEF-R4C9-B — GPS-strip tier routing trusts the user-supplied
  extension** (`apps/web/src/lib/process-image.ts:1489-1507`
  `stripGpsFromOriginal` dispatch; code angle, LOW/Medium). PNG bytes
  uploaded as `.jpg` fail the JPEG magic check and fall to the tier-2
  `jpeg({quality:95})` re-encode (alpha flattened, lossy) when
  `strip_gps_on_upload` is ON; an APNG re-encode keeps only the first
  frame. Privacy is NEVER compromised (tier 2 strips all metadata);
  only fidelity of deliberately-mislabeled files suffers, and only
  for the admin's own uploads. Reason for deferral: self-inflicted
  edge with zero privacy impact; a content-sniffing dispatch is a
  behavior change to a fresh, test-locked surface and deserves its
  own pass. Exit criterion: any real upload hits the tier-2 warn log
  with a content/extension mismatch, or the next change to
  `stripGpsFromOriginal`.

## Standing deferrals re-audit (all exit criteria un-triggered this cycle)

- **DEF-R4C1-01** (plan-274) — LR route `revalidateAllAppData()`
  breadth. Checked: `p/[id]` and `g/[key]` still export
  `revalidate = 0` (re-verified this cycle). Remains deferred.
- **DEF-R4C2-01** (plan-276) — tokens UI grants all three scopes.
  Checked: sole consuming route remains `api/admin/lr/upload`
  (`allowTokenScope: 'lr:upload'`, route.ts:484). Remains deferred.
- **DEF-R4C3-01** (plan-278) — LR upload route error strings
  hardcoded English (machine-client surface). Checked: no LR plugin
  localization, no browser consumer appeared. Remains deferred.
- **OPS-R4C6-01** (plan-284) — production host nginx lacks the repo's
  `/uploads/` location block (original severity MED/High preserved).
  Checked: no host-level nginx maintenance occurred this cycle; the
  `next.config.ts headers()` policy remains the serving authority.
  Remains deferred with the plan-284 runbook intact.
- **DEF-R4C8-A/B** (plan-288) — paid-download GET error bodies
  unlocalized; interstitial double-submit plain 410. Checked: no
  change to `api/download/[imageId]` or
  `lib/download-interstitial.ts` this cycle; no customer-confusion
  report. Remain deferred.
- **DEF-R4C8-C** (plan-288) — ImageZoom passive-listener
  `preventDefault` no-ops. Checked: no ImageZoom gesture refactor
  this cycle. Remains deferred.
- **DEF-R4C8-D** (plan-288) — dynamic Tailwind `columns-${n}`
  comment-only safelist. Checked: no Tailwind config change, comment
  block untouched, no masonry bug report. Remains deferred.
- **Histogram mode-cycle aria-label** (carried since plan-286,
  LOW/Medium). The adjacent `role="img"` canvas label announces the
  mode. Re-open criterion unchanged (SR-user feedback or fresh
  designer finding). Remains deferred.
