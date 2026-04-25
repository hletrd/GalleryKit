# Plan 233 — Cycle 8 fresh: harden `/api/og` (cache + rate-limit)

**Source finding:** AGG8F-01 (4 agents: code-reviewer, perf, security, tracer)
**Severity:** MEDIUM
**Confidence:** High

## Problem

`apps/web/src/app/api/og/route.tsx` is the only public unauthenticated CPU-bound endpoint in the repo. It currently:

1. Returns `Cache-Control: 'no-store, no-cache, must-revalidate'` on the success path → CDNs and crawlers cannot cache, every social-share unfurl regenerates the SVG/PNG via the WASM resvg pipeline (~200–400ms CPU per call).
2. Has no per-IP rate limit. Every other public endpoint (`searchImagesAction`, `loadMoreImages`) has both an in-memory and DB-backed rate limit. This is the only gap.

The DoS amplifier vector is concrete: a script can hit `/api/og?topic=valid&tags=x,y,z` repeatedly and pin Node CPU.

## Fix shape

1. **Cache:** On the success branch, switch to `Cache-Control: 'public, max-age=3600, stale-while-revalidate=86400, immutable'`. Keep `no-store` on the error branch.
2. **ETag:** Compute `crypto.createHash('sha256').update(\`${topic}|${tagList.join(',')}|${seo.title}\`).digest('hex').slice(0, 16)` and set `ETag` header. Allow `If-None-Match` to short-circuit with 304.
3. **Rate limit:** Add a new bucket type `og` with windowMs = 60_000, maxRequests = 30. Reuse the existing in-memory `searchRateLimit`-style Map pattern OR introduce a single small Map dedicated to `/api/og`.

## Implementation steps

1. Edit `apps/web/src/app/api/og/route.tsx`:
   - Inside the `try` block, after validating topic/tags, compute the ETag.
   - If `req.headers.get('if-none-match') === etag`, return 304 with the same Cache-Control + ETag headers.
   - In `ImageResponse(...)`, set `headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400', 'ETag': etag }`.
   - Before any work, call a new `checkOgRateLimit(ip)` helper. If true (over limit), return 429 with `Retry-After: 60`.
2. Add a new helper file or section in `lib/rate-limit.ts`:
   - `OG_WINDOW_MS = 60_000`, `OG_MAX_REQUESTS = 30`, `OG_RATE_LIMIT_MAX_KEYS = 2000`.
   - `ogRateLimit = new Map<string, {count: number; resetAt: number}>()`.
   - `pruneOgRateLimit(now)`, `checkOgRateLimit(ip, now)`, `rollbackOgRateLimit(ip)` mirroring the `loadMoreRateLimit` pattern in `actions/public.ts`.
3. Add unit test `apps/web/src/__tests__/og-route.test.ts`:
   - Asserts 30th request OK, 31st request 429 within 60s.
   - Asserts ETag round-trip (304 on If-None-Match).
   - Asserts Cache-Control on success vs error branches.

## Done criteria

- All gates pass (`lint`, `typecheck`, `test`, `lint:api-auth`, `lint:action-origin`, `build`).
- `og-route.test.ts` covers rate-limit + cache headers.
- Manual probe: `curl -I -H "If-None-Match: $ETAG" /api/og?topic=valid` returns 304 the second time.

## Out of scope (explicitly)

- DB-backed rate-limit persistence for `og` bucket. The in-memory Map is sufficient for a personal-gallery single-process deployment; matches the precedent in `loadMoreImages`.
- Custom font bundling (deferred to AGG8F-31 / DSGN8F-03).

## Risk assessment

- Cache-Control change is the only behavior shift visible to users. Effect: faster social-share unfurl. No safety implications.
- Rate-limit shift is invisible to legitimate users (30/min is well above natural usage).
- ETag is purely additive.
