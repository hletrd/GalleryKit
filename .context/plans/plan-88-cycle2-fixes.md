# Plan 88 — Cycle 2 Review Fixes

**Created:** 2026-04-19 (Cycle 2, New Loop)
**Status:** DONE
**Severity:** LOW (all findings)

---

## C2-01: Replace fragile `e.message?.includes('Duplicate entry')` in `updateTopic` [LOW, Medium Confidence]

**File:** `apps/web/src/app/actions/topics.ts:180`

### Implementation

**Step 1:** Replace the fragile message check with the consistent `e.cause?.code` pattern:

Current:
```typescript
if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.message?.includes('Duplicate entry'))) {
```

Change to:
```typescript
if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.cause?.code === 'ER_DUP_ENTRY')) {
```

**Step 2:** Verify tests pass.

**Step 3:** Commit: `fix(topics): 🐛 use reliable error code check instead of fragile message match in updateTopic`

### Acceptance Criteria
- [x] `updateTopic` catch block uses `e.cause?.code === 'ER_DUP_ENTRY'` instead of `e.message?.includes('Duplicate entry')`
- [x] Pattern matches `createTopic` and `createTopicAlias` in the same file
- [x] All existing tests pass

---

## C2-02: Fix misleading error in `deleteTopicAlias` catch block [LOW, Low Confidence]

**File:** `apps/web/src/app/actions/topics.ts:287-289`

### Implementation

**Step 1:** Change the catch block to return a more appropriate error:

Current:
```typescript
} catch (e) {
    console.error('Failed to delete topic alias:', e);
    return { error: t('invalidAlias') };
}
```

Change to:
```typescript
} catch (e) {
    console.error('Failed to delete topic alias:', e);
    return { error: t('failedToDeleteAlias') };
}
```

Note: Need to verify `failedToDeleteAlias` key exists in `messages/en.json` and `messages/ko.json`. If not, add it or use an existing generic error key like `t('failedToDeleteTopic')`.

**Step 2:** Verify tests pass.

**Step 3:** Commit: `fix(topics): 🐛 return server error instead of misleading invalidAlias on delete failure`

### Acceptance Criteria
- [x] `deleteTopicAlias` catch block returns a server-error message, not a validation error
- [x] i18n keys exist for the new error message
- [x] All existing tests pass

---

## C2-03: Add US-007 TOCTOU comment to `createTopicAlias` [LOW, Low Confidence]

**File:** `apps/web/src/app/actions/topics.ts:245-249`

### Implementation

**Step 1:** Add the US-007 comment before the try block in `createTopicAlias`:

Current (line 245):
```typescript
    // US-007: Insert directly and catch ER_DUP_ENTRY to avoid TOCTOU race
    try {
```

Wait — checking the code again, line 244 already has this comment. Let me verify.

**After verification:** The US-007 comment IS already present at line 244. This finding was incorrect. Marking as NO-OP.

### Status: NO-OP — already present in code

---

## Deferred Findings (No Change)

All previously deferred items from cycles 5-37 and cycle 1 remain deferred with no change:

- C1N-01 through C1N-23: See plan-87-deferred-cycle1-new.md
- C32-03 through font subsetting: See prior deferred docs
