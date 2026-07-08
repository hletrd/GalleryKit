# Cycle 26 Test Verifier Review

Date: 2026-07-08 KST
Lane: test-verifier-reviewer, read-only specialist review
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `101ebef57ae2a379cce4b5fa04dccd538c438b0c`

## Scope And Inventory

Read first: `AGENTS.md`, `CLAUDE.md`, and the code-review skill guidance. I also inspected the latest Cycle 25 aggregate/plan/deferred files, the current untracked Cycle 26 `code-security-reviewer.md`, and the current HEAD commit that closed Cycle 25 findings.

Primary files inspected:

- Config/re-encode: `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`.
- Restore cleanup: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/__tests__/db-restore.test.ts`.
- Cycle 25 UI fixes: `apps/web/src/components/search.tsx`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, `apps/web/src/__tests__/client-source-contracts.test.ts`.
- Regression-test inventory: `apps/web/src/__tests__/detached-uncached-config-wiring.test.ts`, `admin-backfill-runner-leak.test.ts`, `cycle-17-source-contracts.test.ts`, `gallery-config.test.ts`, `db-restore.test.ts`, e2e skip/focus sweeps.

Focused validation run:

- `npm test --workspace=apps/web -- --run src/__tests__/detached-uncached-config-wiring.test.ts src/__tests__/admin-backfill-runner-leak.test.ts src/__tests__/cycle-17-source-contracts.test.ts src/__tests__/db-restore.test.ts src/__tests__/client-source-contracts.test.ts src/__tests__/gallery-config.test.ts`
- Result: 6 files passed, 61 tests passed.

## Findings

### TV-01 - Sidecar color backfill fail-closed config behavior is source-locked, not behavior-tested

- Severity: Medium
- Confidence: High
- Evidence: `apps/web/scripts/backfill-color-pipeline.ts:350-368` now calls `getGalleryConfigDetachedStrict()` before constructing `backfillSettings`, which fixes Cycle 25's live fail-open risk for the sidecar path. The only sidecar-specific regression lock I found is source-order coverage in `apps/web/src/__tests__/cycle-17-source-contracts.test.ts:55-67`, which asserts the strict accessor string appears after the advisory lock and restore guard. By contrast, the in-app runner has a behavior test in `apps/web/src/__tests__/admin-backfill-runner-leak.test.ts:102-166` that mocks `getGalleryConfigDetachedStrict` rejection and proves no encoding/update occurs plus state/lock cleanup completes. `apps/web/src/__tests__/gallery-config.test.ts:189-197` proves the strict accessor rejects DB errors, but not that the sidecar handles that rejection before processing rows.
- Failure scenario: a future refactor keeps the literal `const config = await getGalleryConfigDetachedStrict()` in the script, so the source-order test still passes, but wraps it in a `catch` that falls back to defaults or moves row queue construction before the rejecting call. The sidecar can again rewrite derivatives with default photographer settings and exit as if current behavior were preserved.
- Suggested test/fix: extract the sidecar main body behind an injectable/exported runner or execute it in a child-process harness with mocked DB/config modules. Add a red-path test where `getGalleryConfigDetachedStrict` rejects and assert `processImageFormats`/`db.transaction` are not called, the process exits non-zero, and the advisory-lock connection is released or process-owned cleanup is explicit.

### TV-02 - Restore spawn cleanup regression is still protected by source shape rather than a temp-file leak test

- Severity: Low-Medium
- Confidence: High
- Evidence: the implementation appears fixed: `spawn('mysql')` is created at `apps/web/src/app/[locale]/admin/db-actions.ts:893-899`, handlers are registered through `:969-971`, cleanup ownership transfers only at `:973-976`, and the outer fallback cleanup remains at `:978-981`. The regression test at `apps/web/src/__tests__/db-restore.test.ts:47-64` checks for those source strings and ordering, but it does not simulate a synchronous `spawn()` throw or assert that the uploaded temp SQL file is actually unlinked. The same test checks child failure shape with string containment at `apps/web/src/__tests__/db-restore.test.ts:66-84`.
- Failure scenario: `cleanupTempFile()` is weakened, a future helper swallows the unlink path, or a spawn setup exception takes a new branch while the source still contains the expected marker strings. The test suite stays green, but failed restore attempts can leave temp SQL dumps on disk.
- Suggested test/fix: add a behavior test around `restoreDatabase` or a small extracted `runRestoreImport` helper with injectable `spawn`, `createReadStream`, and temp path. Force `spawn` to throw synchronously and assert the temp path is removed and the result is a structured restore failure with maintenance state handled as intended.

### TV-03 - Cycle 25 UI accessibility fixes are mostly string-pinned, not interaction-proven

- Severity: Low-Medium
- Confidence: Medium-High
- Evidence: `apps/web/src/__tests__/client-source-contracts.test.ts:71-94` asserts literal source strings for the semantic-search mobile label and persistent taxonomy/SEO form errors. The implementation pieces exist in source: search closed trigger renders visible copy when `semanticSearchMode === 'production'` at `apps/web/src/components/search.tsx:380-397`; SEO renders a persistent alert and `aria-invalid` wiring at `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:107-128`; tag edit renders an alert and associated input at `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:193-202`. I found no component/jsdom/e2e test that renders these controls, drives a rejected save, asserts focus lands on the alert, or confirms the production search label fits and remains visible on a mobile viewport.
- Failure scenario: a handler refactor stops setting `formError`, a translation/conditional branch hides the visible mobile search label, or focus recovery breaks after the alert mounts. The current source test can still pass because the literal strings remain in the file.
- Suggested test/fix: add focused component tests or Playwright admin-flow tests for duplicate/invalid tag/category/SEO saves that assert the persistent alert, `aria-describedby`, `aria-invalid`, and focus recovery. Add a mobile Playwright smoke with semantic mode forced to `production` that asserts the closed search trigger has visible text and remains a 44 px target without overlap.

## Positive Verification Notes

- No `.only` tests were found under `apps/web/src/__tests__` or `apps/web/e2e`.
- Skip sweep found only expected local/admin e2e guards and CLIP model-gated suites: `apps/web/e2e/admin.spec.ts`, `apps/web/e2e/origin-guard.spec.ts`, `apps/web/src/__tests__/clip-offline-load.test.ts`, and `apps/web/src/__tests__/clip-semantic-integration.test.ts`.
- Cycle 25's old browser-upload six-settings gap is closed at current HEAD: `apps/web/src/__tests__/images-actions.test.ts` now asserts `forceSrgbDerivatives`, chroma, effort, quality, sizes, and `wideGamutMaxSourcePixels` forwarding.
- I did not find a confirmed live code defect in the areas above; these findings are regression-strength/test-confidence gaps.

## Final Sweep

I did not run the full lint/typecheck/build/e2e gate set in this lane. The focused run passed for the files most relevant to Cycle 25 fixes. Current worktree already contained another untracked Cycle 26 review file from a separate lane; I did not modify it. This file is the only file written by this lane.
