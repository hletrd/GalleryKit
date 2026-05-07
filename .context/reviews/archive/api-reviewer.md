# API Reviewer — Cycle 3

## Findings

### F1: Checkout route idempotency key uses `Math.floor(Date.now() / 60_000)` which collapses duplicates across the same minute
- **File**: `apps/web/src/app/api/checkout/[imageId]/route.ts`, line 147
- **Severity**: Low
- **Problem**: Two legitimate purchases of the same image by the same IP within the same minute share the same idempotency key. Stripe deduplicates them, so the second buyer gets the same Checkout session URL (which is okay because it's the same session). But if the first buyer abandons the session and the second tries, they land in the same Stripe session. This is acceptable for idempotency.
- **Note**: Not a bug, just noting the trade-off.

### F2: Semantic search response does not include `Cache-Control` on success
- **File**: `apps/web/src/app/api/search/semantic/route.ts`, line 210-213
- **Severity**: Low
- **Problem**: The success response uses `NO_STORE_HEADERS` which includes `no-store`. This prevents any caching, which is correct for a POST mutation-like search, but GET-based search might benefit from short-term caching. However, it's a POST, so no-store is fine.

### F3: Reactions GET returns `Cache-Control: no-store`
- **File**: `apps/web/src/app/api/reactions/[imageId]/route.ts`, lines 40-43
- **Result**: Correct for a personalized endpoint.

### F4: Download route returns `Content-Type: application/octet-stream`
- **File**: `apps/web/src/app/api/download/[imageId]/route.ts`, line 241
- **Result**: Correct for original-format downloads.
