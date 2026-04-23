# Cycle 3 Fresh Code Review

**Date:** 2026-04-22
**Reviewer:** general-purpose (deep manual sweep)
**Scope:** Full codebase review focusing on security, correctness, performance, and data safety

## Prior-cycle fixes verified

| Fix | Status | Notes |
|---|---|---|
| C2R-01: CREATE TABLE removed from SQL scanner | VERIFIED | `sql-restore-scan.ts` no longer blocks CREATE TABLE |
| C2R-02: Default-port normalization in hasTrustedSameOrigin | VERIFIED | `request-origin.ts` now has `stripDefaultPort()` |
| C2R-03: X-Content-Type-Options on health/live routes | VERIFIED | Both routes return `nosniff` header |
| C3R-01: Redundant group_concat_max_len SET | VERIFIED | Removed in commit `00000002f` |
| C3R-02: escapeCsvField missing C1 control stripping | VERIFIED | Fixed in commit `00000002f` |
| C12-01: Unicode tag slug mismatch | VERIFIED | Both write and read paths use `isValidTagSlug` with `\p{Letter}\p{Number}` — aligned |
| C12-03: Container health check uses DB-dependent endpoint | VERIFIED | `Dockerfile` now uses `/api/live` for HEALTHCHECK, `/api/health` for readiness |
| C12-04: Default-port normalization in hasTrustedSameOrigin | VERIFIED | `stripDefaultPort()` handles `:443`/`:80` |

## New Findings

| ID | Severity | Confidence | Finding | Primary citations |
|---|---|---|---|---|
| C3-01 | MEDIUM | High | `searchImages` in data.ts runs 3 sequential DB queries (main, tags, aliases) even when the first query already returns `effectiveLimit` results. This wastes DB connections and adds latency on popular search terms. Short-circuiting after the first query returns enough results would avoid unnecessary work. | `apps/web/src/lib/data.ts:682-763` |
| C3-02 | LOW | High | `deleteImageVariants` scans the full directory with `opendir` iteration even when `sizes` is provided and all variant filenames are deterministic. For directories with thousands of files, the `opendir` scan is O(n) when only O(|sizes|) known filenames need deletion. The scan is only needed for catching non-standard variant sizes from prior configs. | `apps/web/src/lib/process-image.ts:170-198` |

## Deferred Findings

| ID | Severity | Confidence | Reason deferred | Exit criterion |
|---|---|---|---|---|
| D3-01 | MEDIUM | High | `exportImagesCsv` loads up to 50K rows into memory then builds a CSV string; the `results = []` reassignment doesn't release memory because `csvLines` holds string references derived from `results`. Streaming would be better but current approach works for galleries under 30K images. | When gallery size exceeds 30K images or memory pressure is observed. |
| D3-02 | MEDIUM | High | Backup/restore still snapshots SQL only, not the filesystem-backed image corpus; fixing this safely requires a broader product/runtime contract than a bounded hardening pass. (Carried from C12-01.) | Product decision on image backup scope. |
