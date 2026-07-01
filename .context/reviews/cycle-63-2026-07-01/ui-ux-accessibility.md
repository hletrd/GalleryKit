# Cycle 63 UI/UX/Accessibility Review

Reviewer: UI/UX/accessibility designer lane
Date: 2026-07-01
Start HEAD: `ecfda466cab14cd6a9ffbe03e6dc7d42023c8e82`

## Scope And Method

- Read required guidance and prior-cycle context: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/reviews/_aggregate.md`, `.context/plans/cycle-62-2026-07-01-plan.md`, `.context/plans/cycle-62-2026-07-01-deferred.md`, `.context/reviews/cycle-62-2026-07-01/_aggregate.md`, and `.context/reviews/cycle-62-2026-07-01/ui-ux-accessibility.md`.
- Reviewed public and admin UI source across `apps/web/src/components`, `apps/web/src/app/[locale]/(public)`, `apps/web/src/app/[locale]/admin`, `apps/web/messages`, and the relevant source-contract/E2E tests.
- Browser/runtime DOM pass was not started in this lane; review evidence is source/test-grounded. Residual risk remains for runtime-only layout regressions, authenticated admin flows requiring live data, and screen-reader-specific announcement timing.
- Avoided re-raising deferred Cycle 62 search status duplication (`C62-04`) and carried-forward non-UI/test/dependency items unless new evidence changed scheduling. No new evidence changed those items.

## Findings

### C63-UX-01 - Admin Analytics table links do not provide a 44 px pointer target

- Severity: Low
- Confidence: Medium
- File/line:
  - `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:117`
  - `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:122`
  - `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:225`
  - `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:230`
- Evidence:
  - The Top Photos link is an inline `<a>` with `className="text-primary underline-offset-4 hover:underline rounded outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"` and no `min-h-11`, `inline-flex`, `block`, or padding that expands the clickable target.
  - The Top Shared Albums link has the same inline-only target shape with `font-mono text-primary ...` and no target-size utility.
  - `CLAUDE.md` defines a repo-wide 44x44 px interactive target policy. `apps/web/src/__tests__/touch-target-audit.test.ts:248` through `apps/web/src/__tests__/touch-target-audit.test.ts:521` catches explicit sub-44 link classes, but not bare inline links that omit any sizing token. The focused a11y test run passed, so this gap is not currently blocked by tests.
- Scenario:
  - An admin reviewing Analytics on a tablet or with motor tremor tries to open a top photo or shared album. The surrounding table cell has `px-4 py-3`, but only the text glyph box is the active link, so the practical touch target can be far below 44 px when labels are short, especially shared keys.
- Suggested fix:
  - Make both analytics anchors fill a finger-sized hit area without changing table semantics, for example `inline-flex min-h-11 items-center rounded px-1 -mx-1 ...`, or make the cell link `block min-h-11 py-2` if the whole first cell should be clickable.
  - Add a narrow source-contract check for admin Analytics table links carrying `min-h-11` or another documented >=44 px target utility, because the current regex audit does not catch omitted sizing.

## Non-Findings / Checks

- Public search functional outage from Cycle 62 was fixed at the current start HEAD; Cycle 62 plan evidence records deployed keyword-search smoke passing after `c474f11c`, and current HEAD includes the ledger close.
- Search status duplication remains the explicit deferred `C62-04`; current source still shows the live region at `apps/web/src/components/search.tsx:440` and visible status at `apps/web/src/components/search.tsx:473`, but no new severity/scheduling evidence was found.
- Dialog close labels are localized by default in `apps/web/src/components/ui/dialog.tsx:60` through `apps/web/src/components/ui/dialog.tsx:66`; token dialogs that omit `closeLabel` still resolve through `common.close`.
- Public nav/search/photo-viewer controls have source evidence for accessible names, focus management, focus restoration, reduced-motion handling, and 44 px targets in the reviewed files.

## Validation Evidence

- `npm test --workspace=apps/web -- touch-target-audit focus-visible-links-scan a11y-us-p15 search-disclaimer search-short-query-guard search-stale-response ime-composition-guard info-bottom-sheet-ia` - passed: 8 files, 66 tests.
- `git rev-parse HEAD` returned `ecfda466cab14cd6a9ffbe03e6dc7d42023c8e82`, matching the requested start HEAD.
