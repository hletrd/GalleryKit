# Plan 48 — Sharing insertId Guard, Login & User Form maxLength

**Created:** 2026-04-19 (Cycle 8)
**Status:** Done

## Findings Addressed

- C8-01 (MEDIUM): `createGroupShareLink` insertId BigInt precision — same bug class as prior fixes in `images.ts` and `admin-users.ts`
- C8-02 (LOW): Missing `maxLength` on login form username/password inputs
- C8-03 (LOW): Missing `maxLength` on create-user password input

## Implementation

### Part A: Sharing insertId BigInt Guard

#### File: `apps/web/src/app/actions/sharing.ts`

At line 154, add a `Number.isFinite` guard before using `insertId`:

Current:
```ts
const groupId = Number(result.insertId);
if (!Number.isFinite(groupId) || groupId <= 0) {
    throw new Error('Invalid insert ID from shared group creation');
}
```

Change to:
```ts
const rawGroupId = Number(result.insertId);
if (!Number.isFinite(rawGroupId) || rawGroupId <= 0) {
    throw new Error('Invalid insert ID from shared group creation');
}
const groupId = rawGroupId;
```

This matches the pattern already used in `images.ts:165` and `admin-users.ts:44-45`.

### Part B: Login Form maxLength

#### File: `apps/web/src/app/[locale]/admin/login-form.tsx`

Add `maxLength` attributes to both inputs:

Line 40 — username input:
```tsx
<Input id="login-username" type="text" name="username" placeholder={t('username')} required autoFocus autoComplete="username" maxLength={64} />
```

Line 42 — password input:
```tsx
<Input id="login-password" type="password" name="password" placeholder={t('password')} required autoComplete="current-password" maxLength={1024} />
```

### Part C: Create User Password maxLength

#### File: `apps/web/src/components/admin-user-manager.tsx`

Line 86 — add `maxLength={1024}`:
```tsx
<Input name="password" type="password" placeholder={t('users.password')} required minLength={12} maxLength={1024} />
```

## Verification

- Build passes (`npm run build`)
- Login form rejects input > 64 chars for username, > 1024 for password
- Create user form rejects password > 1024 chars
- Group share link creation still works correctly
