# Cycle 8 Prompt 1 — Tracer Review

Scope: `/Users/hletrd/flash-shared/gallery`

## Inventory

I inspected the full end-to-end surface for the requested flows:

- **Upload → DB → queue → serve**
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/lib/process-image.ts`
  - `apps/web/src/lib/image-queue.ts`
  - `apps/web/src/lib/serve-upload.ts`
  - `apps/web/src/lib/upload-paths.ts`
  - `apps/web/src/lib/upload-tracker.ts`
  - `apps/web/src/lib/upload-tracker-state.ts`
  - `apps/web/src/lib/storage/local.ts`
  - `apps/web/src/db/schema.ts`
  - `apps/web/src/db/index.ts`
  - `apps/web/src/app/uploads/[...path]/route.ts`
- **Restore → maintenance → queue/actions**
  - `apps/web/src/app/[locale]/admin/db-actions.ts`
  - `apps/web/src/lib/db-restore.ts`
  - `apps/web/src/lib/restore-maintenance.ts`
  - `apps/web/src/lib/image-queue.ts`
  - `apps/web/src/app/api/health/route.ts`
- **Auth / rate-limit → sessions**
  - `apps/web/src/app/actions/auth.ts`
  - `apps/web/src/lib/rate-limit.ts`
  - `apps/web/src/lib/auth-rate-limit.ts`
  - `apps/web/src/lib/session.ts`
  - `apps/web/src/lib/request-origin.ts`
  - `apps/web/src/lib/action-guards.ts`
  - `apps/web/src/proxy.ts`
  - `apps/web/src/app/api/admin/db/download/route.ts`
- **Sharing → public pages / revalidation**
  - `apps/web/src/app/actions/sharing.ts`
  - `apps/web/src/app/actions/public.ts`
  - `apps/web/src/lib/data.ts`
  - `apps/web/src/lib/revalidation.ts`
  - `apps/web/src/app/[locale]/(public)/page.tsx`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- **Settings / SEO → rendering / cache**
  - `apps/web/src/app/actions/settings.ts`
  - `apps/web/src/app/actions/seo.ts`
  - `apps/web/src/lib/gallery-config.ts`
  - `apps/web/src/lib/gallery-config-shared.ts`
  - `apps/web/src/app/api/og/route.tsx`
  - `apps/web/src/app/manifest.ts`
  - `apps/web/src/app/robots.ts`
  - `apps/web/src/app/sitemap.ts`

I also checked the flow-specific tests for coverage gaps, especially:
`rate-limit.test.ts`, `restore-maintenance.test.ts`, `revalidation.test.ts`, `public-actions.test.ts`, `seo-actions.test.ts`, `settings-image-sizes-lock.test.ts`, `serve-upload.test.ts`, `session.test.ts`, `image-queue*.test.ts`.

## Confirmed findings

### 1) `getClientIp` mis-identifies the client on multi-hop forwarded chains

**Severity:** medium  
**Confidence:** high  
**Evidence:** `apps/web/src/lib/rate-limit.ts:69-86`  
**Related coverage:** `apps/web/src/__tests__/rate-limit.test.ts:97-119`

**What happens**
- `getTrustedProxyHopCount()` returns the hop count from `TRUSTED_PROXY_HOPS`.
- `getClientIp()` then computes `trustedHopIndex = validParts.length - hopCount`.
- For a chain like `x-forwarded-for: client, cdn, nginx` with `TRUST_PROXY=true` and `TRUSTED_PROXY_HOPS=2`, that resolves to the **middle proxy**, not the client.

**Failure scenario**
- In a CDN/LB → nginx → app deployment, login/search/share/upload rate limits are applied to the wrong address.
- Best case: the entire site shares one proxy bucket and legitimate users get throttled together.
- Worst case: rate limits can be bypassed or concentrated on an intermediate hop instead of the actual client.

**Concrete reproduction**
```bash
cd apps/web
npx tsx --eval "import { getClientIp } from './src/lib/rate-limit.ts'; process.env.TRUST_PROXY='true'; process.env.TRUSTED_PROXY_HOPS='2'; const headers=new Map([['x-forwarded-for','198.51.100.10, 203.0.113.7, 192.0.2.9']]); console.log(getClientIp({ get:(name)=>headers.get(name) ?? null }));"
```
Output: `203.0.113.7`

**Concrete fix**
- Change the hop index math so the client is selected from the left of the trusted-proxy chain, not the right. The minimal code fix is to subtract one more hop in the index calculation and update the tests to cover a 3-hop chain.

---

### 2) Restore maintenance is checked too late in many mutating actions

**Severity:** high  
**Confidence:** high  
**Evidence:**  
- `apps/web/src/app/actions/images.ts:82-94`  
- `apps/web/src/app/actions/settings.ts:39-46`  
- `apps/web/src/app/actions/seo.ts:54-61`  
- `apps/web/src/app/actions/sharing.ts:92-99, 189-196, 308-315, 348-355`  
- `apps/web/src/app/actions/admin-users.ts:82-89, 183-191`  
- `apps/web/src/app/[locale]/admin/db-actions.ts:33-44, 102-113, 245-252`  
**Contrast:** `apps/web/src/app/actions/auth.ts:70-75, 270-279` checks maintenance first.

**What happens**
- Several write paths authenticate or read session/admin state **before** they consult `getRestoreMaintenanceMessage()`.
- That means a restore window can still trigger DB work in `getCurrentUser()` / `isAdmin()` / same-origin helpers before the action is rejected.

**Failure scenario**
- While a restore is active, a mutating request can fail with auth/session DB errors or partial restore-time failures instead of the intended maintenance response.
- This is especially brittle because restore is exactly the time when session/auth reads are most likely to be unstable.

**Concrete fix**
- Hoist the maintenance guard to the top of every mutating action, before any auth/session lookup or same-origin validation.
- If you want a single reusable pattern, add a shared helper that returns the localized maintenance message before touching the DB.

---

### 3) Generated OG images are publicly cacheable for an hour with no matching invalidation path

**Severity:** medium  
**Confidence:** high  
**Evidence:**  
- `apps/web/src/app/api/og/route.tsx:39-41, 141-143`  
- SEO/settings mutations invalidate app paths but do not target this route:  
  - `apps/web/src/app/actions/settings.ts:134-154`  
  - `apps/web/src/app/actions/seo.ts:113-135`

**What happens**
- The OG image route explicitly sends `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`.
- The SEO mutation paths revalidate app pages/layouts, but there is no invalidation or version bump for `/api/og`.

**Failure scenario**
- Changing `seo.title`, `seo.description`, `seo_nav_title`, `seo_og_image_url`, or the image-size-dependent branding inputs updates page metadata, but social preview images can remain stale in browsers/CDNs for up to an hour, and stale content can continue to be served during the SWR window.

**Concrete fix**
- If freshness matters more than edge caching, switch the route to `no-store`.
- If you want to keep caching, add an explicit version/cache key derived from SEO settings and invalidate that version when SEO/settings change.

## Manual-validation risk

### `sitemap.ts` cache semantics need a version-specific check

**Evidence:** `apps/web/src/app/sitemap.ts:4-8`

I did **not** count this as a confirmed bug because Next.js route-caching behavior for `dynamic = 'force-dynamic'` + `revalidate = 3600` is version-sensitive. If your deployed Next version actually caches the sitemap response, then content changes will lag by up to an hour and the current mutation paths do not explicitly revalidate `/sitemap.xml`.

## Missed-issues sweep

After the end-to-end pass, I did not find additional confirmed defects in the upload/serve, sharing/public-page, or session/queue code beyond the three findings above.
