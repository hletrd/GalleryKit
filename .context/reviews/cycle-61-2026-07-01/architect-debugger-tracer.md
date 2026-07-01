# Cycle 61 Architect / Debugger / Tracer Review

Traced upload to process to DB to render, admin mutations and restore/maintenance state, queue/backfill flows, semantic search, OG generation, sharing, and analytics at HEAD `7e85644e`.

## Findings

### C61-01 - OG routes bypass restore-maintenance

- Severity: Medium
- Confidence: High
- File/line: `apps/web/src/app/[locale]/admin/db-actions.ts:452`, `apps/web/src/app/[locale]/admin/db-actions.ts:493`, `apps/web/src/__tests__/cycle-28-source-contracts.test.ts:27`, `apps/web/src/app/api/og/route.tsx:92`, `apps/web/src/app/api/og/photo/[id]/route.tsx:59`
- Problem: Public DB-backed pages and semantic routes short-circuit during restore maintenance, but `/api/og` and `/api/og/photo/[id]` can still do DB/config/image work during the restore window.
- Failure scenario: social crawlers or clients hit OG endpoints while tables are importing/reconciling, producing noisy failures and avoidable DB/Satori/Sharp load instead of a clean maintenance response.
- Fix: add `isRestoreMaintenanceActive()` guards to both OG route handlers before rate-limit charging and before DB/config/image work, returning `503` with no-store headers; add focused tests.

### C61-02 - Lightroom upload can query topic DB after restore starts but before the upload contract lock

- Severity: Low
- Confidence: Medium-High
- File/line: `apps/web/src/app/api/admin/lr/upload/route.ts:94`, `apps/web/src/app/api/admin/lr/upload/route.ts:256`, `apps/web/src/app/api/admin/lr/upload/route.ts:279`, `apps/web/src/app/[locale]/admin/db-actions.ts:400`
- Problem: The PAT upload route checks restore maintenance at entry, then parses multipart and validates fields. It verifies the topic with a DB `SELECT` before acquiring the upload-processing contract lock that restore/settings changes use.
- Failure scenario: a large PAT upload starts before restore, spends time parsing, then restore begins; the route can still query the DB before the lock rejects it, surfacing a generic upload error instead of restore-in-progress and violating the no-DB-work maintenance posture.
- Fix: after multipart/field validation, re-check maintenance and acquire the upload-processing contract lock before the topic `SELECT`; keep post-save cleanup.

## Rejected Hypotheses

- Browser upload quota TOCTOU: rejected; the browser path preclaims before awaited work and settles rollback/success paths.
- Delete-during-processing orphaned derivatives: rejected; queue conditional updates and delete cleanup handle the race.
- Restore leaves queue paused: rejected; restore quiesces, drains, clears, and resumes/bootstrap after verified restore.
- Share-key races: rejected; conditional update and collision/re-fetch logic are present.
- Semantic stub/prod coupling: rejected; text and similar routes gate modes separately.
- Analytics writes during restore: rejected; public actions and background DB writes re-check maintenance.
