# Debugger — Cycle 3

## Latent Bugs

### B1: SW `networkFirstHtml` blank page on network success
- **File**: `apps/web/public/sw.js`, lines 148-155
- **Severity**: High
- **Trigger**: Any HTML navigation when the network is available and the page is not in cache.
- **Failure mode**: Browser renders blank page because returned response body is consumed.
- **Workaround**: Hard-refresh or wait for cache fallback on next offline load.

### B2: Reactions route extra rate-limit budget
- **File**: `apps/web/src/app/api/reactions/[imageId]/route.ts`, lines 207-261
- **Severity**: Low
- **Trigger**: Exception thrown during cookie re-issue after DB transaction commits.
- **Failure mode**: Visitor gets one extra toggle attempt per exception.
- **Likelihood**: Very low (cookie setting is synchronous and safe).

### B3: OG photo handler memory spike
- **File**: `apps/web/src/app/api/og/photo/[id]/route.tsx`, lines 70-78
- **Severity**: Low
- **Trigger**: A large JPEG derivative (>5 MB) is fetched.
- **Failure mode**: Base64 string ~7 MB plus Satori rendering heap spike. Could OOM on constrained containers.
