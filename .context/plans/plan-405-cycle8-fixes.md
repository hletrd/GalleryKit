# Plan 405 — Cycle 8 Fixes

## From review: `.context/reviews/_aggregate-c8.md`

## Fix C8-F01 [HIGH] db/index.ts Symbol property fix is ineffective — DONE

**File**: `apps/web/src/db/index.ts` (lines 46–66)  
**Commit**: `0b68818`

**Problem**: The `connectionInitSymbol` property is attached to the callback-style `Connection` object in the `'connection'` event handler, but `getConnection()` returns a `PromisePoolConnection` wrapper that does not proxy arbitrary symbol properties. The `await initPromise` on line 63 therefore awaits `undefined`, failing to guarantee that `SET group_concat_max_len = 65535` completes before the connection is used.

**Fix applied**:
1. In the overridden `poolConnection.getConnection`, access the symbol via `connection.connection` (the underlying callback Connection) instead of directly on the wrapper.
2. Updated the `db-pool-connection-handler.test.ts` structural assertion to verify the new access pattern.
3. All gates green (`tsc --noEmit`, `vitest`, `lint`, `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`).

---

## Fix C8-F03 [LOW] check-public-route-rate-limit.ts false-positive pass on commented-out imports — DONE

**File**: `apps/web/scripts/check-public-route-rate-limit.ts` (lines 140–143)  
**Commit**: `f800fb4`

**Problem**: The `importsRateLimitModule` check scanned raw `content` for import patterns. A commented-out import (e.g., `// import { ... } from '@/lib/auth-rate-limit'`) still matched, causing the lint to falsely pass a route that had no actual rate-limit protection.

**Fix applied**:
1. Changed `importsRateLimitModule` to skip lines starting with `//` before matching import statements.
2. Lint gate (`npm run lint:public-route-rate-limit`) still passes for all current routes.
3. `npm test` passes (118 test files, 1009 tests).

---

## Deferred: C8-F02 [HIGH — PROCESS] Co-Authored-By in commit history

**Reason**: Fixing this requires rewriting published git history (amend + force-push to `master`), which is a destructive action. Per the destructive-action safety rules, this requires explicit user confirmation.

**Exit criterion**: User explicitly requests history rewrite, OR all future commits abstain from `Co-Authored-By` lines (which is already the repo policy per CLAUDE.md).
