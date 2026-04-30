# Plan 86 — Validation Null Byte Exclusion

**Created:** 2026-04-19 (Cycle 1, New Loop)
**Status:** DONE
**Severity:** LOW
**Confidence:** Medium

---

## Problem

Two validation functions in `apps/web/src/lib/validation.ts` do not exclude null bytes (`\x00`):
1. `isValidTopicAlias` (line 25) — regex `^[^/\\\s?#<>"'&]+$` allows null bytes
2. `isValidTagName` (line 30) — regex `/[<>"'&]/` does not check for null bytes

Null bytes in URL paths or tag names could cause truncation in C-style string handling contexts. While MySQL and modern web frameworks handle null bytes correctly, excluding them is a defense-in-depth measure.

## Implementation Steps

### Step 1: Update `isValidTopicAlias` regex
**File:** `apps/web/src/lib/validation.ts:25`

Change:
```
^[^/\\\s?#<>"'&]+$
```
To:
```
^[^/\\\s?\x00#<>"'&]+$
```

### Step 2: Update `isValidTagName` regex
**File:** `apps/web/src/lib/validation.ts:30`

Change:
```typescript
!/[<>"'&]/.test(trimmed)
```
To:
```typescript
!/[<>"'&\x00]/.test(trimmed)
```

### Step 3: Update validation tests
**File:** `apps/web/src/__tests__/validation.test.ts`

Add test cases for null byte rejection in both `isValidTopicAlias` and `isValidTagName`.

### Step 4: Verify
Run `npm test --workspace=apps/web` to ensure all tests pass.

### Step 5: Commit and push
- GPG-signed commit: `fix(validation): 🛡️ reject null bytes in topic aliases and tag names`

## Acceptance Criteria
- [ ] `isValidTopicAlias` rejects strings containing `\x00`
- [ ] `isValidTagName` rejects strings containing `\x00`
- [ ] New test cases added for null byte rejection
- [ ] All existing tests pass
