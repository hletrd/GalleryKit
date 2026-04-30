# Plan 59 — Search Rate Limit Rollback on DB Failure (C14-01)

**Status:** DONE
**Severity:** MEDIUM
**Finding:** C14-01 (search rate limit in-memory overcount on DB increment failure)

---

## Problem

In `searchImagesAction()` (`apps/web/src/app/actions/public.ts`), the search rate limit uses a pre-increment pattern for TOCTOU protection: the in-memory counter is incremented before the DB-backed check and DB increment. If the `incrementRateLimit` DB call throws (transient DB error), the in-memory counter stays incremented while the DB counter was never incremented. This causes the in-memory counter to be overcounted relative to the DB source of truth, potentially causing premature rate limiting for the remainder of the 1-minute window.

Unlike the auth rate limits (which have explicit rollback in catch blocks from cycle 13), the search rate limit has no rollback mechanism.

---

## Implementation Steps

### Step 1: Add in-memory rollback on DB increment failure

File: `apps/web/src/app/actions/public.ts`

Current code (lines 71–75):
```typescript
try {
    await incrementRateLimit(ip, 'search', SEARCH_WINDOW_MS);
} catch {
    // DB unavailable — in-memory Map already incremented
}
```

Change to:
```typescript
try {
    await incrementRateLimit(ip, 'search', SEARCH_WINDOW_MS);
} catch {
    // DB unavailable — roll back in-memory increment to stay consistent
    // with DB source of truth. Without this, the in-memory counter
    // stays overcounted while DB is undercounted, causing premature
    // rate limiting for the remainder of the window.
    const currentEntry = searchRateLimit.get(ip);
    if (currentEntry && currentEntry.count > 1) {
        currentEntry.count--;
    } else {
        searchRateLimit.delete(ip);
    }
}
```

### Step 2: Verify build and tests

Run `npm run build --workspace=apps/web` and `npm test --workspace=apps/web`.

---

## Files Modified

- `apps/web/src/app/actions/public.ts` — add in-memory rollback in catch block

## Testing

- Existing rate limit tests should continue passing
- Manual verification: with a broken DB connection, search rate limit in-memory counter should roll back on failure
- Build and unit tests must pass

## Risk Assessment

- **Risk**: LOW — The change only adds a rollback in an error catch block. The rollback itself is a simple Map operation that cannot throw. If the entry doesn't exist or has count <= 1, we delete it (resetting to clean state), which is safe.
- **Impact**: Prevents premature rate limiting during transient DB connectivity issues.
