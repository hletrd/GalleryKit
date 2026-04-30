# Plan 57 — Rate Limit Rollback on Unexpected Errors (C13-01, C13-02)

**Status:** DONE
**Severity:** 2 MEDIUM
**Findings:** C13-01 (login rate limit rollback), C13-02 (password change rate limit rollback)

---

## Problem

Both `login()` and `updatePassword()` in `auth.ts` pre-increment the rate limit counter before attempting the expensive Argon2 operation (TOCTOU fix). When credentials are correct, the counter is rolled back. When credentials are wrong, the counter correctly stays incremented. **However**, when an *unexpected* infrastructure error occurs (DB query failure, Argon2 internal error, transaction failure), the counter is NOT rolled back, meaning transient infrastructure errors consume rate limit attempts.

After 5 such transient errors, the user is locked out for 15 minutes despite never actually failing authentication.

---

## Implementation Steps

### Step 1: Fix C13-01 — Roll back login rate limit on unexpected errors

File: `apps/web/src/app/actions/auth.ts`

In the outer catch block (currently lines 190–193), add a rollback attempt:

Current code:
```typescript
} catch (e) {
    if (isRedirectError(e)) throw e;
    console.error("Login verification failed:", e instanceof Error ? e.message : 'Unknown error');
}

return { error: t('invalidCredentials') };
```

Change to:
```typescript
} catch (e) {
    if (isRedirectError(e)) throw e;
    console.error("Login verification failed:", e instanceof Error ? e.message : 'Unknown error');
    // Roll back pre-incremented rate limit on unexpected errors —
    // the user didn't fail authentication, the infrastructure did.
    try {
        await clearSuccessfulLoginAttempts(ip);
    } catch (rollbackErr) {
        console.debug('Failed to roll back login rate limit after unexpected error:', rollbackErr);
    }
}

return { error: t('invalidCredentials') };
```

Note: The `ip` variable is already in scope from the earlier `getClientIp(requestHeaders)` call at line 85.

### Step 2: Fix C13-02 — Roll back password change rate limit on unexpected errors

File: `apps/web/src/app/actions/auth.ts`

In the outer catch block (currently lines 318–321), add a rollback attempt:

Current code:
```typescript
} catch (e) {
    console.error("Failed to update password:", e instanceof Error ? e.message : 'Unknown error');
    return { error: t('failedToUpdatePassword') };
}
```

Change to:
```typescript
} catch (e) {
    console.error("Failed to update password:", e instanceof Error ? e.message : 'Unknown error');
    // Roll back pre-incremented rate limit on unexpected errors —
    // the user didn't fail authentication, the infrastructure did.
    try {
        await clearSuccessfulPasswordAttempts(ip);
    } catch (rollbackErr) {
        console.debug('Failed to roll back password change rate limit after unexpected error:', rollbackErr);
    }
    return { error: t('failedToUpdatePassword') };
}
```

Note: The `ip` variable is already in scope from the earlier `getClientIp(requestHeaders)` call at line 222.

### Step 3: Verify build

Run `npm run build --workspace=apps/web` to ensure no compilation errors.

### Step 4: Verify existing tests still pass

Run `npm test --workspace=apps/web` to confirm no regressions.

---

## Files Modified

- `apps/web/src/app/actions/auth.ts` — add rate limit rollback in two catch blocks

## Testing

- Existing auth rate limit tests should continue passing
- Manual verification: with a broken DB connection, login attempts should not consume rate limit counters
- Build and unit tests must pass

## Risk Assessment

- **Risk**: LOW — The change only adds a rollback attempt in error paths. The rollback itself is wrapped in try/catch, so a failed rollback cannot cause further issues.
- **Impact**: Prevents user lockout from infrastructure errors, which is a real operational concern during DB outages or high-load scenarios.
