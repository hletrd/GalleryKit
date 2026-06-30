# Cycle 27 Tracer Report

Date: 2026-06-30
Role: tracer
HEAD reviewed: `1e8bba02`
Mode: review-only. App code was not edited.

## Inventory

Required context read first:

- `AGENTS.md` workspace instructions in the prompt.
- `CLAUDE.md`, especially restore/import, upload, auth/origin/rate-limit, image processing, runtime topology, deploy, and permanently deferred sections.
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`.
- `.context/plans/archive/73-deferred-cycle27.md` and current `.context/reviews/*.md` to avoid re-filing known permanent/deferred policy items.

Review-relevant inventory examined:

- Restore/import and SQL scanning: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, `apps/web/src/lib/restore-maintenance*.ts`, `apps/web/scripts/restore-maintenance-recovery.ts`, `apps/web/scripts/migrate.js`, restore scanner tests.
- Auth/origin/rate-limit: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/app/actions/auth.ts`, public search/similar/OG routes, scanner scripts for API auth/action origin/public route rate limits.
- Upload/image processing: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, upload tracker/path/lock helpers, upload and image queue tests.
- Modal/focus UI state: `apps/web/src/components/use-modal-tree-isolation.ts`, `search.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `lightbox-color-pip.tsx`, `lazy-focus-trap.tsx`, focus/touch tests.
- Deploy/runtime scripts: `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, deploy script tests.

I did not duplicate permanently deferred/product-policy items such as 2FA/WebAuthn, paid downloads/Stripe, documented single-instance scale-out constraints, IPv6 /64 rate-limit aggregation, or known low-value process-local/deferred performance debts.

## Confirmed Issues

### TRC27-01 - HIGH - SQL restore write-target allowlist can be bypassed with comments between statement keywords

Confidence: High

Location:

- `apps/web/src/lib/sql-restore-scan.ts:190-221`
- `apps/web/src/lib/sql-restore-scan.ts:138-155`
- `apps/web/src/app/[locale]/admin/db-actions.ts:620-647`
- `apps/web/src/app/[locale]/admin/db-actions.ts:672-678`

The restore scanner has two separate checks. `hasDisallowedRestoreWriteTarget()` extracts write targets from a sanitized form that removes ordinary comments as an empty string (`stripSqlCommentsAndValueLiterals`, lines 168-180) and is called first at lines 212-215. The dangerous-statement denylist then scans both comment-collapsed and comment-as-space forms at lines 217-221.

That means the prior comment-spacing fix covers `DANGEROUS_SQL_PATTERNS`, but not the write-target allowlist. A restore file containing `CREATE/**/TABLE rogue (id int);`, `INSERT/**/INTO rogue VALUES (1);`, `INSERT/**/INTO otherdb.images VALUES (1);`, or `UPDATE/**/rogue SET id=1;` becomes `CREATETABLE`, `INSERTINTO`, or `UPDATErogue` for the write-target regex and avoids the allowlist. Manual probe against current `containsDangerousSql()` returned `false` for those comment-separated samples while the non-comment versions returned `true`.

Concrete failure scenario:

An authenticated admin restores a tampered dump. The scanner loop in `db-actions.ts:620-647` accepts the file, then `mysql --one-database DB_NAME` imports it at `db-actions.ts:672-678`. MySQL treats comments as token separators, so the statement can still create/write an unexpected table in the app DB, or target a qualified sibling schema if the DB user has broader privileges. This defeats the scanner's explicit non-app-table and cross-schema write boundary.

Suggested fix:

Run the write-target allowlist against both normalized forms, the same way dangerous patterns do. Add regression tests for comment-separated write targets across `CREATE TABLE`, `ALTER TABLE`, `INSERT INTO`, `REPLACE INTO`, `UPDATE`, and schema-qualified `db.table` variants. Keep `--one-database` as defense in depth, not the primary restore boundary.

## Likely Issues

### TRC27-02 - MEDIUM - Fire-and-forget analytics inserts can still cross the restore import boundary

Confidence: Medium

Location:

- `apps/web/src/app/actions/public.ts:416-439`
- `apps/web/src/app/actions/public.ts:444-471`
- `apps/web/src/app/actions/public.ts:476-507`
- `apps/web/src/app/[locale]/admin/db-actions.ts:491-504`
- `apps/web/src/lib/data.ts:222-249`

The restore flow enters durable maintenance, flushes the buffered shared-group aggregate counter, then quiesces the image queue before import (`db-actions.ts:491-504`). That covers `flushBufferedSharedGroupViewCounts()` (`data.ts:222-249`) and queue side effects.

The durable event rows are a separate path. `recordPhotoView`, `recordTopicView`, and `recordSharedGroupView` validate and rate-limit, perform a late maintenance check, then launch `db.insert(...).catch(...)` without awaiting or registering the promise (`public.ts:428-437`, `461-469`, `497-505`). Page renderers intentionally call these with `void` (`p/[id]/page.tsx:154-156`, topic page lines 163-164, shared group page lines 127-131).

Concrete failure scenario:

A public page view passes the late maintenance check and starts an insert promise. Before that promise obtains a connection or commits, an admin restore starts and imports a different database snapshot. The insert can fail on FK drift, or commit after the restore against IDs from the new snapshot, adding a pre-restore event into post-restore analytics.

Suggested fix:

Route view-event inserts through a small tracked analytics-write queue with pause/drain semantics, and have restore drain it alongside `flushBufferedSharedGroupViewCounts()` and `quiesceImageProcessingQueueForRestore()`. A narrower fix is to await the inserts so the server action lifetime tracks them, but a queue is the cleaner restore boundary.

### TRC27-03 - MEDIUM - Search can stack over other custom modals and one Escape can close multiple layers

Confidence: Medium

Location:

- `apps/web/src/components/search.tsx:297-314`
- `apps/web/src/components/search.tsx:316-327`
- `apps/web/src/components/search.tsx:366-536`
- `apps/web/src/components/lightbox.tsx:309-360`
- `apps/web/src/components/info-bottom-sheet.tsx:132-139`
- `apps/web/src/components/use-modal-tree-isolation.ts:19-65`

`Search` registers a global `Cmd/Ctrl+K` listener that opens the search dialog unless the event target is an input/textarea (`search.tsx:297-307`). It does not check whether another modal is already active. Its Escape handler closes search but does not stop propagation (`search.tsx:308-310`). Lightbox and bottom sheet also register global Escape listeners (`lightbox.tsx:309-360`, `info-bottom-sheet.tsx:132-139`).

Concrete failure scenario:

A visitor opens the lightbox, presses `Cmd+K`, then presses Escape to close the search overlay. Because both handlers are on `window`, the same Escape event can close the search dialog and the underlying lightbox/bottom sheet. Search also restores focus to its nav trigger on close (`search.tsx:316-327`), which may be outside the still-open lower modal's accessible tree. `useModalTreeIsolation()` correctly isolates one active modal tree, but it is not a modal stack manager.

Suggested fix:

Add a shared modal stack/owner guard. When any higher-priority modal is open, suppress global search open, or register search as the top stack layer and consume Escape with `stopImmediatePropagation()` semantics before lower modal handlers run. Restore focus to the previously focused element only if it is still in the active top modal; otherwise focus that modal's fallback target.

## Risks Needing Manual Validation

- Modal stacking should be verified in a browser with Search over Lightbox and Search over InfoBottomSheet. Static evidence strongly indicates stacked Escape/focus drift, but exact close order depends on listener registration order and should be captured with Playwright or agent-browser.
- Deploy scripts were source-reviewed only. Current `deploy.sh` waits for `gallerykit-web` health before Docker prune (`apps/web/deploy.sh:34-54`) and prunes only after health (`apps/web/deploy.sh:56-81`); no production deploy was run.
- Upload/image processing restore races were source-reviewed only. Browser and Lightroom paths both hold the upload-processing contract lock before save/insert/enqueue windows and perform late maintenance cleanup; no live upload was executed.

## Refuted Or Already Covered

- SQL multi-token dangerous statements such as `DROP/**/TABLE` are now covered by the comment-as-space dangerous-pattern pass (`sql-restore-scan.ts:153-155`, `217-221`). The remaining confirmed bug is specifically the write-target allowlist.
- Lightroom upload now forwards `semanticSearchMode` to the queue (`apps/web/src/app/api/admin/lr/upload/route.ts:479-516`), matching browser upload (`apps/web/src/app/actions/images.ts:505-537`).
- Semantic search now rejects missing `Content-Length`, chunked transfer, and oversized bodies before reading, and charges the limiter before config/body protected work (`apps/web/src/app/api/search/semantic/route.ts:136-184`).
- OG photo fallback redirects now use canonical origin, not request origin (`apps/web/src/app/api/og/photo/[id]/route.tsx:249-295`).
- nginx uploaded-derivative serving now proxies to Next instead of a container-internal host path (`apps/web/nginx/default.conf:169-185`).
- Custom modal background isolation from cycle 26 has a shared hook wired into Search, Lightbox, and InfoBottomSheet (`use-modal-tree-isolation.ts:19-65` plus consumers above). TRC27-03 is about stacked modal ownership, not the old missing-inert finding.

## Final Sweep Confirmation

Final sweep covered:

- Restore/import lifecycle: durable marker, advisory locks, upload contract lock, SQL chunk scanner, mysql subprocess, post-restore migrations, queue resume/maintenance recovery.
- SQL scanning: comment stripping, allowed app backup drops, write-target allowlist, dangerous statement patterns, tail chunking.
- Auth/origin/rate-limit: admin API wrapper, PAT token path, same-origin helpers, login/account buckets, semantic/OG/search/load-more/view budgets, lint scanners.
- Upload/image processing: browser upload, Lightroom upload, tracker claim/settle, GPS strip, original cleanup, Sharp pipeline, queue claims/retries, caption/embedding side effects, restore quiesce.
- Modal/focus UI: search portal/focus restore, lightbox keyboard/focus/controls, info bottom sheet focus trap, modal tree isolation, nested color pip behavior.
- Deploy/runtime: remote deploy env handling, host deploy health/prune ordering, Docker runtime healthcheck, compose bind mounts, nginx upload/admin/PAT route locations.

No app code was modified and no commits were made. Validation evidence is source inspection plus a direct `containsDangerousSql()` probe for TRC27-01; no test suite or live browser/deploy run was executed.
