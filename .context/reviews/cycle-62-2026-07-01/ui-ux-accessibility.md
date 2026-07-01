# Cycle 62 UI/UX/Accessibility Review

Reviewer: UI/UX/accessibility designer lane
Date: 2026-07-01

## Scope And Method

- Read required guidance: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/cycle-61-2026-07-01-plan.md`, `.context/plans/cycle-61-2026-07-01-deferred.md`, and `.context/reviews/cycle-61-2026-07-01/_aggregate.md`.
- Reviewed public and admin UI source across `apps/web/src/components`, `apps/web/src/app/[locale]`, `apps/web/messages`, and protected admin route clients.
- Used Playwright against the current deployed app at `https://gallery.atik.kr` because authenticated local/admin runtime state was not available in this reviewer lane. Browser checks covered desktop/mobile public home, privacy, timeline, map, admin login, mobile nav expansion, and search dialog interactions.
- Avoided re-raising Cycle 61 deferred test-coverage items (`C61-06`, `C61-07`) and carry-forward non-UI deferred items.

## Findings

### C62-UX-01 - Public search returns the generic unavailable state for normal deployed queries

- Severity: Medium
- Confidence: High for user-visible failure on deployed `gallery.atik.kr`; Medium on root cause without production server logs.
- File/line:
  - `apps/web/src/components/search.tsx:240` calls `searchImagesAction(searchQuery)` for keyword search.
  - `apps/web/src/app/actions/public.ts:305` returns `{ status: 'ok', results: await searchImages(...) }`, but `apps/web/src/app/actions/public.ts:307` catches any thrown search failure and returns `{ status: 'error', results: [] }`.
  - `apps/web/src/components/search.tsx:440` renders the status in the live region, and `apps/web/src/components/search.tsx:473` renders the same status as visible empty/error content.
  - `apps/web/messages/ko.json:425` and `apps/web/messages/en.json:425` map `error` to the generic unavailable copy.
  - `apps/web/src/lib/data.ts:1521` through `apps/web/src/lib/data.ts:1663` is the public search query path that should return matching image rows.
- Evidence:
  - Mobile Playwright, `https://gallery.atik.kr/ko`, opened "사진 검색", typed `TWS`.
  - The server-action POST to `https://gallery.atik.kr/ko` returned HTTP 200 with payload:
    `{"status":"error","results":[]}`.
  - Dialog text became `검색을 잠시 사용할 수 없습니다. 나중에 다시 시도해 주세요.` and the accessibility snapshot exposed the same error text twice: once from the polite live region and once from the visible status block.
  - Repeated in English with query `JIHOON`: `Search is temporarily unavailable. Please try again later.`
- Scenario:
  - A visitor trying to find a performer/tag/camera from the public gallery search receives a system failure state instead of results, even though the home grid and tags prove matching public photos exist. Keyboard users also cannot arrow into results because none are returned.
- Suggested fix:
  - Investigate the production exception emitted by `searchImagesAction failed:` and fix the underlying `searchImages()` runtime/query failure first.
  - Add a route/server-action regression that exercises a query known to match current seeded/public fixtures and asserts `{ status: 'ok' }` with at least one result.
  - After the functional fix, consider avoiding duplicate screen-reader exposure for status messages by keeping the live-region announcement and visible error text coordinated, so the same error is not encountered twice in the dialog accessibility tree.

## Non-Findings / Checks

- No visible sub-44 px interactive targets were confirmed on sampled deployed public/admin-login pages except intentionally off-screen skip links before focus.
- Sampled desktop/mobile pages showed no horizontal overflow and no console/page errors.
- Mobile nav expansion exposed localized controls with 44 px targets and sensible accessible names.
- Admin protected pages were source-inspected only because this lane did not have credentials; residual risk remains in authenticated-only workflows that need live DOM validation.
