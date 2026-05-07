# Cycle 3 (Iteration 3) Fresh Code Review

**Date:** 2026-04-22
**Reviewer:** general-purpose (deep manual sweep)
**Scope:** Full codebase review — all action modules, core lib modules, API routes, middleware, security-critical paths

## Prior-cycle fixes verified

| Fix | Status | Notes |
|---|---|---|
| C3R-01: Redundant group_concat_max_len SET removed | VERIFIED | `db-actions.ts` no longer has the SET SESSION line; comment explains pool handles it |
| C3R-02: escapeCsvField C1 control stripping | VERIFIED | `db-actions.ts:30` regex includes `\x7F-\x9F` range |
| C3-01: searchImages short-circuit when main query fills limit | VERIFIED | `data.ts:698-703` returns early when `results.length >= effectiveLimit` |
| C3-02: deleteImageVariants skips opendir when sizes known | VERIFIED | `process-image.ts:183` gates opendir behind `!sizes \|\| sizes.length === 0` |
| C12-01: Unicode tag slug mismatch | VERIFIED | Both write and read paths use `isValidTagSlug` with `\p{Letter}\p{Number}` |
| C12-03: Container health check uses DB-independent endpoint | VERIFIED | `Dockerfile` uses `/api/live` for HEALTHCHECK |
| C12-04: Default-port normalization in hasTrustedSameOrigin | VERIFIED | `stripDefaultPort()` handles `:443`/`:80` |

## New Findings

None found. The codebase is in excellent shape after 12+ prior hardening cycles. All modules reviewed:

- **auth.ts**: Argon2id + dummy hash timing-safe, pre-increment rate limits, session fixation prevention, TOCTOU-safe conditional UPDATE on share key revoke, same-origin check with port normalization
- **images.ts**: File streaming, upload tracker with pre-increment, disk space pre-check, stripControlChars before validation, deterministic deleteImageVariants, transactional batch delete
- **topics.ts**: stripControlChars before validation, TOCTOU-safe create (catch ER_DUP_ENTRY), transactional slug rename, reserved route segment check
- **tags.ts**: stripControlChars before validation, isValidTagSlug enforced, INSERT IGNORE for concurrent tag creation, transactional delete
- **sharing.ts**: Atomic conditional UPDATE for share key, pre-increment rate limits, DB-backed check with in-memory fallback, rollback on DB excess
- **public.ts**: searchImages short-circuit, stripControlChars + length validation, deep pagination cap (offset > 10000), tag array cap (20)
- **admin-users.ts**: Advisory lock for last-admin deletion guard, pre-increment rate limits
- **seo.ts**: stripControlChars before length validation, OG URL origin validation, allowed-key whitelist
- **db-actions.ts**: Streaming backup via pipe, no credential exposure in /proc/cmdline (MYSQL_PWD env var), SQL restore scanner with dangerous pattern detection, C1 control stripping in CSV
- **proxy.ts**: Cookie format check + redirect, API routes excluded (must self-auth)
- **session.ts**: HMAC-SHA256 + timingSafeEqual, production requires SESSION_SECRET env var, DB-fallback only in dev
- **request-origin.ts**: Default-port normalization, Origin/Referer fallback chain
- **process-image.ts**: Deterministic deleteImageVariants, atomic rename via .tmp, ICC bounds checks, EXIF calendar validation
- **image-queue.ts**: Advisory lock per job, claim retries with escalation, conditional UPDATE (processed=false), orphaned .tmp cleanup
- **api/auth**: withAdminAuth wrapper for all /api/admin/* routes, symlink rejection + realpath containment in download route
- **exif-datetime.ts**: Calendar validation with round-trip Date check, 1900-2100 year range

All previously identified patterns (control char sanitization before validation, TOCTOU-safe pre-increment, transactional multi-table mutations, path traversal prevention, privacy field omission in publicSelectFields) are consistently applied across all modules.

## Deferred Findings

| ID | Severity | Confidence | Reason deferred | Exit criterion |
|---|---|---|---|---|
| D3C3-01 | MEDIUM | High | `exportImagesCsv` loads up to 50K rows into memory; streaming would be better but works for galleries under 30K images. Carried from cycle 2. | When gallery size exceeds 30K images or memory pressure is observed. |
| D3C3-02 | MEDIUM | High | Backup/restore still snapshots SQL only, not the filesystem-backed image corpus; fixing this safely requires a broader product/runtime contract than a bounded hardening pass. Carried from C12-01. | Product decision on image backup scope. |
| D3C3-03 | MEDIUM | High | Restore maintenance, view count buffer, and several counters/queues remain process-local; a robust multi-instance fix is larger architectural work. Carried from D12-03. | Multi-instance deployment requirement. |
