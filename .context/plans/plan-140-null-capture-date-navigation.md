# Plan 140: Fix NULL capture_date prev/next navigation

**Priority:** P1 (Correctness bug)
**Source:** debugger D1

## Problem
In `getImage()` in `data.ts`, when an image has NULL `capture_date`, the "next" (older) navigation query uses `sql\`FALSE\`` which prevents reaching any dated images. This means:
- Navigation from a NULL-dated image can reach NEWER dated images (via `capture_date IS NOT NULL`)
- Navigation from a NULL-dated image CANNOT reach OLDER dated images (FALSE blocks it)
- This is inconsistent with the gallery grid sort order (DESC by capture_date, NULLs last)

## Implementation Steps

### Step 1: Fix the "next" (older) query for NULL capture_date
**File:** `apps/web/src/lib/data.ts`, lines ~382-405

Change:
```typescript
image.capture_date
    ? lt(images.capture_date, image.capture_date)
    : sql`FALSE`,
```

To:
```typescript
image.capture_date
    ? lt(images.capture_date, image.capture_date)
    : sql`${images.capture_date} IS NOT NULL`,
```

This allows the "next" query to reach the oldest dated image when the current image has no capture_date.

## Deferred Items
None — single-line fix.

## Exit Criteria
- NULL-dated images can navigate to older dated images
- Existing navigation for dated images is unchanged
- All existing tests pass

## Implementation Status: DONE
- Step 1: Changed sql`FALSE` to sql`capture_date IS NOT NULL` ✅
Commit: 00000008e8 fix(privacy): 🔒 enforce proper public/admin field separation in data.ts (included in same commit as privacy fix)
