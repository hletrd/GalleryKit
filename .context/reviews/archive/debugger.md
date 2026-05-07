# Debugger Review — Cycle 22

## Method
Latent bug surface analysis: race conditions, failure modes, regressions, and edge-case behavior. Focus on paths that fail silently or produce misleading output.

## Findings

### HIGH

#### C22-DEBUG-01: `decrementRateLimit` Race Condition Still Present
- **Source**: `apps/web/src/lib/rate-limit.ts:427-454`
- **Confidence**: HIGH
- **Cross-reference**: C22-HIGH-01

**Failure mode**: Two concurrent requests on the same IP+window:
- Request A (rollback): UPDATE count=0, then DELETE removes row
- Request B (new attempt): INSERT ... ON DUPLICATE KEY UPDATE sets count=1 between A's UPDATE and DELETE
- Result: B's increment is lost. The rate limit counter is now 0 instead of 1.

This is in the rollback path, which is less common than the increment path, but it means that under high concurrency (e.g., multiple users on a shared network behind the same NAT), rate limits can undercount.

**Fix**: Atomic operation or transaction.

---

#### C22-DEBUG-02: SW HTML Cache Can Cache Logged-In State
- **Source**: `apps/web/public/sw.js:233-235`
- **Confidence**: MEDIUM

The SW caches HTML responses without checking for auth cookies. If an admin browses public pages while logged in, the cached HTML includes the authenticated nav state (e.g., admin dashboard link). A subsequent anonymous visitor on the same device receives the cached logged-in HTML. While this does not grant access (the server still checks auth), it creates UI confusion and leaks the existence of an admin session.

**Fix**: Bypass cache for requests with `admin_session` cookie, or add `Vary: Cookie` handling.

---

### MEDIUM

#### C22-DEBUG-03: Bootstrap Cleanup Amplifies Recovery Load
- **Source**: `apps/web/src/lib/image-queue.ts:583-585`
- **Confidence**: MEDIUM

During a DB outage, image processing jobs fail. Bootstrap retry schedules in 30 seconds. Each retry runs cleanup. If the outage lasts 5 minutes, cleanup runs ~10 times. Each cleanup may scan large tables (sessions, audit_log, rate_limit_buckets). This amplifies load on a recovering system.

**Fix**: Gate cleanup to once per hour.

---

### LOW

#### C22-DEBUG-04: Semantic Search Client Requests Different topK Than Server Default
- **Source**: `apps/web/src/components/search.tsx:79`
- **Confidence**: LOW

If `SEMANTIC_TOP_K_DEFAULT` changes on the server, the client continues to request 20 results. The server clamps to `SEMANTIC_TOP_K_MAX` (50), so this is not a correctness bug, but it is a silent behavioral drift.

---

## No new regressions detected
- Prior cycle fixes remain stable.
- No new failure modes introduced by recent commits.
