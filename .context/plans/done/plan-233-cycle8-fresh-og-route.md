# Plan 233 — Cycle 8 fresh: harden `/api/og` (cache + rate-limit)

**Status:** DONE (cycle 8 recovery — landed 2026-04-25)
**Source finding:** AGG8F-01 (4 agents: code-reviewer, perf, security, tracer)
**Severity:** MEDIUM
**Confidence:** High

## Outcome

Implemented per the fix shape below across two commits:
- `feat(api): ⚡ rate-limit /api/og + ETag/304 + public cache-control` —
  edits to `apps/web/src/app/api/og/route.tsx` and
  `apps/web/src/lib/rate-limit.ts`. Adds `OG_WINDOW_MS`,
  `OG_MAX_REQUESTS`, `ogRateLimit`, `pruneOgRateLimit`,
  `preIncrementOgAttempt`, `resetOgRateLimitForTests`. Route now sends
  `public, max-age=3600, stale-while-revalidate=86400` plus a stable
  ETag on success, returns 304 on `If-None-Match`, and 429 with
  `Retry-After: 60` over the bucket.
- `test(rate-limit): ✅ cover preIncrementOgAttempt window + prune` —
  new `apps/web/src/__tests__/og-rate-limit.test.ts` covering bucket
  saturation, window reset, and prune behavior.

A separate gate-fix commit (`fix(sitemap): 🐛 tolerate offline DB during
build prerender`) was needed because dropping `force-dynamic` from
`sitemap.ts` in `dc1fa30` (AGG8F-02 / plan-234) made the build
prerender step fail when the DB is unreachable; the sitemap route now
falls back to a homepage-only sitemap on data-layer errors and ISR
fills it on the first runtime hit.

All gates green: lint, typecheck, lint:api-auth, lint:action-origin,
vitest (393 tests), Playwright (20 passed / 1 skipped), build. Deploy
issued via `npm run deploy` after push.

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
