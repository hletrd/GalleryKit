# Tracer — Cycle 9 (2026-04-25)

**HEAD:** `35a29c5`

## Trace 1 — `/api/og?topic=foo&tags=a,b` (cold cache)

1. `GET /api/og?topic=foo&tags=a,b` enters Next route handler.
2. `searchParams.get('topic')` → `"foo"`. Length and `isValidSlug` check
   pass.
3. `getClientIp(req.headers)` → real IP if `TRUST_PROXY=true`, else
   `"unknown"`.
4. `preIncrementOgAttempt(ip, now)` increments the in-memory bucket; the
   first 30 calls in a 60-second window pass (`false` returned).
5. `Promise.all([getSeoSettings, getTopicBySlug])` — concurrent DB reads.
6. `topicLabel = clampDisplayText(topicRecord.label, 100)`.
7. `tagList = ['a', 'b']` after split/filter/slice/map/filter pipeline.
8. ETag computed: SHA-256 of `slug|label|tags|siteTitle`, truncated to
   32 hex chars, wrapped in quotes.
9. `req.headers.get('if-none-match')` ≠ etag (cold cache), so we proceed.
10. `ImageResponse(...)` runs the React-tree → SVG → PNG pipeline.
11. Response: `200 OK`, `Cache-Control: public, max-age=3600,
    stale-while-revalidate=86400`, `ETag: "<32hex>"`.

**No defects observed.**

## Trace 2 — `/api/og?topic=foo&tags=a,b` (warm cache, `If-None-Match` matches)

1. Steps 1–8 as above.
2. `req.headers.get('if-none-match') === etag` → true.
3. Response: `304 Not Modified`, same Cache-Control, same ETag, **no
   body**.

**No defects observed.** ETag is computed before the rate-limit check
fails — actually, re-reading: rate-limit runs BEFORE etag computation, so
a saturated client gets `429` rather than `304` even if their ETag
matched. That is correct: the 429 is a budget enforcement, not a
caching decision.

## Trace 3 — `/api/og?topic=evil%2F..%2F..` (path traversal attempt)

1. `searchParams.get('topic')` → `"evil/../.."` (URL-decoded).
2. `isValidSlug` rejects (contains `/` and `.`).
3. Response: `400 Bad Request`. **No DB hit.** **No CPU work.**

**No defects observed.** Validation runs before rate-limit increment AND
before `getTopicBySlug`.

Note: this means an attacker hammering `/api/og?topic=invalid` doesn't
consume their rate-limit budget (the rate-limit check is after the slug
check). For brute-forcing, that's fine — they can't make the route DO
anything; they just get fast 400s. If they want to pin Node CPU, they
must pass valid slugs, and those incur the rate-limit.

## Trace 4 — `/sitemap.xml` (build-time)

1. Build prerender invokes `sitemap()`.
2. DB unreachable in build container.
3. `getTopics()` throws.
4. `try/catch` catches, sets `topics=[]`, `images=[]`, logs warn.
5. Returns localized homepage entries only.
6. Build succeeds (vs. cycle-8 build failure mode).

**No defects observed.** Behavior matches plan-234 follow-up commit.

## Trace 5 — `/sitemap.xml` (runtime, healthy DB)

1. ISR cache miss.
2. `getTopics()` + `getImageIdsForSitemap(imageBudget)` run.
3. Localized entries built; returns full sitemap.
4. Next ISR holds the response 1 hour.

**No defects observed.**

## Findings

**Status: zero new defects from tracing.**

## Summary

Five end-to-end traces of the cycle-8 deltas reveal no flaws. Validation
ordering is sound; cache headers are consistent across all branches;
fallback paths are non-disruptive.
