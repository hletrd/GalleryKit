# Debugger Review - Cycle 7 Lane B

Date: 2026-07-07 KST
Reviewer lane: debugger
HEAD reviewed: `cae5fbd9b88f`
Scope: latent bugs, edge failures, race conditions, null/undefined regressions, restore/upload/download failure modes, deploy/runtime breakage. Review-only except this artifact.

## Result Summary

- Confirmed latent runtime defects found: 0
- Likely issues: 1 Low
- Manual-validation risks: 2

The previous cycle's password-change versus restore race is fixed in current HEAD: `updatePassword()` now acquires an admin mutation slot before long Argon2 work and before the password/session transaction. I did not find a current confirmed data-loss race, restore corruption path, auth/session failure, or upload/download path bug in the reviewed code. The one likely issue is a small retention/lifecycle edge in the high-volume upload-serving path.

## Inventory Built First

Inventoried the repository before detailed review, excluding generated/heavy directories (`.git`, `node_modules`, `.next`, nested `.claude/worktrees`) and TypeScript build info.

Reviewed categories:

- Auth/session mutations: `apps/web/src/app/actions/auth.ts`, `session.ts`, session schema/migrations.
- Foreground/background restore fences: `db-actions.ts`, `admin-mutation-barrier.ts`, `restore-maintenance*.ts`, `image-queue.ts`, `background-db-writes.ts`, maintenance scheduler.
- Upload and image processing: `actions/images.ts`, `api/admin/lr/upload/route.ts`, `process-image.ts`, `upload-paths.ts`, `upload-filenames.ts`, derivative cleanup and queue paths.
- Download/file/OG serving: `serve-upload.ts`, public upload routes, admin DB download route, OG photo route and fetch helper.
- Public search/share/feed flows: public actions, semantic/similar search routes, share pages, feed routes.
- Migrations/deploy/runtime: drizzle migrations, `scripts/migrate.js`, Dockerfile, compose, nginx, deploy scripts, package manifests.
- Tests/docs: restore, migration journal, SQL restore scanner, privacy, secret tracking, rate-limit/auth lint gates, relevant review history.

## Findings

### DBG-B-01 - Low - Upload stream abort listener is not explicitly removed on normal completion

Severity: Low
Confidence: Medium-Low
Validation: likely issue from source inspection

Evidence:

- GET upload routes pass the request abort signal into `serveUploadFile()` in `apps/web/src/app/uploads/[...path]/route.ts:7-15` and `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:7-15`.
- `serveUploadFile()` opens and fd-stats the requested derivative before streaming in `apps/web/src/lib/serve-upload.ts:304-335`.
- The function registers a one-shot abort listener that closes over the file stream in `apps/web/src/lib/serve-upload.ts:337-360`.
- The normal response path returns the converted web stream in `apps/web/src/lib/serve-upload.ts:362-366` without a visible `removeEventListener` on stream `close`, `end`, or `error`.

Concrete failure scenario:

Under normal image loads, `Readable.toWeb()` and `autoClose` should close the file descriptor. If the runtime keeps the request `AbortSignal` reachable longer than the body stream, the one-shot listener can retain the already-closed stream object until request GC. This is not a confirmed fd leak, but it is avoidable retention on a high-volume image-serving path.

Suggested fix:

Use a named abort handler and remove it from the signal on stream `close`, `end`, and `error`, while keeping the current `{ once: true }` abort behavior. Add a focused unit/source test if `AbortSignal` can be mocked cleanly.

## Previously Suspected Issues Rechecked

- Password-change restore race: fixed. `updatePassword()` now checks same-origin, current user, restore maintenance, then acquires `acquireAdminMutationSlot()` at `apps/web/src/app/actions/auth.ts:291-312` before validation, rate-limit work, Argon2 verification/hash, and the `admin_users`/`sessions` transaction at `apps/web/src/app/actions/auth.ts:381-416`.
- Restore foreground drain: present. Restore quiesces queues/background writes, then drains foreground admin mutations before import at `apps/web/src/app/[locale]/admin/db-actions.ts:539-568`, and always releases the exclusive flag in `apps/web/src/app/[locale]/admin/db-actions.ts:572-611`.
- Barrier behavior: `acquireAdminMutationSlot()` increments `inFlight` and releases via `Symbol.dispose` in `apps/web/src/lib/admin-mutation-barrier.ts:76-91`; restore drain blocks new slots and times out instead of importing over in-flight mutations in `apps/web/src/lib/admin-mutation-barrier.ts:97-135`.

## Manual-Validation Risks

### DBG-B-02 - Medium - Restore child-process failure behavior remains difficult to prove without behavioral fakes

Severity: Medium validation risk
Confidence: Medium
Validation: manual or expanded automated validation required

Evidence:

- Restore has multiple asynchronous child-process and stream exits in `apps/web/src/app/[locale]/admin/db-actions.ts:640-854`: SQL scan rejection, read stream errors, `mysql` spawn errors, stdin errors, timeout, nonzero close, success close, and post-restore migration.
- Cleanup and lifecycle release paths are source-visible at `apps/web/src/app/[locale]/admin/db-actions.ts:572-635`, but many event orderings are not exercised by the targeted tests I ran.

Concrete failure scenario:

A timeout, `mysql` spawn error, read-stream error, or post-restore migration failure could leave durable maintenance, queue state, process locks, or temp files in the wrong final state if an event ordering diverges from the intended source path.

Suggested fix:

Extract or wrap restore/import/migration child-process execution so tests can simulate timeout, spawn error, stdin error, read-stream error, nonzero close, and post-migration failure. Assert final marker, lock, queue, temp-file, and response state for each case.

### DBG-B-03 - Low/Medium - Deployment cleanup and proxy behavior need live-host validation

Severity: Low/Medium validation risk
Confidence: Medium
Validation: manual deployment validation required

Evidence:

- Deploy prunes Docker artifacts after a successful health check in `apps/web/deploy.sh:57-104`; comments document bind-mounted persistence and intentionally avoid `volume prune -a`.
- Nginx body-size/rate-limit behavior is path-sensitive in `apps/web/nginx/default.conf:99-204`, with separate caps for admin DB, dashboard upload, Lightroom upload, and generic admin API routes.

Concrete failure scenario:

A host-specific compose path, bind mount, proxy, or nginx location mismatch can pass source review but fail in production: large valid uploads 413 at the edge, restore bodies exceed a proxy cap, health checks pass while a later prune removes an unexpected non-bind-mounted dependency, or rate-limit buckets collapse behind a load balancer.

Suggested fix:

Keep deploy validation on the live host: exercise login, dashboard upload, Lightroom upload, DB backup download, restore-size rejection, public upload serving, and Docker disk cleanup after deploy. Verify persistence directories are bind mounts and not Docker volumes before relying on prune behavior.

## Non-Findings and Code Evidence

- Auth mutation ordering: login pre-increments rate limits before Argon2 work, stores hashed sessions, and sets secure/httpOnly cookies; password change now participates in the restore mutation barrier.
- Upload admission: `uploadImages()` checks maintenance, same-origin, admin slot, current user, form fields, upload contract lock, disk space, and topic existence before processing; failure paths release claims and clean partial files.
- Lightroom upload: route-level admin auth is scoped to `lr:upload`, body/chunked/size checks run early, upload tracker claims reject duplicates, and late restore/HDR/GPS/DB failure paths clean original files.
- File serving: derivative serving validates directory/extension/path segments, rejects symlinks, verifies realpath containment, fd-stats the opened file, and handles HEAD without opening the streaming fd.
- Backup/download: admin DB download validates the backup filename, resolves inside the backups directory, realpath-checks directory and file, opens/stats the descriptor, and returns attachment/no-store/nosniff headers.
- Migrations: journal monotonicity and pending-migration checks passed; schema reconciliation and restore scanner tests passed.
- Public data privacy: privacy field tests passed, and `apps/web/src/lib/data.ts:368-488` has source-level public/map field guards for admin-only fields.
- JSON-LD/XSS: `safeJsonLd()` escapes script-breaking characters before `dangerouslySetInnerHTML` use in the photo page.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm test --workspace=apps/web -- migration-journal.test.ts migration-journal-monotonicity.test.ts migrate-pending-migrations.test.ts sql-restore-scan.test.ts tracked-secrets.test.ts privacy-fields.test.ts` - passed, 6 files / 63 tests.
- `npm audit --workspace=apps/web --audit-level=moderate --json` - failed with moderate dependency advisories; tracked in the security report, not promoted here as a source-level debugger defect.

## Final Sweep

Final sweep covered auth/session state, public/admin API error paths, server action guard ordering, upload/restore/download cleanup, file descriptor and stream paths, migration journal behavior, rate-limit ordering, CSP/JSON-LD/XSS-adjacent rendering, raw SQL and child-process paths, deploy scripts, tests, and docs. I did not modify source code or plans. Residual risk is mainly unexercised child-process failure ordering and live deployment topology, not a confirmed current code defect.
