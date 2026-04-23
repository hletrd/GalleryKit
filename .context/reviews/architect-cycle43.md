# Architect — Cycle 43 (2026-04-20)

## Findings

### A43-01: `db-actions.ts` child process env construction is inconsistent with security principle [MEDIUM] [HIGH confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 120, 312
The env objects for `mysqldump` and `mysql` child processes are explicitly constructed to minimize passthrough (only `PATH`, `NODE_ENV`, `MYSQL_*`, `LANG`, `LC_ALL`). The `HOME` variable was removed for security (commit 00000002b). However, `LANG` and `LC_ALL` remain, which creates inconsistency: the principle of "only pass what's needed" is violated. These locale variables should be explicitly set to a known value (`C.UTF-8`) rather than inherited, ensuring deterministic backup/restore behavior across different server configurations.
**Fix:** Replace `LANG: process.env.LANG, LC_ALL: process.env.LC_ALL` with `LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8'`.

### A43-02: Storage backend abstraction module exists but is not integrated — still deferred [INFO]
The storage backend module (`apps/web/src/lib/storage/`) provides Local, MinIO, and S3 backends, but actual file I/O in `process-image.ts` and `serve-upload.ts` still uses direct `fs` operations. This is already documented in `storage/index.ts` and deferred (AGG-6). No change.

### A43-03: Rate limit consolidation — status check [INFO]
The rate limit duplication across 6+ Maps (AGG-2) remains deferred. Plan-142 was created for this. No change in status.

## Summary
1 MEDIUM finding (LANG/LC_ALL env inconsistency — same as C43-01). All previously identified architectural issues remain deferred with no change.
