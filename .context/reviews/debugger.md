# Cycle 27 Debugger Review

Review target: `/Users/hletrd/flash-shared/gallery`
Review role: `cycle-27 debugger`
HEAD reviewed: `1e8bba02`
Mode: review-only. App source was not edited. This file is the only intended write.

## Inventory

Required context read first:

- AGENTS.md instructions provided in the user prompt
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`
- Current and prior review state: `.context/reviews/_aggregate.md`, `.context/reviews/debugger.md`, `.context/reviews/code-reviewer.md`, `.context/reviews/security-reviewer.md`
- Deferred history: `.context/plans/cycle-26-2026-06-30-deferred.md`

Inventory evidence:

- Focused tracked runtime/deploy/migration files inventoried with `rg --files`: 580 files across `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, deploy/Docker/nginx configs, and related tests.
- Working tree already had unrelated review-file changes before this write: `.context/reviews/perf-reviewer.md` and `.context/reviews/security-reviewer.md`. I did not modify those.
- Current delta since cycle-26 review start (`d13d6637..HEAD`) includes restore recovery, modal tree isolation, SQL scanner changes, route tests, deploy documentation, and review artifacts.

Reviewed debugger surfaces:

- Restore/import lifecycle: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/scripts/restore-maintenance-recovery.ts`.
- SQL scanning: `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/__tests__/sql-restore-scan.test.ts`, restore scan/import call sites.
- Migration/deploy: `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`.
- Auth/session/rate limits: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, admin API wrappers through related current review context.
- Upload/image processing: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/upload-tracker*.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`.
- Analytics/rate limits: `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/analytics.ts`, `apps/web/src/lib/analytics-data.ts`, view-retention/queue interactions.
- UI modal/focus: `apps/web/src/components/use-modal-tree-isolation.ts`, `apps/web/src/components/search.tsx`, `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/ui/dropdown-menu.tsx`.

Validation evidence:

- Direct scanner probe with `npx tsx` showed `containsDangerousSql(...) === false` for:
  - `INSERT HIGH_PRIORITY INTO otherdb.images VALUES (1);`
  - `INSERT LOW_PRIORITY INTO otherdb.images VALUES (1);`
  - `INSERT DELAYED INTO otherdb.images VALUES (1);`
  - `INSERT otherdb.images VALUES (1);`
  - `CREATE TEMPORARY TABLE images (id int);`
  - `DROP TEMPORARY TABLE images;`
- `npm test --workspace=apps/web -- sql-restore-scan restore-maintenance cycle-26-source-contracts`: passed, 3 files / 30 tests. Existing tests do not catch the confirmed scanner gaps.

## Confirmed Issues

### DBG27-01 - Restore SQL scanner misses legal MySQL INSERT target forms

Severity: Medium
Confidence: High
Regions: `apps/web/src/lib/sql-restore-scan.ts:39-55`, `apps/web/src/lib/sql-restore-scan.ts:190-221`, `apps/web/src/app/[locale]/admin/db-actions.ts:618-647`, `apps/web/src/app/[locale]/admin/db-actions.ts:672-678`, `apps/web/src/__tests__/sql-restore-scan.test.ts:53-95`

Failure scenario:
The restore path streams the uploaded dump to disk, scans chunks with `containsDangerousSql()`, and only then pipes the file to `mysql --one-database` (`db-actions.ts:618-647`, `672-678`). The scanner's write-target regex only recognizes `INSERT` when it appears as `INSERT [IGNORE] INTO target` (`sql-restore-scan.ts:40-53`). MySQL accepts other forms, including `INSERT HIGH_PRIORITY INTO ...`, `INSERT LOW_PRIORITY INTO ...`, `INSERT DELAYED INTO ...`, and `INSERT tbl_name ...` without `INTO`. Those statements do not match the target allowlist and are not caught by the dangerous SQL denylist (`sql-restore-scan.ts:57-123`, `212-221`).

An admin or compromised admin session can upload a dump containing `INSERT HIGH_PRIORITY INTO otherdb.images VALUES (...)`. The scanner returns false, and on an overprivileged/co-hosted MySQL account the import can write outside the GalleryKit schema. The security reviewer correctly notes least-privilege DB grants reduce blast radius, but the application scanner is intended to be an independent gate.

Suggested fix:
Replace the broad regex with a small statement-head tokenizer, or explicitly cover MySQL's legal grammar:

- `INSERT [LOW_PRIORITY | DELAYED | HIGH_PRIORITY] [IGNORE] [INTO] target`
- `REPLACE [LOW_PRIORITY | DELAYED] [INTO] target`
- Any schema-qualified target should remain rejected.

Add regression tests for schema-qualified INSERTs with each modifier and for the no-`INTO` form.

### DBG27-02 - Restore scanner accepts temporary app-table DDL

Severity: Medium
Confidence: Medium-High
Regions: `apps/web/src/lib/sql-restore-scan.ts:42-47`, `apps/web/src/lib/sql-restore-scan.ts:190-206`, `apps/web/src/__tests__/sql-restore-scan.test.ts:31-51`

Failure scenario:
`SQL_WRITE_TARGET_PATTERN` explicitly allows `CREATE TEMPORARY TABLE`, and the target allowlist accepts it when the target name is an app table (`sql-restore-scan.ts:42-47`, `190-206`). The tests also currently assert `DROP TEMPORARY TABLE images` is allowed (`sql-restore-scan.test.ts:43-50`). The app's own `mysqldump` restore shape does not need temporary app tables.

A crafted restore can create a temporary `images` table in the same MySQL session, route later inserts to the temporary object, and lose those rows when the session exits. Depending on statement order, the restore may appear to run and then leave missing/empty permanent data, or fail in post-restore reconciliation while durable maintenance remains active. The scanner should reject this non-backup shape before import.

Suggested fix:
Reject `CREATE TEMPORARY TABLE` and `DROP TEMPORARY TABLE` unless a future app-generated backup deliberately emits them. Keep the allowed restore profile narrow: `DROP TABLE IF EXISTS` for known app tables, permanent `CREATE TABLE`, app-table `ALTER`, and app-table row writes. Add tests asserting temporary app-table creates/drops are dangerous.

## Likely Issues

None beyond the confirmed scanner defects met the bar for likely new debugger findings after checking the current fixes and deferred list.

## Risks / Manual Validation

### DBG27-RISK-01 - Portaled dropdown content inside custom modals may escape modal isolation

Severity: Low-Medium
Confidence: Medium
Regions: `apps/web/src/components/use-modal-tree-isolation.ts:19-65`, `apps/web/src/components/info-bottom-sheet.tsx:52-58`, `apps/web/src/components/info-bottom-sheet.tsx:178-240`, `apps/web/src/components/info-bottom-sheet.tsx:509-530`, `apps/web/src/components/ui/dropdown-menu.tsx:34-50`, `apps/web/src/components/photo-viewer.tsx:934-972`

Manual validation scenario:
The cycle-26 custom modal isolation fix hides/inerts siblings that exist when the modal opens (`use-modal-tree-isolation.ts:19-65`). Radix dropdown content portals later to `document.body` by default (`dropdown-menu.tsx:34-50`). The mobile info bottom sheet uses the isolation hook and `FocusTrap` (`info-bottom-sheet.tsx:52-58`, `178-240`) and contains the same wide-gamut download dropdown pattern used in the photo viewer (`info-bottom-sheet.tsx:509-530`, `photo-viewer.tsx:934-972`). If the dropdown portal is added after the isolation walk, it may sit outside both the modal root and the focus trap.

Validate on a mobile viewport with a wide-gamut image that has JPEG and AVIF downloads: open the info sheet, expand it, open the download dropdown, then test keyboard traversal and screen-reader accessibility tree. Confirm dropdown items are reachable and background content remains inert/hidden.

Suggested fix if reproduced:
Render dropdown portals into a container inside the modal root, or move the custom bottom sheet/lightbox/search surfaces to Radix modal primitives that coordinate portals and aria isolation. Add a browser/a11y regression for the bottom-sheet download dropdown.

### DBG27-RISK-02 - Restore recovery CLI is local-only and should be operationally rehearsed

Severity: Low-Medium
Confidence: Medium
Regions: `apps/web/src/lib/restore-maintenance-durable.ts:80-103`, `apps/web/scripts/restore-maintenance-recovery.ts:7-41`, `apps/web/src/app/actions/auth.ts:74-79`, `apps/web/src/app/[locale]/admin/db-actions.ts:684-744`

Manual validation scenario:
Cycle 26's "no recovery path" issue is materially improved: marker write failure now unwinds process state (`restore-maintenance-durable.ts:80-90`), marker clear runs process cleanup in `finally` (`restore-maintenance-durable.ts:93-99`), and `npm run restore:maintenance -- clear --confirm-clear-restore-maintenance` exists (`restore-maintenance-recovery.ts:7-41`). However, failed import/post-restore migration still intentionally keeps maintenance active (`db-actions.ts:684-744`), and login remains blocked during maintenance (`auth.ts:74-79`).

This is acceptable only if operators can reach the host/container and know the recovery command during an incident. Rehearse the documented command in a non-production clone: force a failed import, verify login is blocked, run `status`, run confirmed `clear`, and verify uploads/queue resume behavior. If operators need browser-only recovery, add a narrow recovery endpoint with a separate credential.

## Known Deferred / Not Re-Filed As New

- Fire-and-forget analytics writes can cross the restore boundary: still visible in `apps/web/src/app/actions/public.ts:416-437`, `443-469`, `475-505`; restore drains shared-group count buffers and the image queue but not these insert promises at `apps/web/src/app/[locale]/admin/db-actions.ts:491-504`. This is already carried as `.context/plans/cycle-26-2026-06-30-deferred.md:D26-02`, with the project accepting approximate analytics unless row-level analytics become audit-grade.
- Upload-processing contract lock spans slow upload I/O/CPU: still intentionally conservative in `apps/web/src/app/actions/images.ts:175-182` and `apps/web/src/app/api/admin/lr/upload/route.ts:243-259`; carried as deferred throughput work in `D26-06`.
- GPS stripping buffers originals into memory in `apps/web/src/lib/process-image.ts:1737-1763`; carried as deferred memory/format-parser work in `D26-05`.
- 2FA/WebAuthn and paid-download/Stripe were not reviewed as defects because `CLAUDE.md` marks them permanently deferred/non-goals.

## Refuted / Fixed Current-HEAD Hypotheses

- Restore durable marker lifecycle wedge from cycle 26: fixed enough not to re-file. `beginDurableRestoreMaintenance()` now calls `endRestoreMaintenance()` if marker write fails (`restore-maintenance-durable.ts:80-88`), and `endDurableRestoreMaintenance()` clears process state even if marker unlink throws (`restore-maintenance-durable.ts:93-99`).
- No restore recovery path: improved by `apps/web/scripts/restore-maintenance-recovery.ts:7-41` and `apps/web/package.json:20`. It remains an operational/manual-validation risk, not the same confirmed app-code blocker.
- Deploy prune-before-health incident: current `apps/web/deploy.sh:34-54` waits for Docker health or `/api/live` and exits before prune on failure; prune runs after health at `deploy.sh:76-80`.
- Migration silent-skip class: current `apps/web/scripts/migrate.js:748-808` reconciles/baselines by journal hash and asserts every committed migration hash is recorded; source tripwires cover reconcile table/column/index mirrors in `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:76-173`.
- Upload/restore interleaving: browser and Lightroom upload paths hold the upload-processing contract lock (`images.ts:175-182`, `route.ts:243-259`) and late-clean originals if restore maintenance begins after save (`images.ts:404-416`, `route.ts:388-402`).
- Image queue side effects crossing restore: queue caption/embedding side effects are tracked (`image-queue.ts:346-357`, `702-770`) and drained by restore/shutdown (`image-queue.ts:453-457`), unlike the known-deferred analytics writes.

## Final Sweep

Final missed-issues sweep covered restore failure states, durable marker recovery, SQL scan grammar, import handoff to `mysql --one-database`, migration baselining/reconcile postconditions, deploy health/prune sequencing, auth/session maintenance gates, upload/LR upload cleanup and quota claims, image queue side effects, analytics view recording and rate-limit rollback, public/admin rate-limit helpers, custom modal isolation, focus traps, Radix dropdown portals, and prior/current review/deferred artifacts.

No app code was edited. No commit was made. Existing focused tests pass but do not cover the confirmed scanner bypasses.
