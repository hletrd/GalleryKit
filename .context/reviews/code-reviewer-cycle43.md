# Code Reviewer — Cycle 43 (2026-04-20)

## Findings

### C43-01: `db-actions.ts` dumpDatabase spawns mysqldump with `LANG`/`LC_ALL` inherited from process env — potential locale injection [MEDIUM] [HIGH confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` line 120
The `spawn` call for `mysqldump` passes `LANG: process.env.LANG, LC_ALL: process.env.LC_ALL` from the parent process env. While the env object is explicitly constructed (not spread), passing through locale variables could cause mysqldump output encoding to change unexpectedly. The same pattern exists in the restore `spawn` at line 312. The `HOME` env was previously removed (commit 00000002b) for security, but locale vars were kept — this is inconsistent.
**Fix:** Remove `LANG` and `LC_ALL` from the explicit env object, or set them to `C.UTF-8` for deterministic output. This ensures consistent backup format regardless of server locale.

### C43-02: `getImage` prev/next navigation for NULL capture_date still uses `sql\`FALSE\`` for the "next" (older) direction [MEDIUM] [MEDIUM confidence]
**File:** `apps/web/src/lib/data.ts` lines 393-396
The "next" (older image) query for NULL capture_date uses `sql\`${images.capture_date} IS NOT NULL\`` as the first OR condition. In MySQL DESC sort, NULLs sort last, so for a NULL-dated image, there ARE no older images by capture_date — all dated images are "newer". But `sql\`FALSE\`` was the original code; the current code uses `sql\`${images.capture_date} IS NOT NULL\`` which would be `TRUE` when capture_date is NULL (since `images.capture_date` IS NULL, the template literal evaluates the column reference, not the JavaScript null). Wait — actually `image.capture_date` is the JS value (null), so `sql\`${images.capture_date} IS NOT NULL\`` becomes `sql\`NULL IS NOT NULL\`` which is `FALSE`. This is actually correct! Let me verify more carefully...

Actually, looking again at line 395: when `image.capture_date` is null, the ternary evaluates to `sql\`${images.capture_date} IS NOT NULL\``. But `image.capture_date` is null (the JS value), so this becomes `sql\`null IS NOT NULL\`` which Drizzle would render as `NULL IS NOT NULL` -> FALSE. This is CORRECT behavior for the "next" direction (no older images by date from a null-dated image). The prev direction (line 363) uses the same pattern where `sql\`${images.capture_date} IS NOT NULL\`` means "any image with a non-null date is newer" which is also correct. **No bug found here — this is working as intended.**

### C43-03: `updateImageMetadata` allows setting title/description to empty string after stripControlChars [LOW] [HIGH confidence]
**File:** `apps/web/src/app/actions/images.ts` lines 521-522
After `stripControlChars(title ? title.trim() : null)`, if the title was only control characters, `stripControlChars` returns an empty string. The `|| null` then converts it to null. This is correct behavior — but the description follows the same pattern. If a user intentionally sets description to a string of only control chars, it silently becomes null rather than being rejected as invalid input. This is a minor UX issue, not a security concern.
**Fix:** This is acceptable behavior. No fix needed.

### C43-04: `batchAddTags` existing image check is not inside the transaction [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/actions/tags.ts` lines 248-253
The `existingImages` query checks which image IDs still exist, but this happens outside the transaction at line 310. Between the check and the `INSERT IGNORE` inside the transaction, images could be deleted. The `INSERT IGNORE` handles this gracefully (FK constraint drops silently), but the function would report `existingIds.size` as the count in the audit log even if some images were actually skipped. This is a minor accuracy issue in audit logging, not a data integrity problem.
**Fix:** Move the existing image check inside the transaction, or adjust the audit log count based on actual affected rows.

### C43-05: `health` endpoint exposes DB reachability without authentication [LOW] [HIGH confidence]
**File:** `apps/web/src/app/api/health/route.ts`
The health endpoint at `/api/health` is unauthenticated and reveals whether the database is reachable. This is standard for health checks but could help attackers determine infrastructure status. Already noted as deferred (C32-04 / C30-08) in prior cycles.
**Status:** Already deferred. No new finding.

## Summary
1 new MEDIUM finding (locale env passthrough in mysqldump/mysql child processes), 1 LOW finding (audit log accuracy in batchAddTags). The NULL capture_date navigation issue from prior cycles was re-verified and found to be correctly implemented.
