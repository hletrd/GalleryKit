# Plan 46 — UI Checkbox Component, Password maxLength, CSV GC Release, and Topic Manager Deletion State

**Created:** 2026-04-19 (Cycle 7)
**Status:** Done

## Findings Addressed

- C7-06 (LOW): Replace raw `<input type="checkbox">` with styled checkboxes in image-manager.tsx
- C7-09 (LOW): Split shared `isDeleting` state for topic vs alias deletion
- C7-10 (LOW): Add `maxLength={1024}` to password input fields
- C7-04 (LOW): Allow GC of `results` array in `exportImagesCsv`

## Implementation

### Part A: Checkbox Styling in image-manager.tsx

#### File: `apps/web/src/components/image-manager.tsx`

The shadcn/ui `<Checkbox>` component does not exist in this project. Rather than adding a new dependency, improve the existing raw `<input>` styling with proper design system classes and `role` attributes.

At line 270-277 (select-all) and lines 291-297 (per-row), the checkboxes already have good styling classes. No component change is needed — the current approach is functional and well-styled. Downgrading this from a fix to a "no change needed" since adding a Checkbox component would add complexity without meaningful benefit.

### Part B: Split isDeleting State in topic-manager.tsx

#### File: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`

Replace single `isDeleting` with two separate states:

Current (line 55):
```ts
const [isDeleting, setIsDeleting] = useState(false);
```

Change to:
```ts
const [isDeletingTopic, setIsDeletingTopic] = useState(false);
const [isDeletingAlias, setIsDeletingAlias] = useState(false);
```

Update `handleDelete` (line 81):
```ts
setIsDeletingTopic(true);
// ... delete logic ...
setIsDeletingTopic(false);
```

Update `handleDeleteAlias` (line 106):
```ts
setIsDeletingAlias(true);
// ... delete logic ...
setIsDeletingAlias(false);
```

Update the delete topic AlertDialog's disabled prop (line 201):
```ts
disabled={isDeletingTopic}
```

Update the delete alias AlertDialog's disabled prop (line 278):
```ts
disabled={isDeletingAlias}
```

Update the Loader2 spinners to use the correct state variable.

### Part C: Password maxLength

#### File: `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`

Add `maxLength={1024}` to all three password Input fields:
- Line 44-50 (currentPassword)
- Line 55-62 (newPassword) 
- Line 67-76 (confirmPassword)

### Part D: CSV GC Release

#### File: `apps/web/src/app/[locale]/admin/db-actions.ts`

In `exportImagesCsv`, change `const results` to `let results` (line 36) and add `results = [] as typeof results;` after the CSV loop completes (before line 76), to allow GC to reclaim the DB results before materializing the full CSV string. Update the misleading comment.

## Verification

- Build passes (`npm run build`)
- Topic delete and alias delete buttons work independently
- Password form rejects input > 1024 characters
- CSV export still works correctly
