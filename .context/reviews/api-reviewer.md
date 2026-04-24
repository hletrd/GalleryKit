# API Reviewer — cycle 1

## Scope and inventory

I reviewed the repository from an API-contract perspective, with emphasis on:
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/next.config.ts`
- repo docs: `CLAUDE.md`, `README.md`, `apps/web/README.md`
- related tests: `backup-download-route.test.ts`, `health-route.test.ts`, `live-route.test.ts`, `seo-actions.test.ts`

I also swept the remaining route/metadata surface (`manifest.ts`, `robots.ts`, `sitemap.ts`, upload-serving routes) to confirm there were no additional contract regressions in the current tree.

## Findings

### 1) Auth/download failures are cacheable, so a shared cache can poison the backup download URL
**Severity:** Medium
**Confidence:** High

**Citations:**
- `apps/web/src/lib/api-auth.ts:12-16`
- `apps/web/src/app/api/admin/db/download/route.ts:27-33,39-42,80-85`

**Why this is a problem:**
`withAdminAuth()` returns a JSON 401 without `Cache-Control: no-store`, and the backup download route returns 403/400/404/plain 500 responses without any cache-busting headers on the early-return paths. The success path is marked `no-store`, but the failure paths are not.

**Concrete failure scenario:**
A reverse proxy, CDN, or browser cache sees a 401/403 for `/api/admin/db/download?file=...` and stores it. A later legitimate admin request with the same URL can receive the cached failure even after the user logs in correctly or fixes the filename. Because this is the DB-backup endpoint, a stale cached denial blocks an operational recovery path.

**Suggested fix:**
Make every auth/validation failure response on this route explicitly uncacheable, or centralize a helper that attaches `Cache-Control: no-store` to both `withAdminAuth()` failures and all early download-route exits. If you want shared caches to be extra safe, add `Vary: Cookie, Origin, Referer` as well.

---

### 2) `/api/live` and `/api/health` can be cached even though they are probe endpoints
**Severity:** Medium
**Confidence:** High

**Citations:**
- `apps/web/src/app/api/live/route.ts:1-7`
- `apps/web/src/app/api/health/route.ts:5-27`

**Why this is a problem:**
Both probe routes return JSON but do not emit any cache-control headers. `dynamic = 'force-dynamic'` keeps Next from statically pre-rendering them, but it does not stop an intermediary cache from reusing a 200 or 503 response.

**Concrete failure scenario:**
A monitor or proxy caches a transient 503 from `/api/health` during a DB outage and continues to report the app as unhealthy after the database recovers. The inverse is also possible: a cached 200 from `/api/live` can hide a later failure if an intermediary reuses it. That undermines the reliability of the readiness/liveness contract.

**Suggested fix:**
Return `Cache-Control: no-store, max-age=0` on both routes, and keep `X-Content-Type-Options: nosniff`. If external infrastructure depends on them, document `/api/live` as the only liveness probe and `/api/health` as the DB-aware readiness probe.

---

### 3) The OG image route caches 500s for 60 seconds, so transient failures linger in public previews
**Severity:** Low-Medium
**Confidence:** High

**Citations:**
- `apps/web/src/app/api/og/route.tsx:146-155`

**Why this is a problem:**
The error path returns a public cacheable response (`Cache-Control: public, max-age=60`). That means a temporary rendering failure can be remembered by browsers, crawlers, or upstream caches for a full minute.

**Concrete failure scenario:**
A brief edge/runtime hiccup or Sharp/ImageResponse failure generates a 500 for an OG request. Social crawlers or a CDN cache that response and continue serving the broken preview image even after the underlying issue is fixed, which makes link previews appear down longer than the actual outage.

**Suggested fix:**
Make OG error responses uncacheable (`Cache-Control: no-store`) or at least avoid `public` caching on 5xx responses. Keep the long-lived cache policy only on successful image generation.

## Missed-issues sweep

I re-checked the remaining route and metadata surface (`manifest.ts`, `robots.ts`, `sitemap.ts`, upload-serving routes, and the localized topic page that consumes OG URLs) and did not find any additional API-contract, auth, or cache/versioning regressions beyond the three findings above.
