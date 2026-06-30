# Cycle 38 Security Review

Cycle: 38/100
Date: 2026-06-30 KST
Reviewed HEAD: `564a7679`

## Inventory

- Auth/session: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`
- Admin/API authz: `apps/web/src/proxy.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`
- Server actions/origin: `apps/web/src/lib/action-guards.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`
- Public APIs/rate limits: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/og/photo/[id]/route.tsx`
- Uploads/paths: `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/storage/local.ts`
- SSRF/open redirects/XSS: `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- Privacy fields: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`
- Deploy/secrets: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`

## Findings

No actionable current security findings beyond the scanner-quality items reported by code/test lanes.

## Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- `npm audit --workspace=apps/web --audit-level=moderate`: 0 vulnerabilities.
- Focused security/privacy tests passed: `privacy-fields`, `tracked-secrets`, `request-origin`, `serve-upload`, `admin-tokens` (66 tests).
