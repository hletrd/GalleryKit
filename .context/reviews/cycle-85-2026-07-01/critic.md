# Cycle 85/100 Critic Review

Reviewed HEAD: `1d29b98861098a68a8107746997a5d81d70f03f1`.
Date: 2026-07-01.
Role: critic lane.

## Result

Confirmed findings: 3.

Severity summary: Critical 0, High 0, Medium 1, Low 2.

Scope: adversarial release-state, correctness, security, test, docs, UX, deploy, and deferred-item review. Source and plan files were not edited. This artifact is the only intended write.

## Inventory

- Read required control/context docs: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/reviews/_aggregate.md`, `.context/reviews/cycle-84-2026-07-01/_aggregate.md`, `.context/plans/cycle-84-2026-07-01-plan.md`, and `.context/plans/cycle-84-2026-07-01-deferred.md`.
- Read Cycle 85 lane artifacts already present: `architect.md`, `code-reviewer.md`, `security-reviewer.md`, `perf-reviewer.md`, and `test-engineer.md`.
- Git evidence: `HEAD == origin/master == 1d29b98861098a68a8107746997a5d81d70f03f1`; `git log -1 --show-signature` reports a good GPG signature from `Jiyong Youn <01@0101010101.com>`.
- Cycle 84 delta inventory: plan/review ledgers, `.gitignore`, and `apps/web/src/__tests__/failed-image-retry.test.ts`; no production runtime source changed in the Cycle 84 commit.
- Targeted validation run in this lane: `npm test --workspace=apps/web -- --run src/__tests__/failed-image-retry.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/image-queue-permanent-failure.test.ts src/__tests__/image-queue-permanent-failure-cleanup.test.ts` passed: 4 files, 34 tests.
- Whitespace validation: `git diff --check HEAD~1..HEAD` passed with no output.

## Findings

### C85-CRIT-01 - Cycle 84 release ledger remains active and deploy-unclosed after its pushed signed HEAD

Severity: Medium.
Confidence: High.

Evidence:
- Project policy requires `npm run deploy` after every commit pushed to `master`: `AGENTS.md:17`, `CLAUDE.md:469`.
- Cycle 84's stated goal includes commit/push and deploy: `.context/plans/cycle-84-2026-07-01-plan.md:8`.
- Cycle 84 validation explicitly requires signed commit, pull-rebase, push, and deploy after local gates: `.context/plans/cycle-84-2026-07-01-plan.md:39`.
- The plan index still lists Cycle 84 as active: `.context/plans/README.md:5`, `.context/plans/README.md:7`, `.context/plans/README.md:8`.
- The Cycle 84 plan marks local implementation and gates complete but leaves commit/push and deploy unchecked: `.context/plans/cycle-84-2026-07-01-plan.md:43`, `.context/plans/cycle-84-2026-07-01-plan.md:47`, `.context/plans/cycle-84-2026-07-01-plan.md:48`, `.context/plans/cycle-84-2026-07-01-plan.md:49`.
- Gate evidence records local checks only, ending with `git diff --cached --check`: `.context/plans/cycle-84-2026-07-01-plan.md:53`, `.context/plans/cycle-84-2026-07-01-plan.md:61`.

Why this matters:
Cycle 84 fixed this exact release-ledger ambiguity for Cycle 83, but Cycle 84 now repeats it for itself. Reviewers can prove the signed commit reached `origin/master` from Git, but the committed ledger still cannot distinguish "pushed and deployed" from "pushed, local gates passed, deploy evidence missing."

Suggested fix:
Record signed `1d29b988` / `origin/master` commit-push evidence in the Cycle 84 plan, record the `npm run deploy` result or an explicit deploy-evidence gap/supersession note, and move Cycle 84 from active to recent in `.context/plans/README.md`.

### C85-CRIT-02 - Retry aria-label regression guard does not pin the required `{label}` message placeholder

Severity: Low.
Confidence: High.

Evidence:
- The strengthened failed-image retry test now pins the row-local helper-derived `label` and the component's `t(..., { label })` call: `apps/web/src/__tests__/failed-image-retry.test.ts:159`, `apps/web/src/__tests__/failed-image-retry.test.ts:161`, `apps/web/src/__tests__/failed-image-retry.test.ts:162`, `apps/web/src/__tests__/failed-image-retry.test.ts:163`.
- The rendered button depends on the localized message template for the final accessible name: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:122`.
- Current English and Korean templates are correct and include `{label}`: `apps/web/messages/en.json:73`, `apps/web/messages/en.json:74`, `apps/web/messages/ko.json:73`, `apps/web/messages/ko.json:74`.
- The global i18n parity test intentionally checks leaf-key parity only, not placeholder variables or values: `apps/web/src/__tests__/i18n-key-parity.test.ts:47`, `apps/web/src/__tests__/i18n-key-parity.test.ts:65`.

Why this matters:
A future copy edit can keep the same message key but remove `{label}` from `dashboard.retryImageAria` or `dashboard.retryingImageAria`. The focused retry source-contract test would still pass because the component still passes `{ label }`, and the i18n parity test would still pass because the key exists. The result would be a generic retry button name instead of a per-image accessible name.

Suggested fix:
Add a targeted placeholder assertion for `dashboard.retryImageAria` and `dashboard.retryingImageAria` in both locales, either in `failed-image-retry.test.ts` or a small i18n placeholder-parity helper. Do not compare whole values; the repo intentionally allows language-specific value shapes.

### C85-CRIT-03 - Permanently-failed deletion tests simulate cleanup instead of proving both delete actions do it

Severity: Low.
Confidence: High.

Evidence:
- The cleanup test directly mutates `getProcessingQueueState()` and says it is simulating action cleanup rather than invoking or source-slicing the actions: `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts:9`, `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts:25`, `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts:33`, `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts:41`, `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts:50`.
- The source-contract test only requires one `permanentlyFailedIds.delete(id)` match anywhere in `images.ts`: `apps/web/src/__tests__/image-queue-permanent-failure.test.ts:85`, `apps/web/src/__tests__/image-queue-permanent-failure.test.ts:91`.
- Current runtime source is correct for single delete: `apps/web/src/app/actions/images.ts:697`, `apps/web/src/app/actions/images.ts:699`.
- Current runtime source is also correct for batch delete: `apps/web/src/app/actions/images.ts:809`, `apps/web/src/app/actions/images.ts:812`.

Why this matters:
If a future refactor drops the batch `deleteImages()` cleanup while keeping `deleteImage()` cleanup, the simulation test still passes and the single-regex source contract still sees the surviving single-delete cleanup. Stale `permanentlyFailedIds` can then block future processing after batch deletion plus DB restore/ID reuse scenarios.

Suggested fix:
Strengthen the source contract to slice `export async function deleteImage` and `export async function deleteImages` separately and require cleanup in both bodies, or add action-level mocked behavior coverage for both deletion paths.

## Refutations / Non-Issues

- `C84-02` is not a current runtime UI bug. The dashboard currently derives `label` with `getFailedImageLabel(img)`, renders `{label}`, and passes that same value into the retry aria-label call: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:39`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:40`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:85`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:109`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:110`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:122`.
- `C85-CRIT-02` is not a current translation defect. Both current locales include `{label}` in the retry and retrying aria templates: `apps/web/messages/en.json:73`, `apps/web/messages/en.json:74`, `apps/web/messages/ko.json:73`, `apps/web/messages/ko.json:74`.
- `C85-CRIT-03` is not a current action implementation bug. Both `deleteImage()` and `deleteImages()` currently remove found IDs from `permanentlyFailedIds`: `apps/web/src/app/actions/images.ts:697`, `apps/web/src/app/actions/images.ts:699`, `apps/web/src/app/actions/images.ts:809`, `apps/web/src/app/actions/images.ts:812`.
- Cycle 83's release ledger is not still active. Cycle 84 moved it to recent plans with a signed push and deploy-gap/supersession note: `.context/plans/README.md:10`, `.context/plans/README.md:12`, `.context/plans/cycle-83-2026-07-01-plan.md:49`, `.context/plans/cycle-83-2026-07-01-plan.md:50`, `.context/plans/cycle-83-2026-07-01-plan.md:63`, `.context/plans/cycle-83-2026-07-01-plan.md:64`.
- Deferred items were not re-raised. The Cycle 84 deferred register carries explicit exit criteria for `C80-06`, `C77-ARCH-01`, `C76-04`, `C76-05`, and `C75-08`; this pass found no new evidence satisfying those criteria: `.context/plans/cycle-84-2026-07-01-deferred.md:12`, `.context/plans/cycle-84-2026-07-01-deferred.md:13`, `.context/plans/cycle-84-2026-07-01-deferred.md:14`, `.context/plans/cycle-84-2026-07-01-deferred.md:15`, `.context/plans/cycle-84-2026-07-01-deferred.md:16`.
- No new security, performance, or production-source regression is attributable to the Cycle 84 implementation delta. `git diff --name-status HEAD~1..HEAD` shows the runtime source delta is limited to a test file plus docs/review/plan artifacts, and the targeted related test suite passed in this lane.

## Validation

- `git status --short --branch`: `master...origin/master`, with Cycle 85 review artifacts untracked.
- `git rev-parse HEAD` and `git rev-parse origin/master`: both `1d29b98861098a68a8107746997a5d81d70f03f1`.
- `git log -1 --show-signature --format=fuller`: good GPG signature for `1d29b988`.
- `git diff --check HEAD~1..HEAD`: passed.
- Targeted Vitest: 4 files passed, 34 tests passed.

## Not Run

- Full lint/typecheck/build/Vitest/e2e/deploy were not rerun in this critic lane. Cycle 84's signed commit trailer records full local gates except e2e; this lane ran targeted tests for the challenged contracts and reviewed release/deploy evidence from the committed ledgers.
