# Plan 205 — Cycle 2 Performance Hot-Path Fixes

**Status:** DONE
**Source reviews:** `.context/reviews/_aggregate.md`, `.context/reviews/code-reviewer.md`, `.context/reviews/perf-reviewer.md`, `.context/reviews/verifier.md`, `.context/reviews/test-engineer.md`, `.context/reviews/architect.md`, `.context/reviews/critic.md`
**Goal:** Implement the bounded, current-cycle performance fixes that are small enough to complete safely under the full gate suite, and add regression coverage so they do not silently regress.

## Findings mapped to this plan

| Finding | Severity | Confidence | Action | Status |
|---|---|---|---|---|
| AGG2-01 / CR2-01 / CRI2-01 / ARCH2-01 / VER2-01 | MEDIUM | HIGH | IMPLEMENT | DONE |
| AGG2-02 / CR2-02 / CRI2-02 | LOW | HIGH | IMPLEMENT | DONE |
| AGG2-03 / PERF2-03 | LOW | MEDIUM | IMPLEMENT | DONE |
| AGG2-04 / TE2-01 | LOW | HIGH | IMPLEMENT | DONE |

## Completed items

### 205-01 — Cache and reuse public tag aggregates — DONE
- Added `getTagsCached(topic?)` in `apps/web/src/lib/data.ts` alongside the uncached helper.
- Switched the home/topic public route code paths to the cached helper so metadata and page rendering share one request-scoped tag aggregate.
- Preserved tag output shape and ordering.

### 205-02 — Skip metadata tag lookups on the common no-filter path — DONE
- Updated `generateMetadata()` in both public route files to only resolve/validate tag slugs when a real `tags` search param exists.
- Kept metadata output unchanged for the no-filter path while removing the redundant query.

### 205-03 — Short-circuit homepage custom-OG metadata — DONE
- Updated the homepage metadata path to return immediately when `seo.og_image_url` is configured.
- Avoided the fallback latest-image query and config read on that branch.

### 205-04 — Throttle in-memory search rate-limit pruning — DONE
- Added `pruneSearchRateLimit()` to `apps/web/src/lib/rate-limit.ts` with throttled expiry/cap enforcement.
- Replaced the per-request inline full-map pruning in `apps/web/src/app/actions/public.ts` with the shared helper.

### 205-05 — Add regression coverage for the new hot-path helpers — DONE
- Added focused `rate-limit.test.ts` coverage for the throttled prune helper.
- Updated `public-actions.test.ts` mocks so the existing search action tests cover the new helper contract.
- Verified the full gate suite twice (pre- and post-deslop pass).

## Verification
- `npm run lint --workspace=apps/web` ✅
- `npm run lint:api-auth --workspace=apps/web` ✅
- `npm test --workspace=apps/web` ✅
- `npm run test:e2e --workspace=apps/web` ✅
- `npm run build` ✅

## Explicit non-goals / still-deferred work
- Cursor pagination for public/admin listings remains deferred in `.context/plans/204-deferred-cycle1-performance-review.md`.
- Indexed/full-text search redesign remains deferred in `.context/plans/204-deferred-cycle1-performance-review.md`.
- No UI copy or product-contract changes were introduced beyond preserving current metadata/render behavior while removing redundant work.
