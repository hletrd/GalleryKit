# Implementation Plan — Cycle 2 Fresh Fixes

## Plan A: Fix CREATE TABLE blocking in SQL restore scanner (C2R-01)

### A1: Remove CREATE TABLE from dangerous SQL patterns
- File: `apps/web/src/lib/sql-restore-scan.ts`
- The `CREATE TABLE` pattern was added in a prior cycle to prevent schema manipulation, but standard mysqldump output always includes CREATE TABLE statements for the database's own tables. This makes the restore feature completely non-functional.
- Remove the `/\bCREATE\s+TABLE\b/i` entry from `DANGEROUS_SQL_PATTERNS`.
- The scanner already blocks `DROP DATABASE`, `GRANT`, `CREATE TRIGGER/FUNCTION/PROCEDURE/EVENT/VIEW`, `RENAME TABLE`, and other dangerous DDL — those are sufficient for preventing schema manipulation attacks without blocking the standard mysqldump format.
- The `--one-database` flag on the mysql restore command already constrains the restore to the gallery database only.

## Plan B: Fix hasTrustedSameOrigin default-port mismatch (C2R-02)

### B1: Normalize default ports in getExpectedOrigin
- File: `apps/web/src/lib/request-origin.ts`
- Add a helper function `stripDefaultPort(host: string): string` that removes `:80` from HTTP hosts and `:443` from HTTPS hosts before comparison.
- Apply this normalization in `getExpectedOrigin()` before constructing the origin string.
- Apply the same normalization in `toOrigin()` when comparing origin URLs.
- This ensures `X-Forwarded-Host: example.com:443` matches browser `Origin: https://example.com`.

## Plan C: Add X-Content-Type-Options to health/live routes (C2R-03)

### C1: Add nosniff header to /api/health and /api/live responses
- File: `apps/web/src/app/api/health/route.ts`
- File: `apps/web/src/app/api/live/route.ts`
- Add `'X-Content-Type-Options': 'nosniff'` to the JSON response headers.
- Consistent with serve-upload.ts and backup download route patterns.
