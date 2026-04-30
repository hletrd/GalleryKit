# Critic Review — critic (Cycle 9)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No medium or high findings.
- Two low findings about consistency.

## Verified fixes from prior cycles

All Cycle 8 critic findings confirmed addressed:

1. C8-CRIT-01 (stateful regex bypass): FIXED — `sanitizeAdminString` uses non-`/g` `UNICODE_FORMAT_CHARS` for `.test()`.
2. C8-CRIT-02 (inconsistent `.length` fix): FIXED — `topics.ts` and `seo.ts` now use `countCodePoints()`.

## New Findings

### C9-CRIT-01 (Low / Low). `countCodePoints()` fix was applied to topics/seo but not to `images.ts:139` (`tagsString.length > 1000`) or `public.ts:116` (`sanitizedQuery.length > 200`) — remaining inconsistencies

- Location: `apps/web/src/app/actions/images.ts:139` and `apps/web/src/app/actions/public.ts:116`
- While these are DoS-prevention bounds rather than MySQL varchar boundaries, the inconsistency is a maintenance hazard: a future developer seeing both `countCodePoints()` and `.length` in the same codebase for similar "limit the input size" checks would be unsure which pattern to follow.
- Suggested fix: Either switch these to `countCodePoints()` for consistency, or add explicit comments documenting the intentional use of `.length` (e.g., "DoS-prevention bound — `.length` intentionally stricter for non-varchar limits").

### C9-CRIT-02 (Low / Low). `withAdminAuth` in `api-auth.ts` is a weaker CSRF defense than `requireSameOriginAdmin()` used in server actions — inconsistent provenance posture

- Location: `apps/web/src/lib/api-auth.ts`
- Every mutating server action now uses `requireSameOriginAdmin()` for origin verification. But the only admin API route (`/api/admin/db/download`) adds its own explicit `hasTrustedSameOriginWithOptions` check on top of `withAdminAuth`. This means the wrapper itself is insufficient for CSRF defense — the real defense is layered on top by each caller.
- If a new admin API route is added and the developer only wraps it with `withAdminAuth`, they miss the origin check.
- Suggested fix: Move the origin check into `withAdminAuth` so every admin API route gets it automatically, matching the server action posture.

## Carry-forward (unchanged — existing deferred backlog)

- AGG6R-06: Restore lock complexity is correct but hard to simplify.
- AGG6R-07: OG tag clamping is cosmetic.
- AGG6R-09: Preamble repetition is intentional defense-in-depth.
