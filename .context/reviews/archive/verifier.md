# Verifier — Cycle 3

## Evidence-Based Checks

### C1: SW `networkFirstHtml` returns original response after consuming its body
- **File**: `apps/web/public/sw.js`, lines 148-155
- **Result**: CONFIRMED BUG. `new Response(networkResponse.body, ...)` consumes the stream. Returning `networkResponse` afterwards yields a response with a disturbed body per Fetch/Streams spec.
- **Reproduction**: Load any HTML page with the SW active; the returned response body will be empty if the network request succeeds.

### C2: `check-public-route-rate-limit.ts` exempt-tag stripping
- **File**: `apps/web/scripts/check-public-route-rate-limit.ts`, lines 121-124
- **Result**: VERIFIED. The `withoutStrings` logic correctly strips string literals before checking for the exempt tag. The same technique is NOT applied to `usesPrefixHelper` (lines 131-134), creating an asymmetric correctness posture.

### C3: Reactions route rate-limit rollback after transaction commit
- **File**: `apps/web/src/app/api/reactions/[imageId]/route.ts`
- **Result**: CONFIRMED. The catch block (lines 257-261) calls `rollbackVisitorReaction` and `rollbackIpReaction` regardless of whether the transaction committed. The transaction is on lines 209-237; cookie logic (lines 242-254) is inside the same try block.

### C4: Semantic search rate-limit helper is local, not imported
- **File**: `apps/web/src/app/api/search/semantic/route.ts`
- **Result**: VERIFIED. The local `checkAndIncrementSemanticRateLimit` matches the `checkAndIncrement` prefix, so the regex-based lint gate passes. This is correct but brittle.
