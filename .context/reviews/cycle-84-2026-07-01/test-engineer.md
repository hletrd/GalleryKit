# Cycle 84/100 Test-Engineer Review

Reviewed HEAD: `023ae28d41ee757caaa408710bd864d88087a40c`.
Baseline focus: Cycle 83 implementation/test delta from `cc46b1d69c11cb175c88df69f17cbe526d23aa0d` to HEAD, plus the Cycle 82 a11y/source-contract changes it locks.
Date: 2026-07-01.

## Scope And Evidence

- Required context read: `AGENTS.md`, `CLAUDE.md`, and the `code-review` skill instructions.
- Recent source/test surfaces reviewed: `apps/web/src/lib/photo-title.ts`, `apps/web/src/components/search.tsx`, `apps/web/src/components/similar-photos.tsx`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`, `apps/web/src/__tests__/photo-title.test.ts`, `apps/web/src/__tests__/search-disclaimer.test.ts`, `apps/web/src/__tests__/cycle-21-source-contracts.test.ts`, and `apps/web/src/__tests__/failed-image-retry.test.ts`.
- Lint-gate wiring reviewed: `apps/web/package.json:13` through `apps/web/package.json:27` still expose Vitest, Playwright, ESLint, the admin API auth scanner, action-origin scanner, public route rate-limit scanner, and app/script typecheck gates. The recent implementation delta did not add API routes or server actions.
- Focused verification run: `npm test --workspace=apps/web -- --run src/__tests__/photo-title.test.ts src/__tests__/search-disclaimer.test.ts src/__tests__/cycle-21-source-contracts.test.ts src/__tests__/failed-image-retry.test.ts` passed: 4 files, 48 tests, 189 ms.
- Full lint/typecheck/build/Vitest gates were not re-run in this review lane. HEAD's signed commit trailer records them passing; e2e remains explicitly not run for the latest commit.

## Findings

### C84-TE-01 - Dashboard retry accessibility contract can pass while the rendered label stops using the helper

- Severity: Low.
- Confidence: High.
- Citations: `apps/web/src/__tests__/failed-image-retry.test.ts:152`, `apps/web/src/__tests__/failed-image-retry.test.ts:154`, `apps/web/src/__tests__/failed-image-retry.test.ts:155`, `apps/web/src/__tests__/failed-image-retry.test.ts:156`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:39`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:40`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:85`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:109`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:110`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:122`.
- Problem: The current implementation correctly computes `const label = getFailedImageLabel(img)` and uses it for the visible failed-image row plus the retry button aria label. The source-contract test only proves that the helper exists with the right body and that `aria-label` consumes a variable named `label`; it does not prove the loop's `label` variable is assigned from `getFailedImageLabel(img)` or that the visible row text uses the same helper-derived value.
- Failure scenario: A later refactor can leave `getFailedImageLabel()` in the file to satisfy the test, but change the row loop to `const label = img.title ?? img.user_filename ?? \`ID ${img.id}\``. Whitespace-only titles or missing filenames can then produce weak or empty retry accessible names for the photographer/admin retry workflow while `failed-image-retry.test.ts` still passes.
- Suggested fix: Strengthen the source contract to slice the failed-image map body and require `const label = getFailedImageLabel(img);`, the row text `{label}`, and the retry `aria-label` all inside that same body. A small render-level component test with a whitespace title and a fallback filename/id would be stronger if the test harness can mount `DashboardClient` cheaply.

## Non-Findings / Adequate Contracts

- Cycle 83 closed the prior search/similar source-contract gap: `apps/web/src/__tests__/search-disclaimer.test.ts:20` through `apps/web/src/__tests__/search-disclaimer.test.ts:25` now requires the `SearchResultItem` body to compute and render `label`; `apps/web/src/components/search.tsx:71` and `apps/web/src/components/search.tsx:104` through `apps/web/src/components/search.tsx:105` satisfy it.
- Similar-photo label flow is now source-locked from result mapping into thumbnail attributes: `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:11` through `apps/web/src/__tests__/cycle-21-source-contracts.test.ts:20`, with current source at `apps/web/src/components/similar-photos.tsx:183`, `apps/web/src/components/similar-photos.tsx:188`, and `apps/web/src/components/similar-photos.tsx:231` through `apps/web/src/components/similar-photos.tsx:236`.
- Helper semantics are behavior-tested: `apps/web/src/lib/photo-title.ts:85` through `apps/web/src/lib/photo-title.ts:99` trim titles/descriptions, reject filename-like titles, and fall back; `apps/web/src/__tests__/photo-title.test.ts:92` through `apps/web/src/__tests__/photo-title.test.ts:101` cover the Cycle 82 cases.
- No new lint-gate coverage gap surfaced for the latest source delta because no admin API route, public API route, or server action changed.
- No focused flaky-test risk surfaced in the targeted set; these tests are deterministic unit/source reads with no browser, network, DB, or timer dependency.

## Deferred Items Not Re-Raised

- I did not re-raise carry-forward deferred items `C80-06`, `C77-ARCH-01`, `C76-04`, `C76-05`, or `C75-08`; this lane found no evidence that their recorded exit criteria were hit.
- Historical performance, semantic-search, settings re-encode, shared-view, browser-matrix, and broad e2e expansion items remain governed by prior deferred artifacts.
