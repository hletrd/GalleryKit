# Plan 135 — Cycle 41 Fixes: Tag Sanitization Before Validation

**Created:** 2026-04-19 (Cycle 41)
**Status:** DONE

---

## Problem

Three tag-related actions in `apps/web/src/app/actions/tags.ts` validate tag names before sanitizing control characters. This is the same bug pattern as C29-09/C30-01 (SEO/settings), which was already fixed by moving `stripControlChars` before validation. Control characters (tab `\x09`, newline `\x0A`, etc.) that are not rejected by `isValidTagName`'s regex could pass validation but get silently stripped before storage, causing a mismatch between validated and persisted data.

## Findings Addressed

| ID | Severity | Confidence | Description |
|----|----------|------------|-------------|
| C41-01 | MEDIUM | HIGH | `updateTag` validates on unsanitized `name`, then sanitizes |
| C41-02 | LOW | HIGH | `addTagToImage` does not apply `stripControlChars` before validation |
| C41-03 | LOW | HIGH | `batchUpdateImageTags` does not apply `stripControlChars` in add path |

## Implementation Steps

### Step 1: Fix `updateTag` — sanitize before validate (C41-01)

**File**: `apps/web/src/app/actions/tags.ts`, lines 51-59

Current flow:
1. `isValidTagName(name)` — validates raw input
2. `stripControlChars(name.trim())` — sanitizes after validation
3. `getTagSlug(trimmedName)` — uses sanitized value

Fixed flow:
1. `stripControlChars(name.trim())` — sanitize first
2. `isValidTagName(trimmedName)` — validate sanitized value
3. `getTagSlug(trimmedName)` — same

```diff
-    if (!name || name.trim().length === 0) return { error: t('tagNameRequired') };
-
-    // Validate name length
-    if (!isValidTagName(name)) {
-        return { error: t('invalidTagName') };
-    }
-
-    const trimmedName = stripControlChars(name.trim()) ?? '';
+    const trimmedName = stripControlChars(name?.trim() ?? '') ?? '';
+    if (!trimmedName) return { error: t('tagNameRequired') };
+
+    // Validate name (on sanitized value — matches settings.ts/seo.ts pattern)
+    if (!isValidTagName(trimmedName)) {
+        return { error: t('invalidTagName') };
+    }
```

### Step 2: Fix `addTagToImage` — apply stripControlChars before validation (C41-02)

**File**: `apps/web/src/app/actions/tags.ts`, lines 117-122

Current flow:
1. `cleanName = tagName?.trim()`
2. `isValidTagName(cleanName)` — validates without stripping controls
3. `getTagSlug(cleanName)` — slug from unstripped name

Fixed flow:
1. `cleanName = stripControlChars(tagName?.trim() ?? '') ?? ''`
2. `isValidTagName(cleanName)` — validates sanitized value
3. `getTagSlug(cleanName)` — slug from sanitized value

```diff
-    const cleanName = tagName?.trim();
-    if (!cleanName) return { error: t('tagNameRequired') };
-    if (!isValidTagName(cleanName)) return { error: t('invalidTagName') };
+    const cleanName = stripControlChars(tagName?.trim() ?? '') ?? '';
+    if (!cleanName) return { error: t('tagNameRequired') };
+    if (!isValidTagName(cleanName)) return { error: t('invalidTagName') };
```

### Step 3: Fix `batchUpdateImageTags` add path — apply stripControlChars (C41-03)

**File**: `apps/web/src/app/actions/tags.ts`, lines 307-315

Current flow:
1. `cleanName = name.trim()`
2. `isValidTagName(cleanName)` — validates without stripping controls

Fixed flow:
1. `cleanName = stripControlChars(name.trim()) ?? ''`
2. `isValidTagName(cleanName)` — validates sanitized value

```diff
-                const cleanName = name.trim();
+                const cleanName = stripControlChars(name.trim()) ?? '';
                 if (!cleanName) continue;
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
