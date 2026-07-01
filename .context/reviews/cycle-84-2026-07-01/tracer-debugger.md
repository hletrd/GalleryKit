# Cycle 84/100 Tracer / Debugger Review

Reviewed HEAD: `023ae28d41ee757caaa408710bd864d88087a40c`.
Date: 2026-07-01.
Role: tracer-debugger lane.

Scope: Cycle 83 delta, release ledger, public result-label contracts, failed-image retry accessibility, image processing/retry state, and adjacent invariants. No implementation files were edited.

## Confirmed Findings

### C84-TRC-01 - Cycle 83 release ledger remains active and deploy-unclosed after its pushed HEAD

- Severity: Medium.
- Confidence: High.
- Citations: `.context/plans/README.md:5`, `.context/plans/README.md:7`, `.context/plans/cycle-83-2026-07-01-plan.md:8`, `.context/plans/cycle-83-2026-07-01-plan.md:40`, `.context/plans/cycle-83-2026-07-01-plan.md:44`, `.context/plans/cycle-83-2026-07-01-plan.md:49`, `.context/plans/cycle-83-2026-07-01-plan.md:50`, `.context/plans/cycle-83-2026-07-01-plan.md:54`, `.context/plans/cycle-83-2026-07-01-plan.md:62`, `AGENTS.md:17`, `CLAUDE.md:469`.
- Evidence: `git rev-parse HEAD origin/master` returned the same commit, `023ae28d41ee757caaa408710bd864d88087a40c`, and `git verify-commit HEAD` reported a good GPG signature. The committed plan index still lists Cycle 83 under "Active Current-Cycle Plans", and the Cycle 83 plan still leaves commit/pull-rebase/push plus deploy unchecked even though its goal and validation section require both.
- Failure scenario: Cycle 84+ agents and operators cannot distinguish "Cycle 83 was pushed and deployed" from "Cycle 83 was pushed but deploy evidence is missing" without repeating release forensics. This repeats the same ledger ambiguity class Cycle 83 fixed for Cycle 82.
- Suggested fix: update `.context/plans/cycle-83-2026-07-01-plan.md` with signed `023ae28d` / `origin/master` commit-push evidence, record the `npm run deploy` result or an explicit deploy-evidence gap/supersession note, and move Cycle 83 from active to recent in `.context/plans/README.md`.

### C84-TRC-02 - Failed-image retry accessibility can regress while the source contract still passes

- Severity: Low.
- Confidence: High.
- Citations: `apps/web/src/__tests__/failed-image-retry.test.ts:153`, `apps/web/src/__tests__/failed-image-retry.test.ts:154`, `apps/web/src/__tests__/failed-image-retry.test.ts:155`, `apps/web/src/__tests__/failed-image-retry.test.ts:156`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:39`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:40`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:85`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:109`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:110`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:122`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123`.
- Evidence: the runtime implementation currently computes `label` with `getFailedImageLabel(img)`, renders that label in the failed row, and interpolates it into the retry button aria label. The fixture test only checks that the helper function exists, that its fallback expression exists somewhere, and that `aria-label` receives a variable named `label`; it does not require the mapped row's `label` variable to come from `getFailedImageLabel(img)` or require the visible row text to use the same value.
- Failure scenario: a later refactor leaves `getFailedImageLabel()` in the file and leaves `aria-label={... { label }}` intact, but changes the loop body to derive `label` from raw `img.title ?? img.user_filename ?? ''`. Whitespace titles, missing filenames, or repeated weak labels can return to the admin retry workflow while `failed-image-retry.test.ts` still passes.
- Suggested fix: strengthen the source contract around the `failedImages.map((img) => { ... })` body so it requires `const label = getFailedImageLabel(img);`, visible `{label}`, and retry `aria-label` in the same mapped row. A small render-level `DashboardClient` test with whitespace title plus filename/id fallback would be stronger.

## Non-Findings / Refutations

- Public search label flow is currently correct. `SearchResultItem` computes `label` through `getPhotoResultLabel(image, \`${t('common.photo')} ${image.id}\`)` at `apps/web/src/components/search.tsx:71` and renders `{label}` at `apps/web/src/components/search.tsx:104` and `apps/web/src/components/search.tsx:105`; the Cycle 83 source contract now pins both at `apps/web/src/__tests__/search-disclaimer.test.ts:20`, `apps/web/src/__tests__/search-disclaimer.test.ts:23`, and `apps/web/src/__tests__/search-disclaimer.test.ts:24`.
- Similar-photo labels are also currently wired through the normalized label. The map body computes `label` at `apps/web/src/components/similar-photos.tsx:183`, passes it at `apps/web/src/components/similar-photos.tsx:188`, and `SimilarThumb` uses it for `title`, `aria-label`, and `alt` at `apps/web/src/components/similar-photos.tsx:231`, `apps/web/src/components/similar-photos.tsx:232`, and `apps/web/src/components/similar-photos.tsx:236`. The source contract pins those uses at `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:15` through `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:20`.
- The shared result-label helper behaves as intended for the traced cases: it trims titles, rejects filename-like titles, uses trimmed descriptions, and falls back at `apps/web/src/lib/photo-title.ts:85` through `apps/web/src/lib/photo-title.ts:99`, with unit coverage at `apps/web/src/__tests__/photo-title.test.ts:92` through `apps/web/src/__tests__/photo-title.test.ts:100`.
- No runtime failed-image retry accessibility defect was confirmed. The current UI renders a deterministic per-row label and ties the retry button to both the row label and processing error at `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:85`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:109`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:110`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:122`, and `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123`.
- No processing/retry state-machine defect was confirmed in this pass. Failed rows are queried only when `processed = false` and `processing_error IS NOT NULL` at `apps/web/src/lib/data.ts:1024` through `apps/web/src/lib/data.ts:1041`; retry rechecks the same failed predicate, clears error state only after a fresh settings snapshot, deletes in-memory failure bookkeeping, and restores a visible failed state if enqueue is rejected at `apps/web/src/app/actions/images.ts:1224` through `apps/web/src/app/actions/images.ts:1330`; queue success clears failure columns at `apps/web/src/lib/image-queue.ts:671` through `apps/web/src/lib/image-queue.ts:675`; permanent failure persists error/timestamp at `apps/web/src/lib/image-queue.ts:758` through `apps/web/src/lib/image-queue.ts:820`; bootstrap excludes failed rows until an explicit retry clears the error at `apps/web/src/lib/image-queue.ts:900` through `apps/web/src/lib/image-queue.ts:906`.
- The deferred `C76-05` processed-predicate test gap is not re-raised here: `getImageProcessingState()` now queries by id without filtering pending rows at `apps/web/src/lib/data.ts:1204` through `apps/web/src/lib/data.ts:1219`, and behavior coverage asserts pending rows return `{ processed: false }` at `apps/web/src/__tests__/image-processing-state-data.test.ts:42` through `apps/web/src/__tests__/image-processing-state-data.test.ts:57`.

## Validation

- `npm test --workspace=apps/web -- --run src/__tests__/photo-title.test.ts src/__tests__/search-disclaimer.test.ts src/__tests__/cycle-21-source-contracts.test.ts src/__tests__/failed-image-retry.test.ts src/__tests__/image-processing-state-data.test.ts` passed: 5 files, 51 tests.
- `git diff --check HEAD~2..HEAD` passed.
- `git verify-commit HEAD` reported a good GPG signature.
