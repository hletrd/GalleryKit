# Cycle 56 Test Engineer and Verifier Review

Current HEAD reviewed: `e82311b9822645b055c4638540f5fd1cc3704463`.

## Inventory Examined

- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/lib/settings-submit-payload.ts`
- `apps/web/src/__tests__/settings-submit-payload.test.ts`
- `apps/web/src/__tests__/settings-image-sizes-lock.test.ts`
- `apps/web/src/__tests__/settings-semantic-mode-action.test.ts`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `apps/web/src/__tests__/deploy-script-contract.test.ts`
- `.github/workflows/quality.yml`
- `apps/web/e2e/*.spec.ts`

## Findings

### C56-04 - `image_sizes` lock test is not scoped to the branch it claims to protect

- Severity: Medium
- Confidence: High
- Files: `apps/web/src/__tests__/settings-image-sizes-lock.test.ts:11`
- Failure scenario: The test slices from the `image_sizes` branch to the next `try {`, but there is no later `try {`; `indexOf(...)` returns `-1`, so the test scans almost the rest of `settings.ts`. A future change could remove the existing-image check from the `image_sizes` branch while leaving another `.from(images).limit(1)` later in the file, and this test would still pass.
- Suggested fix: Replace the brittle source-slice assertion with behavior coverage for `updateGallerySettings({ image_sizes: ... })`, including changed and semantically unchanged payloads.

### C56-05 - Deploy permission regression tests do not prove refusal actually exits

- Severity: Medium
- Confidence: High
- Files: `apps/web/src/__tests__/deploy-script-contract.test.ts:73`
- Failure scenario: The deploy tests assert that permission-check strings appear before `source` or Docker Compose, but they do not assert that unsafe-permission branches exit. A regression could keep warning text and remove `exit 1`, allowing deploy to proceed with group/world-readable secrets while tests pass.
- Suggested fix: Add execution-level tests with temporary unsafe env files. Assert nonzero exit, chmod remediation text, and that source/Docker stubs are not reached.

## Final Sweep

No additional test-only finding was confirmed. Existing carry-forward deferred items were not re-raised.
