# Cycle 57/100 Test Engineer and Verifier Review

Current HEAD reviewed: `677a8410933a9aaabbd43721dcc5a0bdb6eee786`.

## Inventory Examined

- Project guidance: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/cycle-56-2026-07-01-plan.md`, `.context/plans/cycle-56-2026-07-01-deferred.md`, `.context/reviews/_aggregate.md`, `.context/reviews/cycle-56-2026-07-01/*`.
- Gate wiring: `package.json`, `apps/web/package.json`, `.github/workflows/quality.yml`, `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/scripts/check-js-scripts.mjs`, `apps/web/tsconfig.scripts.json`.
- Cycle 56 regression surface: `apps/web/src/app/actions/settings.ts`, `apps/web/src/lib/settings-submit-payload.ts`, `apps/web/src/__tests__/settings-submit-payload.test.ts`, `apps/web/src/__tests__/settings-semantic-mode-action.test.ts`, `apps/web/src/__tests__/settings-image-sizes-lock.test.ts`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/src/__tests__/deploy-script-contract.test.ts`, `apps/web/src/__tests__/cycle-56-source-contracts.test.ts`.
- Admin/public data boundary: `apps/web/src/lib/data.ts`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/__tests__/photo-og-metadata.test.ts`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/color-details-section.tsx`.
- E2E and skip posture: `apps/web/e2e/admin.spec.ts`, `apps/web/e2e/origin-guard.spec.ts`, `apps/web/e2e/public.spec.ts`, `apps/web/e2e/nav-visual-check.spec.ts`, `apps/web/e2e/test-fixes.spec.ts`.

## Fresh Validation Evidence

- `npm test --workspace=apps/web -- settings-semantic-mode-action.test.ts settings-image-sizes-lock.test.ts deploy-script-contract.test.ts cycle-56-source-contracts.test.ts privacy-fields.test.ts` - pass: 5 files, 34 tests.
- `npm run lint:api-auth --workspace=apps/web` - pass.
- `npm run lint:action-origin --workspace=apps/web` - pass.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass.
- `npm run check:js-scripts --workspace=apps/web` - pass: checked 8 JavaScript script files.
- `npm run lint --workspace=apps/web` - pass.
- `npm run typecheck --workspace=apps/web` - pass, including script typecheck.
- Not run in this review slice: full `npm test`, `npm run build`, and Playwright E2E. Cycle 56 plan records full unit/build evidence, and CI wiring includes E2E.

## Findings

### C57-TE-01 - Changed `strip_gps_on_upload` server lock branch has no behavior regression test

- Severity: Medium
- Confidence: High
- Files: `apps/web/src/app/actions/settings.ts:103`, `apps/web/src/app/actions/settings.ts:142`, `apps/web/src/app/actions/settings.ts:149`, `apps/web/src/__tests__/settings-semantic-mode-action.test.ts:198`, `apps/web/e2e/admin.spec.ts:73`
- Failure scenario: A stale same-origin admin client or direct server-action call submits `strip_gps_on_upload=true` after images already exist. The action should acquire/release the upload-processing contract lock and return `uploadSettingsLocked` before persistence, but the current behavior tests only prove the semantically unchanged payload path (`strip_gps_on_upload: 'false'`) skips active-upload checks. The E2E settings test proves the hydrated switch can appear disabled, not that the server branch rejects changed payloads.
- Suggested fix: Add a `settings-semantic-mode-action.test.ts` case mirroring the changed `image_sizes` test: seed current `strip_gps_on_upload=false`, seed an existing image row, call `updateGallerySettings({ strip_gps_on_upload: 'true' })`, expect `{ error: 'uploadSettingsLocked' }`, lock release, no transaction, no revalidation, and no audit log. Add a no-existing-image positive case if this branch is next refactored.

### C57-TE-02 - Admin photo audit-data regression is pinned by source strings, not data-selection behavior

- Severity: Medium
- Confidence: High
- Files: `apps/web/src/__tests__/cycle-56-source-contracts.test.ts:13`, `apps/web/src/__tests__/cycle-56-source-contracts.test.ts:24`, `apps/web/src/__tests__/cycle-56-source-contracts.test.ts:28`, `apps/web/src/lib/data.ts:1204`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:143`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:150`
- Failure scenario: Cycle 56 fixed admins losing color/HDR/privacy audit rows on photo pages by adding `getImageForViewerCached(imageId, isAdminUser)`. The regression test only checks that certain source strings exist. A future refactor could leave those strings in dead code/comments or make `getImageForViewer` ignore the boolean while the test still passes, causing logged-in photographers to lose admin-only audit rows again.
- Suggested fix: Add behavior-level coverage around `getImageForViewer`: mock the `db.select(...).from(...).where(...).limit(...)` chain and assert the public path omits `PrivacySensitiveKeys` while the admin path includes representative audit keys such as `icc_profile_name`, `color_space`, `transfer_function`, `is_hdr`, and `filename_original`. Keep the current metadata/OG public-path source contract or replace it with a server-page import test that asserts the page passes the resolved admin boolean into the viewer fetch.

### C57-TE-03 - Cycle 56 evidence ledger still reads active after two fix commits

- Severity: Medium
- Confidence: High
- Files: `.context/plans/cycle-56-2026-07-01-plan.md:51`, `.context/plans/cycle-56-2026-07-01-plan.md:52`, `.context/plans/README.md:7`, `.context/plans/README.md:12`, `.context/reviews/_aggregate.md:3`
- Failure scenario: Current HEAD contains `30dad6a8` and the follow-up deploy-stat hotfix `677a8410`, but the Cycle 56 plan still has commit/push/deploy unchecked and the plan index still labels Cycle 56 active. The latest aggregate pointer still summarizes the pre-fix Cycle 56 findings without terminal evidence. Future Cycle 57+ agents can mistake fixed work for active work, duplicate review/fix effort, or lose the provenance of the `677a8410` hotfix.
- Suggested fix: Close the Cycle 56 ledger with commit/push/deploy evidence for `30dad6a8` and `677a8410`, update `.context/plans/README.md` to mark Cycle 56 implemented, and update the latest aggregate pointer after Cycle 57 aggregation.

## Non-Findings / Carry-Forward Handling

- The three custom lint gates are wired in both package scripts and `.github/workflows/quality.yml`, and all three passed locally.
- `privacy-fields.test.ts` still provides symmetric fixture-drift coverage for `SENSITIVE_KEYS`, `adminSelectFieldKeys`, `publicSelectFieldKeys`, timeline select fields, and search enrichment fields.
- `touch-target-audit.test.ts` still has stale-allowance checks for `KNOWN_VIOLATIONS`; no new touch-target fixture drift was identified from the tested surface.
- `TV-40-03` remains a carry-forward deferred item. I did not re-raise it: this review confirmed the current JS checker fails closed on zero discovery and syntax-checks 8 JS scripts, but semantic `checkJs` migration is already recorded as deferred.
- Skipped CLIP model-weight tests and remote/admin opt-in E2E behavior were not re-raised; these are already represented in prior deferred/operational context and CI still configures local admin E2E.

## Missed-Issues Sweep

Final sweep covered recent Cycle 56 diffs, source-contract tests, custom scanners, skipped tests, privacy fixtures, deploy-script execution tests, settings action behavior tests, admin/public data selection, and current plan/review ledgers. No additional new test, fixture, lint/type gate, or evidence-gap findings were confirmed beyond the three above.
