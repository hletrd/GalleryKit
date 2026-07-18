# Critic — Cycle 5 Provenance

Review target: `4926a3e4`. I inventoried the full application, scripts,
migrations, tests, deployment assets, documentation, and active/history ledgers,
then tried to falsify the Cycle 4 implementation claims with source, Git, gates,
and live browser evidence.

## New findings

### CRIT-C5-01 — Responsive image policy is not actually aligned with layout policy

- Severity / confidence: **Medium / High**
- Status: **Confirmed live** on the home grid; sibling impact is source-confirmed likely
- Regions: `apps/web/src/components/masonry-card.tsx:21,94-109`; archive duplicates at `timeline/page.tsx:229,259-285` and `year/[year]/page.tsx:191,218-244`; shared-group variant at `g/[key]/page.tsx:187,218-244`
- Failure scenario: a DPR-2, 768px-wide visitor gets a 1,536w AVIF for a 234.66px three-column card because the `sizes` expression still selects 50vw. At 769px the same geometry gets 640w. Shared albums overstate slots across 1,024–1,200px and at 1,280px because their rule omits the grid's `lg`/four-column `xl` transitions.
- Fix: own column classes and `sizes` together in shared layout-specific constants and exercise exact breakpoints in a real browser.

### CRIT-C5-02 — The new E2E proof accepts half-broken priority state

- Severity / confidence: **Medium / High**
- Status: **Confirmed test defect; runtime currently correct**
- Region: `apps/web/e2e/masonry-priority.spec.ts:22-49`
- Failure scenario: a non-first card becomes only `loading=eager` or only `fetchpriority=high`. The test's AND predicate labels it non-priority, so `[0]` still passes while the browser receives an unintended scheduling hint.
- Fix: assert eager and high index sets separately, plus explicit non-first lazy/auto-or-absent state.

### CRIT-C5-03 — Cycle 4's authoritative ledger says implementation and release are pending after signed remote publication

- Severity / confidence: **Low / High**
- Status: **Confirmed** for implementation, signed commits, and push; deploy SHA remains **manual-validation**
- Regions: `.context/plans/cycle-4-2026-07-18-plan.md:5,18-42,61-69`; `.context/plans/README.md:34-38`
- Failure scenario: recovery trusts the plan's “implementation pending” status and unchecked commit/push step, although every work package and gate is checked, three good-signature commits exist, and `master == origin/master == 4926a3e4`. Work is repeated or the wrong release frontier is used. Production exposes the relevant observable nav/priority behavior, but there is no build-SHA endpoint or committed deploy transcript proving the exact deployed commit.
- Fix: mark implementation and signed push complete, record verified deployment evidence separately, archive Cycle 4 when Cycle 5 opens, and make terminal reconciliation part of the release workflow.

## Final sweep

I challenged auth, privacy, color/HDR, migration, restore, cache, and deployment
claims and mapped known risks back to the carry-forward register. No additional
fresh issue survived source/browser counter-evidence.
