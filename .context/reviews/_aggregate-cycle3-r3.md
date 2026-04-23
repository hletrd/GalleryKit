# Cycle 3 Fresh Aggregate Review

**Date:** 2026-04-23
**Scope:** review-plan-fix cycle 3 (fresh start)

## Review fan-out summary

Completed specialist notes this cycle:
- Deep manual codebase sweep (all action modules, core lib modules, DB schema, API routes, middleware, Dockerfile, security-critical paths)

## Confirmed findings

| ID | Severity | Confidence | Signals | Finding | Primary citations |
|---|---|---|---|---|---|
| C3R-01 | MEDIUM | High | manual sweep | `exportImagesCsv` calls `SET SESSION group_concat_max_len = 10000` which is redundant (pool already sets 65535 on every connection) and counter-productive (downgrades from 65535 to 10000). In a pooled environment, the SET SESSION may also apply to a different connection than the subsequent SELECT. | `apps/web/src/app/[locale]/admin/db-actions.ts:54`, `apps/web/src/db/index.ts:28-30` |
| C3R-02 | LOW | High | manual sweep | `escapeCsvField` strips C0/DEL but not C1 controls (0x80-0x9F), unlike `stripControlChars` in `sanitize.ts` which strips all. C1 controls in CSV values could cause display issues. | `apps/web/src/app/[locale]/admin/db-actions.ts:30`, `apps/web/src/lib/sanitize.ts:6-8` |

## Deferred / operational findings

| ID | Severity | Confidence | Reason deferred this cycle | Primary citations |
|---|---|---|---|---|
| D3R-01 | MEDIUM | High | `exportImagesCsv` loads up to 50K rows into memory; streaming would be better but works for galleries under 30K images. Carried from cycle 2. | `apps/web/src/app/[locale]/admin/db-actions.ts:56-98` |

## Plan routing

- **Implement:** C3R-01, C3R-02

## Aggregate conclusion

The highest-value bounded cycle-3 work is removing the redundant `SET SESSION group_concat_max_len` that actually downgrades the pool's already-configured limit, and aligning the CSV export's control-character stripping with the project's canonical `stripControlChars` utility.
