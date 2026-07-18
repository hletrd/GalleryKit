# Cycle 4 Critic Review

Review HEAD: `01d39653`. I inventoried the application, scripts, migrations,
tests, deployment files, and current review/plan ledgers, then traced the Cycle
3 implementation through its browser coverage and release record. The full
blocking gates were green at the reviewed baseline; comments and tests were not
treated as proof by themselves.

## CRIT-C4-01 — Claimed masonry geometry regression never asserts geometry

- Severity / confidence: **Medium / High**
- Status: **Confirmed test-coverage and evidence defect**
- Region: `apps/web/e2e/masonry-priority.spec.ts:20-32`; claim in
  `.context/plans/cycle-3-2026-07-18-plan.md:23-31`
- Failure scenario: the Playwright test checks attributes on DOM index 0 and
  the request for that same image, but never reads any card bounding box. At
  1536 px the live CSS-column leaders were indices 0, 6, 13, 16, and later;
  the test would remain green if layout changes made index 0 cease to be a
  visual leader or if the CSS-column/priority boundary regressed in a new way.
  This is the same blind spot Cycle 3 said it was replacing with browser
  geometry coverage.
- Fix: assert browser-computed card geometry at both viewports, prove the
  priority card is a visual top-edge leader, prove desktop has multiple
  non-contiguous leaders, and prove no other card owns explicit priority.

## CRIT-C4-02 — Cycle 3 remains active and unreleased after its signed release

- Severity / confidence: **Low / High**
- Status: **Confirmed documentation/state defect**
- Region: `.context/plans/cycle-3-2026-07-18-plan.md:5,45-48,56-65` and
  `.context/plans/README.md:34-37`
- Failure scenario: recovery work resumes from a false pending push/deploy
  frontier even though `master == origin/master`, all Cycle 3 commits are GPG
  signed, and production exposes the shipped disclosure/nav/priority behavior.
- Fix: record the signed release frontier and live evidence, mark terminal
  tasks complete, archive Cycle 3, and advance the active-plan index.

## Final sweep

The current security, data-loss, and topology risks remain explicitly tracked
in `.context/plans/deferred-carry-forward.md`; this review does not reclassify
them as new. No additional fresh critic finding survived source/browser
validation.
