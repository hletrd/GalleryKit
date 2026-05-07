# Cycle 1 Aggregate Review (Updated 2026-04-22)

**Date:** 2026-04-22
**Scope:** Deep review after 46 prior cycles — focused on fresh findings beyond all prior aggregates

## Review agents

- code-reviewer (direct) — completed
- Prior cycle deferred items (D12-01 through D12-05, D44-P01 through D44-P04) — carried forward

## Confirmed new findings

| ID | Severity | Confidence | Finding | Primary citations |
|---|---|---|---|---|
| C1-03 | LOW | High | `parseExifDateTime` Date/number branches skip `isValidExifDateTimeParts` calendar validation — corrupted EXIF dates stored as Date/number objects bypass the calendar-date guard | `apps/web/src/lib/process-image.ts` lines 136-144 |
| C1-04 | MEDIUM | High | `seo_og_image_url` allows arbitrary external URLs in OG meta tags — admin can set tracker/malicious URLs rendered in every public page's `<meta og:image>` | `apps/web/src/app/actions/seo.ts` lines 94-103 |
| C1-06 | LOW | Medium | `exportImagesCsv` GROUP_CONCAT truncation at default `group_concat_max_len` (1024 bytes) — images with many tags get silently truncated tag lists in CSV export | `apps/web/src/app/[locale]/admin/db-actions.ts` lines 41-99 |
| C1-07 | LOW | Medium | Rate-limit rollback on unexpected login error uses delete instead of decrement — concurrent rollbacks under-count, allowing retry bursts | `apps/web/src/app/actions/auth.ts` lines 226-238 |

## Previously deferred items still valid

All previously deferred items from cycles 12-46 remain deferred with no change in status:
- D12-01: Backup/restore filesystem corpus (HIGH) — still deferred
- D12-02: Historical secret rotation (HIGH) — still deferred
- D12-03: Process-local state / multi-instance (MEDIUM) — still deferred
- D12-04: Public health endpoint exposure (LOW) — still deferred
- D12-05: Missing test surface (MEDIUM) — still deferred
- D44-P01: Rate-limit Map consolidation (LOW) — still deferred
- D44-P02: Upload→process→serve integration test (LOW) — still deferred
- D44-P03: escapeCsvField test (LOW) — still deferred
- D44-P04: getAdminTags query optimization (LOW) — still deferred

## Withdrawn findings

- C1-01: Withdrawn — `like(topics.label, searchTerm)` is already in the main search query's OR conditions.
- C1-02: Withdrawn — Already deferred as D12-03.
- C1-05: Withdrawn — Asymmetric validation is intentional and documented.

## Plan routing

- **Implement:** C1-03, C1-04, C1-06, C1-07
- **Carry forward deferred:** All previously deferred items unchanged
