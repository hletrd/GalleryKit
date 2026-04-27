# Code Reviewer — Cycle 1 Fresh Review (2026-04-27)

## Inventory of Files Reviewed

All production source files under `apps/web/src/` including:
- `db/schema.ts`, `db/index.ts`, `db/seed.ts`
- `lib/data.ts`, `lib/process-image.ts`, `lib/session.ts`, `lib/validation.ts`
- `lib/blur-data-url.ts`, `lib/rate-limit.ts`, `lib/auth-rate-limit.ts`
- `lib/image-queue.ts`, `lib/upload-tracker-state.ts`, `lib/content-security-policy.ts`
- `lib/serve-upload.ts`, `lib/db-restore.ts`, `lib/audit.ts`, `lib/revalidation.ts`
- `lib/sanitize.ts`, `lib/csv-escape.ts`, `lib/action-guards.ts`, `lib/api-auth.ts`
- `lib/request-origin.ts`, `lib/upload-paths.ts`, `lib/upload-limits.ts`
- `lib/upload-processing-contract-lock.ts`, `lib/restore-maintenance.ts`
- `proxy.ts`, `app/actions/auth.ts`, `app/actions/images.ts`, `app/actions/public.ts`
- `app/api/admin/db/download/route.ts`, `app/api/health/route.ts`, `app/api/live/route.ts`
- `components/photo-viewer.tsx`

---

## Findings

### C1-CR-01: Indentation inconsistency in `uploadImages` try/finally block
**File:** `apps/web/src/app/actions/images.ts:178-431`
**Severity:** Low | **Confidence:** High

The `try { ... } finally { await uploadContractLock.release(); }` block has the entire try body indented one extra level (4 extra spaces) compared to the surrounding function. The `try` at line 178 and `finally` at line 429 are at the correct column, but the body inside is indented 8 spaces instead of 4 relative to the function. This makes the code harder to read and diffs harder to follow.

**Fix:** Re-indent the try body to use consistent 4-space indentation relative to the function.

---

### C1-CR-02: `deleteImageVariants` called with `[]` for sizes — intent ambiguous
**File:** `apps/web/src/lib/process-image.ts:186` and `apps/web/src/app/actions/images.ts:503-505`
**Severity:** Low | **Confidence:** High

`deleteImageVariants(UPLOAD_DIR_WEBP, image.filename_webp, [])` triggers the `!sizes || sizes.length === 0` branch, which runs the expensive `opendir`+scan path. This is intentional (to clean up variants from prior size configs), but passing `[]` makes the intent ambiguous. A reader could interpret this as "no sizes" rather than "scan all variants". An explicit `undefined` or a named constant would be clearer.

**Fix:** Pass `undefined` instead of `[]`, or add a named constant like `SCAN_ALL_VARIANTS = undefined as unknown as number[]`.

---

### C1-CR-03: `width` fallback to 2048 in `saveOriginalAndGetMetadata` stores misleading dimensions
**File:** `apps/web/src/lib/process-image.ts:276-277`
**Severity:** Medium | **Confidence:** Medium

```ts
const width = (metadata.width && metadata.width > 0) ? metadata.width : 2048;
const height = (metadata.height && metadata.height > 0) ? metadata.height : width;
```

When Sharp cannot determine dimensions, the function falls back to 2048x2048. This synthetic dimension is stored in the database and used for aspect-ratio calculations in the masonry grid and photo viewer. A 2048x2048 fallback for a non-square image produces incorrect aspect ratios and visual layout artifacts (stretched/squished images). The `original_width`/`original_height` fields correctly preserve the actual values when available, but `width`/`height` are the primary fields used for layout.

**Fix:** Throw an error when Sharp cannot determine dimensions rather than storing a misleading fallback. At minimum, log a warning when the fallback is triggered.

---

### C1-CR-04: `buildContentSecurityPolicy` includes Google Analytics domains unconditionally in production
**File:** `apps/web/src/lib/content-security-policy.ts:58-59`
**Severity:** Low | **Confidence:** High

The production CSP always includes `https://www.googletagmanager.com` in `script-src` and `https://www.google-analytics.com` in `connect-src`. Sites that don't use Google Analytics have unnecessary CSP allowlist entries that weaken the policy. These should be conditional on a configuration flag.

**Fix:** Make GA domains conditional on an environment variable like `NEXT_PUBLIC_GA_ID` or a site-config flag.

---

### C1-CR-05: `photo-viewer.tsx` — keyboard shortcut `F` conflicts with browser search
**File:** `apps/web/src/components/photo-viewer.tsx:197-198`
**Severity:** Low | **Confidence:** Medium

```ts
} else if (e.key === 'f' || e.key === 'F') {
    setShowLightbox(prev => !prev);
}
```

The `F` key shortcut to toggle the lightbox could conflict with the browser's built-in Ctrl+F / Cmd+F find shortcut on some browsers or screen readers. The code correctly skips editable targets (`isEditableTarget`), but the bare `F` key (without modifier) is unusual for web apps. This is a minor UX concern rather than a bug since the `isEditableTarget` guard prevents interference with text input.

**Fix:** Consider documenting this in the shortcuts hint or adding a modifier key requirement. Low priority since the current implementation is functional.

---

### C1-CR-06: Session `expiresAt` comparison may be timezone-sensitive
**File:** `apps/web/src/lib/session.ts:139`
**Severity:** Low | **Confidence:** Low

```ts
if (session.expiresAt < new Date()) {
```

The `expiresAt` column is a `timestamp` in MySQL (timezone-aware, stored in UTC). Drizzle reads it as a JavaScript Date. Comparing against `new Date()` (which uses the Node.js process timezone) could be incorrect if the MySQL connection timezone differs from the Node.js process timezone. In practice, both typically use UTC in Docker deployments, but this is an implicit assumption.

**Fix:** Consider using `sql\`NOW()\`` for the comparison, or document the timezone assumption explicitly in the session module.

---

### C1-CR-07: `searchImages` in `data.ts` does not escape LIKE wildcards in tag/alias search
**File:** `apps/web/src/lib/data.ts:820,846`
**Severity:** Low | **Confidence:** High (false positive on closer inspection)

The `searchImages` function at line 780 escapes LIKE wildcards for the main query (`%` and `_`), but the tag search (line 820) and alias search (line 846) also use `like(tags.name, searchTerm)` and `like(topicAliases.alias, searchTerm)`. However, on closer inspection, the `like()` function from Drizzle ORM parameterizes the value, and the wildcards `%${escaped}%` are added around the already-escaped search term. So this is correctly handled — the `escaped` variable at line 780 already has wildcards stripped, and the same variable is reused for tag/alias searches.

**Status:** Not a real issue — LIKE escaping is correctly applied.

---

### C1-CR-08: `original_format`/`original_file_size` in `adminSelectFields` inflate listing queries
**File:** `apps/web/src/lib/data.ts:466-488`
**Severity:** Low | **Confidence:** Medium

`getAdminImagesLite()` uses `...adminSelectFields` which includes `original_format` and `original_file_size`. These are VARCHAR/BIGINT columns. While not as large as `blur_data_url`, they are not displayed in the admin dashboard card layout — they're only shown in the individual photo viewer info panel. The same concern applies to the public listing queries which correctly exclude them via `publicSelectFields`.

**Fix:** Consider whether these fields should be fetched only in `getImage()` (individual query) rather than in the listing query, similar to `blur_data_url`.
