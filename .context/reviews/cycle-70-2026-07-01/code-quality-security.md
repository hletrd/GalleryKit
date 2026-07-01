# Cycle 70 Review - Code Quality and Security

## Files Reviewed

- `AGENTS.md`, `CLAUDE.md`
- Admin API auth scanner and tests: `apps/web/scripts/check-api-auth.ts`, `apps/web/src/__tests__/check-api-auth.test.ts`
- Auth/session code, admin API wrappers, public API routes, server actions, upload/LR upload, sharing, DB restore, semantic search, settings validation, upload serving, and path sanitizers.

## Findings

### C70-01 - Admin API auth scanner misses mixed star re-exports

- Severity/confidence: High / High.
- File/line: `apps/web/scripts/check-api-auth.ts:125`.
- Evidence: `checkRouteSource()` handles named re-exports and direct exported declarations, but a route that combines `export const GET = withAdminAuth(...)` with `export * from './impl'` passes because the star re-export is ignored.
- Failure scenario: an admin route can hide an unwrapped `POST`/`DELETE` in another module while this lint gate reports the route file as OK.
- Suggested fix: fail closed on non-type `export * from ...` in admin API route files and add fixture coverage.

## Final Sweep

Current admin routes do not use the vulnerable star re-export shape. The issue is a security scanner false negative, not a confirmed unauthenticated live route.
