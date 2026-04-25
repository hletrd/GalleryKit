# Plan 234 — Cycle 8 fresh: drop `force-dynamic` from sitemap

**Source finding:** AGG8F-02 (3 agents: code-reviewer, perf, critic)
**Severity:** MEDIUM
**Confidence:** High

## Problem

`apps/web/src/app/sitemap.ts` exports both:

```ts
export const dynamic = 'force-dynamic';
export const revalidate = 3600;
```

`force-dynamic` opts the route out of all caching/revalidation. The `revalidate` value is dead. Operators read the file and assume hourly caching; they get fresh DB scans on every crawler hit instead. For a multi-thousand-image gallery, `getImageIdsForSitemap(24000)` is a real DB scan per Googlebot pull.

## Fix shape

Remove `dynamic = 'force-dynamic'`. Keep `revalidate = 3600`. Document why the route is now revalidated rather than dynamic.

## Implementation steps

1. Edit `apps/web/src/app/sitemap.ts`:
   - Delete line 7 (`export const dynamic = 'force-dynamic';`).
   - Update the existing comment to explain the choice.
2. Verify Next.js renders the sitemap correctly during `npm run build`. The build step will resolve the route at build time and revalidate hourly under ISR.
3. (Optional) Add a CI lint script `scripts/check-route-config.ts` that flags any route file exporting both `dynamic = 'force-dynamic'` and a non-zero `revalidate`. Defer to a separate plan if desired.

## Done criteria

- All gates pass.
- `npm run build` produces the sitemap without warnings.
- Manual probe (post-deploy): `curl -I /sitemap.xml` returns a `Cache-Control` consistent with ISR (Next emits `s-maxage=3600`).

## Risk assessment

- Behavior shift: sitemap response now cached 1 hour. New images and topics propagate to `/sitemap.xml` within 1 hour instead of "instant" (which they were not, due to `getImageIdsForSitemap`'s 50K cap and the build-time freshness fence anyway).
- Crawlers re-fetch sitemap periodically; 1-hour staleness is well within the bound expected by Googlebot for content this stable.

## Out of scope

- Sitemap pagination / sub-sitemap shards (defer to existing backlog).
