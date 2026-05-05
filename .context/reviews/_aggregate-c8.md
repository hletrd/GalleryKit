# Aggregate Review — Cycle 8/100

**Date**: 2026-05-06
**Reviewer**: Single-agent comprehensive review (no sub-agent fan-out available in this environment)
**Focus**: Recent cycle 7 fixes (db pool init, OG route hardening, queue diagnostics, service worker, lint gates), commit-message hygiene, and latent correctness issues

---

## REVIEW SCOPE

Files examined:
- `apps/web/src/db/index.ts` — connection pool initialization, Symbol-based init promise
- `apps/web/src/app/api/og/photo/[id]/route.tsx` — per-photo OG image generation, rate limiting
- `apps/web/src/lib/api-auth.ts` — admin API auth wrapper, Cache-Control hardening
- `apps/web/src/lib/image-queue.ts` — queue diagnostics, lastErrors map
- `apps/web/public/sw.js` / `sw.template.js` — service worker cache strategies
- `apps/web/scripts/check-public-route-rate-limit.ts` — public route rate-limit lint gate
- `apps/web/scripts/build-sw.ts` — service worker build script
- `apps/web/src/lib/rate-limit.ts` — OG rate-limit helpers
- `apps/web/src/lib/data.ts` — `getImage` field selection, privacy guards
- Git history (recent 10 commits, Co-Authored-By audit)

---

## NEW FINDINGS

### C8-F01 [HIGH] db/index.ts Symbol property fix (C6R-04) is ineffective — init promise never awaited

**File**: `apps/web/src/db/index.ts`  
**Lines**: 46–66  
**Confidence**: High  
**Severity**: High (data correctness — GROUP_CONCAT truncation on fresh connections)

**Problem**: Commit `fb58b86` (C6R-04) replaced a WeakMap-based per-connection init promise with a Symbol property, claiming: "A Symbol property travels with the object reference that getConnection() returns." This is incorrect.

In `mysql2/promise`, `poolConnection.on('connection', ...)` receives the **callback-style** `Connection` object. The Symbol property is attached to this callback Connection (line 55):
```typescript
(connection as unknown as Record<symbol, Promise<void>>)[connectionInitSymbol] = initPromise;
```

But `poolConnection.getConnection()` (PromisePool) returns a **`PromisePoolConnection`** wrapper object. `PromisePoolConnection` extends `PromiseConnection`, which stores the underlying callback Connection in `this.connection` but does **not** proxy arbitrary symbol properties. Therefore, when the overridden `getConnection()` reads:
```typescript
const initPromise = (connection as unknown as Record<symbol, Promise<void> | undefined>)[connectionInitSymbol];
```
...`initPromise` is always `undefined`, and `await initPromise` silently resolves immediately without waiting for `SET group_concat_max_len = 65535` to complete.

**Concrete failure scenario**: After a cold start or pool scale-up, a newly created connection fires the `'connection'` event. The SET query is dispatched asynchronously. Before it completes, `getConnection()` returns the wrapper to a caller (e.g., a gallery listing query using `GROUP_CONCAT` for tag names). The gallery query races the SET query. If the gallery query executes first, MySQL uses the default `group_concat_max_len = 1024`, silently truncating long tag lists in CSV exports and SEO settings.

**Fix**: Access the symbol property on the underlying callback Connection via the wrapper's `.connection` property:
```typescript
poolConnection.getConnection = (async (...args: Parameters<typeof poolConnection.getConnection>) => {
    const connection = await originalGetConnection(...args);
    const underlying = (connection as unknown as { connection?: Record<symbol, Promise<void> | undefined> }).connection;
    const initPromise = underlying?.[connectionInitSymbol];
    if (initPromise) {
        await initPromise;
    }
    return connection;
}) as typeof poolConnection.getConnection;
```

The `db-pool-connection-handler.test.ts` structural test only verifies source-code regexes and does not exercise the actual runtime behavior. A runtime assertion (e.g., creating a mock connection and verifying the symbol is accessible from the returned wrapper) should be added.

---

### C8-F02 [HIGH — PROCESS] Co-Authored-By attribution violates CLAUDE.md commit rules

**Scope**: Git history  
**Confidence**: High  
**Severity**: High (process/policy — 33 commits affected)

**Problem**: CLAUDE.md states: "Do NOT add `Co-Authored-By` lines to commit messages. Never attribute Claude as author or co-author in any commit."

A git-history audit finds **33 commits** containing `Co-Authored-By: Claude Opus 4.7` or similar. The most recent violation is in commit `de8151e` (cycle 7, May 6 2026), which is part of the current branch history.

**Exit criterion**: Future commits must not contain `Co-Authored-By` lines. Already-published commits on `master` should not be rewritten without explicit user confirmation (force-push is a destructive action per the destructive-action safety rules).

---

### C8-F03 [LOW] check-public-route-rate-limit.ts lint gate false-positive pass on commented-out imports

**File**: `apps/web/scripts/check-public-route-rate-limit.ts`  
**Lines**: 140–143  
**Confidence**: Medium  
**Severity**: Low

**Problem**: The `importsRateLimitModule` check scans raw `content` (not `withoutStrings`) for import patterns:
```typescript
const importsRateLimitModule = RATE_LIMIT_MODULE_HINTS.some((mod) => {
    const re = new RegExp(`from\\s+['"]@/lib/${mod}['"]`);
    return re.test(content);
});
```

Because this scans the raw file content, a commented-out import such as:
```typescript
// import { preIncrementCheckoutAttempt } from '@/lib/auth-rate-limit';
```
...would still match. Combined with `usesPrefixHelper` being false (no actual helper call), the `importsRateLimitModule || usesPrefixHelper` expression could be true from the comment alone, causing the lint to falsely pass a file that has no actual rate-limit protection.

**Concrete failure scenario**: A developer comments out a rate-limit helper during debugging and forgets to restore it. The lint gate passes because the commented-out import is still detected.

**Fix**: Scan `withoutStrings` (which already strips string literals but not comments) or add a comment-aware regex that rejects lines starting with `//` or `/*`.

**Exit criterion**: The lint gate must not match import statements inside comments.

---

## ASSESSMENT BY AREA

| Area | Status | Notes |
|------|--------|-------|
| Auth / Sessions | Solid | `withAdminAuth` correctly adds `no-store` Cache-Control on success; token path and origin checks are correctly ordered |
| OG Route | Solid | Rate limiting + Content-Length guard + AbortSignal timeout + fallback redirects are all correctly wired |
| Image Queue | Solid | `lastErrors` map is correctly populated, read on permanent failure, and cleaned up in all paths |
| Service Worker | Solid | Template and generated file are consistent; `.clone().body` fix is present in both |
| Public Route Rate Limit Lint | Solid (with C8-F03 caveat) | All current public routes pass; script AST parsing is robust for the existing codebase |
| DB Pool Init | **C8-F01** | Symbol property fix does not actually fix the race condition — needs correction |
| Commit Hygiene | **C8-F02** | 33 commits violate the no-Co-Authored-By rule |

---

## CONCLUSION

After 47+ prior review cycles, the codebase remains highly mature. This cycle's review surfaced **one new high-severity correctness bug** (C8-F01) in the recently committed db pool initialization fix, **one process/policy violation** (C8-F02) that cannot be remedied without destructive git operations, and **one low-severity lint gate gap** (C8-F03).

The C8-F01 fix should be prioritized: it closes a race condition that can silently truncate GROUP_CONCAT output on newly created pool connections.
