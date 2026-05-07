# Code Reviewer — Cycle 1 Fresh Review

**Date**: 2026-05-05
**Scope**: Full repository review focusing on code quality, logic correctness, and maintainability.

---

## FINDINGS

### BUG-01: Service Worker HTML cache never expires (High)
**File**: `apps/web/public/sw.template.js` (propagates to `apps/web/public/sw.js` via build)
**Lines**: 139 (put), 148 (read)

The `networkFirstHtml` strategy caches HTML responses but never sets the `sw-cached-at` header it later checks. At line 139:
```js
await htmlCache.put(request, networkResponse.clone());
```

Then at line 148:
```js
const dateHeader = cached.headers.get('sw-cached-at');
```

`dateHeader` is always `null` because the original server response does not include this header and the service worker never adds it. The 24-hour max-age check (`HTML_MAX_AGE_MS`) is dead code. Cached HTML is served indefinitely until a service worker version bump purges the cache.

**Failure scenario**: User visits the site, goes offline, and returns 48 hours later. The service worker serves stale HTML from cache instead of returning a 503 "Offline" response, violating the documented "24 h fallback cache" semantics.

**Fix**: Wrap the cached response with the `sw-cached-at` header before storing:
```js
const responseToCache = new Response(networkResponse.body, {
  status: networkResponse.status,
  statusText: networkResponse.statusText,
  headers: {
    ...Object.fromEntries(networkResponse.headers.entries()),
    'sw-cached-at': String(Date.now()),
  },
});
await htmlCache.put(request, responseToCache);
```

---

### BUG-02: check-public-route-rate-limit.ts misses export-specifier form (Medium)
**File**: `apps/web/scripts/check-public-route-rate-limit.ts`
**Lines**: 75-91

The script scans for exported mutating handlers via `FunctionDeclaration` and `VariableStatement`, but misses the export-specifier form:
```ts
const handler = async (req) => { ... };
export { handler as POST };
```

This is an `ExportDeclaration` with a `NamedExports` clause, not a `FunctionDeclaration` or `VariableStatement` with an `ExportKeyword` modifier. The TypeScript AST checker doesn't traverse into `ExportDeclaration` statements.

**Failure scenario**: A future route using the `export { handler as POST }` pattern would silently pass the lint despite having no rate-limit helper.

**Fix**: Add handling for `ts.isExportDeclaration(statement)` with `NamedExports` containing `MUTATING_METHODS` names.

---

### BUG-03: check-public-route-rate-limit.ts false positive on non-function exports (Low)
**File**: `apps/web/scripts/check-public-route-rate-limit.ts`
**Lines**: 84-91

The variable-statement check only verifies the declaration name (POST/PUT/PATCH/DELETE) without confirming the initializer is actually a function:
```ts
export const POST = 42;  // Would be flagged as mutating handler
```

**Fix**: Check `decl.initializer` is a function-like node.

---

### BUG-04: Exempt tag bypass via string literal (Low)
**File**: `apps/web/scripts/check-public-route-rate-limit.ts`
**Line**: 99

The exempt-tag check uses `content.includes(EXEMPT_TAG)`, which matches the substring anywhere in the file including inside string literals.

**Fix**: Restrict the match to comment contexts only.

---

## CODE QUALITY NOTES

- The `BoundedMap.prune()` method uses a collect-then-delete pattern which is correct and well-documented.
- The `home-client.tsx` `sizes` attribute is correctly calculated for the masonry column breakpoints.
- The `migrate.js` schema reconciliation is defensive and idempotent.
- No duplicate logic or DRY violations found in the critical paths reviewed.

## VERDICT

The codebase is mature and well-maintained. One high-severity bug (SW cache expiry) and three minor lint-gate edge cases were identified. All other critical paths reviewed show solid engineering.
