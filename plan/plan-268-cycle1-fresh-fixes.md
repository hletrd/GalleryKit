# Plan: Cycle 1 Fresh Fixes

**Created**: 2026-05-04
**Status**: COMPLETE (except FIX-08 non-issue)
**Source**: `_aggregate-c1-fresh.md` review findings

---

## FIXES (Scheduled for Implementation)

### FIX-01: Admin action buttons touch-target compliance [CR-HIGH-01]
**File**: `apps/web/src/components/image-manager.tsx`
**Severity**: High | **Confidence**: High

Add `className="h-11 w-11"` to the edit (Pencil) and delete (Trash2) icon buttons in the admin image table.

### FIX-02: Back-to-top button explicit touch target [CR-HIGH-02]
**File**: `apps/web/src/components/home-client.tsx`
**Severity**: Med-High | **Confidence**: High

Add explicit `min-h-11 min-w-11` to the back-to-top button to guarantee WCAG 2.5.5 compliance.

### FIX-03: Semantic search results render empty cards [CR-HIGH-03]
**File**: `apps/web/src/components/search.tsx`
**Severity**: Medium | **Confidence**: High

After getting semantic results, batch-fetch image metadata (title, filename_jpeg, topic, topic_label, camera_model) by IDs so results display correctly.

### FIX-04: Dead ternary in upload dropzone [CR-MED-01]
**File**: `apps/web/src/components/upload-dropzone.tsx`
**Severity**: Low | **Confidence**: High

Simplify `previewVersion >= 0 ? previewUrlsRef.current : previewUrlsRef.current` to `previewUrlsRef.current`.

### FIX-05: Admin toolbar `size="sm"` buttons below touch-target floor [CR-MED-03]
**File**: `apps/web/src/components/image-manager.tsx`
**Severity**: Medium | **Confidence**: High

Add `h-11` to the Bulk Edit, Batch Add Tag, Share, and Delete Selected buttons.

### FIX-06: Remove commented-out code block [CR-MED-04]
**File**: `apps/web/src/components/upload-dropzone.tsx`
**Severity**: Low | **Confidence**: High

Remove the large commented-out code block (lines 431-447) about global tag display.

### FIX-07: EXIF exposure_time normalization [CR-MED-05]
**File**: `apps/web/src/lib/process-image.ts`
**Severity**: Low | **Confidence**: High

Normalize ExposureTime to a consistent format (e.g., always store as "1/125" rational form) in `extractExifForDb`.

### FIX-08: JPEG download button uses correct largest derivative [PWF-MED-07]
**File**: `apps/web/src/components/photo-viewer.tsx`
**Severity**: Low-Med | **Confidence**: High

Update download button to use `sizedImageUrl` to find the largest available JPEG derivative instead of the base filename.

---

## DEFERRED FINDINGS

### DEFER-01: No original-format download for admin [PWF-CRIT-01]
**File**: `apps/web/src/components/photo-viewer.tsx:222-224, 844-855`
**Severity**: Med-High | **Confidence**: High
**Reason**: Requires new API route with admin auth serving from `data/uploads/original/`. New feature with security surface area -- needs design review for the access control model.
**Exit criterion**: Implement when admin download API route is added with proper auth and rate limiting.

### DEFER-02: Sequential file upload bottleneck [PWF-CRIT-02]
**File**: `apps/web/src/components/upload-dropzone.tsx:243-246`
**Severity**: Med-High | **Confidence**: High
**Reason**: Requires architectural change to batch upload or parallel upload with server-side queue. The current sequential behavior is intentional due to the MySQL advisory lock (`gallerykit_upload_processing_contract`). Changing this requires careful analysis of concurrent upload safety.
**Exit criterion**: Implement when upload architecture is redesigned for batch/parallel support.

### DEFER-03: No EXIF-based search/filter [PWF-HIGH-01]
**File**: `apps/web/src/lib/data.ts:1130-1260`
**Severity**: High | **Confidence**: High
**Reason**: Requires new search UI with EXIF field selectors, new query infrastructure for range queries, and potentially new database indexes. This is a significant feature addition.
**Exit criterion**: Implement when EXIF search/filter feature is designed and planned.

### DEFER-04: Upload processing progress visibility [PWF-HIGH-02]
**File**: `apps/web/src/components/image-manager.tsx:431-436`
**Severity**: Med-High | **Confidence**: High
**Reason**: Requires server-sent events (SSE) or WebSocket to push processing progress to the client. The current architecture is fire-and-forget from the server action. Significant new infrastructure.
**Exit criterion**: Implement when real-time processing status feature is designed.

### DEFER-05: EXIF display missing copyright/artist fields [PWF-HIGH-03]
**File**: `apps/web/src/lib/process-image.ts:792-901, apps/web/src/db/schema.ts:35-53`
**Severity**: Medium | **Confidence**: High
**Reason**: Requires database schema migration (new columns), EXIF extraction additions, UI additions, and translation strings. Multi-file change with migration risk.
**Exit criterion**: Implement when EXIF schema expansion is planned.

### DEFER-06: No manual photo ordering within topics [PWF-HIGH-04]
**File**: `apps/web/src/db/schema.ts, apps/web/src/lib/data.ts`
**Severity**: Medium | **Confidence**: High
**Reason**: Requires schema migration (new `position` column or sort_order), admin UI for drag-to-reorder, and changes to all listing queries. Significant feature work.
**Exit criterion**: Implement when manual ordering feature is designed.

### DEFER-07: No bulk download/export [PWF-HIGH-05]
**Severity**: Medium | **Confidence**: High
**Reason**: Requires new API route for ZIP generation, memory/bandwidth considerations, and potentially background job processing for large collections.
**Exit criterion**: Implement when bulk download feature is designed.

### DEFER-08: Shared groups have no expiration/password [PWF-MED-01]
**File**: `apps/web/src/app/actions/sharing.ts, apps/web/src/db/schema.ts`
**Severity**: Low-Med | **Confidence**: High
**Reason**: Schema already supports `expires_at` but UI and action changes needed. Password protection requires new auth flow.
**Exit criterion**: Implement when sharing enhancement feature is planned.

### DEFER-09: No EXIF date/timezone override [PWF-MED-02]
**File**: `apps/web/src/lib/process-image.ts:177-226`
**Severity**: Low-Med | **Confidence**: High
**Reason**: Requires new UI for timezone selection and batch date correction. Non-trivial UX design.
**Exit criterion**: Implement when timezone/date correction feature is designed.

### DEFER-10: No per-image processing priority [PWF-MED-03]
**File**: `apps/web/src/lib/image-queue.ts`
**Severity**: Low-Med | **Confidence**: Medium
**Reason**: Requires priority queue changes and admin UI for priority designation.
**Exit criterion**: Implement when priority processing feature is designed.

### DEFER-11: Tag input UX friction for large vocabularies [PWF-MED-04]
**File**: `apps/web/src/components/tag-input.tsx`
**Severity**: Low-Med | **Confidence**: Medium
**Reason**: Requires UX redesign with tag categories, recent/frequent tags, or hierarchical tag support.
**Exit criterion**: Implement when tag management UX redesign is planned.

### DEFER-12: No photo comparison mode [PWF-MED-05]
**File**: `apps/web/src/components/lightbox.tsx`
**Severity**: Low | **Confidence**: Medium
**Reason**: New feature requiring significant lightbox redesign.
**Exit criterion**: Implement when comparison/split-view feature is designed.

### DEFER-13: No list/timeline view toggle [PWF-MED-06]
**File**: `apps/web/src/components/home-client.tsx`
**Severity**: Low-Med | **Confidence**: Medium
**Reason**: Requires new view components and toggle UI.
**Exit criterion**: Implement when view mode toggle feature is designed.

### DEFER-14: No error boundary for photo viewer [CR-MED-02]
**File**: `apps/web/src/components/photo-viewer.tsx`
**Severity**: Medium | **Confidence**: Medium
**Reason**: Requires designing a graceful fallback UI for the error boundary. Non-trivial UX decision.
**Exit criterion**: Implement when error boundary pattern is established for the app.

### DEFER-15: No watermark option [PWF-MED-08]
**Severity**: Low | **Confidence**: Medium
**Reason**: New feature requiring processing pipeline changes and admin configuration UI.
**Exit criterion**: Implement when watermark feature is designed.

### DEFER-16: No drag-to-reorder in admin [PWF-LOW-01]
**Severity**: Low | **Confidence**: Medium
**Depends on**: DEFER-06 (manual ordering)
**Exit criterion**: Implement alongside DEFER-06.

### DEFER-17: Map view separate from gallery [PWF-LOW-02]
**Severity**: Low | **Confidence**: Medium
**Exit criterion**: When map integration into gallery is designed.

### DEFER-18: "On This Day" not in main gallery [PWF-LOW-03]
**Severity**: Low | **Confidence**: Medium
**Exit criterion**: When date-based discovery is designed for the main gallery.

### DEFER-19: No image rating/label system [PWF-LOW-04]
**Severity**: Low | **Confidence**: Medium
**Exit criterion**: When rating/label system feature is designed.

---

## Progress

- [x] FIX-01: Admin buttons touch target (commit b09bafe)
- [x] FIX-02: Back-to-top touch target (commit 4927cb9)
- [x] FIX-03: Semantic search empty cards (commit e0c7f30)
- [x] FIX-04: Dead ternary cleanup (commit 919528b)
- [x] FIX-05: Admin toolbar buttons touch target (commit b09bafe)
- [x] FIX-06: Commented-out code removal (commit e520907)
- [x] FIX-07: EXIF exposure_time normalization (commit d6d60bd)
- [x] FIX-08: JPEG download uses correct derivative -- NON-ISSUE: filename_jpeg already points to the largest configured derivative per processImageFormats base-filename logic