# Cycle 85/100 Test-Engineer Review

Reviewed HEAD: `1d29b98861098a68a8107746997a5d81d70f03f1`.
Baseline focus: Cycle 84 implementation/test delta from `023ae28d41ee757caaa408710bd864d88087a40c` to HEAD, plus adjacent failed-image retry regression coverage.
Date: 2026-07-01.

## Scope And Inventory

- Required context read: `AGENTS.md`, `CLAUDE.md`, the `code-review` skill, latest aggregate `.context/reviews/_aggregate.md`, Cycle 84 aggregate/reviews, Cycle 84 plan/deferred files, root `package.json`, and `apps/web/package.json`.
- Cycle 84 delta inspected: review/plan ledgers, `.gitignore`, and `apps/web/src/__tests__/failed-image-retry.test.ts`; no production runtime source changed in the Cycle 84 commit.
- Test inventory: `apps/web/vitest.config.ts:17` includes `src/__tests__/**/*.test.{ts,tsx}` and `apps/web/playwright.config.ts:49` through `apps/web/playwright.config.ts:84` configures one Chromium Playwright project with a local web server by default. The tree currently has 317 test/e2e files by file inventory.
- Cycle 84 gate evidence reviewed from the signed commit trailer and plan: local lint/typecheck/build/Vitest gates are recorded in the commit trailer; e2e is explicitly not run in the trailer. The Cycle 84 plan records full local gate pass evidence at `.context/plans/cycle-84-2026-07-01-plan.md:53` through `.context/plans/cycle-84-2026-07-01-plan.md:61`.
- I did not run tests in this lane. This was a read-only coverage review except for this artifact.

## Findings

### C85-TE-01 - Retry aria label contract still passes if translations drop the `{label}` interpolation

- Severity: Low.
- Confidence: High.
- Citations: `apps/web/src/__tests__/failed-image-retry.test.ts:159`, `apps/web/src/__tests__/failed-image-retry.test.ts:161`, `apps/web/src/__tests__/failed-image-retry.test.ts:162`, `apps/web/src/__tests__/failed-image-retry.test.ts:163`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:122`, `apps/web/messages/en.json:73`, `apps/web/messages/en.json:74`, `apps/web/messages/ko.json:73`, `apps/web/messages/ko.json:74`, `apps/web/src/__tests__/i18n-key-parity.test.ts:47`, `apps/web/src/__tests__/i18n-key-parity.test.ts:65`.
- Problem: Cycle 84 correctly strengthened the dashboard source slice so the row assigns `const label = getFailedImageLabel(img);`, renders `{label}`, and passes `{ label }` into `t(...)`. However, the accessible name still depends on both retry message templates preserving `{label}`. The current EN/KO messages do include it, but the focused retry test never reads message files, and the global i18n parity test intentionally checks key sets only, not placeholder variables.
- Failure scenario: a future copy edit changes `dashboard.retryImageAria` to `"Retry processing"` in one or both locale files. `failed-image-retry.test.ts` still passes because the component still passes `{ label }`, and `i18n-key-parity.test.ts` still passes because the key remains present. The retry button then loses the per-image accessible name that Cycle 84 intended to lock.
- Suggested fix: add a focused assertion in `failed-image-retry.test.ts` or an i18n placeholder-parity helper requiring `dashboard.retryImageAria` and `dashboard.retryingImageAria` in both locales to contain `{label}`. Keep it targeted; a full value-equality test would conflict with the existing Korean pluralization/value-shape policy.

### C85-TE-02 - Permanently failed ID deletion coverage can pass without either delete action performing cleanup

- Severity: Low.
- Confidence: High.
- Citations: `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts:9`, `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts:25`, `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts:33`, `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts:41`, `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts:50`, `apps/web/src/__tests__/image-queue-permanent-failure.test.ts:85`, `apps/web/src/__tests__/image-queue-permanent-failure.test.ts:91`, `apps/web/src/app/actions/images.ts:697`, `apps/web/src/app/actions/images.ts:699`, `apps/web/src/app/actions/images.ts:809`, `apps/web/src/app/actions/images.ts:812`.
- Problem: The current source is correct: `deleteImage()` and `deleteImages()` both remove IDs from `queueState.permanentlyFailedIds`. The tests are weaker than their claims. `image-queue-permanent-failure-cleanup.test.ts` directly mutates `getProcessingQueueState()` and comments that it is simulating the actions, so it would still pass if both action cleanup sites were deleted. The source contract in `image-queue-permanent-failure.test.ts` only checks for one `permanentlyFailedIds.delete(id)` occurrence anywhere in `images.ts`, so it cannot distinguish single-delete, batch-delete, retry, or unrelated cleanup.
- Failure scenario: a future refactor drops the batch `deleteImages()` cleanup loop while keeping `deleteImage()` intact. The direct-state simulation keeps passing, and the single regex still sees the surviving single-delete cleanup. Permanently failed IDs can then remain excluded from bootstrap after batch deletion and DB restore/reuse scenarios.
- Suggested fix: strengthen the source contract to slice `export async function deleteImage` and `export async function deleteImages` separately and require cleanup in both bodies, or add a mocked action-level behavior test that seeds `permanentlyFailedIds`, calls each action through existing DB mocks, and asserts only the found/deleted IDs are removed.

## Cycle 84 Lock Assessment

- `C84-02` is substantially locked at source level: the new failed-image row body slice at `apps/web/src/__tests__/failed-image-retry.test.ts:154` through `apps/web/src/__tests__/failed-image-retry.test.ts:163` now binds `getFailedImageLabel(img)` to visible row text and the retry aria-label call, and current dashboard source satisfies it at `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:85`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:109`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:110`, and `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:122`. Finding `C85-TE-01` is the remaining translation-template edge, not a refutation of the Cycle 84 fix.
- `C84-01` appears closed for Cycle 83: `.context/plans/cycle-83-2026-07-01-plan.md:49` and `.context/plans/cycle-83-2026-07-01-plan.md:50` now mark commit/push and terminal release state complete, and `.context/plans/README.md:12` moves Cycle 83 to Recent Plans with the deploy-evidence gap/supersession note.
- Cycle 84 itself is not e2e-locked: the signed commit trailer records `Not-tested: npm run test:e2e --workspace=apps/web`, while the plan requires deploy after push at `.context/plans/cycle-84-2026-07-01-plan.md:39` and still has commit/push/deploy unchecked at `.context/plans/cycle-84-2026-07-01-plan.md:48` through `.context/plans/cycle-84-2026-07-01-plan.md:49`. I am not filing this as a test-engineer finding because it is a release-ledger/deploy-evidence issue rather than a regression-test gap, but verifier/document lanes should close or explicitly supersede it.

## Non-Findings / Adequate Contracts

- I did not re-open the Cycle 83 search/similar label findings. The search source contract binds `getPhotoResultLabel(...)` to visible `{label}` at `apps/web/src/__tests__/search-disclaimer.test.ts:20` through `apps/web/src/__tests__/search-disclaimer.test.ts:25`, and current source satisfies it at `apps/web/src/components/search.tsx:71`, `apps/web/src/components/search.tsx:104`, and `apps/web/src/components/search.tsx:105`.
- Similar-photo label flow remains adequately source-locked from parent mapping through thumbnail `title`, `aria-label`, and `alt` at `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:14` through `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:20`, with current source at `apps/web/src/components/similar-photos.tsx:183`, `apps/web/src/components/similar-photos.tsx:188`, `apps/web/src/components/similar-photos.tsx:231`, `apps/web/src/components/similar-photos.tsx:232`, and `apps/web/src/components/similar-photos.tsx:236`.
- The shared result-label helper has behavior coverage for filename-like and blank titles at `apps/web/src/__tests__/photo-title.test.ts:92` through `apps/web/src/__tests__/photo-title.test.ts:101`, matching the implementation at `apps/web/src/lib/photo-title.ts:85` through `apps/web/src/lib/photo-title.ts:99`.
- I did not re-raise deferred items `C80-06`, `C77-ARCH-01`, `C76-04`, `C76-05`, or `C75-08`; this lane found no new evidence that their recorded exit criteria were hit.

## Flaky Risk Notes

- Existing Playwright admin coverage is intentionally serialized at `apps/web/playwright.config.ts:49` through `apps/web/playwright.config.ts:58` to avoid login-rate-limit races. Admin E2E remains opt-in outside CI/known local credentials at `apps/web/e2e/admin.spec.ts:6` through `apps/web/e2e/admin.spec.ts:12`, so unit/source contracts continue to carry most regression load.
- `apps/web/src/__tests__/.omc/` is ignored scratch state, not a committed test fixture. It should not affect Vitest discovery because the config only includes `*.test.ts(x)`.
