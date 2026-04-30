# Code Review Report — code-reviewer (Cycle 15)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-30
Scope: whole repository, focusing on code quality, logic, SOLID, and maintainability.
Verification: All prior cycle fixes confirmed intact (AGG8R-01 through AGG14-AGG-02).

## Inventory reviewed

All primary source files in `apps/web/src/` (237+ files): lib/ (38 files), components/ (30 files), app/ actions and routes (40+ files), db/ (3 files), __tests__/ (79+ files), config files. Focused on audit-log consistency, sanitization pipeline, action-guard coverage, cross-file interaction patterns, and edge cases missed in prior cycles.

## Verified fixes from prior cycles

All prior fixes confirmed intact:

1. C14-AGG-01 (audit.ts metadata truncation with ellipsis marker): FIXED — `audit.ts:38` appends `'…'` to the preview.
2. C14-AGG-02 (deleteAdminUser raw SQL rationale comment): FIXED — `admin-users.ts:195-202` documents the advisory-lock rationale.
3. AGG13-01 through AGG8R-01: All confirmed intact per prior cycle verifications.

## New Findings

### C15-CR-01 (Low / Low). `deleteTopic` has a redundant `deletedRows > 0` check — the early `deletedRows === 0` return makes the second check unreachable

- Location: `apps/web/src/app/actions/topics.ts:346-357`
- At line 346-348, if `deletedRows === 0`, the function returns early with `{ error: t('topicNotFound') }`. The subsequent `if (deletedRows > 0)` at line 354 is therefore always true when reached. The audit event is correctly gated (always fires when reached), but the condition is misleading — it suggests `deletedRows` could be `<= 0` at that point, which is impossible.
- Severity is Low because the code is functionally correct; the issue is readability/maintainability.
- Suggested fix: Remove the `if (deletedRows > 0)` guard and move the audit log code directly after the `deletedRows === 0` return, adding a comment that execution reaching this point means `deletedRows >= 1`.

### C15-CR-02 (WITHDRAWN). `loadMoreImages` uses `typeof safeOffset === 'number'` check — NOT redundant

- Location: `apps/web/src/app/actions/public.ts:80`
- **Withdrawn on review**: While the `!usesCursor` guard means `safeOffset` is always a number at runtime, TypeScript types `safeOffset` as `ImageListCursor | number` (from the `normalizedCursor ?? fallback` expression). The `typeof safeOffset === 'number'` check serves as a TypeScript type guard that narrows the union type to `number`, enabling the `> 10000` comparison. Removing it would cause a type error. Not a finding.

## Carry-forward (unchanged — existing deferred backlog)

All prior deferred items remain valid with no change in status. See aggregate for full list.
