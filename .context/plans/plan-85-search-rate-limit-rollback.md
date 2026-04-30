# Plan 85 — Search Rate Limit Rollback Fix

**Created:** 2026-04-19 (Cycle 1, New Loop)
**Status:** DONE
**Severity:** MEDIUM
**Confidence:** High
**Cross-agent agreement:** C1N-06 (code-quality) + C1N-07 (security) — HIGH SIGNAL

---

## Problem

In `apps/web/src/app/actions/public.ts`, the `searchImagesAction` function pre-increments the in-memory rate limit counter before checking the DB-backed rate limit. When the DB check returns `limited: true`, the function returns `[]` immediately **without rolling back the pre-incremented in-memory counter**. This causes the in-memory counter to overcount compared to the DB, prematurely rate-limiting legitimate search requests.

The existing code already handles the inverse case (DB increment failure → rollback in-memory counter) at lines 74-84. The missing rollback for the `limited=true` case is the same class of bug.

## Implementation Steps

### Step 1: Add rollback when DB-backed check returns limited
**File:** `apps/web/src/app/actions/public.ts:62-69`

After the `if (dbLimit.limited)` check, add rollback logic that mirrors the existing pattern at lines 74-84:

```typescript
// DB-backed check for accuracy across restarts
try {
    const dbLimit = await checkRateLimit(ip, 'search', SEARCH_MAX_REQUESTS, SEARCH_WINDOW_MS);
    if (dbLimit.limited) {
        // Roll back the pre-incremented in-memory counter to stay consistent
        // with DB source of truth. Without this, the in-memory counter
        // stays overcounted while DB is undercounted, causing premature
        // rate limiting for the remainder of the window.
        const currentEntry = searchRateLimit.get(ip);
        if (currentEntry && currentEntry.count > 1) {
            currentEntry.count--;
        } else {
            searchRateLimit.delete(ip);
        }
        return [];
    }
} catch {
    // DB unavailable — rely on in-memory Map
}
```

### Step 2: Verify with existing tests
Run `npm test --workspace=apps/web` to ensure no regressions.

### Step 3: Commit and push
- GPG-signed commit with semantic message: `fix(search): 🐛 roll back in-memory rate limit counter when DB check returns limited`

## Acceptance Criteria
- [ ] When DB returns `limited: true`, the in-memory counter is decremented or the entry removed
- [ ] The rollback mirrors the existing pattern for DB increment failure
- [ ] All existing tests pass
- [ ] No new regressions introduced
