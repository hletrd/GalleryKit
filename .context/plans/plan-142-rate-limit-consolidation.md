# Plan 142: Consolidate Rate Limiting Pruning Logic

**Priority:** P2 (Maintainability)
**Source:** AGG-2 (code-reviewer C4/C6, security-reviewer S6, critic CR2, architect A2)

## Problem
Six separate Maps with near-identical pruning logic (iterate, delete expired, cap size):
1. `loginRateLimit` in rate-limit.ts
2. `passwordChangeRateLimit` in auth-rate-limit.ts
3. `searchRateLimit` in actions/public.ts
4. `shareRateLimit` in actions/sharing.ts
5. `userCreateRateLimit` in actions/admin-users.ts
6. `uploadTracker` in actions/images.ts

Plus: `checkShareRateLimit` returns inverted boolean (true = limited), inconsistent with `checkRateLimit` which returns `{ limited: boolean }`.

## Implementation Steps

### Step 1: Create `BoundedExpiryMap<K, V>` utility class
**File:** `apps/web/src/lib/bounded-map.ts` (new)

```typescript
export class BoundedExpiryMap<K, V> {
    private map = new Map<K, V>();
    private maxSize: number;
    private isExpired: (entry: V, now: number) => boolean;

    constructor(options: { maxSize: number; isExpired: (entry: V, now: number) => boolean }) { ... }

    get(key: K): V | undefined { ... }
    set(key: K, value: V): void { ... }
    has(key: K): boolean { ... }
    delete(key: K): boolean { ... }
    get size(): number { ... }
    prune(now: number): void { ... }  // Prune expired + enforce max size
    entries(): IterableIterator<[K, V]> { ... }
    keys(): IterableIterator<K> { ... }
}
```

### Step 2: Refactor each Map to use BoundedExpiryMap
Replace each of the 6 Maps with `BoundedExpiryMap` instances, providing their specific expiry/max config.

### Step 3: Fix `checkShareRateLimit` naming
Rename to `isShareRateLimited` to match the return semantics (true = limited).

### Step 4: Add startup warning for TRUST_PROXY
**File:** `apps/web/src/lib/rate-limit.ts`
Add a `console.warn` at module load when `NODE_ENV === 'production'` and `TRUST_PROXY` is not set.

## Deferred Items
- Full `RateLimiter` class that combines in-memory + DB-backed logic (architect A2) — deferred as it requires more extensive refactoring and testing. Current consolidation of pruning logic is sufficient for now.
- **Reason:** The in-memory + DB-backed integration is complex and could introduce regressions. The pruning consolidation provides 80% of the benefit with 20% of the risk.
- **Exit criterion:** When the codebase has been stable for 2+ cycles with the BoundedExpiryMap, the full RateLimiter class can be introduced.

## Exit Criteria
- All 6 Maps use BoundedExpiryMap
- No duplicated pruning logic
- `checkShareRateLimit` renamed to `isShareRateLimited`
- All existing tests pass

## Implementation Status: DEFERRED
- All steps deferred to a future cycle — this plan requires extensive refactoring
  of 6 modules with near-identical pruning logic. The risk of regression is high
  and the benefit is primarily maintainability, not correctness or security.
- The TRUST_PROXY startup warning (Step 4) was implemented in plan-143.
- Exit criterion for picking up: after 2+ stable cycles with current rate limiting.
Commit: N/A (deferred)
