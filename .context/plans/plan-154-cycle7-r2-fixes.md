# Plan -- Cycle 7 Round 2 Fixes

## Status: COMPLETE

## Findings to Address

### F1: C7R2-01 -- Add malformed-input rejection to `createTopicAlias` [MEDIUM] [HIGH confidence]

**File:** `apps/web/src/app/actions/topics.ts` lines 248-258

**Current code:**
```typescript
const cleanTopicSlug = stripControlChars(topicSlug) ?? '';
if (!cleanTopicSlug || !isValidSlug(cleanTopicSlug)) {
    return { error: t('invalidTopicSlug') };
}
const cleanAlias = stripControlChars(alias) ?? '';
if (!isValidTopicAlias(cleanAlias)) {
    return { error: t('invalidAliasFormat') };
}
```

**Fix:** Add rejection checks matching `deleteTopicAlias` pattern:
- After line 248: `if (cleanTopicSlug !== topicSlug) return { error: t('invalidTopicSlug') };`
- After line 255: `if (cleanAlias !== alias) return { error: t('invalidAlias') };`

### F2: C7R2-02 -- Add malformed-input rejection to `createTopic` [MEDIUM] [MEDIUM confidence]

**File:** `apps/web/src/app/actions/topics.ts` lines 37-38

**Current code:**
```typescript
const label = stripControlChars(formData.get('label')?.toString() ?? '') ?? '';
const slug = stripControlChars(formData.get('slug')?.toString() ?? '') ?? '';
```

**Fix:** Save raw values before sanitization and add mismatch checks:
```typescript
const rawLabel = formData.get('label')?.toString() ?? '';
const rawSlug = formData.get('slug')?.toString() ?? '';
const label = stripControlChars(rawLabel) ?? '';
const slug = stripControlChars(rawSlug) ?? '';
if (label !== rawLabel) return { error: t('labelContainsControlChars') };
if (slug !== rawSlug) return { error: t('slugContainsControlChars') };
```

Note: Will need to add translation keys `labelContainsControlChars` and `slugContainsControlChars` to en.json/ko.json. Alternatively, reuse existing error keys like `invalidSlugFormat` and a generic label error.

### F3: C7R2-03 -- Add malformed-input rejection to `batchAddTags` [MEDIUM] [HIGH confidence]

**File:** `apps/web/src/app/actions/tags.ts` lines 228-230

**Current code:**
```typescript
const cleanName = stripControlChars(tagName?.trim() ?? '') ?? '';
if (!cleanName) return { error: t('tagNameRequired') };
```

**Fix:** Add raw value tracking and mismatch check:
```typescript
const rawTagName = tagName?.trim() ?? '';
const cleanName = stripControlChars(rawTagName) ?? '';
if (cleanName !== rawTagName) return { error: t('invalidTagName') };
if (!cleanName) return { error: t('tagNameRequired') };
```

### F4: C7R2-04 -- Add malformed-input rejection to `updateTag` [MEDIUM] [HIGH confidence]

**File:** `apps/web/src/app/actions/tags.ts` line 55

**Current code:**
```typescript
const trimmedName = stripControlChars(name?.trim() ?? '') ?? '';
if (!trimmedName) return { error: t('tagNameRequired') };
```

**Fix:** Add raw value tracking and mismatch check:
```typescript
const rawName = name?.trim() ?? '';
const trimmedName = stripControlChars(rawName) ?? '';
if (trimmedName !== rawName) return { error: t('invalidTagName') };
if (!trimmedName) return { error: t('tagNameRequired') };
```

### F5: C7R2-05 -- Add malformed-input rejection to `createAdminUser` [LOW] [MEDIUM confidence]

**File:** `apps/web/src/app/actions/admin-users.ts` lines 95-96

**Current code:**
```typescript
const rawUsername = formData.get('username')?.toString() ?? '';
const username = stripControlChars(rawUsername) ?? '';
```

**Fix:** Add mismatch check after sanitization:
```typescript
if (username !== rawUsername) return { error: t('invalidUsernameFormat') };
```

### F6 (DEFERRED): C7R2-06 -- Login username mismatch check [LOW] [MEDIUM confidence]

**Reason for deferral:** Login is not a destructive operation. Rejecting a username with control characters could prevent a legitimate user with a buggy client from logging in. The sanitized value is used for the DB lookup which is the correct behavior.

**Exit criterion:** If a client-side bug is discovered that sends control characters in usernames, this should be re-opened.

### F7 (DEFERRED): C7R2-07 -- `updateImageMetadata` title/description mismatch check [LOW] [LOW confidence]

**Reason for deferral:** Free-text fields where control characters could come from legitimate copy-paste. The stored value is sanitized so there is no security concern. Rejecting could cause poor UX for users who inadvertently paste content with control characters.

**Exit criterion:** If a pattern of control-character injection in image metadata is detected, this should be re-opened.

### F8 (DEFERRED): C7R2-08 -- Settings/SEO mismatch checks [LOW] [LOW confidence]

**Reason for deferral:** Same as F7 -- admin-only settings where control characters are unlikely but not impossible from copy-paste. The stored values are sanitized. Rejecting could cause poor UX.

**Exit criterion:** If a pattern of control-character injection in settings is detected, this should be re-opened.

## Progress Tracking

- [x] F1: Add malformed-input rejection to `createTopicAlias`
- [x] F2: Add malformed-input rejection to `createTopic`
- [x] F3: Add malformed-input rejection to `batchAddTags`
- [x] F4: Add malformed-input rejection to `updateTag`
- [x] F5: Add malformed-input rejection to `createAdminUser`
- [x] Add translation keys if needed (reused existing keys)
- [x] Run gates (eslint, next build, vitest)
- [x] Deploy
