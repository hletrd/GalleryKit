# Code Review — Cycle 13 (2026-05-05)

**Reviewer angle**: Code quality, logic correctness, edge cases, maintainability
**Scope**: Entire repository, focus on recently changed files and complex async paths
**Gates**: All green (eslint, tsc, vitest 1049 tests, playwright e2e 20 passed, lint:api-auth, lint:action-origin, lint:public-route-rate-limit)

---

## Executive Summary

After 13+ review cycles and 1000+ tests, the codebase has converged to a highly stable state. Only one new finding of LOW severity was identified. All prior MEDIUM/HIGH findings have been resolved. The code quality is excellent with thorough documentation, defensive patterns, and comprehensive error handling.

## Findings

### C13-LOW-01: `x-nonce` CSP nonce propagated to HTTP response headers
- **File+line**: `apps/web/src/proxy.ts:33-34`
- **Severity**: LOW
- **Confidence**: HIGH
- **Problem**: `applyProductionCsp` sets `x-nonce` in response headers. The nonce is intended for server-side use (read from request headers by `csp-nonce.ts`) and for embedding in `<script nonce="...">` HTML attributes. Exposing it as a response header makes it readable by same-origin JavaScript via `fetch()`/`XMLHttpRequest`, slightly weakening CSP's inline-script injection protection.
- **Failure scenario**: An attacker with DOM XSS makes a same-origin fetch, reads `x-nonce`, then injects `<script nonce="stolen">...</script>` that bypasses CSP.
- **Suggested fix**: Remove `response.headers.set('x-nonce', nonce)` from `applyProductionCsp`. Server components already read the nonce from request headers; clients read it from DOM attributes. The response header serves no legitimate purpose.
- **Cross-reference**: Verified no client-side code reads `x-nonce` from response headers. `csp-nonce.ts` imports from `next/headers` (request headers only).

## Verified Correct Patterns

The following complex areas were examined and found correct:

1. **Semantic search route** (`app/api/search/semantic/route.ts`): Rate-limit rollback correctly placed after all cheap validation gates and before expensive embedding work. Body size guard, same-origin check, and maintenance check all precede rate-limit consumption. Pattern 2 rollback (rollback on infrastructure error) is correctly implemented.

2. **AVIF high-bitdepth probe** (`lib/process-image.ts:50-76`): Promise-based singleton correctly prevents concurrent probe races. The first caller triggers the probe; all concurrent callers await the same promise. If probe fails, the promise resolves to `false` and all callers get `false`.

3. **Image queue bootstrap** (`lib/image-queue.ts:510-596`): GC interval is properly cleared before creating a new one (line 580). Permanently-failed IDs are excluded from bootstrap queries. Connection-refused errors trigger retry with backoff.

4. **Upload tracker** (`lib/upload-tracker.ts`): The `settleUploadTrackerClaim` reconciliation math correctly handles partial failures: `currentEntry.count = Math.max(0, currentEntry.count + (successCount - claimedCount))`.

5. **View count flush** (`lib/data.ts:63-166`): The atomic Map swap pattern prevents lost increments during flush. Retry cap with backoff, chunking, and post-flush buffer enforcement are all correct.

## Areas Examined With No Issues Found

- `lib/data.ts` — cursor-based pagination, search deduplication, privacy field guards
- `lib/process-image.ts` — EXIF extraction, ICC profile parsing, color pipeline
- `lib/rate-limit.ts` — all rate-limit helpers, rollback patterns, IP normalization
- `lib/image-queue.ts` — claim locks, retry logic, bootstrap continuation
- `app/actions/auth.ts` — login flow, session management, password change
- `app/actions/images.ts` — upload flow, tag processing, cleanup
- `proxy.ts` — middleware auth guard, CSP request handling (minus the header leak)
- `public/sw.js` — cache strategies, LRU eviction, admin bypass

## Conclusion

The codebase is in excellent shape. One LOW-severity security finding (CSP nonce header leak) was identified. No correctness bugs, race conditions, or memory leaks were found in the critical paths.
