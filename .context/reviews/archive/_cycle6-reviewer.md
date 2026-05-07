# Cycle 6 Deep Code Review — Single-Agent Comprehensive Review

**Date**: 2026-05-05
**Review Type**: Single-agent review (no sub-agent fan-out available)
**Focus**: Post-cycle-5 delta, build artifact integrity, dead code elimination completeness, latent correctness issues

## Agent Failures

- The `Agent` tool is not exposed in this environment. `.claude/agents/` does not exist.
- A single comprehensive review was performed manually, covering code quality, security,
  correctness, tests, build pipeline, and UX angles.

## Findings

### C6R-01 — SW template missing `.clone()` fix causes body-disturbance regression on every build

- **File**: `apps/web/public/sw.template.js:148`
- **Severity**: High
- **Confidence**: High
- **Status**: NEW

**Problem**: The service worker template uses `new Response(networkResponse.body, {...})` in `networkFirstHtml` without cloning the response body first. This consumes/disturbs the body stream of `networkResponse` before the function returns it to the caller. The returned response has a disturbed body, causing blank HTML pages on network-success navigations when the service worker is active.

Commit `85a20e4` fixed this in the generated `sw.js` by changing to `networkResponse.clone().body`, but the template `sw.template.js` was never updated. The `prebuild` script (`scripts/build-sw.ts`) regenerates `sw.js` from the template on every build, so the fix is reverted every time. This affects both local builds and Docker builds.

**Failure scenario**: A user with an active service worker visits a page. The SW's `networkFirstHtml` strategy fetches the HTML, caches it, but the cached response body is disturbed. The browser displays a blank page instead of the HTML content.

**Fix**: Update `apps/web/public/sw.template.js` line 148 to match the fix in `sw.js`:
```javascript
const responseToCache = new Response(networkResponse.clone().body, {
```

---

### C6R-02 — `migrate.js reconcileLegacySchema` still creates dead reaction artifacts

- **File**: `apps/web/scripts/migrate.js:362` and `:484-492`
- **Severity**: Low
- **Confidence**: High
- **Status**: NEW

**Problem**: The `reconcileLegacySchema` function in `migrate.js` adds `reaction_count` to `images` (line 362) and creates the `image_reactions` table (lines 484-492). These artifacts were removed from the application in cycle 5 (schema.ts dropped them, migration 0014 drops them from DB). For legacy databases running through reconcile, this creates the artifacts only for migration 0014 to immediately drop them. This is unnecessary DB churn and could confuse operators.

**Fix**: Remove `reaction_count` from `ensureColumn` calls and remove the `image_reactions` `ensureTable` block from `reconcileLegacySchema`.

---

### C6R-03 — `check-public-route-rate-limit.ts` error message references deleted module

- **File**: `apps/web/scripts/check-public-route-rate-limit.ts:145`
- **Severity**: Low
- **Confidence**: High
- **Status**: NEW

**Problem**: The lint script's failure message references `@/lib/{reaction,auth}-rate-limit`, but the `reaction-rate-limit` module was deleted in cycle 5. The error message is stale and confusing to developers who encounter a lint failure.

**Fix**: Update line 145 to reference only `@/lib/auth-rate-limit`:
```typescript
`...preIncrement* / checkAndIncrement* / @/lib/auth-rate-limit).`
```

---

### C6R-04 — WeakMap key mismatch in db/index.ts pool initialization

- **File**: `apps/web/src/db/index.ts:46-67`
- **Severity**: Medium
- **Confidence**: Medium
- **Status**: NEW

**Problem**: The `connectionInitPromises` WeakMap stores init promises keyed by `CallbackPoolConnection` objects (the callback-style connections emitted by the `poolConnection.on('connection')` handler). However, `poolConnection.getConnection()` returns promise-style `PoolConnection` wrappers. The cast on line 61 (`connection as unknown as CallbackPoolConnection`) does not change the runtime object identity. The WeakMap lookup on line 62 likely returns `undefined` because the wrapper object and the underlying callback connection are different objects.

This means the `await initPromise` on line 64 is a no-op (`await undefined` resolves immediately), and the first query on a newly created pooled connection may race against the `SET group_concat_max_len = 65535` initialization. If the query uses `GROUP_CONCAT` and the SET hasn't completed, output could silently truncate at MySQL's default 1024-byte limit.

In practice this is hard to trigger because:
1. Connections are pooled and reused, so most queries run on connections where the SET completed long ago
2. The SET command is extremely fast
3. The default 1024 limit is sufficient for many tag lists

But from a correctness standpoint, the initialization contract is broken.

**Fix**: Store the init promise on the promise-style connection wrapper instead, or use a Map keyed by connection ID, or attach the promise directly to the connection object as a property.

---

## Previous-Cycle Status

- Cycle 5 findings C5R-01 through C5R-08 were all implemented in plan-402.
- Cycle 5 successfully removed dead backend reaction API, schema artifacts, visitor cookies,
  rate-limit modules, tests, and lint hints.
- The working tree was clean after cycle 5 (no uncommitted changes).

## Final Sweep

- No remaining `reaction` references in source, translations, or tests (confirmed via grep).
- All gates pass: eslint, tsc --noEmit, vitest (1009 tests), lint:api-auth, lint:action-origin.
- Build passes (`next build` completes successfully).
- Playwright e2e cannot run in this environment (no local MySQL), but this is environmental, not a code issue.
