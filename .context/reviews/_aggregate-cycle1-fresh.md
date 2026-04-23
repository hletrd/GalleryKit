# Cycle 1 Fresh Aggregate Review (2026-04-22)

**Date:** 2026-04-22
**Scope:** Fresh deep review — cycle 1 of new loop

## Review agents

- code-reviewer (direct) — completed
- Previously deferred items carried forward

## New findings to implement

| ID | Severity | Confidence | Finding | Primary citations |
|---|---|---|---|---|
| C1-03 | LOW | High | `parseExifDateTime` Date/number branches skip `isValidExifDateTimeParts` calendar validation — corrupted EXIF dates stored as Date/number objects bypass the calendar-date guard | `apps/web/src/lib/process-image.ts` lines 136-144 |
| C1-04 | MEDIUM | High | `seo_og_image_url` allows arbitrary external URLs in OG meta tags — admin can set tracker/malicious URLs rendered in every public page's `<meta og:image>` | `apps/web/src/app/actions/seo.ts` lines 94-103 |
| C1-06 | LOW | Medium | `exportImagesCsv` GROUP_CONCAT truncation at default `group_concat_max_len` (1024 bytes) — images with many tags get silently truncated tag lists in CSV export | `apps/web/src/app/[locale]/admin/db-actions.ts` lines 41-99 |
| C1-07 | LOW | Medium | Rate-limit rollback on unexpected login error uses delete instead of decrement — concurrent rollbacks under-count, allowing retry bursts | `apps/web/src/app/actions/auth.ts` lines 226-238 |

## Previously deferred items still valid

All previously deferred items from cycles 12-46 remain deferred with no change in status:
- D12-01: Backup/restore filesystem corpus (HIGH)
- D12-02: Historical secret rotation (HIGH)
- D12-03: Process-local state / multi-instance (MEDIUM)
- D12-04: Public health endpoint exposure (LOW)
- D12-05: Missing test surface (MEDIUM)
- D44-P01: Rate-limit Map consolidation (LOW)
- D44-P02: Upload→process→serve integration test (LOW)
- D44-P03: escapeCsvField test (LOW)
- D44-P04: getAdminTags query optimization (LOW)

## Plan routing

- **Implement:** C1-03, C1-04, C1-06, C1-07
- **Carry forward deferred:** All previously deferred items unchanged
