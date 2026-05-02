# Cycle 16 Review Aggregate

**Date:** 2026-04-30
**Review source:** c16-comprehensive.md (consolidated multi-perspective review)

## Actionable Findings (NEW this cycle)

| ID | Severity | Confidence | File | Description | Action |
|----|----------|------------|------|-------------|--------|
| C16-MED-01 | MEDIUM | HIGH | `apps/web/src/app/actions/public.ts:47-56` | `loadMoreImages` rate-limit is in-memory only with no DB backup, unlike `searchImagesAction` in the same file which uses DB-backed rate limiting. Process restart resets budget. | Add DB-backed rate-limit check matching searchImagesAction pattern |
| C16-MED-02 | MEDIUM | MEDIUM | `apps/web/src/lib/data.ts:890-916` | `getImageByShareKey` GROUP_CONCAT name/slug alignment still fragile despite C15-MED-02 fix. Comma-containing tag names from before validation was added could split incorrectly. DISTINCT can cause count mismatches. | Use combined GROUP_CONCAT with unique delimiter, or fetch tags in separate query like getSharedGroup |
| C16-MED-03 | MEDIUM | HIGH | `apps/web/src/app/actions/sharing.ts:27-28` vs `apps/web/src/lib/rate-limit.ts:65` | Two separate `shareRateLimit` maps with same name but different configs (500 vs 2000 key caps). Naming collision risks wrong import. | Rename sharing.ts map to `shareWriteRateLimit` with distinct constant names |
| C16-LOW-01 | LOW | HIGH | `apps/web/src/lib/data.ts:101-103` | `flushGroupViewCounts` dropped increments have no aggregate counter/metric | Add dropped-increment counter logged in GC interval |
| C16-LOW-02 | LOW | HIGH | `apps/web/src/lib/data.ts:1118-1135` | `searchImages` main branch lacks GROUP BY (unlike tag/alias branches) — maintenance hazard | Add comment noting intentional omission, or add GROUP BY proactively |
| C16-LOW-03 | LOW | HIGH | `apps/web/src/lib/content-security-policy.ts:81` | CSP `style-src 'unsafe-inline'` carry-forward with no mitigation path | Document concrete exit criterion in deferred tracking |
| C16-LOW-04 | LOW | HIGH | `apps/web/src/db/schema.ts:50` | `original_file_size bigint mode: 'number'` precision — carry-forward | Document accepted precision limit in schema comment |
| C16-LOW-05 | LOW | MEDIUM | `apps/web/src/proxy.ts:87` | Middleware session cookie check only validates colon count (`::` would pass) | Add per-segment length/hex check |
| C16-LOW-06 | LOW | HIGH | `apps/web/src/app/actions/images.ts:492,628` | `getCurrentUser()` called after DB transaction for audit — already cached | No fix needed — informational |
| C16-LOW-07 | LOW | MEDIUM | `apps/web/src/lib/sanitize.ts:136-138` | `sanitizeStderr` password regex char class missing `>`, `}`, `]` | Expand character class |
| C16-LOW-08 | LOW | HIGH | `apps/web/src/proxy.ts:105-110` | No CSP/nosniff header on API route responses (carry-forward) | Add X-Content-Type-Options to withAdminAuth wrapper |
| C16-LOW-09 | LOW | LOW | `apps/web/src/lib/data.ts:957-974` | `getSharedGroup` position gaps — informational only | No fix needed |
| C16-LOW-10 | LOW | LOW | `apps/web/src/app/actions/sharing.ts:95-175` | `createPhotoShareLink` rate-limit consumed on "already has key" fast path | Move check after pre-increment or add rollback |
| C16-LOW-11 | LOW | HIGH | `apps/web/src/app/[locale]/admin/db-actions.ts:76` | CSV headers hardcoded English (carry-forward C13-03) | Deferred |
| C16-LOW-12 | LOW | MEDIUM | `apps/web/src/lib/data.ts:890-916` | Same as C16-MED-02 but lower severity due to isValidTagName comma rejection | See C16-MED-02 |
| C16-LOW-13 | LOW | LOW | `apps/web/src/app/actions/auth.ts:63-68` | First Argon2 dummy hash is lazily computed — timing side-channel on first request | Pre-compute at module init or accept negligible risk |
| C16-LOW-14 | LOW | HIGH | `apps/web/src/db/schema.ts:106-111` | `adminUsers` table lacks `updated_at` — password changes not timestamped at column level | Consider adding updated_at column |
| C16-LOW-15 | LOW | MEDIUM | `apps/web/src/lib/session.ts:94-145` | `verifySessionToken` cache is request-scoped — theoretical expiry bypass concern | No fix needed — request-scoped cache is safe |

## Agent Failures

No agent failures — single-agent consolidated review completed successfully.

## Cross-Agent Agreement (if multi-agent)

N/A — this cycle used a single consolidated review.

## Deferred (carry-forward, no change from prior cycles)

All previously deferred items from cycles 5-15 remain deferred with no change in status. See:
- Plan 60 (cycle 15 deferred)
- Plan 72 (cycle 26 deferred)
- C9-F01 / C14-LOW-01: `original_file_size` BigInt precision (now also C16-LOW-04)
- A17-MED-02 / C14-LOW-04: CSP `style-src 'unsafe-inline'` (now also C16-LOW-03)
- D1-MED: No CSP header on API route responses (now also C16-LOW-08)
- C13-03 / C15-LOW-05: CSV headers hardcoded in English (now also C16-LOW-11)
