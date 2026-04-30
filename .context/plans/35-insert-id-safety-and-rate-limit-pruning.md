# Plan 35: Insert ID Safety and Rate-Limit Map Pruning

**Priority:** HIGH
**Estimated effort:** 30 minutes
**Sources:** C3-01, C3-02
**Status:** COMPLETED (cycle 3, commit 07b969e)

---

## Scope
- Add explicit Number() conversion + guard for `result.insertId` in `createGroupShareLink`
- Add `prunePasswordChangeRateLimit()` function and call it from `updatePassword`

---

## Item 1: Guard insertId in createGroupShareLink (C3-01)

**File:** `apps/web/src/app/actions/sharing.ts:101`

**Problem:** Drizzle `insert().values()` returns `{ insertId }` which can be a BigInt depending on mysql2 configuration. When the auto-increment PK exceeds `Number.MAX_SAFE_INTEGER`, the JS number silently loses precision. The value is passed as `groupId` to `sharedGroupImages` insert, which could silently corrupt the foreign key reference.

**Fix:** Add an explicit Number() conversion with a guard:

```typescript
// Before (line 101):
const groupId = result.insertId;

// After:
const groupId = Number(result.insertId);
if (!Number.isFinite(groupId) || groupId <= 0) {
    throw new Error('Invalid insert ID from shared group creation');
}
```

This also applies to `uploadImages` in `images.ts:156` which has the same pattern:
```typescript
const [result] = await db.insert(images).values(insertValues);
if (!result.insertId) {
    console.error(`Insert failed for file: ${file.name}`);
    failedFiles.push(file.name);
    continue;
}
const insertedImage = { id: result.insertId, ...insertValues };
```

Fix this to use `Number(result.insertId)` as well:
```typescript
const insertedImage = { id: Number(result.insertId), ...insertValues };
```

---

## Item 2: Add prunePasswordChangeRateLimit (C3-02)

**File:** `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/app/actions/auth.ts`

**Problem:** `passwordChangeRateLimit` Map was added in cycle 2 but is never pruned. Over time, every IP that attempts a password change adds a persistent entry. `updatePassword` at line 213 only calls `pruneLoginRateLimit(now)`, which doesn't touch the password map.

**Fix:** Add a `prunePasswordChangeRateLimit` function in `auth-rate-limit.ts`:

```typescript
export function prunePasswordChangeRateLimit(now: number) {
    for (const [key, entry] of passwordChangeRateLimit) {
        if (now - entry.lastAttempt > LOGIN_WINDOW_MS) {
            passwordChangeRateLimit.delete(key);
        }
    }

    // Hard cap: if still over limit after expiry pruning, evict oldest entries.
    if (passwordChangeRateLimit.size > LOGIN_RATE_LIMIT_MAX_KEYS) {
        const excess = passwordChangeRateLimit.size - LOGIN_RATE_LIMIT_MAX_KEYS;
        let evicted = 0;
        for (const key of passwordChangeRateLimit.keys()) {
            if (evicted >= excess) break;
            passwordChangeRateLimit.delete(key);
            evicted++;
        }
    }
}
```

Import `LOGIN_RATE_LIMIT_MAX_KEYS` from `rate-limit.ts` (already available via existing imports).

Then in `auth.ts:updatePassword`, add the pruning call after `pruneLoginRateLimit(now)`:

```typescript
pruneLoginRateLimit(now);
prunePasswordChangeRateLimit(now); // Added
```

---

## Deferred Items

None — both MEDIUM findings are planned above.
