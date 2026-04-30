# Plan 138 — Cycle 34 Fixes: Sanitization Consistency in deleteTopicAlias and createAdminUser

**Created:** 2026-04-19 (Cycle 34)
**Status:** DONE

---

## Problem

Two remaining user-facing text inputs do not apply `stripControlChars` before validation, breaking the defense-in-depth pattern established across the codebase (tags, topic labels, SEO settings, gallery settings, search queries, image metadata, topic aliases).

## Findings Addressed

| ID | Severity | Confidence | Description |
|----|----------|------------|-------------|
| C34R2-01 | MEDIUM | HIGH | `deleteTopicAlias` does not apply `stripControlChars` to alias parameter before validation |
| C34R2-02 | LOW | MEDIUM | `createAdminUser` username not sanitized with `stripControlChars` before validation |

## Implementation Steps

### Step 1: Fix `deleteTopicAlias` — apply `stripControlChars` to alias (C34R2-01)

**File**: `apps/web/src/app/actions/topics.ts`, lines 286-289

Current:
```typescript
// Permissive check to allow deleting legacy aliases
if (!alias || !isValidTopicAlias(alias)) {
    return { error: t('invalidAlias') };
}
```

Fixed:
```typescript
// Sanitize before validation — matches createTopicAlias pattern (C34R2-01)
const cleanAlias = stripControlChars(alias) ?? '';
// Permissive check to allow deleting legacy aliases
if (!cleanAlias || !isValidTopicAlias(cleanAlias)) {
    return { error: t('invalidAlias') };
}
```

Also update the DB query (line 294) and audit log (line 302) to use `cleanAlias` instead of `alias`:

Current DB query:
```typescript
eq(topicAliases.alias, alias),
```
Fixed:
```typescript
eq(topicAliases.alias, cleanAlias),
```

Current audit log:
```typescript
{ alias }).catch(console.debug);
```
Fixed:
```typescript
{ alias: cleanAlias }).catch(console.debug);
```

Also update the revalidation path (line 309) to use `cleanAlias`:
```typescript
`/${cleanAlias}`,
```

### Step 2: Fix `createAdminUser` — apply `stripControlChars` to username (C34R2-02)

**File**: `apps/web/src/app/actions/admin-users.ts`, line 94

Current:
```typescript
const username = formData.get('username')?.toString() ?? '';
```

Fixed:
```typescript
const rawUsername = formData.get('username')?.toString() ?? '';
const username = stripControlChars(rawUsername) ?? '';
```

Add import at top:
```typescript
import { stripControlChars } from '@/lib/sanitize';
```

## Deferred Items

No new deferrals from this cycle. All findings are scheduled for implementation.

All previously deferred items remain unchanged (see `.context/reviews/_aggregate-cycle42.md` and carry-forward documents).

## Verification

After making changes:
1. Run `npm run lint --workspace=apps/web` — must pass
2. Run `npx tsc --noEmit --project apps/web/tsconfig.json` — must pass
3. Run `npm run build --workspace=apps/web` — must pass
4. Run `npm test --workspace=apps/web` — must pass
