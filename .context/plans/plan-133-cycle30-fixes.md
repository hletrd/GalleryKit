# Plan 133 — Cycle 30 Fixes (C30-01, C30-02, C30-03)

**Created:** 2026-04-19 (Cycle 30)
**Status:** DONE
**Severity:** 1 MEDIUM, 2 LOW

---

## C30-01: `updateGallerySettings` validates on unsanitized input [MEDIUM] [HIGH confidence]

- **File:** `apps/web/src/app/actions/settings.ts` lines 48-55 vs 61
- **Problem:** Validation runs on `trimmedValue` (raw input), then `stripControlChars` is applied inside the transaction. Same bug pattern as C29-09 (SEO settings). Control characters could pass validation then get silently stripped, causing mismatch between validated and stored values.
- **Fix:** Move `stripControlChars` before `isValidSettingValue`. Sanitize first, validate the sanitized value — matching the `seo.ts` pattern.
- **Implementation:**
  1. In `updateGallerySettings`, replace the validation loop (lines 48-55) to sanitize before validating:
     ```ts
     const sanitizedSettings: Record<string, string> = {};
     for (const [key, value] of Object.entries(settings)) {
         const sanitizedValue = stripControlChars(value.trim()) ?? '';
         if (!sanitizedValue) continue; // Empty means "use default" — will be deleted
         if (!isValidSettingValue(key as GallerySettingKey, sanitizedValue)) {
             return { error: t('invalidSettingValue', { key }) };
         }
         sanitizedSettings[key] = sanitizedValue;
     }
     ```
  2. In the transaction, iterate over `sanitizedSettings` instead of `settings` and use the pre-sanitized values directly (no need to call `stripControlChars` again).
  3. Remove the duplicate `stripControlChars` call from inside the transaction.

---

## C30-02: `db-actions.ts` passes `HOME` env var to child processes [LOW] [MEDIUM confidence]

- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 120, 312
- **Problem:** Both `dumpDatabase` and `restoreDatabase` pass `HOME: process.env.HOME` to mysqldump/mysql child processes. This allows `~/.my.cnf` to override connection parameters set via `MYSQL_*` env vars.
- **Fix:** Remove `HOME` from the child process env. The `MYSQL_PWD`, `MYSQL_USER`, `MYSQL_HOST`, and `MYSQL_TCP_PORT` env vars are sufficient for authentication.
- **Implementation:**
  1. In `dumpDatabase` (line 120), remove `HOME: process.env.HOME,` from the env object.
  2. In `restoreDatabase` (line 312), remove `HOME: process.env.HOME,` from the env object.

---

## C30-03: `stripControlChars` does not strip tab, newline, carriage return [LOW] [MEDIUM confidence]

- **File:** `apps/web/src/lib/sanitize.ts` line 8
- **Problem:** The regex `/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g` skips `\x09` (tab), `\x0A` (newline), and `\x0D` (carriage return). These C0 control characters pass through and could cause display issues in SEO titles, tag names, and other short-text fields.
- **Fix:** Extend the regex to `/[\x00-\x1F\x7F]/g` — strips all C0 control characters (0x00-0x1F) plus DEL (0x7F).
- **Implementation:**
  1. Change line 8 from:
     ```ts
     return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
     ```
     to:
     ```ts
     return s.replace(/[\x00-\x1F\x7F]/g, '');
     ```
  2. Update the function JSDoc to note that all C0 control characters and DEL are stripped.
  3. Verify no test relies on tabs/newlines being preserved (check `validation.test.ts` and `base56.test.ts`).

---

## Implementation Order

1. C30-01 (MEDIUM) — settings.ts sanitize-before-validate
2. C30-03 (LOW) — stripControlChars extended regex
3. C30-02 (LOW) — db-actions.ts remove HOME env

Each fix gets its own commit.

---

## Not In Scope (Deferred)

See Plan 134 (deferred carry-forward) for items not addressed this cycle.
