# Security Review — Cycle 22

## Method
Reviewed auth flows, rate-limit implementations, service worker caching, semantic search surface, and admin settings mutations. Focus on OWASP Top 10 and data leakage.

## Verified Prior Fixes
- C21-AGG-02 (chunked encoding bypass): FIXED — body read as text with explicit cap
- C21-AGG-04 (decrementRateLimit race): STILL OPEN — see C22-HIGH-01
- C21-AGG-06 (backfill rate limit): PARTIALLY FIXED — auth added, rate limit still missing
- C21-AGG-07 (OG buffer guard): FIXED — post-fetch buffer length validation

## Findings

### HIGH

#### C22-SEC-01: Rate-limit decrement race allows undercounting
- **Source**: `apps/web/src/lib/rate-limit.ts:427-454`
- **Cross-reference**: C22-HIGH-01 (code-reviewer)
- **Issue**: The UPDATE+DELETE sequence in `decrementRateLimit` is non-atomic. A concurrent `incrementRateLimit` (which uses `onDuplicateKeyUpdate`) can interleave between UPDATE and DELETE, causing the incremented value to be lost. This weakens brute-force protection.
- **Attack scenario**: Attacker triggers rapid login attempts from multiple connections. Concurrent rollback of rate-limit counters (e.g., from legitimate users retrying after a transient error) interleaves with new increments, causing the bucket to undercount and allowing more attempts than configured.
- **Fix**: Wrap in transaction or use single atomic operation.
- **Confidence**: High

#### C22-SEC-02: SW HTML cache stores admin responses if admin browses while logged in
- **Source**: `apps/web/public/sw.js:224-237`
- **Issue**: The fetch handler returns early for admin routes (`isAdminRoute`), but this only applies to `/admin/*` and `/api/admin/*`. If an admin browses public pages while logged in, those HTML responses (which may contain user-specific admin state in JS hydration or CSRF tokens) are cached. The next visitor (different user, same device/browser) could receive cached HTML with stale admin-specific state.
- **Note**: Next.js App Router renders HTML on the server; logged-in vs anonymous HTML may differ (e.g., nav state). The SW caches the logged-in version.
- **Fix**: Add `Cache-Control: no-store` to admin-session-specific HTML responses, or bypass cache for requests with `admin_session` cookie.
- **Confidence**: Medium

### MEDIUM

#### C22-SEC-03: `backfillClipEmbeddings` lacks invocation rate limiting
- **Source**: `apps/web/src/app/actions/embeddings.ts:26-89`
- **Cross-reference**: C22-MED-01 (code-reviewer)
- **Issue**: No rate limiting on an admin action that processes up to 5000 images. A compromised admin session can repeatedly invoke this to exhaust CPU and DB resources.
- **Fix**: Add per-admin invocation rate limit.
- **Confidence**: High

### LOW

#### C22-SEC-04: Semantic search enrichment query returns `camera_model`
- **Source**: `apps/web/src/app/api/search/semantic/route.ts:216-226`
- **Issue**: The enrichment query selects `camera_model` which is EXIF-derived data. While consistent with regular search (which also returns this), it slightly expands the PII surface of the semantic endpoint. No regression from existing behavior.
- **Confidence**: Low

## Final Sweep
No new SQL injection surfaces. No new path traversal. No secrets in code. Same-origin guards intact. Session security unchanged.
