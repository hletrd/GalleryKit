# Cycle 83/100 Test-Engineer / Verifier Review

Reviewed HEAD: `cc46b1d69c11cb175c88df69f17cbe526d23aa0d`.
Baseline for changed-file inventory: `c272c5217ffdf1d324f001d8c35145262be310b4`.
Date: 2026-07-01.

## Scope And Inventory

- Required context read: `AGENTS.md`, `CLAUDE.md`, and the `review-plan-fix` skill instructions. This lane stays read-only except for this file; no deploy.
- Latest Cycle 82 artifacts read: `.context/reviews/cycle-82/_aggregate.md`, `.context/plans/cycle-82-2026-07-01-plan.md`, `.context/plans/cycle-82-2026-07-01-deferred.md`, `.context/reviews/_aggregate.md`, `.context/reviews/cycle-82/test-engineer.md`, and `.context/reviews/cycle-82/designer.md`.
- Gate scripts inventoried: `apps/web/package.json:13` Vitest, `apps/web/package.json:21` Playwright, `apps/web/package.json:23` admin API auth lint, `apps/web/package.json:24` action-origin lint, `apps/web/package.json:25` public route rate-limit lint, and `apps/web/package.json:26` through `apps/web/package.json:27` typecheck.
- Test surface inventoried: 303 Vitest files under `apps/web/src/__tests__/` and 6 Playwright spec files under `apps/web/e2e/`.
- Files changed since `c272c521`: Cycle 82 review/plan docs, `.gitignore`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/lib/photo-title.ts`, `apps/web/src/components/search.tsx`, `apps/web/src/components/similar-photos.tsx`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`, and the four focused test files `photo-title.test.ts`, `search-disclaimer.test.ts`, `cycle-21-source-contracts.test.ts`, and `failed-image-retry.test.ts`.
- Focused verification run: `npm test --workspace=apps/web -- --run src/__tests__/photo-title.test.ts src/__tests__/search-disclaimer.test.ts src/__tests__/cycle-21-source-contracts.test.ts src/__tests__/failed-image-retry.test.ts` passed: 4 files, 48 tests, 187 ms.
- Full required gates were not re-run in this review lane. Cycle 82 plan records all required gates passing, including full Vitest, and this lane intentionally avoided the expensive full suite per prompt.

## Findings

### C83-TE-01 - Cycle 82 source-contract tests can pass while result labels drift away from the normalized value

- Severity: Low.
- Confidence: High.
- Citations: `apps/web/src/__tests__/search-disclaimer.test.ts:19`, `apps/web/src/__tests__/search-disclaimer.test.ts:20`, `apps/web/src/__tests__/search-disclaimer.test.ts:21`, `apps/web/src/__tests__/search-disclaimer.test.ts:22`, `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:9`, `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:11`, `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:12`, `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:15`, `apps/web/src/components/search.tsx:71`, `apps/web/src/components/search.tsx:104`, `apps/web/src/components/search.tsx:105`, `apps/web/src/components/similar-photos.tsx:183`, `apps/web/src/components/similar-photos.tsx:188`, `apps/web/src/components/similar-photos.tsx:231`, `apps/web/src/components/similar-photos.tsx:232`, `apps/web/src/components/similar-photos.tsx:236`.
- Problem: The helper behavior is unit-covered in `photo-title.test.ts`, and the current components do use `label`. The regression contracts for search and similar photos, however, only assert that `getPhotoResultLabel` is imported/computed and that one previous raw fallback spelling is absent. They do not assert that the rendered search row text, similar thumbnail `label` prop, `title`, `aria-label`, or `alt` actually consume the normalized `label`.
- Failure scenario: A later refactor can leave `const label = getPhotoResultLabel(...)` in place to satisfy the source-contract tests, then render `image.title ?? image.description ?? ...` or pass a raw title to `SimilarThumb`. Filename-like titles such as `IMG_0001.JPG` would reappear in public search/similar accessible names while the focused tests still pass.
- Suggested fix: Add a minimal render-level test for `SearchResultItem` and `SimilarPhotos` with a filename-like title and meaningful description, or strengthen the source contract to require `{label}` in the search result text and `label={label}` flowing into `SimilarThumb`, plus `aria-label={label}` / `alt={label}` in the thumb component.

## Non-Findings / Locked Contracts

- `C82-02` helper behavior is locked at unit level: `apps/web/src/lib/photo-title.ts:85` through `apps/web/src/lib/photo-title.ts:99` trims titles/descriptions, rejects filename-like titles, and falls back; `apps/web/src/__tests__/photo-title.test.ts:92` through `apps/web/src/__tests__/photo-title.test.ts:101` covers filename-like, blank, trimmed-title, and trimmed-description cases.
- Current search implementation consumes the normalized label at `apps/web/src/components/search.tsx:71` and renders it at `apps/web/src/components/search.tsx:104` through `apps/web/src/components/search.tsx:105`.
- Current similar-photo implementation consumes the normalized label at `apps/web/src/components/similar-photos.tsx:183`, passes it to `SimilarThumb` at `apps/web/src/components/similar-photos.tsx:188`, and uses it for title, aria-label, and image alt at `apps/web/src/components/similar-photos.tsx:231` through `apps/web/src/components/similar-photos.tsx:236`.
- `C82-03` failed-image retry accessible names are source-locked by `apps/web/src/__tests__/failed-image-retry.test.ts:152` through `apps/web/src/__tests__/failed-image-retry.test.ts:163`; current source computes a row label at `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:39` through `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:40`, applies the localized aria label at `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:122`, and connects error description via `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123`.
- No focused flaky-test risk surfaced: the targeted set is deterministic unit/source-contract coverage with no browser, network, DB, or timer dependency.

## Deferred Items Not Re-Raised

- I did not re-raise carry-forward deferred items `C80-06`, `C77-ARCH-01`, `C76-04`, `C76-05`, or `C75-08`; this lane found no evidence that their recorded exit criteria were hit.
- Historical performance, semantic-search, settings re-encode, shared-view, and browser-matrix deferred items remain governed by prior deferred artifacts.
