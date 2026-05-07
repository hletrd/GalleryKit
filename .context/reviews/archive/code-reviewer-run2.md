# Code Review -- Cycle 1 (Run 2)

**Date**: 2026-05-05
**Focus**: Code quality, logic, maintainability, correctness

---

## Findings

### CR-R2-01: `bulkUpdateImages` applies `titlePrefix` as exact title, not prefix (Low-Med, High confidence)

**File**: `apps/web/src/app/actions/images.ts:874`

```typescript
if (titlePrefix.mode === 'set') setClause['title'] = sanitizedTitlePrefix;
```

The input field is named `titlePrefix` but the code sets the title to the exact value. The name suggests it should prepend to the existing title, but it overwrites. This is confusing but may be intentional (the UI label in the bulk edit dialog would clarify). If intentional, the naming is misleading.

**Suggestion**: Rename to `title` or `titleValue` in the `BulkUpdateImagesInput` type if the intent is to set (not prepend).

---

### CR-R2-02: `revalidateAllAppData()` called unnecessarily in `deleteTag` and `updateTag` (Low, High confidence)

**File**: `apps/web/src/app/actions/tags.ts:93,131`

Both `updateTag` and `deleteTag` call both `revalidateLocalizedPaths` AND `revalidateAllAppData`. The latter is very broad (revalidates every page). Since tags only affect the topic pages, the tag admin page, and the dashboard, the `revalidateAllAppData` call is heavier than necessary.

**Suggestion**: Use only `revalidateLocalizedPaths` with the affected paths. This is a performance concern, not a correctness issue.

---

### CR-R2-03: `getSafeUserFilename` only checks byte length, not character count (Low, Medium confidence)

**File**: `apps/web/src/app/actions/images.ts:45-55`

The function checks `Buffer.byteLength(sanitized, 'utf8') > USER_FILENAME_MAX_BYTES` which is correct for MySQL varchar(255) byte limit. But the `path.basename` call may produce multi-byte characters. The function is correct -- this is just a note that it's properly implemented.

**Verdict**: Not a bug. This is correct behavior.

---

### CR-R2-04: `getImageByShareKey` uses null-byte delimiter which could conflict with MySQL GROUP_CONCAT (Low, Medium confidence)

**File**: `apps/web/src/lib/data.ts:934`

```typescript
tag_concat: sql`GROUP_CONCAT(DISTINCT CONCAT(${tags.slug}, CHAR(0), ${tags.name}) ORDER BY ${tags.slug} SEPARATOR CHAR(1))`
```

Using CHAR(0) as an inner delimiter and CHAR(1) as the separator is a robust approach. However, if any tag name or slug ever contains a null byte (which shouldn't happen given validation), the parsing would break. This is defensive-enough given the existing validation layer.

**Verdict**: Acceptable risk. Not actionable.

---

### CR-R2-05: `batchUpdateImageTags` within `bulkUpdateImages` runs per-row updates inside a transaction (Medium, Medium confidence)

**File**: `apps/web/src/app/actions/images.ts:906-917`

```typescript
for (const { id, caption } of toUpdate) {
    if (applyAltSuggested === 'title') {
        await tx.update(images).set({ title: caption }).where(eq(images.id, id));
    } else {
        await tx.update(images).set({ description: caption }).where(eq(images.id, id));
    }
}
```

This runs individual UPDATE statements inside a transaction for each image that needs alt text applied. For 100 images, this could be 100 sequential UPDATE statements. The pattern is correct (each row has a different caption value) but could be optimized with a CASE WHEN expression.

**Suggestion**: For large batches, consider building a single `CASE WHEN id THEN caption END` UPDATE statement. Low priority -- bulk edit of 100 images with alt text suggestion is a rare operation.

---

### CR-R2-06: Commented-out eslint-disable comment in `upload-dropzone.tsx` (Low, High confidence)

**File**: `apps/web/src/components/upload-dropzone.tsx:423`

```typescript
{/* eslint-disable-next-line @next/next/no-img-element */}
```

This is used intentionally for the preview image (not using Next.js Image for blob URLs). This is a valid suppression. Not a finding.

---

### CR-R2-07: `exif-datetime.ts` parses stored datetime string using Date.UTC then formats with timeZone: 'UTC' (OK, High confidence)

**File**: `apps/web/src/lib/exif-datetime.ts:33-78`

The parsing creates a Date via `Date.UTC()` and formatting uses `timeZone: 'UTC'`. This correctly round-trips the EXIF datetime without timezone shifting. This is properly implemented after the PP-BUG-1 fix.

**Verdict**: Correct implementation. No finding.