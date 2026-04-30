# Plan 136 — Cycle 42 Fixes: Tag Sanitization in batchAddTags, removeTagFromImage, batchUpdateImageTags Remove Path, and uploadImages Tags

**Created:** 2026-04-19 (Cycle 42)
**Status:** DONE

---

## Problem

Four tag-related code paths do not apply `stripControlChars` before validation or lookup. This is the same bug pattern as C29-09/C30-01 (SEO/settings) and C41-01/C41-02/C41-03 (updateTag/addTagToImage/batchUpdateImageTags add path), which were all fixed by moving `stripControlChars` before validation. Without this, control characters (tab `\x09`, newline `\x0A`, carriage return `\x0D`, etc.) that are not rejected by `isValidTagName`'s regex can pass validation and get stored in the DB, causing display issues, MySQL truncation, and inconsistent tag matching across operations that do strip control chars.

## Findings Addressed

| ID | Severity | Confidence | Description |
|----|----------|------------|-------------|
| C42-01 | MEDIUM | HIGH | `batchAddTags` validates on unsanitized `tagName`, does not apply `stripControlChars` |
| C42-02 | LOW | HIGH | `removeTagFromImage` does not apply `stripControlChars` to tag name lookup |
| C42-03 | LOW | HIGH | `batchUpdateImageTags` remove path does not apply `stripControlChars` |
| C42-04 | MEDIUM | HIGH | `uploadImages` tag validation does not apply `stripControlChars` before `isValidTagName` |

## Implementation Steps

### Step 1: Fix `batchAddTags` — apply stripControlChars before validation (C42-01)

**File**: `apps/web/src/app/actions/tags.ts`, lines 218-220

Current flow:
1. `cleanName = tagName?.trim()` — no sanitization
2. `isValidTagName(cleanName)` — validates unsanitized value
3. `getTagSlug(cleanName)` — slug from unsanitized name

Fixed flow:
1. `cleanName = stripControlChars(tagName?.trim() ?? '') ?? ''` — sanitize first
2. `isValidTagName(cleanName)` — validate sanitized value
3. `getTagSlug(cleanName)` — slug from sanitized value

```diff
-    const cleanName = tagName?.trim();
+    const cleanName = stripControlChars(tagName?.trim() ?? '') ?? '';
     if (!cleanName) return { error: t('tagNameRequired') };
     if (!isValidTagName(cleanName)) return { error: t('invalidTagName') };
```

### Step 2: Fix `removeTagFromImage` — apply stripControlChars to lookup (C42-02)

**File**: `apps/web/src/app/actions/tags.ts`, lines 171-172

Current flow:
1. `cleanName = tagName?.trim()` — no sanitization
2. Lookup by `eq(tags.name, cleanName)` — matches unstripped name

Fixed flow:
1. `cleanName = stripControlChars(tagName?.trim() ?? '') ?? ''` — sanitize first
2. Lookup by `eq(tags.name, cleanName)` — matches sanitized name

```diff
-    const cleanName = tagName?.trim();
+    const cleanName = stripControlChars(tagName?.trim() ?? '') ?? '';
     if (!cleanName) return { error: t('tagNameRequired') };
```

### Step 3: Fix `batchUpdateImageTags` remove path — apply stripControlChars (C42-03)

**File**: `apps/web/src/app/actions/tags.ts`, line 342

Current flow:
1. `cleanName = name.trim()` — no sanitization
2. Lookup by `eq(tags.name, cleanName)` — matches unstripped name

Fixed flow:
1. `cleanName = stripControlChars(name.trim()) ?? ''` — sanitize first
2. Lookup by `eq(tags.name, cleanName)` — matches sanitized name

```diff
-                const cleanName = name.trim();
+                const cleanName = stripControlChars(name.trim()) ?? '';
```

### Step 4: Fix `uploadImages` tag validation — apply stripControlChars before isValidTagName (C42-04)

**File**: `apps/web/src/app/actions/images.ts`, line 65

Current flow:
1. `tagsString.split(',').map(t => t.trim()).filter(t => t.length > 0 && isValidTagName(t))` — no sanitization
2. Tag names used directly in DB inserts

Fixed flow:
1. Apply `stripControlChars(t.trim())` before `isValidTagName()`
2. Use stripped values for DB inserts

```diff
-    const tagNames = tagsString
-        ? tagsString.split(',').map(t => t.trim()).filter(t => t.length > 0 && isValidTagName(t))
-        : [];
+    const tagNames = tagsString
+        ? tagsString.split(',').map(t => stripControlChars(t.trim()) ?? '').filter(t => t.length > 0 && isValidTagName(t))
+        : [];
```

Also need to update the validation check on line 68 to use consistent stripping:

```diff
-    if (tagsString && tagNames.length !== tagsString.split(',').map(t => t.trim()).filter(Boolean).length) {
+    if (tagsString && tagNames.length !== tagsString.split(',').map(t => stripControlChars(t.trim()) ?? '').filter(Boolean).length) {
```

## Deferred Items

No new deferrals from this cycle. All findings are scheduled for implementation.

All previously deferred items remain unchanged (see `.context/plans/134-deferred-cycle30.md` and carry-forward documents).

## Verification

After making changes:
1. Run `npm run lint --workspace=apps/web` — must pass
2. Run `npx tsc --noEmit --project apps/web/tsconfig.json` — must pass
3. Run `npm run build --workspace=apps/web` — must pass
4. Run `npm test --workspace=apps/web` — must pass
