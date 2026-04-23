# Cycle 2 Fresh Code Review

**Date:** 2026-04-23
**Reviewer:** general-purpose (deep manual sweep)
**Scope:** Full codebase review focusing on security, correctness, and data safety

## New Findings

| ID | Severity | Confidence | Finding | Primary citations |
|---|---|---|---|---|
| C2R-01 | HIGH | High | `CREATE TABLE` pattern in SQL restore scanner blocks all legitimate mysqldump restores. Standard mysqldump output includes `CREATE TABLE` statements for the gallery's own tables, so any attempt to restore a backup will be rejected with "disallowed SQL". This makes the restore feature non-functional. | `apps/web/src/lib/sql-restore-scan.ts:24`, `apps/web/src/app/[locale]/admin/db-actions.ts:343` |
| C2R-02 | HIGH | High | `hasTrustedSameOrigin` default-port mismatch. When a reverse proxy sends `X-Forwarded-Host: example.com:443` but the browser's `Origin` header is `https://example.com` (without `:443`), the comparison fails because `new URL()` normalizes away default ports but `toOrigin(protocol + '://' + host)` preserves them. Legitimate same-origin login requests are rejected behind common proxies. | `apps/web/src/lib/request-origin.ts:14-26` |
| C2R-03 | MEDIUM | High | `/api/health` and `/api/live` responses lack `X-Content-Type-Options: nosniff` header, inconsistent with other routes (serve-upload, backup download) that include it. | `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts` |

## Deferred Findings

| ID | Severity | Confidence | Reason deferred | Exit criterion |
|---|---|---|---|---|
| D2R-01 | MEDIUM | High | `exportImagesCsv` loads up to 50K rows into memory then builds a CSV string; the `results = []` reassignment on line 95 doesn't release memory because `csvLines` holds string references derived from `results`. Streaming would be better but current approach works for galleries under 30K images. | When gallery size exceeds 30K images or memory pressure is observed. |
| D2R-02 | MEDIUM | High | `searchImages` runs 3 sequential DB queries (main, tag, alias) when the first two could run in parallel. The third (alias) is dependent on de-duplication from the first two. | When search latency becomes a user-facing issue. |
