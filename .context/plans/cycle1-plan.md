# Implementation Plan — Cycle 1 (Fresh Review)

## Plan A: Security-Critical Test Coverage (Priority: Critical)
Addresses: [CROSS-AGREE-1] Missing test coverage for security-critical modules

### A1: Add tests for `proxy.ts` middleware
- File: `apps/web/src/__tests__/proxy.test.ts`
- Test `isProtectedAdminRoute` logic (export needed or test via middleware call)
- Cases: `/admin` (NOT protected), `/admin/dashboard` (protected), `/en/admin/dashboard` (protected), API routes excluded, trailing slashes, default locale paths

### A2: Add tests for `serve-upload.ts`
- File: `apps/web/src/__tests__/serve-upload.test.ts`
- Cases: path traversal, symlink rejection, invalid directory, extension mismatch, safe segment validation

### A3: Add tests for `request-origin.ts`
- File: `apps/web/src/__tests__/request-origin.test.ts`
- Cases: matching Origin, matching Referer, missing both headers, spoofed X-Forwarded-Host, invalid URLs

### A4: Add tests for `sql-restore-scan.ts` (already partially exists, extend)
- File: `apps/web/src/__tests__/sql-restore-scan.test.ts`
- Add cases for: CREATE TABLE detection, DELIMITER bypass, multi-line dangerous patterns

### A5: Add tests for `process-image.ts` EXIF extraction
- File: `apps/web/src/__tests__/exif-extraction.test.ts`
- Test `extractExifForDb` for all metering modes, exposure programs, flash bit combos, GPS conversion

## Plan B: Security Hardening (Priority: Critical)
Addresses: [CROSS-AGREE-2], [S1-02], [S1-03], [V1-01]

### B1: Enforce lowercase slugs
- File: `apps/web/src/lib/validation.ts`
- Change `isValidSlug` regex from `/[a-z0-9_-]+/i` to `/[a-z0-9_-]+/` (remove case-insensitive flag)
- Add `.toLowerCase()` in `createTopic` and `updateTopic` before slug validation
- Update existing slugs in DB migration if needed

### B2: Add `CREATE TABLE` to dangerous SQL patterns
- File: `apps/web/src/lib/sql-restore-scan.ts`
- Add `/\bCREATE\s+TABLE\b/i` to `DANGEROUS_SQL_PATTERNS` array
- Note: This will make legitimate backup restores fail. Alternative: allow `CREATE TABLE` only for known table names (whitelist). Decision: Since mysqldump output includes `CREATE TABLE` statements for the gallery's own tables, we should NOT block `CREATE TABLE` entirely. Instead, add a post-restore validation that only expected tables exist.

### B3: Add Content-Security-Policy header
- File: `apps/web/src/proxy.ts` (middleware) or `next.config.js`
- Add CSP header: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';`
- Adjust based on Next.js requirements (may need 'unsafe-inline' for styles initially)

### B4: Add allowed-host validation for `hasTrustedSameOrigin`
- File: `apps/web/src/lib/request-origin.ts`
- Add a `ALLOWED_HOSTS` check derived from `site-config.json` or `BASE_URL` env var
- If the host in X-Forwarded-Host doesn't match the configured host, reject

## Plan C: Privacy Model Hardening (Priority: High)
Addresses: [CROSS-AGREE-3], [CR1-04]

### C1: Add `original_format` and `original_file_size` to privacy guard type
- File: `apps/web/src/lib/data.ts`
- Add these keys to `_PrivacySensitiveKeys` type
- They're already omitted from `publicSelectFields` (set to NULL), but the type guard doesn't catch them

### C2: Add runtime privacy assertion for dev mode
- File: `apps/web/src/lib/data.ts`
- Add a dev-only assertion that checks the keys of `publicSelectFields` against `adminSelectFields`
- Throws in dev if any PII key appears in public fields

### C3: Add test verifying public API responses don't contain PII
- File: `apps/web/src/__tests__/privacy-response.test.ts`
- Mock DB responses with PII fields populated
- Verify that `getImagesLite`, `getImage`, `getImageByShareKey`, `getSharedGroup` results don't contain latitude, longitude, filename_original, user_filename, processed

## Plan D: Code Quality and Correctness (Priority: Medium)
Addresses: [C1-01], [C1-05], [V1-03], [C1-06], [CR1-05]

### D1: Fix `updateImageMetadata` TOCTOU gap
- File: `apps/web/src/app/actions/images.ts`
- Add null check for `existingImage` before UPDATE
- If null, return error early

### D2: Pre-validate topic existence in `createTopicAlias`
- File: `apps/web/src/app/actions/topics.ts`
- Add a SELECT for the topic before inserting the alias
- Keep FK as defense-in-depth

### D3: Document `parseExifDateTime` timezone behavior
- File: `apps/web/src/lib/process-image.ts`
- Add JSDoc noting that string EXIF dates preserve camera local time
- Date/numeric inputs are converted to UTC

### D4: Extend `stripControlChars` to cover C1 controls
- File: `apps/web/src/lib/sanitize.ts`
- Change regex from `/[\x00-\x1F\x7F]/g` to `/[\x00-\x1F\x7F-\x9F]/g`

### D5: Sort image sizes before processing
- File: `apps/web/src/lib/process-image.ts`
- Add `sizes.sort((a, b) => a - b)` at the start of `processImageFormats`
- Ensures the last element is always the largest

## Plan E: Architecture Improvements (Priority: Medium)
Addresses: [A1-01], [A1-02], [P1-01], [P1-02]

### E1: Extract view-count buffering from data.ts
- File: Create `apps/web/src/lib/view-count-buffer.ts`
- Move `viewCountBuffer`, `viewCountFlushTimer`, `bufferGroupViewCounts`, `flushGroupViewCounts`, related constants and functions
- Update `data.ts` imports

### E2: Parallelize search queries
- File: `apps/web/src/lib/data.ts`
- Run all 3 search queries in parallel with `Promise.allSettled`
- Merge and deduplicate results

### E3: Stream CSV export
- File: `apps/web/src/app/[locale]/admin/db-actions.ts`
- Replace in-memory CSV building with streaming approach
- Note: This requires changes to the server action return type. May need to use a Response object instead of a plain return.

## Plan F: UI/UX Improvements (Priority: Medium)
Addresses: [UI1-01], [UI1-02], [UI1-03], [UI1-04/05], [UI1-06]

### F1: Audit focus trap in admin modals
- Verify all dialog/sheet usages include focus trap
- Test Tab cycling within modals and Escape to close

### F2: Add accepted file types to upload dropzone
- File: `apps/web/src/components/upload-dropzone.tsx`
- Display accepted formats (.jpg, .png, .webp, .avif, .heic, etc.)

### F3: Add processing indicator for unprocessed images
- File: `apps/web/src/components/admin-nav.tsx` or image list component
- Add a "Processing..." badge or shimmer for unprocessed images

### F4: Verify keyboard navigation in photo viewer
- Test left/right arrow keys for prev/next
- Verify ARIA labels on navigation buttons

## Deferred Items

### [DEFER-1] Unify rate limiting into single class (A1-01)
**Reason:** Refactor, not a bug. Would touch 4+ files with no functional change.
**Exit criterion:** When a new rate-limit use case requires adding yet another Map.

### [DEFER-2] Stream CSV export (E3)
**Reason:** Requires server action return type change; current approach works for galleries up to 50K images.
**Exit criterion:** When gallery size exceeds 30K images or memory pressure is observed.

### [DEFER-3] Runtime privacy assertion in dev mode (C2)
**Reason:** Compile-time guard is sufficient for type-safe codebases. Runtime check adds dev-mode overhead.
**Exit criterion:** When a PII leak is found that the compile-time guard missed.

### [DEFER-4] `hasTrustedSameOrigin` allowed-host validation (B4)
**Reason:** The function already checks Origin/Referer match. Adding host validation requires knowing the external URL at config time, which may not be available in all deployment scenarios.
**Exit criterion:** When a concrete spoofing attack is demonstrated.

### [DEFER-5] Periodic orphan-file cleanup job (D1-02)
**Reason:** Best-effort cleanup is sufficient for a personal gallery. Orphaned files don't cause functional issues.
**Exit criterion:** When disk space becomes a concern from orphaned files.

### [DEFER-6] Error message information leakage review (CR1-02)
**Reason:** Current error messages are useful for UX. Generic messages would degrade the admin experience. Not a security boundary — admin actions already require authentication.
**Exit criterion:** When a specific attack leverages error message content.
