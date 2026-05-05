# Code Review — Cycle 14 (2026-05-06)

**Reviewer angle**: Code quality, logic correctness, edge cases, maintainability
**Scope**: Entire repository, focus on recently changed files and boundary conditions
**Gates**: All green (eslint, tsc, vitest 1049 tests, playwright e2e 20 passed, lint:api-auth, lint:action-origin, lint:public-route-rate-limit)

---

## Executive Summary

After 14 review cycles and 1000+ tests, the codebase is in a fully converged state. No new MEDIUM or HIGH severity findings were identified in cycle 14. All prior findings from cycles 1-13 remain correctly fixed. The code quality is excellent with thorough documentation, defensive patterns, and comprehensive error handling.

## Findings

No new findings in cycle 14.

## Verified Correct Patterns (Cycle 14 Deep Dive)

1. **proxy.ts** (post-C13-LOW-01 fix): The `x-nonce` response header leak has been correctly remediated. `applyProductionCsp` now only sets `Content-Security-Policy` on the response; no `x-nonce` response header is emitted. Verified by full-text search across the codebase.

2. **Service worker cache strategies** (`sw.template.js` / `sw.js`): LRU eviction correctly handles browser-independent quota evictions by checking `imageCache.delete()` return value before adjusting the running total. The `recordAndEvict` function properly serializes metadata through the Cache API. Version-scoped cache keys prevent cross-version contamination.

3. **Semantic search route** (`app/api/search/semantic/route.ts`): All validation gates (same-origin, maintenance, body size, JSON shape, query length, feature flag) correctly precede rate-limit consumption and embedding work. Rollback on DB failure is present and correct.

4. **BoundedMap** (`lib/bounded-map.ts`): The collect-then-delete pruning pattern is consistent and correct. Hard-cap eviction uses FIFO insertion order as documented. Convenience constructors properly bind the expiry predicate.

5. **loadMoreImages / searchImagesAction** (`app/actions/public.ts`): Pattern 2 rollback (rollback on infrastructure error) is correctly implemented for both actions. In-memory and DB-backed counters are kept in sync with symmetric increment/rollback pairs.

## Areas Examined With No Issues Found

- `lib/image-queue.ts` — claim retry logic, permanent failure tracking, bootstrap continuation
- `lib/process-image.ts` — AVIF probe singleton, EXIF extraction, ICC parsing, variant cleanup
- `lib/data.ts` — view count flush, cursor pagination, privacy field separation
- `app/actions/auth.ts` — Argon2 verify, session creation, password change, rate-limit ordering
- `app/actions/images.ts` — upload flow, tag processing, batch operations
- `scripts/check-public-route-rate-limit.ts` — comment-stripping, string-literal bypass prevention
- `scripts/build-sw.ts` — template replacement, git SHA fallback

## Conclusion

The codebase maintains its excellent quality posture. Cycle 14 found no new issues. All architectural invariants are enforced by automated lint gates.
