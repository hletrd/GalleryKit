# Security Reviewer Review — Cycle 7 (R2)

**Date:** 2026-04-19
**Reviewer:** security-reviewer
**Scope:** Full codebase

## Findings

### SEC-7R2-01: `searchImages` exposes internal UUID filenames to unauthenticated users [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/lib/data.ts` lines 598-604, `apps/web/src/app/actions/public.ts` line 97
- **Description:** The `searchImages` function returns `filename_jpeg`, `filename_webp`, `filename_avif` in its `SearchResult` type. The `searchImagesAction` in `public.ts` is an unauthenticated server action that returns the full `SearchResult[]` to the client. This leaks internal UUID-based filenames (e.g., `a1b2c3d4-5678-90ab-cdef-1234567890ab.jpg`) to unauthenticated users. While these are not the `filename_original` (excluded from public queries), the UUID filenames in the processed directories reveal the internal naming scheme and could aid directory enumeration attacks.
- **Fix:** Create a `searchPublicSelectFields` that omits filename columns, or strip filename fields from the result before returning to the client in `searchImagesAction`.

### SEC-7R2-02: `db-actions.ts` `dumpDatabase` env passthrough includes `HOME` [LOW] [HIGH confidence]
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts` line 121
- **Description:** The `env` option for `mysqldump` spawn passes `HOME` from the Node.js process. While `HOME` is needed for MySQL client config file discovery (`~/.my.cnf`), it could theoretically leak the container's home directory path. This is a known low-severity concern already deferred as CR-38-05.
- **Fix:** Already deferred as CR-38-05.

### SEC-7R2-03: `createGroupShareLink` insertId BigInt coercion risk [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/app/actions/sharing.ts` line 167
- **Description:** `Number(result.insertId)` is used to convert the insert ID. If the insertId exceeds `Number.MAX_SAFE_INTEGER`, this would silently produce an incorrect value. In practice, MySQL auto-increment values won't reach this limit, but the same pattern is used in `uploadImages` (line 167) where it IS validated (`Number.isFinite`). The `createGroupShareLink` function does check `Number.isFinite(groupId) || groupId <= 0` which would catch `Infinity` but not precision loss within the safe range.
- **Fix:** Already deferred as C30-04 / C36-02.

## Previously Deferred Items Confirmed (No Change)

All previously deferred items from cycles 5-39 remain deferred with no change in status.
