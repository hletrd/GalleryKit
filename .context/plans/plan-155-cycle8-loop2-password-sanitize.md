# Plan -- Cycle 8 (Loop 2) Password Sanitization Fixes

## Status: COMPLETE

## Findings to Address

### F1: C8-01 -- Sanitize `password` in `createAdminUser` before length check [MEDIUM] [MEDIUM confidence]

**File:** `apps/web/src/app/actions/admin-users.ts` lines 95-108

**Current code (lines 95-108):**
```typescript
const rawUsername = formData.get('username')?.toString() ?? '';
const username = stripControlChars(rawUsername) ?? '';
const password = formData.get('password')?.toString() ?? '';

// Reject malformed input: if sanitization changes the value, the input
// contained control characters and must not silently proceed (defense in
// depth — matches updateTopic/deleteTopic pattern, see C7R2-05).
if (username !== rawUsername) return { error: t('invalidUsernameFormat') };

if (!username || username.length < 3) return { error: t('usernameTooShort') };
if (username.length > 64) return { error: t('usernameTooLong') };
if (!/^[a-zA-Z0-9_-]+$/.test(username)) return { error: t('invalidUsernameFormat') };
if (!password || password.length < 12) return { error: t('passwordTooShortCreate') };
if (password.length > 1024) return { error: t('passwordTooLongCreate') };
```

**Fix:** Apply `stripControlChars` to password before length checks. Reject passwords containing control characters (matching the username pattern -- if sanitization changes the value, reject).

**Implementation plan:**
1. Change line 97 to: `const rawPassword = formData.get('password')?.toString() ?? '';`
2. Add after it: `const password = stripControlChars(rawPassword) ?? '';`
3. Add rejection check: `if (password !== rawPassword) return { error: t('invalidPasswordFormat') };`
4. Length checks now operate on the sanitized `password` value.

Note: Need to check if `t('invalidPasswordFormat')` key exists in messages/en.json and messages/ko.json. If not, need to add it, or reuse an existing key like `t('invalidUsernameFormat')` which would be misleading. A better approach: since control characters in passwords are almost certainly accidental, just strip them silently (like tagsString in uploadImages) rather than rejecting -- the user never intends to type a null byte or tab in a password. But for consistency with the username pattern (reject-on-change), and because the password is a security-sensitive field, rejection is safer.

Actually, on reflection: the safest approach is to silently strip control characters from the password, then do length checks. This matches the `tagsString` pattern from C46-01 where we strip-then-validate rather than reject-on-change. The reason is:
- For usernames/tags: control chars change the identity of the entity (different name)
- For passwords: control chars are almost certainly accidental paste artifacts, not intentional

So the implementation should be:
1. `const rawPassword = formData.get('password')?.toString() ?? '';`
2. `const password = stripControlChars(rawPassword) ?? '';`
3. Length checks on sanitized `password`
4. No rejection check -- just silently strip (matches tagsString pattern)

### F2: C8-02 -- Sanitize password fields in `updatePassword` before length checks [LOW] [MEDIUM confidence]

**File:** `apps/web/src/app/actions/auth.ts` lines 261-279

**Current code (lines 261-279):**
```typescript
const currentPassword = formData.get('currentPassword')?.toString() ?? '';
const newPassword = formData.get('newPassword')?.toString() ?? '';
const confirmPassword = formData.get('confirmPassword')?.toString() ?? '';

if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: t('allFieldsRequired') };
}

if (newPassword !== confirmPassword) {
    return { error: t('passwordsDoNotMatch') };
}

if (newPassword.length < 12) {
    return { error: t('passwordTooShort') };
}

if (newPassword.length > 1024) {
    return { error: t('passwordTooLong') };
}
```

**Fix:** Apply `stripControlChars` to all three password fields before the empty check and length checks. Silently strip (same as F1).

**Implementation plan:**
1. Change lines 261-263:
   ```
   const currentPassword = stripControlChars(formData.get('currentPassword')?.toString() ?? '') ?? '';
   const newPassword = stripControlChars(formData.get('newPassword')?.toString() ?? '') ?? '';
   const confirmPassword = stripControlChars(formData.get('confirmPassword')?.toString() ?? '') ?? '';
   ```
2. All subsequent checks (empty, match, length) now operate on sanitized values.

### F3: C8-03 -- Sanitize `password` in `login` for consistency [LOW] [LOW confidence]

**File:** `apps/web/src/app/actions/auth.ts` line 72

**Current code (line 72):**
```typescript
const password = formData.get('password')?.toString() ?? '';
```

**Fix:** Apply `stripControlChars` before any checks. This ensures the password used for Argon2 verification matches the sanitized password that was stored during account creation (after F1 is applied).

**Implementation plan:**
1. Change line 72 to: `const password = stripControlChars(formData.get('password')?.toString() ?? '') ?? '';`
2. This is safe because `stripControlChars` only removes C0 controls and DEL, which are never intentional in passwords.

## Progress Tracking

- [x] F1: Sanitize password in `createAdminUser` before length check — commit 0000000f4
- [x] F2: Sanitize password fields in `updatePassword` before length checks — commit 0000000f4
- [x] F3: Sanitize password in `login` for consistency — commit 0000000f4
- [x] Run gates (eslint, next build, vitest) — all pass
- [x] Deploy — per-cycle-success

## Deferred Items

No findings are deferred. All 3 findings are scheduled for implementation.
