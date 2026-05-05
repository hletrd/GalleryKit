# Architect — Cycle 3

## Findings

### F1: Service Worker cache prefix hard-coding
- **File**: `apps/web/public/sw.js`, lines 191-198
- **Severity**: Low
- **Problem**: Cache cleanup in `activate` explicitly lists `gk-images-`, `gk-html-`, `gk-meta-`. Adding a new cache prefix requires updating two places (the prefix literal and the cleanup filter). This is error-prone.
- **Fix**: Use a shared prefix constant (e.g., `gk-`) and filter by `k.startsWith(SW_CACHE_PREFIX)`.

### F2: Lint gates rely on regex over AST
- **Files**: `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/scripts/check-action-origin.ts`
- **Severity**: Medium
- **Problem**: `check-public-route-rate-limit.ts` uses regex to detect rate-limit helpers. `check-action-origin.ts` uses AST but has regex-like string scanning for exempt comments. Mixed approaches reduce maintainability.
- **Fix**: Standardize on AST traversal for all semantic checks. The TypeScript compiler API is already imported; use it to find actual call expressions.

### F3: OG image pipeline couples HTTP fetch, base64 encode, and Satori render
- **File**: `apps/web/src/app/api/og/photo/[id]/route.tsx`
- **Severity**: Low
- **Problem**: The request handler does sequential work: fetch JPEG → base64 → Satori. No size cap or timeout on the base64 step. Memory spikes are unbounded.
- **Fix**: Add a size-guarded abort before base64 conversion.
