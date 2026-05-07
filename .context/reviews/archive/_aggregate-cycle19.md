# Aggregate Review — Cycle 19 (2026-04-19)

**Source reviews:** Deep single-reviewer cycle covering all server actions, middleware, data layer, image processing pipeline, auth/session, rate limiting, upload security, DB schema, admin pages, public pages, API routes, validation, audit logging, i18n, frontend components, SQL restore scanning, and storage modules.

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

Single-reviewer cycle — no deduplication needed. All findings are from the comprehensive review.

---

## NEW FINDINGS

### C19-01: `revokePhotoShareLink` uses unconditional UPDATE, allowing race with concurrent share-key recreation [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/sharing.ts` lines 250-258
- **Description**: The function reads the current `share_key` via SELECT (line 250), then unconditionally sets `share_key = null` via UPDATE (line 256) using only `WHERE eq(images.id, imageId)`. Between the SELECT and UPDATE, another admin could call `createPhotoShareLink` which generates a new share key for the same image. The unconditional UPDATE would then revoke the newly-created key instead of the originally-read key. Compare with `createPhotoShareLink` (lines 104-106) which uses `WHERE ... AND share_key IS NULL` for race safety.
- **Concrete failure scenario**: Admin A revokes share link for image 42. Admin B simultaneously creates a new share link for image 42. Admin A's UPDATE sets the new share_key to null, destroying Admin B's newly-created link without Admin B's knowledge.
- **Fix**: Change the UPDATE to use a conditional WHERE clause: `WHERE eq(images.id, imageId)` AND `eq(images.share_key, oldShareKey)`. If `affectedRows === 0`, return an appropriate error (e.g., "share link was already changed").

### C19-02: `updateGallerySettings` switches storage backend AFTER transaction commit, creating DB/live inconsistency on failure [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/settings.ts` lines 57-86
- **Description**: The function commits the `storage_backend` setting to the DB in a transaction (lines 59-71), then attempts to switch the live backend (lines 77-86). If the switch fails (e.g., invalid S3/MinIO credentials), the function returns an error (line 85), but the DB already stores the new backend value. On subsequent requests, `getGalleryConfig()` returns the new backend from DB, but the live storage module is still on the old backend. This creates a silent inconsistency: uploads continue to the old storage, but the admin UI shows the new backend. A server restart would pick up the DB value and attempt to use the new (broken) backend.
- **Concrete failure scenario**: Admin switches storage from "local" to "s3" with incorrect credentials. The setting is saved to DB. The live switch fails with an error. The admin sees the error, but the settings page now shows "s3" as the current backend. New uploads still go to local storage. After a server restart, all storage operations fail because the S3 credentials are invalid.
- **Fix**: Validate the storage backend switch BEFORE committing the transaction (e.g., test the connection), or roll back the setting change if the switch fails by deleting or reverting the DB row.

### C19-03: Mobile `info-bottom-sheet.tsx` omits 6 EXIF fields present in desktop `photo-viewer.tsx` [LOW] [HIGH confidence]
- **File**: `apps/web/src/components/info-bottom-sheet.tsx` — EXIF grid section (lines 224-309)
- **Description**: The desktop photo-viewer sidebar displays `white_balance`, `metering_mode`, `exposure_compensation`, `exposure_program`, `flash`, and `bit_depth` (photo-viewer.tsx lines 440-475), but the mobile bottom sheet's EXIF grid only shows `camera_model`, `lens_model`, `focal_length`, `f_number`, `exposure_time`, `iso`, `color_space`, `dimensions`, `format`, and `capture_date`. Mobile users see a subset of the EXIF data that desktop users see.
- **Fix**: Add the 6 missing EXIF fields to the bottom sheet's expanded EXIF grid, matching the desktop layout. Consider using a collapsible section if space is a concern.

---

## PREVIOUSLY FIXED — Confirmed Resolved

All cycle 1-18 findings remain resolved. Additionally, the following cycle 39 findings are confirmed resolved in the current codebase:

- C39-01 (`batchUpdateImageTags` slug-only lookup): **RESOLVED** — The remove path now uses name-first, slug-fallback lookup (tags.ts lines 331-337).
- C39-02 (Mobile bottom sheet GPS dead code annotation): **RESOLVED** — The GPS block in `info-bottom-sheet.tsx` now has the unreachable-GPS comment (lines 291-294).
- C39-03 (Admin user creation form labels not associated with inputs): **RESOLVED** — Labels have `htmlFor` and inputs have matching `id` (admin-user-manager.tsx lines 101-111).
- SEC-39-01 (Locale cookie missing Secure flag): **RESOLVED** — The cookie now includes `;Secure` when on HTTPS (nav-client.tsx line 60).
- SEC-39-03 (`SET @@global.` pattern in sql-restore-scan.ts): **RESOLVED** — The pattern `/\bSET\s+@@global\./i` is present in the dangerous patterns list (sql-restore-scan.ts line 30).
- UX-39-02 (Admin user creation lacks password confirmation): **RESOLVED** — A password confirmation input and client-side check are present (admin-user-manager.tsx lines 109-111, 38-43).
- CR-39-02 (`processImageFormats` unlink-before-link race): **RESOLVED** — Atomic rename via `.tmp` file is now used (process-image.ts lines 380-395).

Prior cycle 18 findings (C18-01, C18-02, C18-03) all remain resolved.

---

## DEFERRED CARRY-FORWARD

All previously deferred items remain unchanged. See the deferred items in `.context/plans/` for the full list:

- C32-03: Insertion-order eviction in Maps (also CRI-38-01 DRY concern)
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- CR-38-05: `db-actions.ts` env passthrough is overly broad
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- CRI-38-01: DRY violation in Map pruning (5+ copies)
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory
- ARCH-38-03: `data.ts` is a god module
- TE-38-01 through TE-38-04: Test coverage gaps

---

## AGENT FAILURES

None — direct review completed successfully.

---

## TOTALS

- **0 CRITICAL** findings
- **2 MEDIUM** findings (C19-01, C19-02)
- **1 LOW** finding (C19-03)
- **3 total** new findings
