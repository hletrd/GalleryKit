# Cycle 27 Document Specialist Review

Reviewer: cycle-27 document-specialist
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `1e8bba0298eac45df45698f5162908005df501e8`
Scope: documentation/code mismatch review against authoritative repo sources, focused on deployment, restore recovery, SQL restore scanner claims, runtime/dependency availability, admin operations, color/HDR documentation, and tests.

## Inventory First

I read the workspace rules and `CLAUDE.md`, then built the review inventory before judging mismatches.

Review-relevant docs inventoried:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `apps/web/README.md`
- `.env.deploy.example`
- `apps/web/.env.local.example`
- `.context/reviews/*.md` for known review history and already-reported items

Authoritative deployment/runtime sources examined:

- `package.json`
- `apps/web/package.json`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `apps/web/nginx/default.conf`
- `apps/web/next.config.ts`

Authoritative restore/admin/SQL sources examined:

- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/restore-maintenance-durable.ts`
- `apps/web/scripts/restore-maintenance-recovery.ts`
- `apps/web/src/instrumentation.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`

Authoritative color/HDR/semantic/runtime sources examined:

- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/settings-hash.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/color-detection.ts`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/scripts/backfill-color-pipeline.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/src/app/actions/admin-backfill.ts`
- `apps/web/src/lib/clip-model.ts`
- `apps/web/src/lib/clip-paths.ts`
- `apps/web/scripts/download-clip-models.ts`
- `apps/web/scripts/backfill-clip-embeddings.ts`
- `apps/web/src/app/api/search/semantic/route.ts`

Authoritative tests examined:

- `apps/web/src/__tests__/sql-restore-scan.test.ts`
- `apps/web/src/__tests__/db-restore.test.ts`
- `apps/web/src/__tests__/restore-maintenance.test.ts`
- `apps/web/src/__tests__/cycle-26-source-contracts.test.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/touch-target-audit.test.ts`

## Confirmed Issues

### DOC-C27-01 - Backfill docs say concurrent full runs serialize, but the implementation mostly fail-fasts

Severity: Low
Confidence: High

Evidence:

- `CLAUDE.md:337` says the sidecar backfill acquires `gallerykit_color_pipeline_backfill`, "so two concurrent runs serialize instead of fighting".
- `CLAUDE.md:339` says the sidecar and in-app runner "both re-encode behind the same lock" and "Full backfill runs serialize against each other".
- `CLAUDE.md:404` repeats that concurrent color-pipeline backfill invocations "serialize cleanly rather than racing".
- `apps/web/scripts/backfill-color-pipeline.ts:32-38` repeats the same sidecar-vs-in-app serialization claim in code comments.
- The sidecar actually calls `GET_LOCK(?, 10)` in `apps/web/scripts/backfill-color-pipeline.ts:312-315` and exits non-zero when the lock is not acquired in `apps/web/scripts/backfill-color-pipeline.ts:323-327`.
- The in-app runner calls `GET_LOCK(?, 0)` in `apps/web/src/lib/admin-backfill-runner.ts:316-330`, so it does not wait for an existing run.
- The admin action surfaces that state as `already_running` in `apps/web/src/app/actions/admin-backfill.ts:63-64`.

Concrete failure scenario:

An operator starts a full in-app color-pipeline re-encode, then starts the documented sidecar command expecting it to queue and run after the in-app job. Instead, the sidecar waits only up to 10 seconds and exits `1` if the lock is still held. Conversely, triggering the in-app runner during a sidecar run returns `already_running` immediately. This is mutual exclusion, not queued serialization.

Suggested fix:

Update `CLAUDE.md` and the sidecar script comment to say: "Full backfills are mutually exclusive. The in-app runner returns `already_running`; the sidecar waits up to 10 seconds for the MySQL lock and exits non-zero if another run is still active." If queued behavior is intended, change the code instead by making the sidecar wait long enough for the documented operational contract and by deciding whether the in-app action should queue or remain fail-fast.

### DOC-C27-02 - Restore-maintenance recovery docs can imply an external CLI clear fixes the live web process

Severity: Medium
Confidence: High

Evidence:

- `CLAUDE.md:401` documents `npm run restore:maintenance --workspace=apps/web -- clear --confirm-clear-restore-maintenance` for recovery and says the script "also resets process-local maintenance state when run in the app runtime."
- The documented command runs `apps/web/scripts/restore-maintenance-recovery.ts`; its clear path requires confirmation and calls `clearDurableRestoreMaintenanceForRecovery()` in `apps/web/scripts/restore-maintenance-recovery.ts:24-41`.
- Process-local maintenance is a Node process global in `apps/web/src/lib/restore-maintenance.ts:1-27`.
- The normal restore path can intentionally keep maintenance active after restore/import/migration failures: `apps/web/src/app/[locale]/admin/db-actions.ts:501-517`, with failure returns carrying `keepMaintenance: true` in `apps/web/src/app/[locale]/admin/db-actions.ts:684-694`, `apps/web/src/app/[locale]/admin/db-actions.ts:729-731`, and `apps/web/src/app/[locale]/admin/db-actions.ts:743-745`.
- Durable recovery clears the marker and the current process-local flag in `apps/web/src/lib/restore-maintenance-durable.ts:93-103`; it does not have a channel to mutate a separate already-running web server process.
- Startup sync reads the durable marker in `apps/web/src/instrumentation.ts:1-4`, and `syncRestoreMaintenanceFromDurable()` only sets the local flag true when a marker exists in `apps/web/src/lib/restore-maintenance-durable.ts:72-78`; it does not poll for later marker removal.

Concrete failure scenario:

A database restore fails after the live `gallerykit-web` process has entered restore maintenance. The process-local flag stays active by design and the durable marker remains. An operator follows the documented `npm run restore:maintenance ... clear` command from a shell. That separate `tsx` process removes `data/restore-maintenance.json` and clears its own process-local global, but the already-running web process still has `restoreMaintenance.active = true`. Admin uploads, restore-guarded APIs, or semantic search can continue returning maintenance responses until the web process restarts or an in-process recovery path runs.

Suggested fix:

Clarify the runbook: external CLI clear removes the durable marker for future starts, but if the currently running web process handled the failed restore, restart/redeploy `gallerykit-web` after the clear unless an authenticated in-app recovery action is used. Alternatively, add a protected admin recovery route/action that calls the clear helper inside the live web process, then document that as the preferred recovery path. Add a source-contract test that distinguishes "same process clear" from "external CLI clear plus web restart required."

## Likely Issues

No additional likely documentation/code mismatches rose above the evidence bar in this pass.

## Risks Needing Manual Validation

### RISK-C27-01 - Browser color/HDR capability prose can drift faster than repo tests

Severity: Low
Confidence: Medium

Evidence:

- `CLAUDE.md:367-381` documents current browser-specific ICC/HDR behavior and says the matrix was checked on 2026-06-12.
- Repo code and tests can validate Gallery's own behavior, but they do not prove the continuing accuracy of external browser behavior over time.
- Relevant local implementation remains internally consistent: color-impacting settings are enumerated in `apps/web/src/lib/settings-hash.ts:47-59`, admin UI settings are wired in `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:505-644`, and color metadata detection is handled in `apps/web/src/lib/color-detection.ts:330-423`.

Concrete failure scenario:

A browser release changes Firefox or Safari color-management behavior, but the runbook still describes the 2026-06-12 matrix. An operator may over- or under-estimate whether Gallery needs fallback behavior for a specific client.

Suggested fix:

When editing the color/HDR runbook next, re-check the browser matrix against current browser/vendor documentation or compatibility data and update the checked date. This is a manual validation risk, not a confirmed code/doc mismatch.

### RISK-C27-02 - Test-count prose was not re-proven by running the full suite

Severity: Low
Confidence: Medium

Evidence:

- `AGENTS.md:32-38` lists the blocking quality gates.
- `AGENTS.md:37` says `npm test --workspace=apps/web` includes "Vitest 2000+ unit tests".
- Source-level test coverage for this review's focus areas exists in `apps/web/src/__tests__/sql-restore-scan.test.ts`, `apps/web/src/__tests__/db-restore.test.ts`, `apps/web/src/__tests__/restore-maintenance.test.ts`, `apps/web/src/__tests__/cycle-26-source-contracts.test.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, and `apps/web/src/__tests__/touch-target-audit.test.ts`.

Concrete failure scenario:

The exact test count changes below the documented "2000+" threshold without anyone updating the prose. That would be a documentation freshness issue, not necessarily a product failure.

Suggested fix:

If exact test-count claims matter for release documentation, run `npm test --workspace=apps/web -- --reporter=json` or an equivalent count-producing command and either update the number or soften the prose to avoid a brittle count.

## Confirmed Clean Areas

- Deployment: `AGENTS.md:17-20` and `CLAUDE.md` deployment prose match `scripts/deploy-remote.sh:20-63`, `apps/web/deploy.sh:9-82`, `apps/web/docker-compose.yml:17-28`, `apps/web/Dockerfile:1-157`, and `apps/web/nginx/default.conf:31-202`. The documented config-driven SSH deploy, host-network container, `/api/live` health gate, bind-mounted persistence, and prune-after-success behavior are represented in code.
- Docker disk hygiene: `apps/web/deploy.sh:52-78` prunes containers, images, builder cache, and unused volumes after the health gate. It uses `docker volume prune -f`, not `docker volume prune -af`, preserving the documented no-`-a` guarantee.
- SQL restore scanner: the scanner's dangerous-statement claims match `apps/web/src/lib/sql-restore-scan.ts:57-123`, table-target allowlist logic in `apps/web/src/lib/sql-restore-scan.ts:12-55`, chunk-tail behavior in `apps/web/src/lib/sql-restore-scan.ts:125-234`, and tests in `apps/web/src/__tests__/sql-restore-scan.test.ts:24-233`.
- Restore import safeguards: upload size/header checks, temp-file mode, SQL scanning, `mysql --one-database`, and post-restore migration behavior are implemented in `apps/web/src/app/[locale]/admin/db-actions.ts:568-819` and helper tests in `apps/web/src/__tests__/db-restore.test.ts:12-78`.
- Runtime/dependency availability: documented Next/React/TypeScript/Node expectations align with `README.md:12-14`, `README.md:222-229`, `apps/web/package.json:5-85`, and `apps/web/Dockerfile:1-21`.
- Semantic/CLIP availability: docs describing local model availability and production gating align with `apps/web/src/lib/clip-paths.ts:49-98`, `apps/web/scripts/download-clip-models.ts:47-141`, `apps/web/src/lib/clip-model.ts:35-210`, `apps/web/scripts/backfill-clip-embeddings.ts:83-215`, and the semantic route's disabled/empty-state behavior in `apps/web/src/app/api/search/semantic/route.ts:107-290`.
- Admin operations: admin API auth/path-hardening docs line up with `apps/web/src/lib/api-auth.ts:68-142`, DB backup download containment checks in `apps/web/src/app/api/admin/db/download/route.ts:21-90`, and Lightroom upload guard/body-limit/contract-lock behavior in `apps/web/src/app/api/admin/lr/upload/route.ts:78-259`.
- Color/HDR implementation: documented color-impacting settings and fallback boundaries align with `apps/web/src/lib/gallery-config-shared.ts:22-192`, `apps/web/src/lib/settings-hash.ts:4-104`, `apps/web/src/lib/process-image.ts:36-360`, `apps/web/src/lib/color-detection.ts:1-423`, and the admin settings UI in `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:505-644`.

## Final Sweep Confirmation

Final sweep categories reviewed: deployment, remote deploy helper, Docker runtime, nginx upload limits, restore recovery, SQL restore scanning, DB dump/restore actions, admin authentication and operations, semantic/CLIP runtime availability, package/runtime versions, color/HDR processing, admin settings, and tests.

Final targeted source terms included: `deploy`, `restore`, `maintenance`, `restore:maintenance`, `GET_LOCK`, `gallerykit_color_pipeline_backfill`, `sql-restore`, `DROP TABLE`, `TRUNCATE`, `MYSQL_PWD`, `CLIP_MODELS_ROOT`, `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, `allow_hdr_ingest`, `force_srgb`, `wide_gamut`, `NEXT_UPLOAD`, `client_max_body_size`, `withAdminAuth`, `same-origin`, `touch-target`, and `privacy`.

Validation note: this was a documentation review. I did not run the full app test suite because no app code was changed; source-level tests and authoritative implementation files were inspected directly. No official external docs were needed for the confirmed findings because both are repo-internal documentation/code mismatches. Browser color/HDR current-support prose remains a manual validation risk as noted above.
