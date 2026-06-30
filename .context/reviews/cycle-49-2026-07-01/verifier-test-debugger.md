# Cycle 49 Review - Verifier / Test Engineer / Debugger

## Inventory Examined

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/cycle-48-2026-07-01/_aggregate.md`
- `.context/plans/cycle-48-2026-07-01-plan.md`
- `.context/plans/cycle-48-2026-07-01-deferred.md`
- `.context/reviews/cycle-47-2026-07-01/_aggregate.md`
- `.context/plans/cycle-47-2026-07-01-plan.md`
- `package.json`
- `apps/web/package.json`
- `apps/web/public/sw.template.js`
- `apps/web/public/sw.js`
- `apps/web/src/__tests__/sw-template-contract.test.ts`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/__tests__/cycle-47-source-contracts.test.ts`
- `apps/web/src/__tests__/cycle-22-source-contracts.test.ts`
- `apps/web/src/__tests__/failed-image-retry.test.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/background-db-writes.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/check-js-scripts.mjs`

## Findings

### C49-SW-01 - Photo pages are excluded from the documented offline HTML fallback

- Severity: Medium
- Confidence: High
- Files/lines: `apps/web/public/sw.template.js:59-63`, `apps/web/public/sw.template.js:456-459`, `apps/web/public/sw.js:59-63`, `apps/web/src/__tests__/sw-template-contract.test.ts:71-75`, `CLAUDE.md:422`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:40-42`

`CLAUDE.md:422` documents the service worker HTML fallback as intentionally caching dynamic public gallery/photo pages, with exclusions for admin routes, share pages (`/s`, `/g`), smart collections (`/c`), map, and admin-session renders. The photo page itself is dynamic (`revalidate = 0`) at `p/[id]/page.tsx:40-42`, matching that documented fallback rationale.

The shipped service-worker classifier currently includes `/p/<id>` in `isRevocableShareHtmlRoute` at `sw.template.js:61-63`, and the fetch handler bypasses every matching HTML request at `sw.template.js:456-459`. The generated `sw.js` carries the same `/p/<id>` bypass. As a result, visited photo detail pages never reach `networkFirstHtml()`, so the PWA loses the documented offline fallback for one of the core browsing surfaces.

The regression test currently enshrines the wrong contract: `sw-template-contract.test.ts:71-75` expects `p\/\d+` inside the bypass matcher under a test named "bypasses revocable share pages", even though `/p/<id>` is not a revocable share route and is not listed in the documented exclusions. Focused evidence: `npm test --workspace=apps/web -- sw-template-contract.test.ts` passes (24/24), while a direct regex check confirms both `/p/123` and `/ko/p/123` are classified as bypassed.

Failure scenario: a visitor opens `/p/123` online, then loses network connectivity and returns to that visited page within the 24-hour HTML fallback window. Expected behavior from the PWA contract is an offline HTML fallback shell; actual behavior is no service-worker response for the photo page, so the browser falls through to the failed network navigation. Image derivatives may still be cached, but the page HTML is not.

Suggested fix: remove the `/p/\d+` branch from `isRevocableShareHtmlRoute` so normal photo pages flow through `networkFirstHtml()`. Keep `/s`, `/g`, `/c`, and `/map` bypassed. Update `sw-template-contract.test.ts` to assert that `/p/<id>` and `/{locale}/p/<id>` are not in the bypass matcher and add a behavioral classifier/helper test instead of only checking source substrings. Regenerate `apps/web/public/sw.js` after changing the template. If the intended product decision is instead "photo pages must never be cached because deletion can stale for 24h", update `CLAUDE.md` and the test names/comments to explicitly say `/p/<id>` is excluded; do not leave code and docs split.

## Validation

- `npm test --workspace=apps/web -- sw-template-contract.test.ts` - pass, 24 tests.
- Direct classifier check: the current `/p/\d+` regex returns `true` for `/p/123` and `/ko/p/123`.

## Notes

- I did not re-raise the carried-forward deferred items listed in Cycle 48 (`PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, `AGG-C38-08`) because this pass did not find new evidence changing their severity or scheduling.
