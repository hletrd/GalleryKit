# Plan 129 — Cycle 19 Fixes

**Created:** 2026-04-19 (Cycle 19)
**Status:** COMPLETE

---

## Findings Addressed

### C19-01: `revokePhotoShareLink` uses unconditional UPDATE, allowing race with concurrent share-key recreation
- **Severity:** MEDIUM / Confidence: MEDIUM
- **Files:** `apps/web/src/app/actions/sharing.ts` lines 250-258
- **Implementation:** Change the UPDATE to use a conditional WHERE clause that includes the original `share_key` value. If `affectedRows === 0`, the share key was changed by a concurrent request — return an appropriate error. This matches the pattern used in `createPhotoShareLink` which uses `WHERE ... AND share_key IS NULL` for race safety.
- **Progress:** [x] Complete — implemented with conditional WHERE on share_key

### C19-02: `updateGallerySettings` switches storage backend AFTER transaction commit, creating DB/live inconsistency on failure
- **Severity:** MEDIUM / Confidence: MEDIUM
- **Files:** `apps/web/src/app/actions/settings.ts` lines 57-86
- **Implementation:** If the storage backend switch fails after the transaction commits, roll back the DB setting by deleting or reverting the `storage_backend` row. Specifically: in the `catch` or error branch of `switchStorageBackend`, delete the `storage_backend` setting from `admin_settings` so the default ("local") takes effect. This ensures the DB and live state remain consistent.
- **Progress:** [x] Complete — implemented with DB rollback on switch failure

### C19-03: Mobile `info-bottom-sheet.tsx` omits 6 EXIF fields present in desktop `photo-viewer.tsx`
- **Severity:** LOW / Confidence: HIGH
- **Files:** `apps/web/src/components/info-bottom-sheet.tsx` — EXIF grid section
- **Implementation:** Add `white_balance`, `metering_mode`, `exposure_compensation`, `exposure_program`, `flash`, and `bit_depth` fields to the bottom sheet's expanded EXIF grid, matching the desktop photo-viewer sidebar layout. Use the same `hasExifData()` guard pattern already used for existing fields.
- **Progress:** [x] Complete — all 6 missing EXIF fields added

---

## Deferred Items

None — all findings from this cycle are scheduled for implementation.
