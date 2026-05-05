# Code Review — Cycle 15 (2026-05-06)

**Reviewer angle**: Code quality, logic correctness, edge cases, maintainability
**Scope**: Entire repository, focus on boundary conditions and cross-file interactions
**Gates**: All green (eslint, tsc, vitest 1049 tests, lint:api-auth, lint:action-origin, lint:public-route-rate-limit)

---

## Executive Summary

After 15 review cycles and 1000+ tests, the codebase remains in a fully converged state. No new MEDIUM or HIGH severity findings were identified in cycle 15. All prior findings from cycles 1-14 remain correctly fixed.

## Findings

No new findings in cycle 15.

## Verified Correct Patterns (Cycle 15 Deep Dive)

1. **proxy.ts** (post-C13-LOW-01 fix re-verified): The `x-nonce` response header leak remains correctly remediated. `applyProductionCsp` only sets `Content-Security-Policy` on the response; no `x-nonce` response header is emitted. The token format check (`token.length < 100` and `token.split(':').length !== 3`) correctly filters malformed tokens before they reach the DB verification path.

2. **Session management** (`lib/session.ts`): The `verifySessionToken` function uses `cache()` from React for per-request deduplication, preventing redundant DB queries when the same token is verified multiple times in a single server context. HMAC-SHA256 signature verification uses `timingSafeEqual` with explicit Buffer length checks. Token age bounds (`tokenAge < 0`) correctly reject future-dated tokens.

3. **Rate-limit rollback patterns** (`lib/rate-limit.ts`, `lib/auth-rate-limit.ts`): All three documented rollback patterns are correctly implemented across their respective callers. The `decrementRateLimit` function atomically decrements via `GREATEST(count - 1, 0)` and cleans up zero-count rows, preventing negative counts and accumulation.

4. **Semantic search route** (`app/api/search/semantic/route.ts`): The `clampSemanticTopK` function correctly handles non-numeric inputs (falls back to default), negative values (clamped to 1), and values above max (clamped to SEMANTIC_TOP_K_MAX). The same-origin check, maintenance check, body size guard, and feature-flag check all correctly precede rate-limit consumption.

5. **Image processing pipeline** (`lib/process-image.ts`): The AVIF high-bitdepth probe uses a Promise-based singleton preventing races. The `stripGpsFromOriginal` function uses atomic rename (temp file → original) for safe in-place rewriting. Color pipeline version 3 correctly handles wide-gamut sources with explicit `toColorspace` conversion before encoding.

## Areas Examined With No Issues Found

- `lib/bounded-map.ts` — hard-cap eviction, collect-then-delete pruning patterns
- `lib/data.ts` — view count flush with atomic Map swap, retry cap, backoff
- `lib/image-queue.ts` — claim retry logic, permanent failure tracking, bootstrap continuation
- `lib/validation.ts` — Unicode formatting char rejection, safeInsertId BigInt guard
- `app/actions/public.ts` — loadMore/search rollback symmetry, cursor pagination bounds
- `scripts/check-public-route-rate-limit.ts` — TypeScript AST parsing, comment/string stripping

## Conclusion

The codebase maintains its excellent quality posture. Cycle 15 found no new issues. All architectural invariants are enforced by automated lint gates.
