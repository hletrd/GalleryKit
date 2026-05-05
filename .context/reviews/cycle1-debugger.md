# Debugger — Cycle 1 Fresh Review

**Date**: 2026-05-05
**Scope**: Latent bug surface, failure modes, race conditions, regressions.

---

## FINDINGS

### BUG-01: Service Worker HTML cache expiry is dead code (High)
**File**: `apps/web/public/sw.template.js`
**Lines**: 139, 148-156

The `sw-cached-at` header is read at line 148 but never written. This means:
1. The `age > HTML_MAX_AGE_MS` check (line 151) is unreachable.
2. Cached HTML entries never expire by age.
3. Stale HTML is served indefinitely across browser sessions.

**Regression risk**: After a deployment that changes JS chunk hashes, a returning user with cached HTML loads the old shell, which references deleted chunks → 404 errors → broken app.

**Reproduction**: 
1. Visit the site.
2. Go offline.
3. Wait 25 hours.
4. Revisit. The service worker serves cached HTML instead of 503.

---

### BUG-02: Service Worker metadata/cache desync on browser eviction (Medium)
**File**: `apps/web/public/sw.template.js`
**Lines**: 79-101

`recordAndEvict` tracks image sizes in a metadata Map stored in `META_CACHE`. If the browser evicts entries from `IMAGE_CACHE` due to quota pressure (independent of the SW's LRU logic), the metadata Map still believes those entries exist. On the next cache operation, `total` is computed from stale metadata, potentially causing:
1. Under-eviction (metadata thinks cache is smaller than it is)
2. Attempts to delete non-existent entries (harmless but wasteful)

**Impact**: Bounded — the LRU evicts oldest entries first, so metadata skew is limited to recently-evicted entries. The cache eventually self-corrects on version bump.

---

### BUG-03: OG photo route fetch has no timeout (Low)
**File**: `apps/web/src/app/api/og/photo/[id]/route.tsx`
**Line**: 71

```ts
const photoRes = await fetch(photoUrl);
```

No `AbortSignal` or timeout. If the internal photo server hangs (e.g., due to a file system issue), the OG request hangs indefinitely. Node.js `fetch` default timeout is 300s, which would hold the request open and consume server resources.

**Fix**: Add an `AbortSignal.timeout(10000)` or similar reasonable timeout.

---

## VERDICT

One high-severity bug (SW cache expiry), one medium-severity design limitation (metadata desync), and one low-severity timeout gap. The rest of the codebase shows mature error handling and defensive patterns.
