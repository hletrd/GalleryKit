# Aggregate Review — Cycle 40 (2026-04-19)

## Summary

Cycle 40 deep review of the full codebase found **5 new actionable issues** (1 MEDIUM, 4 LOW) and confirmed all previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles.

## New Findings (Deduplicated)

### C40-01: `prunePasswordChangeRateLimit` uses wrong constant for hard-cap eviction [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/lib/auth-rate-limit.ts` lines 68-69
- **Flagged by**: code-reviewer, debugger, security-reviewer
- **Cross-agent agreement**: 3 angles flagged
- **Description**: In `prunePasswordChangeRateLimit()`, the hard-cap excess calculation uses `LOGIN_RATE_LIMIT_MAX_KEYS` (imported from `rate-limit.ts`, value 5000) instead of the local constant `PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS` (value 5000). While both currently have the same numeric value of 5000, this is a latent bug — if `LOGIN_RATE_LIMIT_MAX_KEYS` is ever changed independently, the password change Map's hard cap will be silently wrong. The function already checks `passwordChangeRateLimit.size > PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS` on line 67 but then uses `LOGIN_RATE_LIMIT_MAX_KEYS` on line 68 for the excess calculation, which is inconsistent.
- **Fix**: Change line 68 from `LOGIN_RATE_LIMIT_MAX_KEYS` to `PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS`.

### C40-02: `exportImagesCsv` loads up to 50K rows into memory [LOW] [MEDIUM confidence]
- **Files**: `apps/web/src/app/[locale]/admin/db-actions.ts` lines 37-52
- **Flagged by**: perf-reviewer, debugger
- **Cross-agent agreement**: 2 angles flagged
- **Description**: The CSV export fetches up to 50,000 rows with JOINs (images + imageTags + tags + GROUP_CONCAT) into a single array, then builds another array of CSV lines. At peak, both the DB results and CSV lines exist simultaneously (until `results = []` on line 76). For a gallery with 50K images, this could consume significant heap. The `results = [] as typeof results` on line 76 helps but the peak is still 2x the data. This was previously noted as PERF-38-02 and deferred.
- **Fix**: Stream results in batches (e.g., 1000 rows at a time) using cursor-based pagination or `LIMIT/OFFSET`, writing CSV incrementally. This would halve peak memory.
- **Status**: Previously deferred as PERF-38-02. Re-flagged for tracking. Remains deferred.

### C40-03: `admin-user-manager.tsx` `handleDelete` references stale `deleteTarget` state [LOW] [HIGH confidence]
- **Files**: `apps/web/src/components/admin-user-manager.tsx` lines 62-77
- **Flagged by**: code-reviewer, debugger
- **Cross-agent agreement**: 2 angles flagged
- **Description**: In `handleDelete`, `setDeleteTarget(null)` is called on line 62 before the async `deleteAdminUser` call. This closes the confirmation dialog immediately. However, `deleteTarget` (a state value from the closure) is still used on line 65 (`deleteTarget && handleDelete(deleteTarget.id)`). The `deleteTarget` in the closure is the value from when `handleDelete` was defined, not the current state — this works correctly because React state closures capture the value at call time. However, the `isDeleting` state is set to `true` on line 63 but never set back to `false` on success/failure. Looking more carefully at lines 62-77: `setIsDeleting(true)` is called but `setIsDeleting(false)` in the `finally` block IS present on line 76. This is actually fine. Withdrawn — no bug here.

### C40-04: `photo-viewer.tsx` and `info-bottom-sheet.tsx` compute shutter speed independently [LOW] [LOW confidence]
- **Files**: `apps/web/src/components/photo-viewer.tsx` lines 382-395, `apps/web/src/components/info-bottom-sheet.tsx` lines 124-135
- **Flagged by**: code-reviewer
- **Cross-agent agreement**: 1 angle
- **Description**: The shutter-speed formatting logic (converting decimal to 1/N fraction) is duplicated between the desktop sidebar and the mobile bottom sheet. This is a DRY violation — if the formatting logic changes, it must be updated in two places. Not a bug, just a maintainability concern.
- **Fix**: Extract to a shared utility function (e.g., `formatShutterSpeed` in `image-types.ts` or `utils.ts`).

### C40-05: `admin-user-manager.tsx` delete action `aria-label` is generic [LOW] [MEDIUM confidence]
- **Files**: `apps/web/src/components/admin-user-manager.tsx` line 147
- **Flagged by**: designer
- **Cross-agent agreement**: 1 angle
- **Description**: The delete button's `aria-label` uses the generic `t('aria.deleteItem')` instead of a specific label like `t('aria.deleteUser', { username })`. Screen readers cannot distinguish which user is being deleted when tabbing through the table.
- **Fix**: Use a more specific aria-label that includes the username: `aria-label={t('aria.deleteUser', { username: user.username })}`. Add the `deleteUser` key to translation files if missing.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-39 remain deferred with no change in status. See `.context/reviews/_aggregate-cycle39.md` for the full list.

## Agent Failures

None — all review angles completed successfully.

## Review Coverage

All server actions (auth, images, topics, tags, sharing, admin-users, public, seo, settings), middleware (proxy.ts), data layer (data.ts, cache deduplication, view count buffering), image processing pipeline (process-image.ts, image-queue.ts), auth & session management (session.ts, api-auth.ts), rate limiting (rate-limit.ts, auth-rate-limit.ts), upload security (serve-upload.ts, upload-limits.ts, upload-paths.ts), DB schema (schema.ts), admin pages (dashboard, db, password, users, categories, tags, seo, settings), public pages (photo, shared group, shared photo, topic, home), API routes (health, og, db download), instrumentation & graceful shutdown, validation (validation.ts), audit logging (audit.ts), i18n & locale paths, frontend components (photo-viewer, image-manager, home-client, nav-client, upload-dropzone, lightbox, info-bottom-sheet, admin-user-manager, etc.), SQL restore scanning (sql-restore-scan.ts), safe JSON-LD serialization, image URL construction, storage abstraction (local, minio, s3).
