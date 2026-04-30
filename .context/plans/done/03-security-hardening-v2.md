# Plan 03: Security Hardening Pass 2

**Priority:** P1 — Fix within 1 week  
**Estimated effort:** 3-4 hours  
**Sources:** Security C1/H1/H2/H3/H4/M3-M8, Architecture 9

---

## 1. Fix CSP to match actual resource loading
**Source:** Security C1  
**Files:**
- `apps/web/next.config.ts:20` — update CSP to include CDN domains:
  ```
  script-src 'self' 'unsafe-inline' https://www.googletagmanager.com;
  style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;
  font-src 'self' data: https://cdn.jsdelivr.net;
  connect-src 'self' https://www.google-analytics.com;
  ```
- `apps/web/nginx/default.conf:22` — REMOVE CSP from nginx (single source of truth in Next.js)
- Keep the stricter image-location CSP in nginx (`default-src 'none'; img-src 'self'`)

## 2. Rate limiting on search, upload, and API
**Source:** Security H1, Performance P1-06  
**Files:**
- `apps/web/nginx/default.conf` — add rate zones:
  ```nginx
  limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;
  limit_req_zone $binary_remote_addr zone=search:10m rate=60r/m;
  ```
- Apply to admin mutation paths and public search action path
- Server-side: add rate limiter to `searchImagesAction` (similar pattern to login rate limiter)

## 3. Share button conditionally rendered for admin only
**Source:** Security H4  
**Files:**
- `apps/web/src/app/[locale]/p/[id]/page.tsx` — pass `isAdmin` boolean prop to PhotoViewer
- `apps/web/src/components/photo-viewer.tsx` — wrap Share button in `{isAdmin && (...)}`
- Remove `createPhotoShareLink` import from public bundle when not admin

## 4. Robots.txt for shared links
**Source:** Security I3  
**File:** `apps/web/src/app/robots.ts`
- Add `Disallow: /s/` and `Disallow: /g/` to prevent crawling shared links

## 5. Sitemap caching
**Source:** Security M3  
**File:** `apps/web/src/app/sitemap.ts`
- Replace `force-dynamic` with `export const revalidate = 3600`

## 6. Nginx TLS documentation
**Source:** Security M6  
**File:** `apps/web/nginx/default.conf`
- Add comment documenting that TLS is terminated upstream
- Add HTTP-to-HTTPS redirect: `if ($http_x_forwarded_proto = "http") { return 301 https://$host$request_uri; }`

## 7. DB backup filename — remove database name
**Source:** Security M4  
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:89`
- Change `backup-${DB_NAME}-${timestamp}.sql` to `backup-${timestamp}.sql`
- Update `SAFE_FILENAME` regex in download route to match

## 8. Entrypoint chown optimization
**Source:** Security M7  
**File:** `apps/web/scripts/entrypoint.sh:5-6`
- Only chown if not already owned by node: `if [ "$(stat -c '%U' /app/data)" != "node" ]; then`

---

## Verification
- [ ] Browser DevTools Console shows no CSP violations
- [ ] `curl -H "X-Forwarded-Proto: https"` returns proper CSP header
- [ ] Search from non-browser client rate-limited after 60 requests/min
- [ ] Share button not visible when not logged in as admin
- [ ] `/robots.txt` disallows `/s/` and `/g/`
- [ ] `/sitemap.xml` returns cached (check response headers)
