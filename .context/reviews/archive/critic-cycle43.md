# Critic — Cycle 43 (2026-04-20)

## Findings

### CR43-01: `db-actions.ts` child process env inconsistency — HOME removed but LANG/LC_ALL kept [MEDIUM] [HIGH confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 120, 312
Commit 00000002b removed `HOME` from the child process env for security (preventing mysql from reading `~/.my.cnf`). However, `LANG` and `LC_ALL` are still passed through from the parent process. These aren't security risks in the same way as HOME, but they create non-deterministic behavior: the same backup/restore operation could produce different results depending on the server's locale settings. For a backup tool, deterministic output is important.
**Fix:** Replace `LANG: process.env.LANG, LC_ALL: process.env.LC_ALL` with `LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8'` for deterministic mysqldump/mysql behavior.

### CR43-02: `escapeCsvField` in db-actions.ts could be more robust against control characters [LOW] [HIGH confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 20-29
The CSV escaping function handles `\r\n` and formula injection, but data reaching this function from the DB may still contain other control characters (tab, null bytes, etc.) if they were stored before the `stripControlChars` sanitization was added. While all current write paths apply `stripControlChars`, legacy data could contain these characters. The CSV export should defensively strip control characters as a safety net.
**Fix:** Apply a regex like `/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g` to strip control characters (except the already-handled `\r\n`) from CSV field values before the existing escape logic.

### CR43-03: `photo-viewer.tsx` Histogram component receives potentially null imageUrl when image has no jpeg [LOW] [LOW confidence]
**File:** `apps/web/src/components/photo-viewer.tsx` lines 484-491
The `Histogram` component receives `imageUrl(...)` based on `image.filename_jpeg`, but only renders when `image.filename_jpeg` is truthy (line 484). So this is guarded. However, the `findNearestImageSize` function could return a size that doesn't exist if the `imageSizes` array is empty or contains unusual values. The function has fallback logic in `gallery-config-shared.ts`, so this is very low risk.
**Status:** No actionable finding.

## Summary
1 MEDIUM finding (LANG/LC_ALL passthrough inconsistency with HOME removal — same as C43-01/S43-01), 1 LOW finding (CSV control character defense-in-depth).
