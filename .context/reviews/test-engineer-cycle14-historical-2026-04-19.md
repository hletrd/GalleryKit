# Test Engineer Review — Cycle 14 (2026-04-20)

## Reviewer: test-engineer
## Scope: Test coverage gaps, flaky tests, missing test scenarios, TDD opportunities, assertion quality, test isolation

## Existing Test Inventory

### Unit Tests (`apps/web/src/__tests__/`)
| File | Tests | Functions Covered |
|------|-------|-------------------|
| `base56.test.ts` | 8 | `generateBase56`, `isBase56` |
| `session.test.ts` | 4 | `hashSessionToken`, `generateSessionToken` format |
| `queue-shutdown.test.ts` | 2 | `drainProcessingQueueForShutdown` |
| `auth-rate-limit.test.ts` | 3 | `getLoginRateLimitEntry`, `recordFailedLoginAttempt`, `clearSuccessfulLoginAttempts` |
| `revalidation.test.ts` | 4 | `getLocalizedPathVariants`, `revalidateLocalizedPaths`, `revalidateAdminSurfaces`, `revalidateAllAppData` |
| `locale-path.test.ts` | 4 | `stripLocalePrefix`, `localizePath`, `absoluteUrl`, `localizeUrl` |
| `sql-restore-scan.test.ts` | 4 | `stripSqlCommentsAndLiterals`, `containsDangerousSql` |
| `rate-limit.test.ts` | 7 | `normalizeIp`, `getRateLimitBucketStart`, `getClientIp` |
| `validation.test.ts` | 14 | `isValidSlug`, `isValidFilename`, `isValidTopicAlias`, `isReservedTopicRouteSegment`, `isValidTagName` |

**Total: 9 files, 50 tests**

### E2E Tests (`apps/web/e2e/`)
| File | Tests | Scope |
|------|-------|-------|
| `public.spec.ts` | 3 | Homepage locale switch, search dialog, photo lightbox |
| `admin.spec.ts` | 3 | Admin auth, navigation, upload (opt-in) |
| `nav-visual-check.spec.ts` | 3 | Screenshot capture (no assertions) |
| `test-fixes.spec.ts` | 3 | Mobile/desktop nav, photo info sheet |
| `helpers.ts` | — | Shared utilities |

**Total: 4 spec files, 12 tests**

### Untested Source Files (pure functions, no DB/FS dependencies)
| File | Export | Lines | Tested? |
|------|--------|-------|---------|
| `lib/gallery-config-shared.ts` | `isValidSettingValue` | 71-74 | NO |
| `lib/gallery-config-shared.ts` | `findNearestImageSize` | 94-106 | NO |
| `lib/gallery-config-shared.ts` | `parseImageSizes` | 112-116 | NO |
| `lib/image-url.ts` | `imageUrl` | 4-8 | NO |
| `lib/safe-json-ld.ts` | `safeJsonLd` | 2-4 | NO |
| `lib/image-types.ts` | `hasExifData` | 50-55 | NO |
| `lib/image-types.ts` | `nu` | 58-60 | NO |
| `lib/upload-limits.ts` | `formatUploadLimit` | 12-19 | NO |
| `lib/process-image.ts` | `getSafeExtension` | 62-72 | NO |
| `lib/process-image.ts` | `parseExifDateTime` | 117-150 | NO |
| `lib/process-image.ts` | `cleanString` | 412-417 | NO |
| `lib/process-image.ts` | `cleanNumber` | 419-424 | NO |
| `lib/process-image.ts` | `extractExifForDb` | 426-535 | NO |
| `lib/audit.ts` | `logAuditEvent` (truncation logic) | 16-29 | NO |
| `lib/image-queue.ts` | `pruneRetryMaps` | 21-32 | NO |

---

## Findings

### Finding TE-14-01: `gallery-config-shared.ts` pure functions have zero tests despite recent bug fixes
- **File**: `apps/web/src/lib/gallery-config-shared.ts` lines 71-116
- **Confidence**: HIGH
- **Description**: Three pure functions — `isValidSettingValue`, `findNearestImageSize`, `parseImageSizes` — have no unit tests. These functions were directly implicated in recent production bugs:
  - Commit `000000057`: "fix(settings): tighten image_sizes input pattern validation"
  - Commit `000000002`: "fix(viewer): use findNearestImageSize for histogram source instead of hardcoded 640"
  - Commit `0000000337`: "fix(config): use parseImageSizes for sorted output and add validation with fallback"
  - These bugs were found and fixed **without adding regression tests**, making them likely to recur.
- **Concrete gap**: No test verifies that `parseImageSizes` sorts output, falls back to `DEFAULT_IMAGE_SIZES` on empty/invalid input, or rejects non-numeric values. No test verifies `findNearestImageSize` selects the closest size, handles empty arrays, or breaks ties. No test verifies `isValidSettingValue` validates ranges per key (quality 1-100, concurrency 1-16, etc.).
- **Suggested tests**:
  ```ts
  describe('parseImageSizes', () => {
    it('sorts sizes ascending', () => expect(parseImageSizes('4096,640,2048')).toEqual([640, 2048, 4096]));
    it('returns defaults on empty string', () => expect(parseImageSizes('')).toEqual(DEFAULT_IMAGE_SIZES));
    it('returns defaults on all-invalid input', () => expect(parseImageSizes('abc,0,-1')).toEqual(DEFAULT_IMAGE_SIZES));
    it('filters out zero and negative values', () => expect(parseImageSizes('100,0,-5,200')).toEqual([100, 200]));
    it('trims whitespace around values', () => expect(parseImageSizes(' 640 , 2048 ')).toEqual([640, 2048]));
  });
  describe('findNearestImageSize', () => {
    it('returns targetSize when sizes array is empty', () => expect(findNearestImageSize([], 1536)).toBe(1536));
    it('returns exact match when available', () => expect(findNearestImageSize([640, 1536, 2048], 1536)).toBe(1536));
    it('returns nearest when no exact match', () => expect(findNearestImageSize([640, 2048], 1500)).toBe(2048));
    it('picks first element on tie', () => expect(findNearestImageSize([1500, 1600], 1550)).toBe(1500));
  });
  describe('isValidSettingValue', () => {
    it('rejects quality values outside 1-100', () => { expect(isValidSettingValue('image_quality_webp', '0')).toBe(false); expect(isValidSettingValue('image_quality_webp', '101')).toBe(false); });
    it('rejects non-numeric quality', () => expect(isValidSettingValue('image_quality_avif', 'high')).toBe(false));
    it('accepts valid storage backends', () => { expect(isValidSettingValue('storage_backend', 'local')).toBe(true); expect(isValidSettingValue('storage_backend', 's3')).toBe(true); });
    it('rejects invalid storage backends', () => expect(isValidSettingValue('storage_backend', 'ftp')).toBe(false));
    it('validates image_sizes with comma-separated numbers', () => expect(isValidSettingValue('image_sizes', '640,1536,2048')).toBe(true));
    it('rejects image_sizes with zero or negative', () => expect(isValidSettingValue('image_sizes', '640,0,-1')).toBe(false));
  });
  ```

### Finding TE-14-02: `safeJsonLd()` XSS-prevention escape is untested
- **File**: `apps/web/src/lib/safe-json-ld.ts` lines 2-4
- **Confidence**: HIGH
- **Description**: `safeJsonLd` prevents XSS via `</script>` injection by escaping `<` to `\u003c`. This is a one-liner that is security-critical and trivially testable, yet has no test. A future refactor could remove the replacement or change the escape target.
- **Concrete gap**: No test verifies that `<` characters in input data are escaped to `\u003c`, or that the output is valid JSON.
- **Suggested tests**:
  ```ts
  describe('safeJsonLd', () => {
    it('escapes < to prevent </script> injection', () => {
      expect(safeJsonLd({ html: '<script>alert(1)</script>' })).not.toContain('<script>');
      expect(safeJsonLd({ html: '<script>alert(1)</script>' })).toContain('\\u003c');
    });
    it('produces valid JSON', () => {
      const input = { key: 'value', num: 42 };
      expect(JSON.parse(safeJsonLd(input))).toEqual(input);
    });
    it('leaves non-< characters intact', () => {
      expect(safeJsonLd({ text: 'hello & "world"' })).toContain('hello & "world"');
    });
  });
  ```

### Finding TE-14-03: `imageUrl()` path construction is untested
- **File**: `apps/web/src/lib/image-url.ts` lines 4-8
- **Confidence**: HIGH
- **Description**: `imageUrl` constructs URLs by prepending `IMAGE_BASE_URL` to relative paths. It normalizes leading slashes and strips trailing slashes from the base. If this logic breaks, image URLs would be malformed across the entire gallery.
- **Concrete gap**: No test verifies: base URL prepended correctly, trailing slash stripped from base, leading slash normalization, empty base URL falls back to path only.
- **Suggested tests**:
  ```ts
  describe('imageUrl', () => {
    it('prepends base URL with trailing slash stripped', () => { /* mock IMAGE_BASE_URL='https://cdn.example.com/' */ expect(imageUrl('/uploads/jpeg/foo.jpg')).toBe('https://cdn.example.com/uploads/jpeg/foo.jpg'); });
    it('adds leading slash when path lacks one', () => { expect(imageUrl('uploads/jpeg/foo.jpg')).toMatch(/\/uploads\//); });
    it('returns path unchanged when base is empty', () => { expect(imageUrl('/uploads/jpeg/foo.jpg')).toBe('/uploads/jpeg/foo.jpg'); });
    it('strips multiple trailing slashes from base', () => { /* mock IMAGE_BASE_URL='https://cdn.example.com///' */ });
  });
  ```

### Finding TE-14-04: `process-image.ts` pure EXIF helpers are untested
- **File**: `apps/web/src/lib/process-image.ts` lines 62-72 (`getSafeExtension`), 117-150 (`parseExifDateTime`), 412-424 (`cleanString`/`cleanNumber`), 426-535 (`extractExifForDb`)
- **Confidence**: HIGH
- **Description**: Several pure functions with complex branching logic have no tests. While the original review (Finding 5) identified EXIF/ICC as untested, it did not call out these specific pure functions that are independently testable without mocking Sharp or the filesystem:
  - `getSafeExtension`: strips non-alphanumeric chars, validates against ALLOWED_EXTENSIONS whitelist. Security-relevant.
  - `parseExifDateTime`: handles 3 input types (string, Date, number) with range validation and timezone-safe formatting. The recent commit history shows date-related bugs are a recurring pattern.
  - `cleanString`/`cleanNumber`: handle arrays, null-like strings, non-finite numbers.
  - `extractExifForDb`: 80+ lines mapping raw EXIF to DB fields, including GPS DMS-to-DD conversion with bounds checking, flash bitfield parsing, color_space/white_balance/metering_mode/exposure_program lookup tables, and exposure_compensation formatting.
- **Concrete gap**: GPS `convertDMSToDD` validates degree/minute/second ranges and hemisphere sign, but no test verifies: negative DMS values, values exceeding max degrees, S/W hemisphere negation. Flash bitfield parsing has 4 mode branches with fired/not-fired variants — no test covers them. Exposure compensation formatting (`+1.0 EV`, `0 EV`, `-0.5 EV`) is untested.
- **Suggested tests**:
  ```ts
  describe('getSafeExtension', () => {
    it('strips non-alphanumeric characters', () => { /* test .J%PG → .jpg after sanitization */ });
    it('rejects disallowed extensions', () => { /* test .exe, .svg, .php */ });
    it('accepts allowed extensions case-insensitively', () => { /* test .JPEG, .WEBP */ });
  });
  describe('parseExifDateTime', () => {
    it('parses standard EXIF format YYYY:MM:DD HH:MM:SS', () => { /* ... */ });
    it('rejects out-of-range months/days/hours', () => { /* month 13, hour 25 */ });
    it('returns null for unparsable strings', () => { /* ... */ });
    it('handles Date objects', () => { /* ... */ });
    it('handles numeric timestamps', () => { /* ... */ });
  });
  describe('extractExifForDb', () => {
    it('converts GPS DMS to DD with S/W negation', () => { /* ... */ });
    it('rejects GPS values exceeding max degrees', () => { /* ... */ });
    it('parses flash bitfield for auto/fired/off modes', () => { /* val & 0x01, (val >> 3) & 0x03 */ });
    it('formats exposure compensation with sign and EV unit', () => { /* 0 → "0 EV", 1.5 → "+1.5 EV", -0.3 → "-0.3 EV" */ });
    it('maps metering_mode numbers to labels', () => { /* 2 → "Center-weighted", 3 → "Spot" */ });
  });
  ```

### Finding TE-14-05: `hasExifData()` and `nu()` helpers are untested
- **File**: `apps/web/src/lib/image-types.ts` lines 50-60
- **Confidence**: MEDIUM
- **Description**: `hasExifData` guards EXIF display in the UI with three branches (undefined/null → false, string with trim → boolean, number with isFinite → boolean). `nu` converts null to undefined for HTML attributes. Both are trivially testable pure functions used in rendering.
- **Concrete gap**: No test for `hasExifData` with whitespace-only string (should return false), non-finite number (should return false), zero (should return true), or `nu` with undefined vs null.
- **Suggested tests**:
  ```ts
  describe('hasExifData', () => {
    it('returns false for null/undefined', () => { expect(hasExifData(null)).toBe(false); expect(hasExifData(undefined)).toBe(false); });
    it('returns false for whitespace-only strings', () => { expect(hasExifData('   ')).toBe(false); });
    it('returns false for non-finite numbers', () => { expect(hasExifData(NaN)).toBe(false); expect(hasExifData(Infinity)).toBe(false); });
    it('returns true for valid strings and finite numbers', () => { expect(hasExifData('Canon')).toBe(true); expect(hasExifData(0)).toBe(true); expect(hasExifData(100)).toBe(true); });
  });
  describe('nu', () => {
    it('converts null to undefined', () => { expect(nu(null)).toBeUndefined(); });
    it('passes through undefined', () => { expect(nu(undefined)).toBeUndefined(); });
    it('passes through strings', () => { expect(nu('sRGB')).toBe('sRGB'); });
  });
  ```

### Finding TE-14-06: `formatUploadLimit()` has untested edge cases
- **File**: `apps/web/src/lib/upload-limits.ts` lines 12-19
- **Confidence**: MEDIUM
- **Description**: `formatUploadLimit` has three branches: exact GiB, exact MiB, or raw bytes. The boundary between GiB and MiB display is determined by modulo arithmetic that could produce surprising results for non-power-of-two sizes.
- **Concrete gap**: No test for values that are exact GiB (2GB → "2GB"), exact MiB but not GiB (512MB → "512MB"), or fractional (1500 bytes → "1500 bytes"). The boundary at 1024 MiB (= 1 GiB) is especially worth testing.
- **Suggested tests**:
  ```ts
  describe('formatUploadLimit', () => {
    it('formats exact GiB values', () => { expect(formatUploadLimit(2 * 1024 * 1024 * 1024)).toBe('2GB'); });
    it('formats exact MiB values', () => { expect(formatUploadLimit(512 * 1024 * 1024)).toBe('512MB'); });
    it('falls back to raw bytes for non-aligned sizes', () => { expect(formatUploadLimit(1500)).toBe('1500 bytes'); });
    it('handles 1 GiB boundary', () => { expect(formatUploadLimit(1024 * 1024 * 1024)).toBe('1GB'); });
  });
  ```

### Finding TE-14-07: `audit.ts` metadata truncation logic is untested
- **File**: `apps/web/src/lib/audit.ts` lines 16-29
- **Confidence**: MEDIUM
- **Description**: `logAuditEvent` contains two testable logic branches that operate on pure data before hitting the DB: (1) JSON serialization failure fallback, (2) 4096-byte truncation with preview. These are currently entangled with the DB insert, but the serialization/truncation logic can be extracted and tested.
- **Concrete gap**: No test verifies: metadata with circular references falls back to `{ note: 'metadata serialization failed' }`, metadata exceeding 4096 bytes is truncated with `{ truncated: true, preview: ... }` structure, or the preview is sliced to 4000 chars.
- **Suggested tests**: Extract serialization/truncation into a pure `serializeMetadata(metadata: Record<string, unknown>)` function, then test:
  ```ts
  describe('serializeMetadata', () => {
    it('serializes normal objects to JSON', () => { /* ... */ });
    it('falls back on serialization failure', () => { const circular: any = {}; circular.self = circular; /* expect fallback */ });
    it('truncates metadata exceeding 4096 bytes', () => { const long = { data: 'x'.repeat(5000) }; /* expect truncated: true, preview: ... */ });
    it('preserves metadata under 4096 bytes', () => { /* ... */ });
  });
  ```

### Finding TE-14-08: `image-queue.ts pruneRetryMaps` logic is untested
- **File**: `apps/web/src/lib/image-queue.ts` lines 21-32
- **Confidence**: MEDIUM
- **Description**: `pruneRetryMaps` evicts the oldest entries from retry Maps when they exceed `MAX_RETRY_MAP_SIZE` (10000). The eviction iterates Map keys in insertion order and deletes `excess` entries. This is a pure function that takes a state object and mutates Maps — testable without DB or filesystem.
- **Concrete gap**: No test verifies: Maps under the limit are untouched, Maps at exactly the limit are untouched, Maps above the limit have the correct number of entries evicted, eviction removes the oldest (first-inserted) entries.
- **Suggested tests**:
  ```ts
  describe('pruneRetryMaps', () => {
    it('does nothing when maps are under the limit', () => { /* ... */ });
    it('evicts oldest entries when retryCounts exceeds MAX', () => { /* ... */ });
    it('evicts from both retryCounts and claimRetryCounts independently', () => { /* ... */ });
  });
  ```

### Finding TE-14-09: `LocalStorageBackend.resolve()` path-traversal prevention is untested
- **File**: `apps/web/src/lib/storage/local.ts` lines 26-31
- **Confidence**: HIGH
- **Description**: The `resolve` method is the sole security gate preventing path traversal in local file storage. It normalizes the path and checks that the result starts within `UPLOAD_ROOT`. This is a high-stakes security function with no test coverage. While it depends on `UPLOAD_ROOT`, the function is testable by setting the env var before import or by testing with known paths.
- **Concrete gap**: No test verifies: `../etc/passwd` is blocked, `foo/../../bar` is blocked, legitimate subdirectory paths are allowed, path exactly equal to UPLOAD_ROOT is allowed.
- **Suggested tests**: Test the class method directly:
  ```ts
  describe('LocalStorageBackend.resolve', () => {
    it('blocks path traversal with ../', () => { expect(() => backend.resolve('../etc/passwd')).toThrow('Path traversal'); });
    it('blocks path traversal with ../../', () => { expect(() => backend.resolve('foo/../../bar')).toThrow('Path traversal'); });
    it('allows legitimate subdirectory keys', () => { expect(() => backend.resolve('jpeg/photo.jpg')).not.toThrow(); });
    it('allows the root itself', () => { expect(() => backend.resolve('')).not.toThrow(); });
  });
  ```

### Finding TE-14-10: Recent commits fixed bugs without adding regression tests — pattern risk
- **Files**: Multiple, see git log below
- **Confidence**: HIGH
- **Description**: The last 5 commits on master are all bug fixes in areas with zero test coverage, and none added tests:
  - `000000057` fix(settings): tighten image_sizes input pattern validation
  - `00000002a` refactor(seo): replace unsafe double-cast with Object.fromEntries conversion
  - `000000002` fix(viewer): use findNearestImageSize for histogram source instead of hardcoded 640
  - `0000000337` fix(config): use parseImageSizes for sorted output and add validation with fallback
  - `0000000d4f` fix(images): use configured image sizes in client components and OG metadata
- **Concrete gap**: This is a systemic pattern — bugs are found, fixed, and committed without adding corresponding tests. Each of these fixes should have been accompanied by at least one regression test. The `parseImageSizes` and `findNearestImageSize` fixes are especially concerning because they are pure functions that are trivially testable.
- **Suggested action**: Adopt a TDD rule: every bug fix commit MUST include at least one failing test that reproduces the bug, then the fix that makes it pass. This should be enforced in review.

### Finding TE-14-11: E2E `test-fixes.spec.ts` file naming is misleading and content overlaps with nav specs
- **File**: `apps/web/e2e/test-fixes.spec.ts` lines 1-55
- **Confidence**: LOW
- **Description**: The file named `test-fixes.spec.ts` contains actual behavioral tests (mobile/desktop nav visibility, photo info sheet), not "test fixes." This naming suggests temporary or diagnostic content rather than first-class test coverage. The mobile nav tests partially overlap with `nav-visual-check.spec.ts` concerns.
- **Concrete gap**: Developers may assume this file is temporary and skip maintaining it. The tests inside are valid and should be in a properly named file.
- **Suggested action**: Rename to `navigation.spec.ts` or merge the unique tests into `public.spec.ts`.

### Finding TE-14-12: `base56.test.ts` has a weak randomness assertion
- **File**: `apps/web/src/__tests__/base56.test.ts` lines 18-22
- **Confidence**: LOW
- **Description**: The test "produces different values on successive calls" generates two values and asserts they differ. With a 56-character alphabet and 16-char output, the probability of collision is negligible, but the assertion pattern is fragile in principle — it tests probabilistic behavior rather than the deterministic contract.
- **Concrete gap**: The test could theoretically produce a false negative (two identical random values). More importantly, it doesn't verify the distribution quality or that all BASE56 characters appear in a large sample.
- **Suggested improvement**: Not urgent, but consider testing that a large sample (1000 values) uses at least 80% of the BASE56 alphabet, and that no two consecutive values are identical.

---

## TDD Opportunity Matrix

| Priority | Function | File | Lines | Testability | Recent Bug? |
|----------|----------|------|-------|-------------|-------------|
| P0 | `parseImageSizes` | `gallery-config-shared.ts` | 112-116 | Pure, no deps | YES (2 bugs) |
| P0 | `findNearestImageSize` | `gallery-config-shared.ts` | 94-106 | Pure, no deps | YES |
| P0 | `isValidSettingValue` | `gallery-config-shared.ts` | 71-74 | Pure, no deps | YES |
| P1 | `safeJsonLd` | `safe-json-ld.ts` | 2-4 | Pure, no deps | Security-critical |
| P1 | `getSafeExtension` | `process-image.ts` | 62-72 | Pure, no deps | Security-critical |
| P1 | `imageUrl` | `image-url.ts` | 4-8 | Pure (env dep) | No |
| P1 | `extractExifForDb` | `process-image.ts` | 426-535 | Pure, no deps | No |
| P1 | `parseExifDateTime` | `process-image.ts` | 117-150 | Pure, no deps | No |
| P2 | `hasExifData` / `nu` | `image-types.ts` | 50-60 | Pure, no deps | No |
| P2 | `formatUploadLimit` | `upload-limits.ts` | 12-19 | Pure, no deps | No |
| P2 | `LocalStorageBackend.resolve` | `storage/local.ts` | 26-31 | Class method | Security-critical |
| P2 | `pruneRetryMaps` | `image-queue.ts` | 21-32 | Pure (Map mutation) | No |
| P3 | `logAuditEvent` truncation | `audit.ts` | 16-29 | Extract first | No |

---

## Previously Reported (NOT re-reported, status noted)

The following were identified in the original `test-engineer.md` (12 findings) and `test-engineer-cycle38.md` (4 findings). None have been addressed — the test inventory is unchanged (9 unit test files, 4 e2e specs):

- Auth/session behavior coverage (Finding 2) — UNADDRESSED
- DB-backed rate limiting (Finding 3) — UNADDRESSED
- Upload server action (Finding 4) — UNADDRESSED
- Image processing pipeline (Finding 5) — UNADDRESSED
- Background queue retry/claim/bootstrap (Finding 6) — UNADDRESSED
- File-serving security routes (Finding 7) — UNADDRESSED
- Topic/tag/admin mutations (Finding 8) — UNADDRESSED
- Data-layer ordering/privacy/buffering (Finding 9) — UNADDRESSED
- Client race handling (Finding 10) — UNADDRESSED
- Photo viewer state machines (Finding 11) — UNADDRESSED
- Playwright flaky patterns (Finding 12) — UNADDRESSED
- View count buffering (TE-38-01) — UNADDRESSED
- ICC profile parsing (TE-38-02) — UNADDRESSED
- Upload-process-serve integration (TE-38-04) — UNADDRESSED

---

## Summary

This cycle focused on identifying **testable pure functions** that are currently untested, in contrast to prior reviews that focused on large integration gaps. The key finding is that **15 pure functions with zero external dependencies** have no test coverage, despite several being directly implicated in recent bug fixes.

The most actionable takeaway is Finding TE-14-10: the project has a pattern of fixing bugs without adding regression tests. The 5 most recent commits all fixed bugs in untested pure functions. Adding tests for these functions (especially `parseImageSizes`, `findNearestImageSize`, `isValidSettingValue`) would be the highest-ROI testing investment — they are trivially testable, already have known failure modes, and are security/configuration-critical.
