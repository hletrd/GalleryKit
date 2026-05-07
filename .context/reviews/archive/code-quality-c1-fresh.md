# Code Quality Review -- Cycle 1 (Fresh)

**Reviewer**: code-reviewer (c1-fresh)
**Date**: 2026-05-04
**Scope**: Full repository code quality, logic, maintainability

---

## HIGH FINDINGS

### CR-HIGH-01: Admin Image Manager Missing Touch-Target Compliance
**File**: `apps/web/src/components/image-manager.tsx` lines 488, 493
**Confidence**: High | **Severity**: High

The edit and delete action buttons in the admin image table use `size="icon"` which defaults to 36x36px. The project's touch-target audit (`touch-target-audit.test.ts`) enforces a 44px minimum.

**Fix**: Add `className="h-11 w-11"` to both button instances.

---

### CR-HIGH-02: Back-to-Top Button Missing Explicit Touch Target
**File**: `apps/web/src/components/home-client.tsx` lines 314-321
**Confidence**: High | **Severity**: Medium-High

The back-to-top button uses `p-3` (12px padding) with an `h-5 w-5` icon. The actual rendered size is ~44px but relies on padding math rather than explicit `min-h-11 min-w-11`.

**Fix**: Add explicit `min-h-11 min-w-11` to guarantee the touch target.

---

### CR-HIGH-03: Semantic Search Results Render Empty Cards
**File**: `apps/web/src/components/search.tsx` lines 91-101
**Confidence**: High | **Severity**: Medium

When semantic search returns results, only `imageId` and `score` are mapped to SearchResult objects with empty `filename_jpeg`, null title/description. Cards show no thumbnails and "Photo {id}" text.

**Fix**: Batch-fetch image metadata after semantic results, or include required fields in the semantic API response.

---

## MEDIUM FINDINGS

### CR-MED-01: Dead Ternary in Upload Dropzone
**File**: `apps/web/src/components/upload-dropzone.tsx` line 123
Both branches return the same value. The re-render is forced by `setPreviewVersion` on line 108, making this expression meaningless.

---

### CR-MED-02: No Error Boundary for Photo Viewer
**File**: `apps/web/src/components/photo-viewer.tsx`
Complex client component with no error boundary. A JS error crashes the entire page.

---

### CR-MED-03: Admin Toolbar `size="sm"` Buttons Below Touch-Target Floor
**File**: `apps/web/src/components/image-manager.tsx` lines 300, 314, 348, 359
Multiple `size="sm"` buttons (32px default) lack `h-11` overrides.

---

### CR-MED-04: Commented-Out Code Block in Upload Dropzone
**File**: `apps/web/src/components/upload-dropzone.tsx` lines 431-447
Large commented block explaining global tag display. Should be removed or converted to a proper comment.

---

### CR-MED-05: EXIF `exposure_time` Not Normalized at Storage
**File**: `apps/web/src/lib/process-image.ts` line 833
Different cameras return ExposureTime as different types (rational string vs decimal). No normalization at storage time means inconsistent display across camera brands.