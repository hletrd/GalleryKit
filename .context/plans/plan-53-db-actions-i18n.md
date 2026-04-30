# Plan 53 — DB Actions i18n (C10-01)

**Status:** DONE
**Severity:** MEDIUM
**Finding:** C10-01 — `db-actions.ts` contains ~15 hardcoded English error strings. All other server action files were migrated to `getTranslations('serverActions')` in cycles 8-9, but this file was missed.

---

## Problem

`apps/web/src/app/[locale]/admin/db-actions.ts` has hardcoded English strings throughout `exportImagesCsv()`, `dumpDatabase()`, `restoreDatabase()`, and `runRestore()`. Korean admin users see English errors for DB backup/restore operations while all other admin actions display Korean errors.

### Special consideration: Promise callbacks

`dumpDatabase()` and `runRestore()` use `new Promise()` with resolve callbacks that return error strings. The `getTranslations()` call must happen before the Promise executor runs (i18n context is per-request). Solution: call `const t = await getTranslations('serverActions')` at the top of each exported function and capture it in a closure variable accessible to the Promise executor.

---

## Implementation Steps

### Step 1: Add translation keys to `en.json` under `serverActions`

Add these keys:

```json
"unauthorizedDb": "Not authorized",
"missingDbConfig": "Missing database configuration",
"failedToWriteBackup": "Failed to write backup file",
"backupFailed": "Database backup failed",
"restoreInProgress": "Another restore is already in progress",
"noFileProvided": "No file provided",
"fileTooLarge": "File too large (max 250MB)",
"failedToSaveUpload": "Failed to save uploaded file",
"invalidSqlDump": "Invalid SQL dump file",
"disallowedSql": "SQL file contains disallowed statements",
"failedToReadRestore": "Failed to read restore file",
"restoreFailed": "Database restore failed"
```

Note: `unauthorized` already exists. We can reuse `t('unauthorized')` for the DB actions too — no need for a separate key. Only add keys for strings that don't already have translations.

Revised list (only new keys needed):
```json
"missingDbConfig": "Missing database configuration",
"failedToWriteBackup": "Failed to write backup file",
"backupFailed": "Database backup failed",
"restoreInProgress": "Another restore is already in progress",
"noFileProvided": "No file provided",
"fileTooLarge": "File too large (max 250MB)",
"failedToSaveUpload": "Failed to save uploaded file",
"invalidSqlDump": "Invalid SQL dump file",
"disallowedSql": "SQL file contains disallowed statements",
"failedToReadRestore": "Failed to read restore file",
"restoreFailed": "Database restore failed"
```

The `mysqldump exited with code ${code}` and `mysql restore exited with code ${code}` strings are dynamic. Add a template key:
```json
"backupExitedWithCode": "Backup exited with code {code}",
"restoreExitedWithCode": "Restore exited with code {code}"
```

### Step 2: Add translation keys to `ko.json` under `serverActions`

Add corresponding Korean translations for all new keys.

### Step 3: Update `db-actions.ts` to use `getTranslations`

1. Import `getTranslations` from `next-intl/server`
2. In `exportImagesCsv()`:
   - Add `const t = await getTranslations('serverActions');` at top
   - Replace `'Unauthorized'` with `t('unauthorized')`
3. In `dumpDatabase()`:
   - Add `const t = await getTranslations('serverActions');` at top
   - Replace all hardcoded strings with `t()` calls
   - For Promise callbacks, use the closure-captured `t` variable
   - For `mysqldump exited with code ${code}`: use `t('backupExitedWithCode', { code })`
4. In `restoreDatabase()`:
   - Add `const t = await getTranslations('serverActions');` at top
   - Replace `'Unauthorized'` with `t('unauthorized')`
   - Pass `t` to `runRestore()`
5. In `runRestore()`:
   - Accept `t` as parameter (or re-fetch — but passing is cleaner since the caller already has it)
   - Replace all hardcoded strings with `t()` calls
   - For `mysql restore exited with code ${code}`: use `t('restoreExitedWithCode', { code })`

### Step 4: Verify build

Run `npm run build --workspace=apps/web` to ensure no compilation errors.

## Files Modified

- `apps/web/messages/en.json` — add ~13 keys to `serverActions`
- `apps/web/messages/ko.json` — add ~13 keys to `serverActions`
- `apps/web/src/app/[locale]/admin/db-actions.ts` — import getTranslations, replace ~15 hardcoded strings

## Testing

- Attempt DB backup with misconfigured DB — should show localized error
- Attempt DB restore without file — should show localized error
- Attempt DB restore with invalid file — should show localized error
- Switch language to Korean and verify all DB action errors appear in Korean
