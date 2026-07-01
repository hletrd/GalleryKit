# Cycle 98 Security/Auth Review

Starting deployed HEAD: `6f40f66d9a6949ea866966230e5fe0ba61024637`.

## Coverage

- Admin API `withAdminAuth(...)` wrappers.
- Mutating server action same-origin and admin guards.
- Public mutating and expensive route rate-limit gates.
- Upload filename/path handling and public upload serving containment.
- Backup download/restore filename, temp file, SQL scan, and stderr secret handling.
- Session cookie/token verification, PAT hashing/scope enforcement, OG/internal-fetch SSRF posture, public select/privacy guards, and raw SQL call sites.

## Findings

No new confirmed security/auth/privacy issues.

## Validation

The reviewer reported these checks passing during review:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- Targeted security/privacy Vitest slice: 19 files / 391 tests.
