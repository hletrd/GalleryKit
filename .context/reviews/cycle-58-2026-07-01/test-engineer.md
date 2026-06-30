# Cycle 58 Test-Engineer + Verifier Review

Current HEAD reviewed: `51bca78933a702e237853a509ddce10f13f9ed6b`.

Focused validation in this lane passed:

```text
npm test --workspace=apps/web -- settings-semantic-mode-action.test.ts data-viewer-select-fields.test.ts cycle-56-source-contracts.test.ts deploy-script-contract.test.ts settings-submit-payload.test.ts photo-og-metadata.test.ts
Test Files  6 passed (6)
Tests       36 passed (36)
```

## Findings

### C58-02 - Photo page public/admin fetch split is still protected by source-grep, not behavior

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:143`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:152`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:153`, `apps/web/src/__tests__/cycle-56-source-contracts.test.ts:28`, `apps/web/src/__tests__/cycle-56-source-contracts.test.ts:30`, `apps/web/src/__tests__/cycle-56-source-contracts.test.ts:32`
- Failure scenario: Cycle 57 restored the intended anonymous fast path by starting `getImageCached(imageId)` and only calling `getImageForViewerCached(imageId, true)` for admins. The regression guard still reads source text and regexes the branch. A future refactor could leave those strings in comments/dead code, or move an admin-field fetch into the anonymous path, while the test still passes.
- Suggested fix: Add behavior-level coverage that mocks `getImageCached`, `getImageForViewerCached`, and `isAdmin`; assert anonymous render uses the public promise and never calls the admin viewer fetch, while admin render calls `getImageForViewerCached(imageId, true)` only after a public image exists.

### C58-03 - Strip-GPS lock coverage only tests one boolean change direction

- Severity: Low
- Confidence: High
- Citations: `apps/web/src/app/actions/settings.ts:103`, `apps/web/src/app/actions/settings.ts:112`, `apps/web/src/app/actions/settings.ts:142`, `apps/web/src/app/actions/settings.ts:148`, `apps/web/src/__tests__/settings-semantic-mode-action.test.ts:214`, `apps/web/src/__tests__/settings-semantic-mode-action.test.ts:215`, `apps/web/src/__tests__/settings-semantic-mode-action.test.ts:217`
- Failure scenario: The server contract treats any `strip_gps_on_upload` change after images exist as locked, but the Cycle 57 test only covers `false -> true`. A future regression that only blocks enabling GPS stripping, but allows `true -> false`, would pass the current test while letting a stale/direct server-action request disable GPS stripping after a gallery already contains photos.
- Suggested fix: Parameterize the existing test over both `{ current: 'false', requested: 'true' }` and `{ current: 'true', requested: 'false' }`, preserving the assertions for lock acquisition/release, no transaction, no revalidation, and no audit log.

### C58-01 - Cycle 57 release/deploy claim is not closed in committed evidence

- Severity: Medium
- Confidence: High
- Citations: `AGENTS.md:17`, `.context/plans/cycle-57-2026-07-01-plan.md:8`, `.context/plans/cycle-57-2026-07-01-plan.md:39`, `.context/plans/cycle-57-2026-07-01-plan.md:48`, `.context/plans/cycle-57-2026-07-01-plan.md:49`, `.context/plans/README.md:7`, `.context/plans/README.md:12`
- Failure scenario: Project policy requires `npm run deploy` after every pushed `master` iteration, and the Cycle 57 plan's stated goal includes commit, push, and deploy. The committed plan still has commit/push and deploy unchecked, and the plans index still marks Cycle 57 active.
- Suggested fix: Close the Cycle 57 ledger with exact commit/push/deploy evidence for `51bca789`, update `.context/plans/README.md` so Cycle 57 is no longer active, and make the next aggregate distinguish verified deploy state from test-only gate evidence.

## Inspected Surfaces

Cycle 57 plan/review artifacts, recent commits, photo-page data fetch tests, settings action/payload tests, deploy-script tests, E2E helper/config wiring, privacy select-field guards, and CI quality workflow. Carry-forward deferred items were not re-raised.
