# Plan 137 — Cycle 43 Fix: Audit Log Sanitization in removeTagFromImage

**Created:** 2026-04-19 (Cycle 43)
**Status:** DONE

---

## Problem

`removeTagFromImage` logs the raw unsanitized `tagName` parameter to the audit log, while all other tag operations use the sanitized name. This is the same bug class as C41/C42 (control characters in tag operations). While the DB lookup in `removeTagFromImage` already uses the sanitized `cleanName` (fixed in C42-02), the audit log at line 195 still passes the raw `tagName`, meaning control characters in user input are persisted to the `audit_log.metadata` column.

## Findings Addressed

| ID | Severity | Confidence | Description |
|----|----------|------------|-------------|
| C43-01 | LOW | HIGH | `removeTagFromImage` audit log uses raw `tagName` instead of sanitized `cleanName` |

## Implementation Steps

### Step 1: Fix audit log in `removeTagFromImage` — use `cleanName` instead of `tagName` (C43-01)

**File**: `apps/web/src/app/actions/tags.ts`, line 195

Current:
```typescript
logAuditEvent(currentUser?.id ?? null, 'tag_remove', 'image', String(imageId), undefined, { tag: tagName }).catch(console.debug);
```

Fixed:
```typescript
logAuditEvent(currentUser?.id ?? null, 'tag_remove', 'image', String(imageId), undefined, { tag: cleanName }).catch(console.debug);
```

This matches the pattern used by:
- `addTagToImage` (line 155): `{ tag: tagRecord.name }` — DB-confirmed name
- `batchAddTags` (line 265): `{ tag: cleanName }` — explicitly sanitized
- `updateTag` (line 73): `{ name: trimmedName, slug }` — explicitly sanitized

## Deferred Items

No new deferrals from this cycle. All findings are scheduled for implementation.

All previously deferred items remain unchanged (see `.context/reviews/_aggregate-cycle42.md` and carry-forward documents).

## Verification

After making changes:
1. Run `npm run lint --workspace=apps/web` — must pass
2. Run `npx tsc --noEmit --project apps/web/tsconfig.json` — must pass
3. Run `npm run build --workspace=apps/web` — must pass
4. Run `npm test --workspace=apps/web` — must pass
