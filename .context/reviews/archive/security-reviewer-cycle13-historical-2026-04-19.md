# Security Reviewer — Cycle 13

## Findings

### SEC-13-01: `getGalleryConfig` does not validate parsed numeric settings [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/lib/gallery-config.ts` lines 70-87
- **Description**: `_getGalleryConfig()` reads settings from the DB and converts them with bare `Number()` calls without validation. While `isValidSettingValue` is called during writes in `updateGallerySettings`, the read path doesn't validate. If a DB row is corrupted or manually edited (e.g., `image_sizes` = "foo"), `Number('foo')` returns `NaN`, and `imageSizes` becomes `[NaN]` (since `.filter(n => Number.isFinite(n) && n > 0)` would catch this) or `queueConcurrency` becomes `NaN` which would break `PQueue`. The `parseImageSizes` function in `gallery-config-shared.ts` correctly falls back to defaults on invalid input, but `gallery-config.ts` doesn't use it.
- **Failure scenario**: Admin manually edits `admin_settings` table setting `queue_concurrency` to "abc" — `PQueue({ concurrency: NaN })` behavior is undefined (likely defaults to Infinity, consuming all CPU).
- **Fix**: Validate parsed config values against the same validators in `gallery-config-shared.ts`, falling back to defaults on invalid values.

### SEC-13-02: `gallery-config.ts` `storageBackend` cast is unchecked [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/lib/gallery-config.ts` line 85
- **Description**: `storageBackend: getSetting(map, 'storage_backend') as 'local' | 'minio' | 's3'` is an unchecked type assertion. If the DB value is corrupted to something else (e.g., "ftp"), the cast silently passes the invalid value downstream. `switchStorageBackend` has a `default` case that falls through to `LocalStorageBackend`, so it won't crash, but the admin UI would show the wrong backend status.
- **Fix**: Validate against the allowed values `['local', 'minio', 's3']` and fall back to `'local'` if invalid.

### SEC-13-03: SEO OG image URL allows `javascript:` protocol via race with validation [LOW] [LOW confidence]
- **File**: `apps/web/src/app/actions/seo.ts` lines 88-97
- **Description**: The URL validation checks `['http:', 'https:'].includes(url.protocol)`, which is correct. However, `new URL()` can be confused by some edge cases with userinfo (e.g., `http://evil.com@good.com`). This is extremely low risk since the URL is only used in `<meta property="og:image">` tags which browsers don't navigate to, and the value is set by an authenticated admin. The OG image URL is not rendered as an `<a href>` or `<img src>` in user-facing pages — it's only in the `<head>` metadata.
- **Fix**: No immediate fix needed. The existing validation is sufficient for the threat model (admin-only input, metadata-only rendering).

## Previously Deferred Items Still Present

- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- CR-38-05: `db-actions.ts` env passthrough is overly broad
