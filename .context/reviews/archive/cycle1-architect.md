# Architect — Cycle 1 Fresh Review

**Date**: 2026-05-05
**Scope**: Architectural/design risks, coupling, layering.

---

## FINDINGS

### ARC-01: Service Worker cache metadata lives outside the cache API (Medium)
**File**: `apps/web/public/sw.template.js`

The image LRU metadata is stored in a separate `META_CACHE` cache instead of using Cache API metadata or IndexedDB. This creates a split-brain risk where the metadata Map and the actual cache contents can diverge (e.g., browser quota eviction, manual cache deletion in DevTools).

**Recommendation**: Consider using CacheStorage API with direct size queries, or store metadata alongside cached entries as Response headers. The current approach is pragmatic for a PWA but has known consistency limitations.

---

### ARC-02: check-public-route-rate-limit.ts duplicates AST parsing logic (Low)
**File**: `apps/web/scripts/check-public-route-rate-limit.ts`

The script implements its own TypeScript AST traversal for finding exported handlers. This overlaps with the pattern used in `check-api-auth.ts` and `check-action-origin.ts`. A shared AST utility would reduce duplication and maintenance burden.

**Recommendation**: Extract a shared `findExportedHandlers` utility across the three lint gates.

---

### ARC-03: OG photo route self-fetches over HTTP (Low)
**File**: `apps/web/src/app/api/og/photo/[id]/route.tsx`

The OG route fetches photo derivatives via `fetch(photoUrl)` using the request origin. This adds an internal HTTP round-trip that could be avoided by reading the file directly from disk (the route already runs in Node.js runtime).

**Recommendation**: Read the JPEG derivative directly via `fs.readFile` instead of `fetch`, eliminating the HTTP overhead.

---

## VERDICT

Architecture is sound. Three minor recommendations for consistency and efficiency. No structural risks identified.
