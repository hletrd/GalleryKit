# Plan 173 — Fresh Cycle 1 Fixes

**Created:** 2026-04-21
**Status:** DONE
**Purpose:** Implement actionable findings from fresh cycle 1 aggregate review.

## Scheduled Fixes

### C173-01: Add username-scoped login rate limiting (S1-02)
**Severity:** MEDIUM | **Confidence:** Medium
**File:** `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/rate-limit.ts`

Currently, login rate limiting is IP-only. Add a secondary rate limit bucket keyed by `acct:<username>` so that distributed brute-force against a known username is throttled at the account level regardless of IP rotation.

Implementation:
1. In `auth.ts login()`, after the existing IP rate-limit checks, add a username-scoped `checkRateLimit`/`incrementRateLimit` pair using bucket type `login_account` and key `acct:${normalizedUsername}`.
2. On successful login, reset both IP and account rate limits.
3. On infrastructure error, roll back both pre-increments.
4. Apply the same pattern to `updatePassword()` (already has its own rate-limit namespace).

### C173-02: Stream CSV export instead of materializing full string (C1-01)
**Severity:** LOW | **Confidence:** High
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts`

Instead of building the full CSV in memory and returning it as a string, use a ReadableStream response to stream the CSV incrementally.

Implementation:
1. Change `exportImagesCsv()` to return a streaming Response instead of a `{ data, error }` object.
2. Process DB rows in smaller batches and write CSV lines to the stream incrementally.
3. This is a more significant refactor — consider whether the current admin-only 50K cap makes this worth the complexity. If deferring, document the memory concern.

**Decision: DEFER** — The 50K row cap and admin-only usage limits the practical impact. The current code already nulls the `results` array after processing. A streaming refactor would change the return type and require frontend changes to handle a streaming response. Not worth the complexity for an admin-only feature with bounded input. Document as deferred.

### C173-03: Batch flushGroupViewCounts DB updates (C1-02)
**Severity:** LOW | **Confidence:** High
**File:** `apps/web/src/lib/data.ts`

Instead of `Promise.all` over all 1000 entries, process in chunks of 20 to reduce concurrent promise overhead.

Implementation:
1. Replace the `Promise.all` with a chunked sequential approach using a helper that processes N entries at a time.
2. This reduces peak memory from 1000 promise objects to ~20 at a time.

### C173-04: Replace Host-header-based health check with secret header (S1-01)
**Severity:** LOW | **Confidence:** High
**File:** `apps/web/src/app/api/health/route.ts`

Replace the Host-header-based internal health check with a secret-header approach. The current health endpoint already returns only `{ status }` (no internal details), so the Host-header check is vestigial from a prior fix that removed detail leakage. Simply remove the Host-based branching since the public response is already safe.

Implementation:
1. Simplify the health route to always return `{ status: "ok" | "degraded" }` without the Host-header check.
2. Add optional `HEALTHCHECK_SECRET` env var support for a more detailed response when the secret header is present (optional enhancement).

## Deferred Items

| Finding ID | Reason for deferral | Exit criterion |
|------------|-------------------|----------------|
| C1-01 (CSV memory) | Admin-only, 50K cap, existing null-after-use pattern. Streaming refactor requires return-type change and frontend changes. | Re-open if CSV export causes OOM in production or if the feature needs to support >50K rows. |
| S1-03 (nginx TLS) | Deployment/operational concern, not a code defect. The documented deployment path uses an upstream TLS terminator. | Re-open if the nginx config is used as the public edge without an upstream TLS terminator. |
| S1-04 (npm audit esbuild) | Dev-only advisory through drizzle-kit. No production impact. Requires drizzle-kit upgrade. | Re-open when a drizzle-kit version with fixed esbuild chain is available. |

## Progress

- [x] C173-01: Username-scoped login rate limiting
- [x] C173-03: Batch flushGroupViewCounts
- [x] C173-04: Simplify health endpoint Host check
