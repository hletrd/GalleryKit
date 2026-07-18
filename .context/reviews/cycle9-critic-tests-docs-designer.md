# Cycle 9 Review — Critic, Test Engineer, Document Specialist, Designer

Date: 2026-07-18
Reviewed HEAD: `f50e96b3`
Roles covered: critic, test-engineer, document-specialist, designer

## Inventory and method

- Inventoried the 945 tracked review-relevant files under the repository, then
  used the current architecture/rules (`CLAUDE.md`, `AGENTS.md`), the newest
  committed review/plan baseline, and the complete Cycle 8 change range
  `ff8c5f48..f50e96b3` to focus the fresh pass without reopening disproved or
  already-fixed historical findings.
- Examined the changed responsive source policy, MasonryCard contract, seed
  fixture, unit tests, Playwright coverage, review records, and plan ledger in
  full, plus their public-layout, archive, shared-group, image-source, Tailwind
  container, and deployment interactions.
- Audited the surrounding test and UI contracts through the existing unit/E2E
  inventory and source scanners. The full configured gates remain for Prompt 3;
  this review did not treat prior green logs as current gate evidence.
- Used the full `agent-browser` skill set against the deployed application.
  At 2560x1440/DPR 2, the public gallery rendered a 1504 px grid with 288 px
  cards and selected `_640.avif`; load-more increased the photo links from 24 to
  30 without page errors. At 375x812, the page had no horizontal overflow, the
  mobile disclosure remained collapsed, the search dialog filled the viewport,
  focused its labelled combobox, locked body scrolling, and restored focus to
  the search trigger on Escape. Accessibility snapshots exposed the skip link,
  labelled main navigation, logical headings, descriptive photo links, tag
  group, and footer landmarks. Light/dark media, state persistence, network,
  console/error, accessibility-diff, screenshot, keyboard, and i18n-switch
  paths were exercised.
- A local E2E application start was attempted first, but the disposable MySQL
  service was unavailable (`ECONNREFUSED 127.0.0.1:3306`). Consequently,
  authenticated/admin browser flows were not re-run manually in this review;
  those remain source- and repository-E2E-covered. The public deployed build was
  used for live interaction. The Korean route navigation reached `/ko`, although
  the automation connection became unresponsive after navigation; no Korean
  rendering claim is based on that incomplete post-navigation probe.
- Final missed-issues sweep covered loading/empty/error affordances, focus and
  keyboard behavior, 44 px touch targets, responsive breakpoints, source
  selection/perceived performance, i18n direction, reduced-motion contracts,
  stale documentation, flaky/fixture coupling, and regression-test vacuity.

## Finding DOC-C9-01 — Cycle 8 release ledger still reports completed publication and deployment as pending

- Severity: Low
- Confidence: High
- Status: Confirmed documentation/state-consistency issue
- Evidence: `.context/plans/cycle-8-2026-07-18-plan.md:5,63-65,99-100`
  says “signed release pending,” leaves the commit/push/deploy work item open,
  and marks both signed commits and per-cycle deploy incomplete. Current
  `master` and `origin/master` are both `f50e96b3`; `git verify-commit` reports
  good signatures for all three Cycle 8 commits (`b3e299f1`, `d2a90c3c`,
  `f50e96b3`); and the deployed gallery now selects `_640.avif` for the live
  288 px ultrawide cards, proving that the shipped source policy is active.
- Why it matters: `.context/plans/README.md` advertises this file as the active
  current-cycle plan. An operator or later review agent reading the canonical
  plan index is told that release/deploy work remains, which can trigger a
  redundant deploy or make release history appear incomplete.
- Concrete failure scenario: a later cycle treats the unchecked deploy row as
  unfinished implementation and runs an unnecessary recovery/deploy pass, or
  reports Cycle 8 as unpublished despite the signed remote history and live
  behavior.
- Suggested fix: reconcile the status/checklist with the verified signatures,
  local/remote equality, and live behavior; archive the completed Cycle 8 plan;
  advance `.context/plans/README.md` to the Cycle 9 plan. Do not invent an exact
  production commit identifier because the live probe establishes behavior,
  not a deployed SHA.

## No additional findings

- Critic: the container-capped `sizes` policy matches the actual one- and
  two-container padding, Tailwind container caps, column breakpoints, and 16 px
  gaps. Item-count capping remains aligned with HomeClient. No correctness or
  product-scope regression was found.
- Test engineer: the new unit matrix exercises fixed-container transitions,
  invalid counts, and shared padding; the Playwright cases assert actual grid
  and card geometry, emitted `sizes`, and selected candidates for main/archive/
  shared paths. The third seed image and `sparse` tag preserve the old two-item
  fixture while making the three-item boundary deterministic. No vacuous or
  flaky assertion was confirmed.
- Document specialist: MasonryCard comments now match the observer/memoization
  behavior, and the Cycle 8 responsive-plan technical claims match source and
  live output. Only the terminal release-ledger state above is stale.
- Designer: no confirmed WCAG 2.2, information-architecture, responsive,
  keyboard/focus, dialog, touch-target, theme, or perceived-performance defect
  was found in the exercised public paths. Existing explicitly deferred polish
  remains governed by the carry-forward register; none of its exit criteria
  fired in this pass.

## Files skipped / limitations

No review-relevant category was silently skipped. Unchanged backend/security/
queue/storage/schema files were inventoried and delegated to the concurrent
correctness and security/performance/architecture reviewers rather than
duplicated here. Local admin UI live interaction was infeasible solely because
the disposable DB service was down; that limitation is recorded above.
