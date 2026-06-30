# Cycle 57/100 Critic / Architecture / Docs Review

Current HEAD reviewed: `677a8410933a9aaabbd43721dcc5a0bdb6eee786`.

## Inventory

- Read first: `AGENTS.md`, `CLAUDE.md`, and the `code-review` skill instructions.
- Current cycle ledgers: `.context/reviews/cycle-57-2026-07-01/code-reviewer.md`, `designer.md`, `perf-reviewer.md`, `security-reviewer.md`, `test-engineer.md`.
- Recent plan/review ledgers: `.context/plans/README.md`, `.context/plans/cycle-56-2026-07-01-plan.md`, `.context/plans/cycle-56-2026-07-01-deferred.md`, `.context/reviews/_aggregate.md`, `.context/reviews/cycle-56-2026-07-01/_aggregate.md`.
- Route/data layering: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/app/[locale]/(public)/map/page.tsx`.
- Settings/deploy/schema/docs surfaces: `apps/web/src/app/actions/settings.ts`, `apps/web/src/__tests__/settings-semantic-mode-action.test.ts`, `apps/web/src/__tests__/settings-image-sizes-lock.test.ts`, `apps/web/src/__tests__/cycle-56-source-contracts.test.ts`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/src/__tests__/deploy-script-contract.test.ts`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `README.md`, `apps/web/README.md`, `apps/web/src/lib/storage/index.ts`.

Validation run:

```text
bash -n apps/web/deploy.sh scripts/deploy-remote.sh
pass

npm test --workspace=apps/web -- migration-journal.test.ts migrate-reconcile-coverage.test.ts privacy-fields.test.ts cycle-56-source-contracts.test.ts settings-semantic-mode-action.test.ts deploy-script-contract.test.ts
Test Files  6 passed (6)
Tests       116 passed (116)

npm run lint:api-auth --workspace=apps/web
pass

npm run lint:action-origin --workspace=apps/web
pass

npm run lint:public-route-rate-limit --workspace=apps/web
pass
```

## Findings

### CRIT-C57-01 - Public photo render lost public-image `cache()` reuse and starts the main image query late

- Severity: Medium
- Confidence: High
- Files: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:55`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:59`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:143`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:150`, `apps/web/src/lib/data.ts:1200`, `apps/web/src/lib/data.ts:1204`, `apps/web/src/lib/data.ts:1730`, `apps/web/src/lib/data.ts:1731`
- Failure scenario: On a normal anonymous `/p/[id]` request, metadata fetches the public image through `getImageCached(imageId)`, while the page waits for locale, translations, SEO, gallery config, and `isAdmin()` before starting `getImageForViewerCached(imageId, false)`. The false branch uses the same public select shape as `getImage`, but it is wrapped in a different React `cache()` function, so the metadata/page paths do not dedupe and the visible render starts the image/tags/prev/next query later. Under DB latency or pool contention this increases TTFB and duplicate DB work on a hot public route.
- Suggested fix: Start `const publicImagePromise = getImageCached(imageId)` before the page-level `Promise.all`. Resolve `isAdmin()` in parallel. If admin, fetch `getImageForViewerCached(imageId, true)`; otherwise reuse `publicImagePromise`. Keep metadata and OG on public data.

### CRIT-C57-02 - Admin photo audit-data regression is guarded by source strings instead of behavior

- Severity: Medium
- Confidence: High
- Files: `apps/web/src/__tests__/cycle-56-source-contracts.test.ts:13`, `apps/web/src/__tests__/cycle-56-source-contracts.test.ts:14`, `apps/web/src/__tests__/cycle-56-source-contracts.test.ts:24`, `apps/web/src/__tests__/cycle-56-source-contracts.test.ts:28`, `apps/web/src/lib/data.ts:1204`, `apps/web/src/lib/data.ts:1205`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:143`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:150`
- Failure scenario: Cycle 56 fixed admin photo pages by selecting admin audit fields only after `isAdmin()`, but the regression test only checks for literal source snippets. A future refactor can leave those snippets in dead code/comments or change `getImageForViewer` to ignore the boolean while the test still passes; logged-in photographers would again lose color/HDR/original-file audit rows without a behavioral failure.
- Suggested fix: Add behavior-level coverage for `getImageForViewer`: assert the public branch omits representative `PrivacySensitiveKeys` and the admin branch includes representative audit fields such as `icc_profile_name`, `transfer_function`, `is_hdr`, and `filename_original`. Keep a smaller source contract only for metadata/OG staying public-shaped if needed.

### CRIT-C57-03 - Changed `strip_gps_on_upload` lock branch lacks behavior coverage

- Severity: Medium
- Confidence: High
- Files: `apps/web/src/app/actions/settings.ts:103`, `apps/web/src/app/actions/settings.ts:112`, `apps/web/src/app/actions/settings.ts:142`, `apps/web/src/app/actions/settings.ts:149`, `apps/web/src/__tests__/settings-semantic-mode-action.test.ts:198`, `apps/web/src/__tests__/settings-semantic-mode-action.test.ts:202`, `apps/web/e2e/admin.spec.ts:73`
- Failure scenario: A stale same-origin admin client or direct server-action call submits `strip_gps_on_upload=true` after images already exist. The action should detect a real contract change, acquire/release the upload-processing contract lock, and return `uploadSettingsLocked` before persistence. Current tests only prove the unchanged `false` payload skips active-upload checks, and the E2E only proves the hydrated UI can show a locked toggle; a server-side regression in the changed branch would not be caught.
- Suggested fix: Add a behavior test mirroring the changed `image_sizes` case: seed current `strip_gps_on_upload=false`, seed an existing image row, call `updateGallerySettings({ strip_gps_on_upload: 'true' })`, expect `{ error: 'uploadSettingsLocked' }`, lock release, no transaction, no revalidation, and no audit log. Add a no-existing-image positive case when this branch is next touched.

### CRIT-C57-04 - Cycle 56 release ledger still reads active after two fix commits

- Severity: Medium
- Confidence: High
- Files: `.context/plans/README.md:7`, `.context/plans/README.md:12`, `.context/plans/cycle-56-2026-07-01-plan.md:51`, `.context/plans/cycle-56-2026-07-01-plan.md:52`, `.context/reviews/_aggregate.md:3`
- Failure scenario: Current `master`/`origin/master` is `677a8410`, containing the Cycle 56 implementation commit and a deploy-stat follow-up, but the plan index still labels Cycle 56 active and the Cycle 56 plan leaves commit/push/deploy unchecked. Operators and future review agents cannot tell from committed ledgers whether `30dad6a8` or `677a8410` was deployed, repeating the release-ledger drift class Cycle 56 was supposed to close.
- Suggested fix: Close the Cycle 56 plan with exact signed commit, pull-rebase/push, and deploy evidence for the final deployed hash; update `.context/plans/README.md` to mark Cycle 56 implemented and advance Cycle 57 pointers; update `.context/reviews/_aggregate.md` after Cycle 57 aggregation.

## Non-Findings

- Product-policy sweep found no live docs/source violation for removed paid downloads, unsupported S3/MinIO switching, bundled Lightroom plugins, or edit/culling/scoring features. Current docs explicitly frame those as unsupported or removed in `README.md`, `apps/web/README.md`, and `apps/web/src/lib/storage/index.ts`.
- Deploy script safety is consistent with docs: Compose runs before prune, health gates prune, `volume prune` does not use `-a`, and runtime/deploy env files are permission-checked before source/Docker use.
- Schema/journal drift was not confirmed. The journal tail is monotonic through `0028_rate_limit_bucket_start_idx`, and targeted migration/reconcile tests passed.
- Public route/auth/rate-limit scanner drift was not confirmed; all three custom lint gates passed.

## Missed-Issues Sweep

Final sweep covered recent diffs from `4dbbbf9b..HEAD`, current Cycle 57 peer ledgers, Cycle 56 aggregate and deferred register, product-policy grep over live docs/source, public/admin select-field boundaries, map GPS exposure, semantic/similar enrichment fields, settings contract branches, deploy docs/scripts/tests, migration journal/reconcile coverage, and custom lint gates. I did not re-raise carry-forward deferred items (`PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, `AGG-C38-08`) because this pass found no new evidence changing their severity or scheduling.

Finding count: 4
