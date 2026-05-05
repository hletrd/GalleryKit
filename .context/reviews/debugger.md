# Debugger Review — Cycle 19

## Method

Traced execution paths for failure modes, race conditions, and edge cases. Focused on: service worker cache consistency, rate-limit entry-point detection, ESM/CJS dual-mode hazards, React cache() side-effect suppression, and semantic search fallback paths.

---

## Findings

### C19-DEBUG-01 (MEDIUM): `check-public-route-rate-limit.ts` ReferenceError on ESM import

- **Source**: `apps/web/scripts/check-public-route-rate-limit.ts:179`
- **Confidence**: HIGH
- **Failure scenario**:
  1. Project adds `"type": "module"` to package.json (or a future Node.js LTS changes default module behavior).
  2. Vitest or tsx loads `check-public-route-rate-limit.ts` in ESM mode.
  3. Module top-level code evaluates `const isCliEntry = require.main === module || ...`
  4. `require` is undefined in ESM. `require.main` throws `ReferenceError: require is not defined`.
  5. Test suite or CI pipeline crashes before any assertions run.
  6. Lint gate is bypassed because the script cannot execute.
- **Root cause**: Short-circuit evaluation in `||` does NOT prevent the left operand from being evaluated first. The `typeof require === 'undefined'` guard on the right is never reached.
- **Detection**: Would manifest as a hard crash on module import in ESM environments.
- **Fix**: Reorder to test `typeof require !== 'undefined'` before accessing `require.main`.

### C19-DEBUG-02 (LOW): `getImageByShareKeyCached` comment describes wrong function

- **Source**: `apps/web/src/lib/data.ts:1324-1328`
- **Confidence**: HIGH
- **Failure scenario**:
  1. Future developer reads comment above `getImageByShareKeyCached` and believes it has view-count side effects.
  2. Developer avoids calling it in a component that needs fresh data, or incorrectly expects view counting.
  3. Actual side-effect function (`getSharedGroupCached`, line 1329) has no comment warning about its `bufferGroupViewCount` behavior.
  4. Developer calls `getSharedGroupCached` twice with different `incrementViewCount` semantics in the same render; React cache() deduplicates the second call, suppressing the view-count increment.
- **Impact**: View count undercounting for shared groups. Only affects analytics, not security.
- **Fix**: Move comment to `getSharedGroupCached`. Add "Pure function" comment above `getImageByShareKeyCached`.

### C19-DEBUG-03 (LOW): Semantic search fallback returns raw embedding results

- **Source**: `apps/web/src/app/api/search/semantic/route.ts:216-230`
- **Confidence**: LOW
- **Failure scenario**:
  1. DB connection pool exhausted or transient error during image enrichment query.
  2. Route falls through to `catch` branch.
  3. Fallback returns ALL embedding-scan results with dummy metadata (`filename_jpeg: ''`, `width: 0`).
  4. Client receives image IDs with empty filenames and attempts to render `<img src="/uploads/jpeg/" />`.
  5. Browser requests invalid URL; server returns 404.
- **Impact**: Degraded UX during DB stress. No security impact.
- **Fix**: Return `{ results: [] }` in the fallback branch, or pre-filter results against the successful imageRows set.
