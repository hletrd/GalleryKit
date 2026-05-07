# Cycle 5 Comprehensive Review — Single-Agent

**Date**: 2026-05-05
**Reviewer**: Unified (code quality, security, correctness, tests, dead code)
**Scope**: Full repository, post-cycle-4 delta, reaction removal completeness

## Agent Failures

- The `Agent` tool is not exposed in this environment. `.claude/agents/` does not exist.
- A single comprehensive review was performed manually, covering code quality, security,
  performance, correctness, tests, and UX angles.

---

## Finding C5R-01: Incomplete Reaction Removal — Backend API Still Live

**Severity**: Medium
**Confidence**: High
**Status**: NEW

### Description
Cycle 4 removed the reactions UI from the photo viewer, admin settings, and translations, but the entire backend reaction API remains intact and functional. The endpoint `POST /api/reactions/[imageId]` can still be called, still writes to the database, still sets visitor cookies, and still performs rate-limit checks. This is dead code that should have been removed alongside the UI.

### File Citations
- `apps/web/src/app/api/reactions/[imageId]/route.ts` — entire file (lines 1–268)
- `apps/web/src/lib/reaction-rate-limit.ts` — entire file (lines 1–72)
- `apps/web/src/lib/visitor-cookie.ts` — entire file (lines 1–131)
- `apps/web/src/__tests__/reactions.test.ts` — entire file (lines 1–207)

### Concrete Failure Scenario
1. A visitor who knows the old API endpoint can still POST to `/api/reactions/123`.
2. The endpoint creates a visitor cookie, writes to `image_reactions` table, and updates `reaction_count`.
3. This consumes DB write capacity and inflates the `image_reactions` table with data that is never surfaced in the UI.
4. Over time, the orphaned table grows without bound.

### Fix
Remove the following completely:
- `apps/web/src/app/api/reactions/[imageId]/route.ts`
- `apps/web/src/lib/reaction-rate-limit.ts`
- `apps/web/src/lib/visitor-cookie.ts`
- `apps/web/src/__tests__/reactions.test.ts`
- Drop `reaction_count` column from `images` table (or add migration)
- Drop `image_reactions` table (or add migration)
- Remove `imageReactions` export from `apps/web/src/db/index.ts` (line 90)
- Remove visitor-cookie related code from any other files

---

## Finding C5R-02: DB Schema Still Contains Reaction Artifacts

**Severity**: Low
**Confidence**: High
**Status**: NEW

### Description
The Drizzle schema (`apps/web/src/db/schema.ts`) still defines:
- `images.reaction_count` (line 59)
- `imageReactions` table (lines 173–181) with indexes

These are no longer read by any application code outside the reactions API module itself (which is also dead). The migration `0007_image_reactions.sql` created the table but there is no corresponding cleanup migration.

### Concrete Failure Scenario
- Database migrations and schema reconciliation will continue to create/maintain these artifacts.
- Backups include unnecessary table data.
- Future developers may assume reactions are a supported feature.

### Fix
- Remove `reaction_count` from `images` schema definition.
- Remove `imageReactions` table definition.
- Create a migration to drop the column and table in existing deployments.
- Remove `imageReactions` from `apps/web/src/db/index.ts` exports.

---

## Finding C5R-03: Visitor Cookie Module Is Dead Code

**Severity**: Low
**Confidence**: High
**Status**: NEW

### Description
`apps/web/src/lib/visitor-cookie.ts` (131 lines) implements HMAC-SHA256-signed visitor identification for anonymous reactions. With the reactions UI removed and the reactions API unused, this module has no callers. It is pure dead code.

### Concrete Failure Scenario
- Module is imported by `api/reactions/[imageId]/route.ts` (also dead).
- Maintaining HMAC secret rotation logic, cookie options, and base64url encoding for a feature that does not exist is wasted complexity.

### Fix
Remove `apps/web/src/lib/visitor-cookie.ts` and all imports.

---

## Finding C5R-04: Reaction Rate-Limit Module Is Dead Code

**Severity**: Low
**Confidence**: High
**Status**: NEW

### Description
`apps/web/src/lib/reaction-rate-limit.ts` (72 lines) implements in-memory rate limiting for reaction toggles. No code path invokes these functions outside the dead reactions API.

### Concrete Failure Scenario
- The module uses `createResetAtBoundedMap` which is still used elsewhere (search rate limit, load-more rate limit), so the utility itself is fine — but the reaction-specific wrappers are dead.

### Fix
Remove `apps/web/src/lib/reaction-rate-limit.ts`.

---

## Finding C5R-05: Reaction Tests Test Dead Code

**Severity**: Low
**Confidence**: High
**Status**: NEW

### Description
`apps/web/src/__tests__/reactions.test.ts` (207 lines) tests visitor cookie HMAC signing and reaction rate-limit boundaries. These tests still pass because the underlying code still exists, but they test functionality that is no longer reachable from the application.

### Fix
Remove `apps/web/src/__tests__/reactions.test.ts`.

---

## Finding C5R-06: `check-public-route-rate-limit.ts` Lint Script References Dead Reaction Module

**Severity**: Low
**Confidence**: High
**Status**: NEW

### Description
The lint script `apps/web/scripts/check-public-route-rate-limit.ts` includes `'reaction-rate-limit'` in its `RATE_LIMIT_MODULE_HINTS` set (line 68). This is harmless — the script scans for import hints, not actual behavior — but it documents a module that no longer exists once reactions are fully removed. The lint gate output currently shows:

```
OK: src/app/api/reactions/[imageId]/route.ts (uses rate-limit helper)
```

This passes because the script recognizes the bespoke `checkAndIncrementVisitorReaction` and `checkAndIncrementIpReaction` call patterns. After removing the reactions API, this line will disappear from the output naturally.

### Fix
Remove the `'reaction-rate-limit'` entry from `RATE_LIMIT_MODULE_HINTS` when the module is deleted.

---

## Finding C5R-07: All Gates Green but e2e Tests Fail on Infrastructure

**Severity**: Low
**Confidence**: High
**Status**: CARRY-FORWARD / NOTE

### Description
`npm run test:e2e` fails because MySQL is not running locally (`ECONNREFUSED 127.0.0.1:3306`). This is an infrastructure gap, not a code issue. The e2e test suite itself is well-structured (Playwright with webServer config).

All other gates pass:
- ESLint: PASS
- TypeScript (`tsc --noEmit`): PASS
- vitest: 119 files, 1023 tests PASS
- lint:api-auth: PASS
- lint:action-origin: PASS (all mutating actions enforce same-origin)
- lint:public-route-rate-limit: PASS

### Fix
None required for code. Consider documenting the MySQL dependency for e2e tests in CONTRIBUTING.md or running them in CI.

---

## Final Sweep — Commonly Missed Issues

### No issues found in:
- **Race conditions**: View-count flush logic, upload processing claims, advisory locks, and transaction patterns all appear correct.
- **Auth/authz**: All admin mutations enforce `requireSameOriginAdmin()`; middleware guards are in place.
- **SQL injection**: Drizzle ORM parameterization used throughout; raw SQL is confined to schema maintenance helpers.
- **Secrets**: No plaintext secrets in source; SESSION_SECRET required in production.
- **Path traversal**: Upload routes use `SAFE_SEGMENT` regex and `resolvedPath.startsWith()` containment.
- **Type safety**: `tsc --noEmit` passes with zero errors.

### Minor observations (not findings):
- `apps/web/public/sw.js` shows as modified in git status but produces no diff — likely a file mode change or already-staged content. Harmless.
- The `data.ts` view-count flush logic is mature and well-hardened (retry caps, backoff, chunking, buffer size enforcement).
- The `adminSelectFields` / `publicSelectFields` separation is correctly maintained; no PII leakage detected.
