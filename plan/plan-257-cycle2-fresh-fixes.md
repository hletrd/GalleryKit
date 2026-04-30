# Plan 257 — Cycle 2 Fresh Review Fixes

## Context
Cycle 2 fresh review produced 4 actionable findings (C2-AGG-02 through C2-AGG-05) plus 1 deferred item. One finding (C2-AGG-01) was discovered to be already fixed during plan review.

## Repo rules read
- `CLAUDE.md`: Node 24+/TS 6; Docker standalone; single web-instance/single-writer topology documented; uploads are 200 MB per file with separate 2 GiB batch cap; restore cap is 250 MB; security/auth/origin/upload/restore guards are blocking; live secrets must not be reused or exposed.
- `AGENTS.md`: always commit and push; use gitmoji; run lint, typecheck, tests, build, and static/security lint gates after changes.
- `.context/**`: current aggregate and prior plan/review artifacts require no silent deferrals and preserved severity/confidence.
- `.cursorrules`: absent.
- `CONTRIBUTING.md`: absent.
- `docs/`: no repository docs directory present.

## Scheduled implementation items

### C2-AGG-02 (Medium / Medium). `deleteImages` sequential file cleanup
- [x] Refactor `deleteImages` in `apps/web/src/app/actions/images.ts:618-636` to use chunked parallel processing (concurrency of 5) for the outer image loop instead of sequential for-of.
- [x] Keep the inner `collectImageCleanupFailures` (4 format ops in parallel per image) unchanged.
- [x] Verify all existing tests still pass.

### C2-AGG-03 (Low / Medium). OG route tags not length-clamped
- [x] Add `clampDisplayText(tag, 30)` call in `apps/web/src/app/api/og/route.tsx:70` inside the `tagList.map()` to prevent layout distortion from long tag names.
- [x] Verify existing OG route test still passes.

### C2-AGG-04 (Low / High). `batchUpdateImageTags` string guard test
- [x] Add an explicit test case in `apps/web/src/__tests__/tags-actions.test.ts` asserting that calling `batchUpdateImageTags` with a string `removeTagNames` returns an error.
- [x] Verify all tests pass.

## Deferred items

### C2-AGG-05 (Low / Low). Double `uploadContractLock?.release()` in db-actions.ts
- Citation: `apps/web/src/app/[locale]/admin/db-actions.ts:360-366`
- Original severity/confidence: Low / Low
- Reason: The inner finally block already releases and nulls `uploadContractLock`, making the outer release a no-op. This is defense-in-depth, not a bug. Adding a comment would be sufficient but the change is purely cosmetic and could confuse future readers more than the current code.
- Re-open/exit criterion: if the double-release pattern causes a bug (e.g. if the inner finally is refactored to not null `uploadContractLock`), or if a new contributor asks about it in review.

## Required gates
Run the full configured gate set against the whole repo and fix all errors before committing/pushing:
- [x] `npm run lint --workspace=apps/web`
- [x] `npx tsc --noEmit`
- [x] `npm test --workspace=apps/web`
- [x] `npm run lint:api-auth --workspace=apps/web`
- [x] `npm run lint:action-origin --workspace=apps/web`

## Progress log
- [x] Plan authored; implementation to follow.
- [x] C2-AGG-02 implemented — chunked parallel cleanup (concurrency 5)
- [x] C2-AGG-03 implemented — OG tag clamping to 30 chars
- [x] C2-AGG-04 implemented — string-as-removeTagNames test added
- [x] All 6 gates pass (ESLint, tsc, vitest 504/504, lint:api-auth, lint:action-origin, build)
- [x] Deployed to production
