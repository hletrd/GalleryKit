# Cycle 54 Security / Auth Review

Reviewed HEAD: `1a65247c` (`fix(settings): keep production search operator-owned`).

## Inventory

- Auth/session/origin: `session.ts`, `api-auth.ts`, `auth.ts`, `request-origin.ts`, `proxy.ts`, `password-hashing.ts`.
- Admin API/actions: DB download, Lightroom upload, DB actions, action guards, image/settings/SEO/admin-user/topic/tag/share/collection/embedding/token actions.
- Public API/rate limiting: rate-limit helpers, public view actions, semantic/similar routes, OG routes.
- Upload/filesystem/restore: upload paths, filenames, image processing, derivative serving, SQL restore scan, DB restore.
- Secrets/privacy/CSP: tracked secrets, admin tokens, Lightroom tokens, privacy projections, search enrichment fields, CSP, `next.config.ts`.

## Findings

No new actionable security/auth findings.

## Validation From Lane

- `npm run lint:api-auth --workspace=apps/web` - pass.
- `npm run lint:action-origin --workspace=apps/web` - pass.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass.
- `npm audit --workspace=apps/web --audit-level=low` - 0 vulnerabilities.
- Focused security Vitest bundle - 18 files / 244 tests passed.
