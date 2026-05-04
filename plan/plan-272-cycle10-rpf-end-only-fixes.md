# Plan: Cycle 10 RPF End-Only Fixes

**Source**: `.context/reviews/_aggregate-c10.md`
**Date**: 2026-05-04

## Issues to implement

### 1. C10-MED-01: Remove dead query in `getReactionsEnabled` (HIGH priority)
- **File**: `apps/web/src/app/api/reactions/[imageId]/route.ts:64-84`
- **Fix**: Remove the dead `SELECT images.id FROM images LIMIT 0` query and `void row`. Keep only the `admin_settings` query.
- **Confidence**: High

### 2. C10-LOW-05: Handle maintenance/rateLimited status in load-more component (MEDIUM priority)
- **File**: `apps/web/src/components/load-more.tsx`
- **Fix**: Check the `status` field returned by `loadMoreImages` and show a toast for 'maintenance' and 'rateLimited' states so the user gets feedback instead of silent failures.
- **Confidence**: Medium

## Deferred items

### C10-MED-02: photo-navigation button size inconsistency
- **File**: `apps/web/src/components/photo-navigation.tsx:211-219`
- **Reason**: Low severity maintainability nit. Current behavior is correct.
- **Exit criterion**: Next shadcn/ui major version update or touch-target audit.

### C10-MED-03: Batch delete share link behavior
- **File**: `apps/web/src/app/actions/images.ts:563-719`
- **Reason**: Current behavior is functionally correct — FK cascade handles cleanup and revalidation covers cache invalidation. The single-delete path and batch-delete path differ in implementation but not in outcome.
- **Exit criterion**: If a user-facing bug is reported about stale share links after batch delete.

### C10-MED-04: Lightbox Ken Burns animation clarity
- **File**: `apps/web/src/components/lightbox.tsx:401-451`
- **Reason**: Code works correctly. The `animation: none` on `<picture>` prevents inherited animation while `<img>` gets the Ken Burns animation. Code clarity nit only.
- **Exit criterion**: Next refactor of lightbox animation system.

### C10-LOW-04: Fractional seconds in EXIF datetime
- **File**: `apps/web/src/lib/exif-datetime.ts:1`
- **Reason**: Not a functional bug — `parseExifDateTime` in process-image.ts strips fractional seconds at extraction time, so the display regex is consistent with stored data.
- **Exit criterion**: If sub-second precision becomes a product requirement.

### C10-LOW-06: containIntrinsicSize browser support
- **File**: `apps/web/src/components/home-client.tsx:199-202`
- **Reason**: Progressive enhancement. Silently ignored in unsupported browsers.
- **Exit criterion**: Browser support data shows >95% coverage or removal for simplification.