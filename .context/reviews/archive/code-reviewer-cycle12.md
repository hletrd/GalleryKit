# Code Reviewer - Cycle 12

Scope: full repository review focused on server actions, rate-limit flows, sanitization, error handling, transaction boundaries, and consistency with cycles 1-11 RPL precedents.

## Files inventoried and examined

- `apps/web/src/app/actions/admin-users.ts` - user CRUD, rate-limit ordering + rollback
- `apps/web/src/app/actions/auth.ts` - login, logout, updatePassword
- `apps/web/src/app/actions/sharing.ts` - photo/group share create/revoke
- `apps/web/src/app/actions/topics.ts` - topic CRUD + alias CRUD, route mutation lock
- `apps/web/src/app/actions/tags.ts` - tag CRUD + batch ops
- `apps/web/src/app/actions/images.ts` - upload, delete, batch delete, metadata update
- `apps/web/src/app/actions/public.ts` - search + load more
- `apps/web/src/app/actions/settings.ts` - gallery settings
- `apps/web/src/app/actions/seo.ts` - SEO settings
- `apps/web/src/lib/rate-limit.ts` - DB-backed rate-limit primitives
- `apps/web/src/lib/auth-rate-limit.ts` - login/password-change helpers

## Findings

No new CRITICAL, HIGH, MEDIUM, or LOW findings.

All previously flagged issues are confirmed fixed:

- `createAdminUser` rollback on `ER_DUP_ENTRY` (C11R-FRESH-01) - `admin-users.ts:159-175` rolls back both DB + in-memory counters.
- `createAdminUser` form-field validation BEFORE rate-limit increment (AGG10R-RPL-01) - `admin-users.ts:88-113`.
- `updatePassword` form-field validation BEFORE rate-limit increment (AGG9R-RPL-01) - `auth.ts:288-306`.
- Sanitize-before-validate pattern consistently applied across all action files.
- Rate-limit rollback on infrastructure errors (login, updatePassword, createAdminUser generic catch, createAdminUser ER_DUP_ENTRY, sharing.ts retry exhaustion, sharing.ts FK violations).

## Pattern consistency checks passed

1. Every mutating action starts with: `isAdmin()` / `requireSameOriginAdmin()` / `getRestoreMaintenanceMessage()`.
2. Every string input is `stripControlChars()`-sanitized before length/format validation.
3. Every rate-limit-guarded action validates form fields BEFORE pre-increment.
4. Every rate-limit pre-increment has symmetric rollback on over-limit, infra-error, and retry-exhausted branches.
5. Every DB transaction that mutates references commits before associated filesystem cleanup.

## Gate snapshot (pre-fix)

- eslint: PASS
- lint:api-auth: PASS
- lint:action-origin: PASS
- vitest: 298/298 PASS
- (next build + playwright e2e will be run as part of cycle gates)

## Confidence: High

No action needed this cycle beyond documentation + gate verification + deploy.
