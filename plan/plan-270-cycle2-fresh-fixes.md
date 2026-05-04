# Plan: Cycle 2 Fresh Fixes

**Created**: 2026-05-04
**Status**: COMPLETE
**Source**: `_aggregate-c2-fresh.md` review findings

---

## FIXES (Scheduled for Implementation)

### FIX-01: TypeScript build error -- comma operator in upload-dropzone.tsx [C2-TS01]
**File**: `apps/web/src/components/upload-dropzone.tsx:124`
**Severity**: High (blocking build) | **Confidence**: High

Replace the comma operator expression with an explicit `void` statement:

```typescript
// Before:
const previewUrls = (previewVersion, previewUrlsRef.current);

// After:
void previewVersion; // force re-render when preview URLs change
const previewUrls = previewUrlsRef.current;
```

### FIX-02: Admin dashboard shows upload date instead of capture date [C2-ADMIN01]
**File**: `apps/web/src/components/image-manager.tsx:486`
**Severity**: Low | **Confidence**: High

Change the date column to display `capture_date` instead of `created_at`:

```typescript
// Before:
{image.created_at ? new Date(image.created_at).toLocaleDateString(locale, ...) : '-'}

// After:
{image.capture_date ? new Date(image.capture_date + 'T00:00:00').toLocaleDateString(locale, ...) : (image.created_at ? new Date(image.created_at).toLocaleDateString(locale, ...) : '-')}
```

The `adminListSelectFields` already includes `capture_date`. Need to add `capture_date` to the `ImageType` interface in image-manager.tsx.

---

## DEFERRED FINDINGS

No new deferred items from cycle 2. The 19 deferred items from cycle 1 remain as-is in `plan-269-cycle1-fresh-deferred.md`.

---

## Progress

- [x] FIX-01: TypeScript build error in upload-dropzone.tsx (commit 89081ee)
- [x] FIX-02: Admin dashboard capture date display (commit 26a26b5)