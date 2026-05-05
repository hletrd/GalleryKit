# Code Reviewer — Cycle 3

## Review Scope
Delta files (`sw.js`, `check-public-route-rate-limit.ts`, `check-action-origin.ts`, `check-api-auth.ts`) and critical public surfaces (`reactions/[imageId]/route.ts`, `og/photo/[id]/route.tsx`, `download/[imageId]/route.ts`).

## Findings

### F1: Service Worker `networkFirstHtml` consumes response body before returning it
- **File**: `apps/web/public/sw.js`, lines 148-155
- **Severity**: High
- **Confidence**: High
- **Problem**: `new Response(networkResponse.body, { ... })` consumes the underlying ReadableStream. The original `networkResponse` is returned on line 155 with a disturbed body, causing the browser to render an empty/blank HTML page on network success.
- **Fix**: Pass `networkResponse.clone().body` to the `Response` constructor so the original remains intact.
- **Concrete failure**: A user navigates to a gallery page with a fresh SW. The network is up. The SW returns the original `networkResponse` after its body was consumed by `htmlCache.put`. The browser shows a blank white page.

### F2: `check-public-route-rate-limit.ts` regex detection can be fooled by string literals
- **File**: `apps/web/scripts/check-public-route-rate-limit.ts`, lines 131-134
- **Severity**: Medium
- **Confidence**: Medium
- **Problem**: `usesPrefixHelper` performs a regex match on raw file content. A string literal containing `preIncrementFoo(` causes a false pass even if no actual rate-limit helper is invoked.
- **Fix**: Strip string literals and comments (similar to the exempt-tag logic on lines 121-124) before scanning for helper invocations, or use AST-based call-expression detection.

### F3: Reactions route catch-block rolls back rate limit after successful DB transaction
- **File**: `apps/web/src/app/api/reactions/[imageId]/route.ts`, lines 207-261
- **Severity**: Low
- **Confidence**: Medium
- **Problem**: The `try` block wraps the DB transaction (lines 209-237) and post-transaction cookie logic (lines 242-254). If cookie-setting throws after the transaction commits, the catch block decrements the rate-limit counters, giving the attacker an extra attempt.
- **Fix**: Separate the return from the catch scope so rollback only fires when the mutation did not commit. Alternatively, wrap only the DB work in the try/catch and handle cookie logic separately.

### F4: OG photo route lacks size cap before base64 encoding
- **File**: `apps/web/src/app/api/og/photo/[id]/route.tsx`, lines 70-78
- **Severity**: Low
- **Confidence**: Medium
- **Problem**: The route fetches a JPEG derivative and converts the entire buffer to a base64 data URL for Satori. A large derivative (e.g., >2 MB) creates a proportionally large string in memory with no safeguard.
- **Fix**: Reject or downsample derivatives larger than a configurable ceiling (e.g., 1 MB) before base64 conversion.
