# Security Reviewer — Cycle 43 (2026-04-20)

## Findings

### S43-01: `dumpDatabase` and `restoreDatabase` pass LANG/LC_ALL to child processes — potential locale-based behavior variation [LOW] [HIGH confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 120, 312
The explicit env objects for `mysqldump` and `mysql` child processes include `LANG: process.env.LANG, LC_ALL: process.env.LC_ALL`. If the server locale uses a multi-byte charset (e.g., ja_JP.UTF-8), this could affect how mysqldump encodes string data in the backup. While not a direct security vulnerability, inconsistent locale settings between dump and restore could cause data corruption. The `HOME` env was already removed for security in commit 00000002b.
**Fix:** Set explicit locale `C.UTF-8` for deterministic behavior, matching the pattern of removing unnecessary env passthrough.

### S43-02: `processImageFormats` unlink-before-link race window on the base file [MEDIUM] [LOW confidence]
**File:** `apps/web/src/lib/process-image.ts` lines 378-396
The code uses atomic rename via `.tmp` file to write the base filename. However, between `fs.link(outputPath, tmpPath)` and `fs.rename(tmpPath, basePath)`, the base file doesn't exist yet (it's only at `.tmp`). If a concurrent request tries to serve the base file during this window, it gets a 404. This is already noted as CR-39-02 in deferred items.
**Status:** Already deferred. No new finding.

### S43-03: `getImageByShareKey` and `getSharedGroup` do not rate-limit public access to share links [LOW] [MEDIUM confidence]
**File:** `apps/web/src/lib/data.ts` lines 432-550
The public share link routes (`/s/[key]` and `/g/[key]`) have no rate limiting on the data access queries themselves. While share key creation is rate-limited (sharing.ts), viewing shared content is not. An attacker with a valid share key could enumerate the key space and make many DB queries. However, base56 keys have 56^10 combinations, making brute-force impractical. The share key validation (`isBase56`) rejects obviously invalid keys early.
**Fix:** Low priority. The key space is large enough that brute-force is impractical. Could add per-IP rate limiting if abuse is observed.

### S43-04: `escapeCsvField` in db-actions.ts does not handle null bytes [LOW] [LOW confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 20-29
The `escapeCsvField` function strips `\r\n` and handles formula injection characters, but does not strip null bytes (`\x00`). If a title or description contains null bytes, they would appear in the CSV output, which could cause issues with some CSV parsers. The `stripControlChars` function in sanitize.ts strips `\x00-\x1F\x7F`, but it's not applied to CSV export data. Since data entering the DB should already be sanitized via `stripControlChars` in the upload/metadata update paths, this is defense-in-depth only.
**Fix:** Apply `stripControlChars` to CSV field values before escaping, or at minimum strip null bytes in `escapeCsvField`.

## Summary
1 LOW finding (locale env passthrough in child processes — same as C43-01), 1 LOW finding (CSV null byte handling), 1 LOW finding (share link view rate limiting). No HIGH or CRITICAL findings.
