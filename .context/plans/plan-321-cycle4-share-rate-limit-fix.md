# Plan: Cycle 4 Fixes — Share Rate Limit & BoundedMap Migration

Plan ID: plan-321
Date: 2026-04-29
Status: active

## Summary

Fix the most impactful findings from Cycle 4 aggregate review: share rate-limit double-increment on both sharing routes, migrate admin-users.ts to BoundedMap, document loadMoreRateLimit intentional design, and broaden sanitizeStderr regex.

## Findings Addressed

| Finding | Severity | Title |
|---------|----------|-------|
| C4-AGG-01 | Medium / High | Share rate limit double-increment on both g/[key] and s/[key] |
| C4-AGG-02 | Medium / Medium | admin-users.ts raw Map → BoundedMap |
| C4-AGG-04 | Medium / Medium | Dead rollback overload in admin-users.ts |
| C4-AGG-05 | Low / Medium | loadMoreRateLimit underdocumented |
| C4-AGG-08 | Low / Low | sanitizeStderr regex does not match colon-separated |

## Implementation Steps

### Step 1: Fix C4-AGG-01 — Remove rate-limit check from `generateMetadata` in both sharing routes

**Files to modify:**
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`

**Changes:**
1. In `g/[key]/page.tsx`:
   - Remove the `isShareLookupRateLimited()` call from `generateMetadata` (line 42) and the `lookupLimited` conditional return (lines 49-53)
   - Keep the `isShareLookupRateLimited()` check in the page body (line 120) — this is the single enforcement point
   - Remove the `isShareLookupRateLimited` function itself since it will no longer be needed in this file (the page body can call `preIncrementShareAttempt` directly, or keep the helper for clarity)
   - Actually: keep the helper function but only call it from the page body. Remove the call from `generateMetadata`.
   - In `generateMetadata`, after removing the rate limit check, if the group/image is not found, still return the not-found metadata. The DB lookup in `generateMetadata` still runs (for OG tags), but the rate limit is only enforced in the page body.

2. In `s/[key]/page.tsx`:
   - Same pattern: remove `isShareLookupRateLimited()` from `generateMetadata` (line 46) and the `lookupLimited` conditional return (lines 53-57)
   - Keep the check in the page body (line 109)

**Rationale:** The `generateMetadata` function runs in a separate React rendering context from the page body. Both calls increment the rate limit counter, causing double-increment per page load. The page body is the correct single enforcement point because it controls the actual response. If rate-limited, the page body returns `notFound()`. The `generateMetadata` function returning minimal metadata when rate-limited provides no security benefit — the page body already enforces the limit.

**After fix:** Each page load consumes exactly 1 rate-limit credit, giving users the intended 60 page loads per minute.

### Step 2: Fix C4-AGG-02 + C4-AGG-04 — Migrate admin-users.ts to BoundedMap and remove dead overload

**File to modify:** `apps/web/src/app/actions/admin-users.ts`

**Changes:**
1. Import `createResetAtBoundedMap` from `@/lib/bounded-map`
2. Replace `userCreateRateLimit = new Map<string, { count: number; resetAt: number }>()` with `userCreateRateLimit = createResetAtBoundedMap<string>(USER_CREATE_RATE_LIMIT_MAX_KEYS)`
3. Remove `pruneUserCreateRateLimit()` function — BoundedMap handles pruning via `.prune(now)`
4. Rewrite `checkUserCreateRateLimit` to use BoundedMap API:
   ```typescript
   function checkUserCreateRateLimit(ip: string): boolean {
       const now = Date.now();
       userCreateRateLimit.prune(now);
       const entry = userCreateRateLimit.get(ip);
       if (!entry || entry.resetAt <= now) {
           userCreateRateLimit.set(ip, { count: 1, resetAt: now + USER_CREATE_WINDOW_MS });
           return false;
       }
       entry.count++;
       return entry.count > USER_CREATE_MAX_ATTEMPTS;
   }
   ```
5. Rewrite `rollbackUserCreateRateLimitAttempt` to use BoundedMap:
   ```typescript
   function rollbackUserCreateRateLimitAttempt(ip: string) {
       const currentEntry = userCreateRateLimit.get(ip);
       if (currentEntry && currentEntry.count > 1) {
           currentEntry.count--;
       } else {
           userCreateRateLimit.delete(ip);
       }
   }
   ```
6. Remove the dead 1-arg `rollbackUserCreateRateLimit(ip: string)` overload (lines 53-60) — it is never called. The 3-arg form (lines 62-67) calls `rollbackUserCreateRateLimitAttempt` internally, which will be updated to use BoundedMap.
7. Remove the now-unused `USER_CREATE_RATE_LIMIT_MAX_KEYS` constant reference if BoundedMap handles cap internally — but actually, keep the constant and pass it to `createResetAtBoundedMap`.

### Step 3: Fix C4-AGG-05 — Document loadMoreRateLimit intentional in-memory-only design

**File to modify:** `apps/web/src/app/actions/public.ts`

**Change:** Replace the comment at lines 88-91:
```
// Load-more is an automatically triggered, low-risk public read path. Keep
// it on the in-memory limiter fast path so every scroll batch does not pay
// persistent DB write/read latency before the actual image query.
```
with:
```
// Intentionally in-memory only: load-more is a high-frequency, low-risk
// public read path where DB write latency would degrade scroll responsiveness.
// Do not add DB-backed checking without evaluating the UX impact on scroll
// performance. See searchImagesAction for the DB-backed rate-limit pattern
// used on higher-risk surfaces.
```

### Step 4: Fix C4-AGG-08 — Broaden sanitizeStderr regex for colon-separated passwords

**File to modify:** `apps/web/src/app/[locale]/admin/db-actions.ts`

**Change:** At line 44, replace:
```typescript
text = text.replace(/(password\s*=\s*)[^\s;'"`]*/gi, '$1[REDACTED]');
```
with:
```typescript
text = text.replace(/(password\s*[:=]\s*)[^\s;'"`]*/gi, '$1[REDACTED]');
```

## Quality Gates

After all changes:
1. `npm run lint --workspace=apps/web` — must pass
2. `npx tsc --noEmit` — must pass
3. `npm test --workspace=apps/web` — must pass
4. `npm run lint:api-auth --workspace=apps/web` — must pass
5. `npm run lint:action-origin --workspace=apps/web` — must pass
6. `npm run build` — must pass

## Commit Strategy

Fine-grained GPG-signed commits with semantic+gitmoji messages:
1. `fix(sharing): 🐛 remove double rate-limit increment from generateMetadata in g/[key]`
2. `fix(sharing): 🐛 remove double rate-limit increment from generateMetadata in s/[key]`
3. `refactor(admin-users): ♻️ migrate userCreateRateLimit to BoundedMap`
4. `docs(public): 📝 document intentional in-memory-only loadMore rate limit`
5. `fix(db-actions): 🐛 broaden sanitizeStderr regex for colon-separated passwords`

## Deferred Findings

The following findings are deferred as low-priority or requiring more investigation:
- C4-AGG-03: Double DB query in generateMetadata (acceptable for personal-gallery scale, will document after AGG-01 fix)
- C4-AGG-06: Test for double-increment (regression test after fix)
- C4-AGG-07: Extract isShareLookupRateLimited to shared module (nice-to-have, not blocking)
- C4-AGG-09: Rate-limit notFound() user-facing explanation (UX enhancement, deferred)
- C4-AGG-10: admin-users.ts rate-limit comment (resolved by AGG-02 migration)
- C4-AGG-11: getImage prev/next NULL integration test (low priority)
