# Critic — Cycle 3

## Findings

### F1: SW `networkFirstHtml` body consumption
- **File**: `apps/web/public/sw.js`, lines 148-155
- **Severity**: High
- **Cross-cutting**: Breaks offline HTML caching. Affects all HTML navigations when the network is available and the page is not in cache. This is the highest-impact finding this cycle.

### F2: Lint gate regex fragility
- **File**: `apps/web/scripts/check-public-route-rate-limit.ts`, lines 131-134
- **Severity**: Medium
- **Cross-cutting**: Security lint gates should be robust. Regex on raw source is a recurring anti-pattern in this repo (also seen in early versions of `check-action-origin`). The exempt-tag stripping logic exists; the helper detection should reuse it.

### F3: Reactions route structure
- **File**: `apps/web/src/app/api/reactions/[imageId]/route.ts`, lines 207-261
- **Severity**: Low
- **Cross-cutting**: Mixing post-transaction cookie logic inside the same try/catch as the transaction is risky. Separate concerns.

### F4: OG photo memory
- **File**: `apps/web/src/app/api/og/photo/[id]/route.tsx`, lines 70-78
- **Severity**: Low
- **Cross-cutting**: No guard against unexpectedly large derivatives.
