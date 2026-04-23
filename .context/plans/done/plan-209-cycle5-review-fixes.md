# Plan 209 — Cycle 5 Review Fixes

**Status:** DONE / archived
**Source reviews:** `.context/reviews/_aggregate.md`, `.context/reviews/code-reviewer.md`, `.context/reviews/perf-reviewer.md`, `.context/reviews/verifier.md`, `.context/reviews/test-engineer.md`, `.context/reviews/architect.md`, `.context/reviews/critic.md`, `.context/reviews/debugger.md`, `.context/reviews/tracer.md`
**Goal:** Eliminate the current-cycle public-route hot-path duplication and correct the misleading topic-label validation error, while adding regression coverage and preserving existing behavior.

## Findings mapped to this plan

| Finding | Severity | Confidence | Action | Status |
|---|---|---|---|---|
| AGG5-01 / CR5-01 / PERF5-01 / VER5-01 / TRACE5-01 / ARCH5-01 / CRT5-01 | MEDIUM | HIGH | IMPLEMENT | DONE |
| AGG5-02 / CR5-02 / VER5-02 / CRT5-02 / DBG5-01 / TE5-02 | LOW | HIGH | IMPLEMENT | DONE |
| TE5-01 | LOW | HIGH | IMPLEMENT | DONE |

## Completed items

### 209-01 — Collapse public first-page list + count into one paginated data helper — DONE
**Files:**
- `apps/web/src/lib/data.ts`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`

**Changes completed:**
1. Added `getImagesLitePage()` in the data layer, backed by a single paginated query that returns rows plus `COUNT(*) OVER()` metadata.
2. Added `normalizePaginatedRows()` so the public pages can derive `images`, `totalCount`, and `hasMore` from one result set.
3. Switched the public home/topic entrypoints off the separate `getImageCount(...)` hot-path query while preserving the existing `HomeClient` contract.

**Exit criterion:** The home and topic first-page render paths no longer issue a second exact-count query for the same filter set, and the rendered `totalCount`/`hasMore` behavior remains unchanged. ✅

### 209-02 — Correct topic label validation messaging — DONE
**Files:**
- `apps/web/src/app/actions/topics.ts`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

**Changes completed:**
1. Added a dedicated `invalidLabel` translation in English and Korean.
2. Switched topic create/update label sanitization mismatches to return `invalidLabel` instead of `invalidSlug`.
3. Left slug validation semantics unchanged.

**Exit criterion:** Topic create/update label sanitization errors point to the label field, not the slug field. ✅

### 209-03 — Add focused regression coverage for the new helper and error contract — DONE
**Files:**
- `apps/web/src/__tests__/topics-actions.test.ts`
- `apps/web/src/__tests__/data-pagination.test.ts`

**Changes completed:**
1. Added regression tests for `invalidLabel` on topic create/update.
2. Added focused unit coverage for `normalizePaginatedRows()` so `rows`, `totalCount`, and `hasMore` stay aligned.

**Exit criterion:** The test suite locks the two cycle-5 fixes against regression. ✅

## Deferred items
- No review findings were deferred from cycle 5. Gate warnings are tracked separately in `.context/plans/210-deferred-cycle5-gate-warnings.md`.

## Progress
- [x] 209-01 — Collapse public first-page list + count into one paginated data helper
- [x] 209-02 — Correct topic label validation messaging
- [x] 209-03 — Add focused regression coverage for the new helper and error contract

## Verification evidence
- `npm run lint --workspace=apps/web` ✅
- `npm run lint:api-auth --workspace=apps/web` ✅
- `npm test --workspace=apps/web` ✅ (35 files / 189 tests)
- `npm run test:e2e --workspace=apps/web` ✅ (12 passed / 3 skipped)
- `npm run build` ✅
