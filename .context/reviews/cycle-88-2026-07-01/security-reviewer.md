# Cycle 88 Security Reviewer

Start HEAD: `afc2bf5245932fd421d84e8d29ca2e0be01280fb`.

## Inventory

Examined auth wrappers, origin guards, public route rate-limit guards, upload serving, backup download, DB restore, public select/privacy guards, semantic/similar search routes, OG photo routing, and the related guard tests.

## Findings

No confirmed security/auth/privacy finding was raised in this lane.

## Evidence

- Focused gates passed during review: `npm run lint:api-auth --workspace=apps/web`, `npm run lint:action-origin --workspace=apps/web`, and `npm run lint:public-route-rate-limit --workspace=apps/web`.
- Focused security/privacy tests passed: `npm test --workspace=apps/web -- privacy-fields map-privacy backup-download-route db-restore sql-restore-scan serve-upload request-origin api-auth-response-headers semantic-search-rate-limit og-route-rate-limit-behavior` (11 files, 108 tests).
- Representative citations checked: `apps/web/src/lib/api-auth.ts:72`, `apps/web/src/lib/action-guards.ts:37`, `apps/web/src/lib/request-origin.ts:87`, `apps/web/src/lib/serve-upload.ts:137`, `apps/web/src/app/api/admin/db/download/route.ts:21`, `apps/web/src/lib/data.ts:368`, `apps/web/src/app/api/og/photo/[id]/route.tsx:176`.
