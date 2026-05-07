# Cycle 17 — Review Aggregate

**Date:** 2026-04-30
**Source:** c17-comprehensive.md (single consolidated multi-perspective review)

## Actionable Findings (NEW this cycle)

| ID | Severity | Confidence | File | Description | Action |
|----|----------|------------|------|-------------|--------|
| C17-MED-01 | MEDIUM | HIGH | `apps/web/src/app/actions/public.ts:99-121` | `loadMoreImages` DB rate-limit counter not incremented when in-memory pre-check catches over-limit. On process restart, DB counter is missing those in-memory-only increments, giving users a fresh budget. `searchImagesAction` does not have this gap because the DB increment happens before the fast-path check. | Move DB increment before the in-memory over-limit return, or add DB increment on the rate-limited exit path |
| C17-LOW-04 | LOW | HIGH | `apps/web/src/lib/api-auth.ts:48` | `withAdminAuth` applies `X-Content-Type-Options: nosniff` to error responses (403/401) but not to successful handler responses. Individual handlers may omit it. | Add nosniff to successful handler responses in the wrapper, or document that handlers must include it |
| C17-LOW-06 | LOW | MEDIUM | `apps/web/src/app/api/og/route.tsx:47-55` | OG route rate-limit counter not decremented on 404 (topic not found). The user searched for a non-existent topic but is charged for CPU they didn't consume. Public read paths should use rollback pattern. | Add decrement on 404 path |
| C17-LOW-09 | LOW | LOW | `apps/web/src/lib/upload-tracker-state.ts:33` | Upload tracker prune uses 2x window (2 hours) while window reset uses 1x (1 hour). No comment explains the discrepancy. | Add comment explaining 2x grace period |
| C17-LOW-10 | LOW | MEDIUM | `apps/web/src/app/actions/tags.ts:448` | `batchUpdateImageTags` catch block returns `failedToAddTag` error even when the failure occurred during tag removal. | Use more generic translation key |

## Informational / No-fix-needed findings

| ID | Severity | Description |
|----|----------|-------------|
| C17-MED-02 | MEDIUM | `getImage` prev branch lacks defensive comment about isNotNull being load-bearing. Correct behavior, needs comment only. |
| C17-MED-03 | MEDIUM | Malformed cursor string silently resets to offset 0. Already safe, needs comment only. |
| C17-LOW-01 | LOW | getImageByShareKey tag parsing theoretical issue with null bytes in slugs. isValidTagSlug prevents this. |
| C17-LOW-02 | LOW | viewCountRetryCount full clear rarely reached under sustained traffic. Not a leak. |
| C17-LOW-03 | LOW | searchImages main branch GROUP BY comment. Already documented (C16-LOW-02). |
| C17-LOW-05 | LOW | adminUsers.updated_at with onUpdateNow() works correctly for password changes. |
| C17-LOW-07 | LOW | serveUploadFile TOCTOU gap between realpath and createReadStream. Acceptable per threat model. |
| C17-LOW-08 | LOW | CSP style-src 'unsafe-inline' carry-forward (C16-LOW-03). |
| C17-LOW-11 | LOW | createGroupShareLink retry loop rate-limit charge. Theoretical only. |

## Agent Failures

N/A -- single consolidated review.

## Cross-Agent Agreement

N/A -- single review.

## Verified Prior Fixes

- C16-MED-01: DB-backed rate limit for loadMoreImages -- verified correct (residual edge case in C17-MED-01)
- C16-MED-02: GROUP_CONCAT alignment -- verified correct
- C16-MED-03: shareRateLimit rename -- verified correct
- C16-LOW-07: sanitizeStderr regex -- verified correct
- C16-LOW-05: stricter cookie validation -- verified correct
- C16-LOW-14: adminUsers.updated_at -- verified correct
- C16-LOW-08: X-Content-Type-Options -- partially verified (C17-LOW-04 extends)

## Deferred (carry-forward, no change from prior cycles)

All previously deferred items from cycles 5-16 remain deferred with no change in status. See plan 84 and plan 93.
