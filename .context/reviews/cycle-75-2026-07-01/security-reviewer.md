# Cycle 75 Security Review

Scope: admin API auth wrappers, mutating server actions, public route rate limits, SSRF/canonical URL handling, session/token behavior, upload path containment, CSV and OG sanitization.

## Findings

No confirmed new security finding at `29f4176d`.

## Evidence

- `npm run lint:api-auth --workspace=apps/web` - pass.
- `npm run lint:action-origin --workspace=apps/web` - pass.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass.
- `npm audit --workspace=apps/web --omit=dev --audit-level=high` - pass, 0 vulnerabilities.

## Inventory

- Auth/API: `apps/web/src/lib/api-auth.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`.
- Actions/session/token: `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/admin-tokens.ts`.
- Public limits/canonical/serving: `apps/web/src/lib/rate-limit.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/og-sanitize.ts`.
