# Plan 63 — Cycle 17 Fixes (C17-01 through C17-10)

**Created:** 2026-04-19 (Cycle 17)
**Status:** DONE
**Severity:** 5 LOW + 1 VERY LOW

---

## Problem

Six issues identified in the cycle 17 comprehensive review. Five are LOW severity, one is VERY LOW. All are small, targeted improvements to consistency, correctness, and UX.

---

## Implementation Steps

### Step 1: C17-03 — Fix handleBatchAddTag isAddingTag state management

**File:** `apps/web/src/components/image-manager.tsx`, lines 159-170

The `handleBatchAddTag` function never sets `isAddingTag=true` before the async call, making the button's `disabled={isAddingTag}` ineffective.

```tsx
// Before
const handleBatchAddTag = async () => {
     if (!tagInput.trim()) return;
     const res = await batchAddTags(Array.from(selectedIds), tagInput);
     if (res?.success) {
         toast.success(t('imageManager.batchAddSuccess'));
         setIsAddingTag(false);
         setTagInput('');
         setSelectedIds(new Set());
     } else {
         toast.error(res?.error || t('imageManager.batchAddFailed'));
     }
};

// After
const handleBatchAddTag = async () => {
     if (!tagInput.trim()) return;
     setIsAddingTag(true);
     try {
         const res = await batchAddTags(Array.from(selectedIds), tagInput);
         if (res?.success) {
             toast.success(t('imageManager.batchAddSuccess'));
             setTagInput('');
             setSelectedIds(new Set());
         } else {
             toast.error(res?.error || t('imageManager.batchAddFailed'));
         }
     } finally {
         setIsAddingTag(false);
     }
};
```

### Step 2: C17-02 — Fix login outer catch to return generic error instead of "invalid credentials"

**File:** `apps/web/src/app/actions/auth.ts`, line 202

After the outer catch block rolls back the rate limit, it falls through to `return { error: t('invalidCredentials') }` which is misleading for infrastructure errors.

```ts
// Before (lines 190-202)
    } catch (e) {
        if (isRedirectError(e)) throw e;
        console.error("Login verification failed:", e instanceof Error ? e.message : 'Unknown error');
        // Roll back pre-incremented rate limit on unexpected errors
        try {
            await clearSuccessfulLoginAttempts(ip);
        } catch (rollbackErr) {
            console.debug('Failed to roll back login rate limit after unexpected error:', rollbackErr);
        }
    }

    return { error: t('invalidCredentials') };

// After
    } catch (e) {
        if (isRedirectError(e)) throw e;
        console.error("Login verification failed:", e instanceof Error ? e.message : 'Unknown error');
        // Roll back pre-incremented rate limit on unexpected errors
        try {
            await clearSuccessfulLoginAttempts(ip);
        } catch (rollbackErr) {
            console.debug('Failed to roll back login rate limit after unexpected error:', rollbackErr);
        }
        return { error: t('authFailed') };
    }
```

Remove the fall-through `return { error: t('invalidCredentials') }` at line 202. The `invalidCredentials` return already exists inside the try block at line 136.

### Step 3: C17-05 — Fix searchImages to use effectiveLimit instead of raw limit in slice

**File:** `apps/web/src/lib/data.ts`, line 585

```ts
// Before
return combined.slice(0, limit);

// After
return combined.slice(0, effectiveLimit);
```

### Step 4: C17-01 — Reduce getImages/getImagesLite data-layer limit caps from 500 to 100

**File:** `apps/web/src/lib/data.ts`, lines 232, 258

```ts
// Before (line 232)
const effectiveLimit = limit > 0 ? Math.min(limit, 500) : 500;

// After
const effectiveLimit = limit > 0 ? Math.min(limit, 100) : 100;

// Before (line 258)
const effectiveLimit = limit > 0 ? Math.min(limit, 500) : 500;

// After
const effectiveLimit = limit > 0 ? Math.min(limit, 100) : 100;
```

### Step 5: C17-10 — Unref GC interval timer in image-queue.ts

**File:** `apps/web/src/lib/image-queue.ts`, line 276

```ts
// Before
state.gcInterval = setInterval(() => {
    purgeExpiredSessions();
    purgeOldBuckets().catch(err => console.debug('purgeOldBuckets failed:', err));
    pruneRetryMaps(state);
}, 60 * 60 * 1000); // every hour

// After
state.gcInterval = setInterval(() => {
    purgeExpiredSessions();
    purgeOldBuckets().catch(err => console.debug('purgeOldBuckets failed:', err));
    pruneRetryMaps(state);
}, 60 * 60 * 1000); // every hour
state.gcInterval.unref?.();
```

### Step 6: C17-07 — Add client-side username pattern validation to admin-user-manager

**File:** `apps/web/src/components/admin-user-manager.tsx`, line 82

```tsx
// Before
<Input name="username" placeholder={t('users.username')} required minLength={3} maxLength={64} />

// After
<Input name="username" placeholder={t('users.username')} required minLength={3} maxLength={64} pattern="[a-zA-Z0-9_-]+" title={t('users.usernameFormat')} />
```

Need to add `'users.usernameFormat'` translation key to `en.json` and `ko.json`.

### Step 7: Verify build

Run `npm run build --workspace=apps/web`.

---

## Files Modified

- `apps/web/src/components/image-manager.tsx` — fix isAddingTag state management
- `apps/web/src/app/actions/auth.ts` — fix login outer catch error message
- `apps/web/src/lib/data.ts` — fix searchImages slice + reduce getImages/getImagesLite caps
- `apps/web/src/lib/image-queue.ts` — unref GC interval timer
- `apps/web/src/components/admin-user-manager.tsx` — add username pattern validation
- `apps/web/messages/en.json` — add translation key
- `apps/web/messages/ko.json` — add translation key

## Risk Assessment

- **Risk:** VERY LOW — All changes are small, targeted improvements. No logic changes to security-critical paths (auth flow only changes error message wording).
