# Cycle 27 Architect Review

Reviewer: Codex architect
Date: 2026-06-30
Scope: coupling, layering, state boundaries, deploy/runtime contracts, restore lifecycle, data access, image processing, and UI component boundaries.
Commit reviewed: `1e8bba0298eac45df45698f5162908005df501e8`

## Inventory First

I started by inventorying review-relevant surfaces rather than jumping straight to one subsystem.

- Project instructions: `AGENTS.md` supplied in-session, `CLAUDE.md`, and the local code-review skill.
- Prior review context checked to avoid re-filing stale or permanently-deferred items: `.context/reviews/architect.md`, `.context/reviews/verifier.md`, `.context/reviews/debugger.md`, `.context/reviews/run9-cycle8/architect.md`, `.context/reviews/run9-cycle8/_aggregate.md`, `.context/plans/archive/73-deferred-cycle27.md`, and `.context/plans/archive/plan-73-cycle27-fixes.md`.
- Tracked-file inventory by primary review area: app routes/actions `77`, components `58`, lib modules `98`, db schema modules `3`, scripts `28`, Drizzle migration files/meta `31`, e2e specs `8`, committed review artifacts `1678`, committed plans `97`.
- Worktree note before this review: unrelated existing edits were present in `.context/reviews/perf-reviewer.md` and `.context/reviews/security-reviewer.md`; this review does not rely on or modify them.

Known policy decisions intentionally not duplicated as new findings: the permanently-deferred 2FA/WebAuthn work and removed Stripe/paid-download paths.

## Confirmed Issues

### C27-ARCH-HIGH-01: Restore-maintenance recovery is documented as an operator runbook, but the production runtime cannot execute the documented recovery contract

Severity: High
Confidence: High
Category: restore lifecycle, deploy/runtime contract, state boundary

Evidence:

- The durable helper stores restore maintenance in two places: a marker file and process-local `globalThis` state. `beginDurableRestoreMaintenance()` sets process state before writing the marker, with rollback on marker-write failure (`apps/web/src/lib/restore-maintenance-durable.ts:80`-`90`), while `endDurableRestoreMaintenance()` removes the marker and then always clears process state in the current process (`apps/web/src/lib/restore-maintenance-durable.ts:93`-`99`).
- The underlying process flag is explicitly process-local global state (`apps/web/src/lib/restore-maintenance.ts:1`-`26`), not shared IPC state.
- Startup sync reads the marker once during instrumentation and applies it to the current process (`apps/web/src/instrumentation.ts:1`-`8`). There is no ongoing watcher or cross-process control plane.
- The recovery script calls `clearDurableRestoreMaintenanceForRecovery()` from its own Node process (`apps/web/scripts/restore-maintenance-recovery.ts:1`-`5`, `apps/web/scripts/restore-maintenance-recovery.ts:32`-`41`). That can remove the marker, but it cannot mutate `globalThis` inside an already-running Next server process.
- The documented package command is `restore:maintenance` (`apps/web/package.json:20`), implemented with `tsx`; `tsx` is only a dev dependency (`apps/web/package.json:70`-`85`).
- The production Docker runner copies `apps/web/scripts/migrate.js`, `apps/web/scripts/mysql-connection-options.js`, and `apps/web/scripts/entrypoint.sh`, but not `restore-maintenance-recovery.ts` (`apps/web/Dockerfile:122`-`125`). The runner then starts only migration plus `server.js` (`apps/web/Dockerfile:157`).
- CLAUDE.md says operators can clear a stale marker with `npm run restore:maintenance --workspace=apps/web -- clear --confirm-clear-restore-maintenance`, and warns not to remove the marker manually because the script also resets process-local state (`CLAUDE.md:401`).

Concrete failure scenario:

1. An admin restore starts and `beginDurableRestoreMaintenance({ allowExisting: true })` succeeds (`apps/web/src/app/[locale]/admin/db-actions.ts:448`-`489`).
2. The restore import or post-restore migration fails; the restore path deliberately keeps maintenance enabled (`apps/web/src/app/[locale]/admin/db-actions.ts:684`-`693`, `apps/web/src/app/[locale]/admin/db-actions.ts:729`-`744`).
3. The operator follows the documented recovery command in production. In the shipped image, the TypeScript recovery script and dev-only `tsx` runtime are not part of the runner. If the operator runs an equivalent command outside the Next process, it can clear the marker file but cannot clear the live process-local maintenance flag.
4. The site remains in restore maintenance until a process restart or an in-process clear occurs. If the marker was removed externally before restart, startup sync no longer represents the real previous state either.

Suggested fix:

Make restore-maintenance recovery a production-real contract, not just a dev workspace script. Two viable shapes:

- Preferred: add an authenticated, same-origin, admin-only in-process recovery action/route that verifies the stale marker condition, clears the durable marker, clears process state in the running server, resumes the image queue if safe, writes an audit log, and revalidates relevant admin/public surfaces.
- Alternative: ship a compiled production recovery CLI in the Docker runner and update the runbook to require a controlled app restart after marker clear, because a separate CLI cannot clear live `globalThis` state.

Either path should update CLAUDE.md and add a test that proves the operator recovery path matches the deployed artifact, not only the local TypeScript workspace.

### C27-ARCH-MED-01: Restore SQL validation can be bypassed with valid cross-schema statement shapes

Severity: Medium
Confidence: High
Category: restore lifecycle, data access boundary, database blast radius

Evidence:

- Restore scans SQL chunks with `containsDangerousSql()` before feeding them to `mysql` (`apps/web/src/app/[locale]/admin/db-actions.ts:618`-`647`).
- The import command uses `mysql --one-database ${DB_NAME}` (`apps/web/src/app/[locale]/admin/db-actions.ts:672`-`675`). That is a helpful guard, but the app-level scanner is the architectural boundary being relied on for dangerous statements.
- The scanner's write-target regex recognizes a narrow subset of `INSERT`: `INSERT` plus optional `IGNORE` then `INTO` (`apps/web/src/lib/sql-restore-scan.ts:39`-`55`).
- It rejects schema-qualified or unknown write targets only after that regex matches a write statement (`apps/web/src/lib/sql-restore-scan.ts:190`-`207`).
- The fallback dangerous-pattern list does not generally reject schema-qualified read sources or all valid `INSERT` modifiers (`apps/web/src/lib/sql-restore-scan.ts:57`-`123`, `apps/web/src/lib/sql-restore-scan.ts:212`-`221`).
- Tests cover basic schema-qualified write targets and ordinary app-table writes, but not priority-modified inserts, `INSERT ... SELECT`, or `CREATE TABLE ... AS SELECT` from another schema (`apps/web/src/__tests__/sql-restore-scan.test.ts:53`-`96`).

Targeted parser probe:

```text
containsDangerousSql('INSERT LOW_PRIORITY INTO otherdb.images VALUES (1);') => false
containsDangerousSql('INSERT DELAYED INTO otherdb.images VALUES (1);') => false
containsDangerousSql('INSERT HIGH_PRIORITY INTO otherdb.images VALUES (1);') => false
containsDangerousSql('INSERT INTO images SELECT * FROM otherdb.images;') => false
containsDangerousSql('CREATE TABLE images AS SELECT * FROM otherdb.images;') => false
```

Concrete failure scenario:

If the configured MySQL user has privileges beyond the gallery schema, a crafted restore file can use a valid `INSERT` modifier to avoid the write-target parser, or can read from another schema into allowed app tables through `INSERT INTO images SELECT ... FROM otherdb.images`. In the first case, the restore can affect data outside the gallery schema. In the second, it can import cross-schema data into the gallery schema while passing the current scanner.

Suggested fix:

Replace the scanner with a real SQL parser or narrow the accepted restore language to the exact mysqldump shapes this app generates. At minimum:

- Recognize all valid `INSERT` modifier forms before `INTO`.
- Reject schema-qualified identifiers anywhere in executable statements, including `SELECT` sources and `CREATE TABLE ... AS SELECT`.
- Add explicit tests for priority modifiers, `INSERT ... SELECT`, `CREATE TABLE ... AS SELECT`, comments around tokens, and schema-qualified reads.
- Keep `--one-database`, but do not treat it as the sole application-layer boundary.

## Likely Issues

### C27-ARCH-MED-02: Fire-and-forget public analytics writes are not drained before restore import

Severity: Medium
Confidence: Medium
Category: state boundary, restore lifecycle, data access

Evidence:

- `recordPhotoView()` checks restore maintenance before and after validation, then starts an unawaited `db.insert(imageViews)` promise (`apps/web/src/app/actions/public.ts:416`-`441`).
- `recordTopicView()` follows the same pattern for `topicViews` (`apps/web/src/app/actions/public.ts:444`-`473`).
- `recordSharedGroupView()` follows the same pattern for `sharedGroupViews` (`apps/web/src/app/actions/public.ts:476`-`509`).
- Restore prep flushes the buffered shared-group aggregate counter and quiesces the image processing queue (`apps/web/src/app/[locale]/admin/db-actions.ts:491`-`505`), but there is no equivalent drain for these analytics insert promises.
- The aggregate shared-group view-count buffer has a tracked flush/drain path (`apps/web/src/lib/data.ts:222`-`249`), but that drain does not cover the three public analytics insert tables above.

Concrete failure scenario:

A public request enters `recordPhotoView()`, passes the late restore-maintenance check, and starts the untracked insert. A restore begins immediately after and reaches SQL import while the insert is still waiting on the pool or committing. Depending on timing, the write can fail against a dropped/recreated table, appear as noisy restore-era errors, or commit a pre-restore analytics event into the freshly restored database after the operator expected a clean snapshot.

Suggested fix:

Move public analytics writes behind a small tracked writer boundary. The restore path should call a `pauseAndDrainPublicAnalyticsWritesForRestore()` helper before SQL import and a matching resume helper after verified restore completion. A simpler but less scalable option is to await these inserts directly so each request owns its write lifecycle. Either way, restore should have one named quiesce contract for all DB writers, not just image processing and the aggregate view-count buffer.

## Risks Needing Manual Validation

- The SQL scanner blast radius depends on the production MySQL user's actual privileges. If the user is schema-confined, cross-schema writes/reads should fail at MySQL authorization even though the app scanner allows the statement shapes.
- The restore recovery issue should be validated against the actual deployed image and operator shell path. Static evidence shows the documented command is not shipped as a runnable production artifact and that an external Node process cannot clear live process-local state.
- The analytics race needs runtime timing validation under load during a restore. The architecture issue is confirmed at the boundary level, but the observed production symptom depends on pool scheduling and restore timing.
- This review did not run a full browser QA sweep. UI component boundaries were inspected statically for ownership and data-flow problems; no new UI boundary finding met the evidence bar.

## Architectural Non-Findings

- Public/admin data field layering is intentionally centralized. `adminSelectFields`, `publicSelectFields`, and `publicMapSelectFields` are derived in one module, with sensitive fields omitted from public surfaces and map latitude/longitude explicitly constrained to the map-visible path (`apps/web/src/lib/data.ts:251`-`327`, `apps/web/src/lib/data.ts:368`-`445`, `apps/web/src/lib/data.ts:459`-`470`).
- Upload and image processing settings are snapshot at upload time and carried into the queue, while bootstrap/legacy queue jobs fall back to current config (`apps/web/src/app/actions/images.ts:183`-`190`, `apps/web/src/app/api/admin/lr/upload/route.ts:264`-`275`, `apps/web/src/lib/image-queue.ts:599`-`661`).
- Image processing uses bounded global Sharp settings, per-format fresh Sharp instances, temp-file writes, verification before marking processed, and rollback of replaced derivatives (`apps/web/src/lib/process-image.ts:36`-`57`, `apps/web/src/lib/process-image.ts:1045`-`1064`, `apps/web/src/lib/process-image.ts:1147`-`1218`).
- Deploy disk hygiene preserves the documented runtime contract: build/up/health-check before prune, with persistent directories bind-mounted by Compose (`apps/web/deploy.sh:32`-`81`, `apps/web/docker-compose.yml:12`-`28`).
- Migration bootstrap/reconcile still has a loud post-condition for silently skipped Drizzle journal entries (`apps/web/scripts/migrate.js:748`-`785`, `apps/web/scripts/migrate.js:787`-`807`).

## Final Sweep Confirmation

Reviewed categories:

- Instructions and architecture docs: `AGENTS.md`, `CLAUDE.md`.
- Restore lifecycle: durable marker/process state, admin restore action, recovery script, restore tests, image queue quiesce/resume.
- Deploy/runtime contracts: Dockerfile runner contents, Compose mounts, entrypoint, deploy helper, Next config, CI quality workflow.
- Data access and privacy boundaries: schema, public/admin select fields, map field path, auth/origin/rate-limit patterns, SQL restore scanner.
- Image processing: upload paths, Lightroom upload route, browser upload action, queue ownership, Sharp processing, upload serving/path containment.
- UI/component boundaries: admin/public routes, API route structure, component ownership by feature area, static interaction with data/action layers.
- Tests and prior review context: restore-maintenance tests, restore upload-lock tests, SQL restore scanner tests, privacy/touch-target conventions, current verifier/debugger review context, and run9 drift-sweep artifacts.

Validation evidence:

- Static cross-file inspection with exact citations above.
- Targeted `npx tsx` probe against `containsDangerousSql()` for the restore scanner bypass shapes.
- No app code was edited.
- No commit was made.
