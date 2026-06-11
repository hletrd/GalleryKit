# Plan 300 — Run-4 Cycle 14 deferred findings ledger

**Source review:** `.context/reviews/run4-cycle14/_aggregate.md`

The scheduled findings (COR-R4C14-01 MED/High, COR-R4C14-02 LOW/High,
DES-R4C14-B LOW/High) are FIXED in plan-299, not deferred, per the
non-deferrable rule for correctness findings. TEST-R4C14-01,
DOC-R4C14-01, DOC-R4C14-02, ARCH-R4C14-01, and DES-R4C14-A all close
with those fixes. This ledger records the cycle's non-scheduled items
and re-audits the standing deferrals. Severity/confidence preserved (no
downgrades). Deferred work remains bound by repo policy (GPG-signed
commits, Conventional Commits + gitmoji, no `--no-verify`, Node 24 /
TS 6) when picked up.

## New deferrals this cycle

- **RISK-R4C14-03 — iOS 17+ dimg-only gain-map shape may evade both
  detection heuristics** (`apps/web/src/lib/gain-map-detection.ts:274-282`;
  code/security/test angles, MED impact / **Low confidence** — risk
  needing manual validation, NOT a confirmed correctness finding).
  Real-device iOS 17/18 ISO 21496-1 HEICs may ship `tmap` referenced
  only via `dimg` with `auxl` pointing gainmap(hvc1)→primary(hvc1) —
  neither heuristic fires, so the admin-only `has_gain_map` audit row
  under-reports (fail-quiet direction; no public-facing dishonesty).
  Reason for deferral: cannot be confirmed or safely fixed without a
  real-device fixture — the critic angle explicitly warns that
  speculatively widening heuristic 2 to `dimg` risks false-positive
  gain-map labels on non-HDR derived-image files, violating the audit
  honesty rule in the opposite direction. This is classified as a risk
  requiring validation rather than a deferrable confirmed defect; the
  deferral therefore does not contravene the "correctness findings are
  not deferrable" rule, which binds confirmed findings.
  Exit criterion: a real iOS 17+ HDR HEIC fixture (or authoritative
  ISOBMFF dump of one) becomes available → add it to
  `gain-map-detection.test.ts`; if the dimg-only shape is confirmed,
  extend heuristic 2 to treat a `dimg` reference FROM a `tmap` item as
  a gain-map signal and lock with the fixture.

- **OBS-R4C14-A / DOC-R4C14-03 — touch-target audit prose describes
  pre-lift Button defaults** (`apps/web/src/__tests__/`
  `touch-target-audit.test.ts` FORBIDDEN narration + KNOWN_VIOLATIONS
  comments for tag-manager(3)/topic-manager(3)/settings-client(1)/
  seo-client(1); test/document angles, INFO/High). `ui/button.tsx:23-30`
  now ships `min-h-11` / `size-11` (44 px) for the `sm`/`icon` variants
  the audit narrates as "32 px"/"36 px", so the exempted icon buttons
  are real-44px-compliant and the exemption entries are conservative
  noise. The audit remains self-consistent (scanned counts match
  documented counts; new violations still fail). Reason for deferral:
  prose/exemption refresh alone is churn in a security-adjacent locked
  test with no behavioral delta. Exit criterion: the next functional
  edit to `touch-target-audit.test.ts` refreshes the FORBIDDEN/exemption
  narration to the post-lift Button defaults and re-evaluates retiring
  the pure-`size="icon"` KNOWN_VIOLATIONS entries.

- **TEST-R4C14-02 — gain-map fixture suite lacks a real-device iOS
  17/18 fixture** (test angle, observation/Medium). Same root cause and
  SAME exit criterion as RISK-R4C14-03 (fixture acquisition); recorded
  separately so the test gap is visible in the test-debt ledger.

## Standing deferrals re-audit (all exit criteria un-triggered this cycle)

Diff since the cycle-13 review commit (`4042a7a9..HEAD` at review time)
touches only plan-297 progress notes — none of the deferral surfaces.

- **DEF-R4C11-A** (plan-294) — `photo-navigation.tsx` aria-live region
  constant string. File untouched. Remains deferred. (LOW/Medium)
- **DEF-R4C10-A** (plan-292) — `stripGpsFromOriginal` tier routing
  trusts the user-supplied extension; tier-2 still strips all metadata.
  No change to `gps-exif-strip.ts` call sites. Remains deferred.
  (LOW/Medium)
- **DEF-R4C10-B** (plan-292) — OnThisDay "today" is the server's
  calendar day. No change to `on-this-day-widget.tsx`. Remains
  deferred. (LOW/Medium)
- **DEF-R4C1-01** (plan-274) — LR route `revalidateAllAppData()`
  breadth. `p/[id]` and `g/[key]` still `revalidate = 0`. Remains
  deferred.
- **DEF-R4C2-01** (plan-276) — tokens UI grants all three scopes; sole
  consuming route remains `api/admin/lr/upload`. Remains deferred.
- **DEF-R4C3-01** (plan-278) — LR upload route error strings hardcoded
  English (machine-client surface). No LR localization consumer
  appeared. Remains deferred.
- **OPS-R4C6-01** (plan-284) — production host nginx lacks the repo's
  `/uploads/` location block (**MED/High preserved**). No host-level
  nginx maintenance this cycle; `next.config.ts headers()` remains the
  serving authority. Remains deferred with the plan-284 runbook intact.
- **DEF-R4C8-A/B** (plan-288) — paid-download GET error bodies
  unlocalized; interstitial double-submit plain 410. No change to
  `api/download/[imageId]` or `lib/download-interstitial.ts`. Remain
  deferred.
- **DEF-R4C8-C** (plan-288) — ImageZoom passive-listener
  `preventDefault` no-ops. No ImageZoom gesture refactor (the cycle-14
  `image-zoom-math.ts` clean pass made no change). Remains deferred.
- **DEF-R4C8-D** (plan-288) — dynamic Tailwind `columns-${n}`
  comment-only safelist. No Tailwind config change. Remains deferred.
- **Histogram mode-cycle aria-label** (carried since plan-286,
  LOW/Medium). Re-open criterion unchanged (SR-user feedback or fresh
  designer finding; the cycle-14 designer pass did not re-flag it).
  Remains deferred.
- **OBS-R4C12-B** (plan-296, INFO invariant) — upload quota check→claim
  span remains shielded by the EXCLUSIVE upload-processing-contract
  lock; no lock-narrowing change this cycle. Remains recorded.
- **OBS-R4C12-C** (plan-296, LOW/Medium) — claim-retry timers still
  untracked; both guards intact. Remains deferred.
- **OBS-R4C12-D** (plan-296, INFO) — `data.ts:83` tautological guard;
  no functional edit to `flushGroupViewCounts` this cycle. Remains
  deferred.
- **OBS-R4C12-E** (plan-296, LOW/Medium) — If-None-Match exact-string
  comparison; ETag format/conditional logic unchanged this cycle.
  Remains deferred.
- **DOC-R4C13-01/02** (plan-298, INFO/High) — no CLAUDE.md edit touched
  the Race-Condition or Privacy/schema sections this cycle (the
  cycle-14 fixes cite CLAUDE.md in commit bodies only). Remain
  recorded with exit criteria unchanged.

## Archive action this cycle

plan-297 (run4 c13 fix plan, fully implemented with deploy record) moves
to `plan/done/` per the archive convention. Deferred ledgers
(plan-292/294/296/298 etc.) stay active.
