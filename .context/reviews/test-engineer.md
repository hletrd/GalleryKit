# Cycle 27 Test-Engineer Review

Role: test-engineer
Workspace: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `1e8bba02`
Date: 2026-06-30

## Scope And Inventory

I reviewed the project instructions in `AGENTS.md` and `CLAUDE.md`, then inventoried the review-relevant test and gate surface before inspecting behavior paths:

- Quality scripts and CI: `package.json`, `apps/web/package.json`, `.github/workflows/quality.yml`.
- Test configuration: `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`.
- Custom lint gates: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, plus their fixtures/tests.
- Unit tests under `apps/web/src/__tests__/`, with focused attention on sharing, image actions, tag actions, route rate limits, privacy, touch targets, and custom lint gate fixtures.
- Playwright specs under `apps/web/e2e/`.
- Cycle-27 target implementation areas from `.context/plans/archive/plan-73-cycle27-fixes.md` and `.context/reviews/archive/_aggregate-cycle27.md`.
- Relevant action modules and callers: `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/components/image-manager.tsx`.

Validation run during review:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.

I did not run the full unit, typecheck, build, or Playwright suites in this review pass; this report is based on static cross-file inspection plus the targeted lint-gate validation above.

## Confirmed Issues

### C27-TE-01: Sharing action regressions are mostly protected by source-string tests, not behavior tests

Severity: Medium
Confidence: High
Category: Unit coverage / regression coverage

Evidence:

- `createPhotoShareLink` performs authorization, rate limiting, atomic share-key creation, audit logging, and revalidation in `apps/web/src/app/actions/sharing.ts:91-192`; the cycle-27-sensitive postconditions are at `apps/web/src/app/actions/sharing.ts:149-156`.
- `createGroupShareLink` validates up to 100 images, inserts the group and link rows transactionally, revalidates, and logs audit metadata in `apps/web/src/app/actions/sharing.ts:194-315`; key postconditions are at `apps/web/src/app/actions/sharing.ts:258-289`.
- `revokePhotoShareLink` conditionally clears the existing key, revalidates the photo/shared/admin paths, and logs revocation in `apps/web/src/app/actions/sharing.ts:317-354`.
- `deleteGroupShareLink` explicitly deletes `sharedGroupImages` before `sharedGroups` inside a transaction, then revalidates and audits in `apps/web/src/app/actions/sharing.ts:357-397`.
- The only dedicated sharing test file currently reads the source and asserts two string-slice contracts in `apps/web/src/__tests__/sharing-source-contracts.test.ts:1-27`; it does not import or execute any sharing action.

Concrete failure scenario:

A future refactor can remove `tx.delete(sharedGroupImages)` from `deleteGroupShareLink`, drop the `group_share_delete` audit call, revalidate only `/` instead of `/g/${group.key}` and `/admin/dashboard`, or break the `createGroupShareLink` transaction link-count check. The existing sharing test would still pass because it only checks two source snippets around photo-share rate-limit rollback.

Suggested fix:

Add a behavior-level `sharing-actions.test.ts` with mocked `db`, `isAdmin`, `getCurrentUser`, `headers`, rate-limit helpers, `revalidateLocalizedPaths`, and `logAuditEvent`. Cover:

- `createPhotoShareLink` success, existing-key no-op, DB limit rollback, concurrent winner rollback, audit metadata, and `/p/:id` plus admin revalidation.
- `createGroupShareLink` unique ID handling, transaction insert of group plus ordered `sharedGroupImages`, link-count mismatch failure, audit metadata, and non-auditing failure paths.
- `revokePhotoShareLink` conditional update success and affectedRows=0 race path.
- `deleteGroupShareLink` explicit child-row delete before group delete, no audit on transaction failure, and revalidation of `/`, `/g/:key`, and `/admin/dashboard`.

### C27-TE-02: Image upload audit and metadata-edit behavior are not pinned by focused tests

Severity: Medium
Confidence: High
Category: Unit coverage / audit and cache postconditions

Evidence:

- `uploadImages` now logs `image_upload` metadata and revalidates home, admin dashboard, and topic paths in `apps/web/src/app/actions/images.ts:604-613`.
- `updateImageMetadata` validates/sanitizes inputs, updates nullable metadata, logs `image_update`, computes affected share/group paths, revalidates photo/admin/home/topic/share paths, and returns sanitized values in `apps/web/src/app/actions/images.ts:891-962`.
- `apps/web/src/__tests__/images-actions.test.ts:178` imports only `uploadImages`, not `updateImageMetadata`.
- The upload happy-path test asserts revalidation and queue snapshot behavior in `apps/web/src/__tests__/images-actions.test.ts:239-277`, but it does not assert the `logAuditEventMock` call even though the mock is defined at `apps/web/src/__tests__/images-actions.test.ts:20-42` and reset at `apps/web/src/__tests__/images-actions.test.ts:223-224`.
- The admin UI depends on the sanitized return shape from `updateImageMetadata` in `apps/web/src/components/image-manager.tsx:274-317`.

Concrete failure scenario:

Removing `logAuditEvent(currentUser.id, 'image_upload', ...)` from the upload success path, removing `logAuditEvent(..., 'image_update', ...)` from metadata edits, dropping share/group revalidation from `updateImageMetadata`, or returning raw unsanitized title/description values would not be caught by the current focused action tests.

Suggested fix:

Extend `images-actions.test.ts` or add a dedicated metadata test file:

- Assert `uploadImages` success calls `logAuditEventMock` with `image_upload`, `count`, `failed`, `topic`, and comma-joined `tags`; assert no upload audit when all files fail before persistence.
- Add `updateImageMetadata` tests for successful sanitized persistence, nullable title/description preservation, `image_update` audit, revalidation of `/p/:id`, `/admin/dashboard`, `/`, topic path, direct share path, and group share paths.
- Add negative tests for invalid ID, rejected sanitized input, overlong code-point counts, missing image, and `affectedRows === 0`, asserting no audit and no revalidation on those branches.

## Likely Issues

### C27-TE-03: `updateTag` dashboard revalidation and audit behavior lack direct tests

Severity: Low
Confidence: Medium-High
Category: Unit coverage / cache postconditions

Evidence:

- `updateTag` validates input, updates the tag and affected image timestamps transactionally, logs `tag_update`, and revalidates `/admin/tags`, `/admin/dashboard`, and `/` in `apps/web/src/app/actions/tags.ts:42-106`.
- The tag action unit file mocks revalidation and audit in `apps/web/src/__tests__/tags-actions.test.ts:100-105`, but it imports only `addTagToImage`, `batchAddTags`, and `batchUpdateImageTags` at `apps/web/src/__tests__/tags-actions.test.ts:117`.
- Current tag tests exercise add/batch behavior in `apps/web/src/__tests__/tags-actions.test.ts:143-255`; they do not call `updateTag`.

Concrete failure scenario:

A future change can remove `/admin/dashboard` from `updateTag` revalidation or stop logging `tag_update`; the current tag action tests would still pass because `updateTag` is not imported.

Suggested fix:

Add focused `updateTag` tests for successful transaction behavior, `tag_update` audit payload, exact revalidation paths, empty/malformed input, missing tag, duplicate/DB error behavior, and affected-image timestamp update only when linked images exist.

## Risks Needing Manual Validation

### C27-TE-R01: Nav visual screenshots are artifacts, not visual regression assertions

Severity: Low
Confidence: Medium
Category: Playwright / visual validation

Evidence:

- The nav e2e spec asserts visibility, target dimensions, and no overlap in `apps/web/e2e/nav-visual-check.spec.ts:6-38`.
- The tests save screenshots to `test-results/nav-collapsed-mobile.png`, `test-results/nav-expanded-mobile.png`, and `test-results/nav-desktop.png` in `apps/web/e2e/nav-visual-check.spec.ts:41-78`, but they do not compare against approved baselines.

Concrete failure scenario:

A visual regression that preserves 44px targets and avoids geometric overlap, such as wrong color contrast, misplaced spacing, clipped icon styling, or unintended theme color, can pass CI while only leaving a screenshot artifact for manual inspection.

Suggested fix:

If visual fidelity is intended to be automated, convert the artifact-only screenshots to `expect(page).toHaveScreenshot(...)` with stable masks/thresholds and committed baselines. If screenshots are intentionally manual artifacts, document the manual review step and expected owner in the e2e README or test comment.

## TDD Opportunities

- Replace the sharing source-slice tests with behavior-first tests before further sharing refactors. Keep one source-contract test only if there is a specific ordering invariant that cannot be expressed through behavior.
- For action postconditions added in cycle 27, write tests that fail before the fix: audit calls, exact cache paths, transaction boundaries, and failure paths with no audit/revalidation.
- Use the existing mock-heavy action test style consistently: the project already has viable patterns for `vi.hoisted`, mocked `db` chains, `logAuditEventMock`, and `revalidateLocalizedPathsMock`.

## Non-Findings / Avoided Duplicates

- I did not re-report the prior OG route GET rate-limit behavior gap. The current suite includes behavior coverage in `apps/web/src/__tests__/og-route-rate-limit-behavior.test.ts`.
- I did not re-report the prior shared-link lookup throttling gap. The current shared page title tests include over-limit behavior coverage and assert that data fetches are skipped after rate limiting.
- I did not duplicate cycle-27 implementation findings from `.context/reviews/archive/_aggregate-cycle27.md`; this review focuses on remaining test coverage and validation gaps around those fixes.

## Final Sweep Confirmation

Reviewed categories:

- Docs and policy: `AGENTS.md`, `CLAUDE.md`, cycle-27 plan and aggregate review artifacts.
- Gates: root/workspace scripts, GitHub Actions quality workflow, custom lint gate scripts and fixtures.
- Unit tests: route rate-limit tests, sharing tests, image action tests, tag/topic action tests, privacy/touch-target-related suite structure.
- E2E tests: admin, public, origin guard, and nav visual specs plus Playwright configuration.
- Cross-file interactions: server actions to UI callers, action exports, audit logging, cache revalidation helpers, DB transaction expectations, and CI gate ordering.

No app code was edited. No commit was made. The remaining findings above are real coverage/validation gaps, not permanently deferred policy items.
