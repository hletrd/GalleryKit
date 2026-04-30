# Plan 51 — Auth Server Action i18n (C9-01)

**Status:** DONE
**Severity:** MEDIUM
**Finding:** C9-01 — All error/success messages in `auth.ts` server actions are hardcoded English strings, breaking the multilingual UX contract for Korean users.

---

## Problem

`apps/web/src/app/actions/auth.ts` contains ~15 hardcoded English strings in `login()` and `updatePassword()`. The `topics.ts` server actions already use `getTranslations('serverActions')` for i18n. Auth pages (login, password change) are the most visible user-facing pages where i18n matters most.

## Implementation Steps

### Step 1: Add translation keys to `en.json` under `serverActions`

Add these keys to the existing `serverActions` object:

```json
"usernameRequired": "Username is required",
"passwordRequired": "Password is required",
"tooManyAttempts": "Too many attempts. Please try again later.",
"invalidCredentials": "Invalid credentials",
"authFailed": "Authentication failed. Please try again.",
"allFieldsRequired": "All fields are required",
"passwordsDoNotMatch": "New passwords do not match",
"passwordTooShort": "New password must be at least 12 characters long",
"passwordTooLong": "Password is too long (max 1024 characters)",
"incorrectPassword": "Incorrect current password",
"failedToUpdatePassword": "Failed to update password",
"passwordUpdated": "Password updated successfully."
```

### Step 2: Add translation keys to `ko.json` under `serverActions`

```json
"usernameRequired": "아이디를 입력해 주세요",
"passwordRequired": "비밀번호를 입력해 주세요",
"tooManyAttempts": "시도 횟수가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
"invalidCredentials": "아이디 또는 비밀번호가 올바르지 않습니다",
"authFailed": "인증에 실패했습니다. 다시 시도해 주세요.",
"allFieldsRequired": "모든 필드를 입력해야 합니다",
"passwordsDoNotMatch": "새 비밀번호가 일치하지 않습니다",
"passwordTooShort": "새 비밀번호는 12자 이상이어야 합니다",
"passwordTooLong": "비밀번호가 너무 깁니다 (최대 1024자)",
"incorrectPassword": "현재 비밀번호가 올바르지 않습니다",
"failedToUpdatePassword": "비밀번호 변경에 실패했습니다",
"passwordUpdated": "비밀번호를 변경했습니다."
```

### Step 3: Update `auth.ts` to use `getTranslations`

1. Import `getTranslations` from `next-intl/server` (already imported in topics.ts, need to add to auth.ts)
2. In `login()`:
   - Add `const t = await getTranslations('serverActions');` at the top of the function
   - Replace all hardcoded strings with `t('xxx')` calls
3. In `updatePassword()`:
   - Add `const t = await getTranslations('serverActions');` at the top of the function
   - Replace all hardcoded strings with `t('xxx')` calls
4. For strings shared between both functions, declare `t` once and reuse

### Step 4: Verify build

Run `npm run build --workspace=apps/web` to ensure no compilation errors.

## Files Modified

- `apps/web/messages/en.json` — add ~12 keys to `serverActions`
- `apps/web/messages/ko.json` — add ~12 keys to `serverActions`
- `apps/web/src/app/actions/auth.ts` — import getTranslations, replace ~15 hardcoded strings

## Testing

- Login with wrong credentials — should show localized error
- Login with empty username — should show localized error
- Password change with wrong current password — should show localized error
- Password change with mismatched new passwords — should show localized error
- Password change success — should show localized success message
- Switch language to Korean and verify all auth messages appear in Korean
