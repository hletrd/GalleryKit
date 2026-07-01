# Cycle 84/100 Critic Review

Reviewed HEAD: `023ae28d41ee757caaa408710bd864d88087a40c`.
Date: 2026-07-01.
Role: critic lane.

## Scope

Reviewed the Cycle 84 reports, Cycle 83 aggregate/plan/deferred ledger, current plan index, the latest commit metadata, and the adjacent source-contract surfaces. This pass did not implement or edit product code.

Severity summary: Critical 0, High 0, Medium 1, Low 1.

## Confirmed Findings

### C84-CR-01 - Cycle 83 release ledger is still active and leaves commit/deploy unchecked after its pushed signed HEAD

- Severity: Medium.
- Confidence: High.
- Citations: `.context/plans/README.md:5`, `.context/plans/README.md:7`, `.context/plans/README.md:10`, `.context/plans/cycle-83-2026-07-01-plan.md:8`, `.context/plans/cycle-83-2026-07-01-plan.md:40`, `.context/plans/cycle-83-2026-07-01-plan.md:44`, `.context/plans/cycle-83-2026-07-01-plan.md:49`, `.context/plans/cycle-83-2026-07-01-plan.md:50`.
- Problem: The plan index still lists Cycle 83 under active current-cycle plans, while the Cycle 83 plan still has commit/push and deploy unchecked. Local `HEAD` and `origin/master` both resolve to `023ae28d41ee757caaa408710bd864d88087a40c`, and `git show --show-signature --no-patch HEAD` reports a good GPG signature for that commit. This repeats the release-ledger ambiguity that Cycle 83 already treated as a Medium finding for Cycle 82.
- Failure scenario: Future reviewers cannot tell from committed artifacts whether Cycle 83 was pushed, deployed, not deployed, or merely left mid-flight. That forces repeated release forensics and can cause duplicate deploy attempts or incorrect assumptions about the production baseline for Cycle 84.
- Suggested fix: Close the Cycle 83 ledger explicitly: move Cycle 83 to Recent Plans, mark commit/pull-rebase/push complete with signed `023ae28d` / `origin/master` evidence, and record deploy status with evidence. If no committed deploy transcript exists, say that directly and let the next verified deploy supersede production state instead of leaving the deploy checkbox ambiguous.

### C84-CR-02 - Dashboard retry source contract can pass while helper-derived labels stop reaching the rendered row

- Severity: Low.
- Confidence: High.
- Citations: `apps/web/src/__tests__/failed-image-retry.test.ts:152`, `apps/web/src/__tests__/failed-image-retry.test.ts:154`, `apps/web/src/__tests__/failed-image-retry.test.ts:155`, `apps/web/src/__tests__/failed-image-retry.test.ts:156`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:39`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:40`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:85`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:109`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:110`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:122`.
- Problem: The current dashboard implementation is correct: it computes `const label = getFailedImageLabel(img)` and uses that value in visible row text and the retry button aria label. The test only asserts that the helper exists, that the helper body has the intended fallback expression, and that an `aria-label` consumes a variable named `label`; it does not prove the failed-image map body assigns `label` from `getFailedImageLabel(img)` or that the visible row text is the same helper-derived label.
- Failure scenario: A future refactor could leave `getFailedImageLabel()` in the file to satisfy the test, then change the map body to a weaker `const label = img.title ?? img.user_filename ?? \`ID ${img.id}\``. Whitespace-only titles or missing filenames could then produce weak or empty retry labels while `failed-image-retry.test.ts` still passes.
- Suggested fix: Strengthen the source contract to slice the failed-image map body and require `const label = getFailedImageLabel(img);`, the visible row `{label}`, and the retry `aria-label` inside that same body. A render-level `DashboardClient` test with whitespace title and fallback filename/id would be stronger if it can be mounted without broad fixture setup.

## Non-Findings / Refutations

- No current dashboard UI bug is confirmed for `C84-CR-02`. The implementation currently uses `getFailedImageLabel(img)` at `dashboard-client.tsx:85`, renders `{label}` at `dashboard-client.tsx:109` through `dashboard-client.tsx:110`, and passes `{ label }` to the retry aria label at `dashboard-client.tsx:122`.
- Do not re-open Cycle 83 `C83-02` for search/similar labels. The search test now requires helper assignment plus rendered `{label}` (`apps/web/src/__tests__/search-disclaimer.test.ts:19` through `apps/web/src/__tests__/search-disclaimer.test.ts:25`), and the component satisfies it (`apps/web/src/components/search.tsx:71`, `apps/web/src/components/search.tsx:104` through `apps/web/src/components/search.tsx:105`). Similar-photo tests require `label={label}`, `title`, `aria-label`, and `alt` (`apps/web/src/__tests__/cycle-21-source-contracts.test.ts:14` through `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:22`), and the component satisfies that (`apps/web/src/components/similar-photos.tsx:183`, `apps/web/src/components/similar-photos.tsx:188`, `apps/web/src/components/similar-photos.tsx:231` through `apps/web/src/components/similar-photos.tsx:236`).
- No new product-policy conflict was confirmed. The Cycle 83 delta is review/ledger artifacts, `.gitignore` whitelist entries, and source-contract tests; it does not add edit, culling, scoring, privacy-field, migration, upload, color/HDR, or public-result runtime behavior.
- No performance or concurrency finding is confirmed from the Cycle 83 delta. The perf lane found no runtime-relevant delta and noted the added synchronous file reads live only in Vitest source-contract tests, not request-path code (`.context/reviews/cycle-84-2026-07-01/perf-reviewer.md:10` through `.context/reviews/cycle-84-2026-07-01/perf-reviewer.md:24`).
- No new evidence re-opens carry-forward deferred items. `C80-06`, `C77-ARCH-01`, `C76-04`, `C76-05`, `C75-08`, and the historical performance/semantic/search/browser-matrix items remain governed by their recorded exit criteria (`.context/plans/cycle-83-2026-07-01-deferred.md:12` through `.context/plans/cycle-83-2026-07-01-deferred.md:17`).

## Validation Evidence

- Read-only review plus this requested artifact write.
- `git rev-parse HEAD` and `git rev-parse origin/master` both returned `023ae28d41ee757caaa408710bd864d88087a40c`.
- `git show --show-signature --no-patch HEAD` reported a good GPG signature.
- No full quality gates were run in this critic lane because the user requested review-only output and no implementation was performed.
