# Security Reviewer — Cycle 3

## Findings

### F1: Service Worker returns disturbed response on network success
- **File**: `apps/web/public/sw.js`, lines 148-155
- **Severity**: High
- **Problem**: The network-first HTML strategy returns a response with a consumed body. While not a direct security flaw, a broken offline experience can be abused to force fallback to cached stale content or cause client-side errors.
- **Fix**: `new Response(networkResponse.clone().body, { ... })`.

### F2: `check-public-route-rate-limit.ts` regex can be bypassed by string literals
- **File**: `apps/web/scripts/check-public-route-rate-limit.ts`, lines 131-134
- **Severity**: Medium
- **Problem**: A malicious or careless developer can add a string literal containing a rate-limit helper name and the lint gate will pass, allowing an un-metered public mutation surface to ship.
- **Fix**: Strip string literals/comments before regex scanning or switch to AST-based detection.

### F3: Reactions route rollback after commit gives extra rate-limit attempts
- **File**: `apps/web/src/app/api/reactions/[imageId]/route.ts`, lines 257-261
- **Severity**: Low
- **Problem**: If post-transaction logic throws, the catch block rolls back the rate-limit counter even though the reaction state mutated. This allows a determined attacker to exceed the intended toggle budget by engineering a post-transaction failure.

### F4: SW `isSensitiveResponse` does not check `private` directive
- **File**: `apps/web/public/sw.js`, lines 45-50
- **Severity**: Low
- **Problem**: `Cache-Control: private` is not treated as sensitive. The SW is a local cache, so `private` is technically acceptable, but it is inconsistent with the comment "401/403 responses: never cached" — the helper name implies broader coverage.
