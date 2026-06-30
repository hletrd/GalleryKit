# Tracer Review - Cycle 24

Review lane: `tracer`
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `a6efd6fd584fe44138be3729d90743ceb76dbfad`
Mode: review-only. Source files were not modified. This report is the only intended file change from this lane.

## Method / Inventory

Required context read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Trace-relevant inventory covered before reviewing flows:

- 522 tracked files in the current trace surface were inventoried in `/tmp/gallery-trace-files.txt`: root/project instructions and package metadata, deploy/env/nginx/Docker files, `apps/web/src/app/**`, `apps/web/src/lib/**`, `apps/web/src/db/**`, `apps/web/scripts/**`, `apps/web/drizzle/**`, `apps/web/src/__tests__/**`, and `apps/web/e2e/**`.
- Current app route/action surface was reviewed rather than sampled: admin DB actions/download, browser and Lightroom uploads, image/tag/topic/settings/SEO/collection/sharing/user/token actions, public load/search/view actions, semantic/similar/OG/health/live API routes, public share pages, and admin pages where they drive state transitions.
- Current suspicious infrastructure surface was reviewed: deployment helper, compose file, nginx config, env examples, migration runner, restore scanner, queue/bootstrap/shutdown, upload path/serving helpers, rate-limit/auth/session/token helpers, audit/view retention, analytics, data projections, config/settings, processing/backfill helpers, and privacy/security tests adjacent to these flows.

Static causal traces performed:

- Deployment env handling and proxy/IP trust.
- Admin auth, sessions, password changes, PAT/LR token creation, token scope/usage.
- Mutating server actions and admin API wrappers.
- Browser/LR uploads, quota tracking, original storage, GPS stripping, queue enqueue, delete races.
- Image processing, foreground queue, in-app backfill, sidecar/backfill adjacency.
- Public routes, share/view/search/semantic/OG flows, public rate limits.
- DB backup/download/restore/import/migration, advisory locks, maintenance state.
- UI state transitions around admin dashboards, upload/backfill/restore settings, and public navigation state where those routes mutate or report server state.

Validation run:

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.

Full lint, typecheck, build, Vitest, and Playwright were not run; this was a static causal trace plus the three custom policy scanners above.

## Findings

### TRC24-01 - Foreground image processing can pin most of the shared MySQL pool across Sharp work

Severity: Medium
Confidence: High
Status: Confirmed issue

Evidence:

- The shared MySQL pool is fixed at 10 connections with a 20-request queue: `apps/web/src/db/index.ts:23-33`.
- Foreground queue concurrency can be configured up to 8: `apps/web/src/lib/image-queue.ts:87-90`.
- Each queued foreground job acquires a dedicated advisory-lock connection and returns that connection to the task on success: `apps/web/src/lib/image-queue.ts:446-455`.
- The task keeps that connection while it verifies the row, resolves/accesses the original, optionally loads config, runs `processImageFormats`, verifies derivative files, updates the image row, and performs delete-race cleanup: `apps/web/src/lib/image-queue.ts:519-675`.
- The advisory-lock connection is released only in the task `finally` block: `apps/web/src/lib/image-queue.ts:812-815`.
- The backfill runner has explicit shared-pool reserve arithmetic and clamps effective concurrency to protect live traffic: `apps/web/src/lib/admin-backfill-runner.ts:96-141`. The foreground queue lacks equivalent reserve math.

Causal chain / failure scenario:

If an operator raises `QUEUE_CONCURRENCY=8` for a large upload/import, eight foreground jobs can hold eight of ten DB pool connections for encode-duration Sharp work. Live gallery/photo requests, admin session checks, public search/view actions, settings reads, and the queue's own transient DB updates then compete for two remaining connections and a 20-item wait queue. The failure mode is avoidable latency or 500/503 responses while CPU and MySQL may otherwise be healthy.

Concrete fix:

Do not hold a shared-pool connection across Sharp work. Prefer a short durable row-claim state or a short advisory lock for claim only, release before encoding, then use a conditional processed-state update and existing delete-race cleanup. If the long advisory lock is kept, move it to a dedicated small pool or clamp `QUEUE_CONCURRENCY` with the same live-connection reserve arithmetic used by `resolveBackfillConcurrency`. Add a regression test proving configured foreground concurrency cannot consume the live pool reserve.

### TRC24-02 - The single-writer runtime topology is documented but not enforced

Severity: Medium
Confidence: Medium
Status: Likely issue requiring deployment validation

Evidence:

- `CLAUDE.md` documents that the shipped deployment is single web-instance/single-writer and that restore flags, upload quota tracking, queue state, rate-limit maps, backfill status, and shared-group view-count buffering are process-local: `CLAUDE.md:233-236`.
- The shipped compose file defines one named `gallerykit-web` container and sets `TRUST_PROXY=true`: `apps/web/docker-compose.yml:1-28`. This supports the documented topology but does not enforce it outside that compose invocation.
- Restore maintenance is process-local `globalThis` state: `apps/web/src/lib/restore-maintenance.ts:1-56`.
- Upload quota tracking is a process-local `globalThis` map, and active claims are checked only inside that process: `apps/web/src/lib/upload-tracker-state.ts:7-20` and `apps/web/src/lib/upload-tracker-state.ts:70-78`.
- Queue bootstrap runs in every Node process: `apps/web/src/instrumentation.ts:1-6`.
- Shared-group view counts are buffered in module-local memory: `apps/web/src/lib/data.ts:13-63`.

Causal chain / failure scenario:

The documented Docker path is single-container, but nothing in application startup acquires an exclusive writer lease. If a second web process is started by a process manager, a manual recovery attempt, a future HA change, or an accidental overlapping deployment, process A can enter restore maintenance while process B cannot see A's maintenance flag, upload claims, queue state, or view-count buffer. B can accept uploads, run queue bootstrap, weaken per-process public rate limits, or buffer analytics during A's restore/import window. That violates the restore and filesystem/DB consistency assumptions the docs rely on.

Concrete fix:

Make the topology executable. If GalleryKit remains single-writer, acquire a startup DB advisory lease and fail fast when another writer is active; include the lease name in ops docs and health output. If multi-process support is intended, move restore maintenance, upload quotas, queue ownership, abuse-relevant public rate limits, backfill status, and shared-group analytics buffering to shared durable coordination.

## Confirmed Negative Traces

- Prior token insert-ID risk is fixed in current HEAD. `createToken` now accepts `number | bigint` insert IDs and calls `safeInsertId`: `apps/web/src/lib/admin-tokens.ts:229-238`.
- Browser and Lightroom upload insert IDs also use `safeInsertId`: `apps/web/src/app/actions/images.ts:470-473` and `apps/web/src/app/api/admin/lr/upload/route.ts:458-462`.
- Browser upload quota settlement now uses an idempotent `settleClaim` closure and covers known post-claim failure paths; the older manual-settle-only risk did not reproduce in current HEAD.
- Browser/LR upload paths carry current processing snapshots into the queue, including quality, sizes, privacy/color/HDR settings, semantic mode, EXIF, ICC, and color signals.
- Queue/delete races are fenced: pending-row check before processing, conditional processed-state update, and full variant cleanup if deletion wins mid-processing are present in `apps/web/src/lib/image-queue.ts:554-675`.
- Upload fallback serving no longer reopens by pathname after validation; it uses `lstat`, `realpath`, `open`, descriptor `stat`, and `fileHandle.createReadStream({ autoClose: true })`: `apps/web/src/lib/serve-upload.ts:169-184` and `apps/web/src/lib/serve-upload.ts:273-313`.
- Admin backup download also uses descriptor-backed streaming after realpath containment: `apps/web/src/app/api/admin/db/download/route.ts:42-93`.
- Restore obtains DB restore/upload/backfill/semantic locks before import and uses the SQL scanner before invoking `mysql`; dangerous SQL scan entrypoint is `apps/web/src/lib/sql-restore-scan.ts:150`.
- Restore failure can intentionally keep process-local maintenance active on partial import/migration failure: `apps/web/src/app/[locale]/admin/db-actions.ts:679`, `apps/web/src/app/[locale]/admin/db-actions.ts:716`, and `apps/web/src/app/[locale]/admin/db-actions.ts:730`. I am treating this as an operator recovery posture, not a defect, but it depends on the single-writer assumption above.
- Public mutating API route policy scanner passed. Semantic search POST uses a rate-limit helper; GET-only health/live/OG/similar routes were reported non-mutating by the scanner.
- Admin API auth scanner passed for the admin DB download route and Lightroom upload route.
- Mutating server action same-origin scanner passed for all mutating actions; explicit read-only/public exemptions were reported by the scanner and reviewed in context.
- OG fallback and internal photo fetch paths are constrained to canonical same-origin/public derivative fetches in current code; the older open redirect/SSRF hypothesis did not hold.
- Smart collection, SEO, settings, topic, tag, and sharing admin inputs route through current validation/sanitization helpers; the format-character/display spoofing hypothesis did not hold for persisted admin names in current HEAD.
- Audit retention is now batched with bounded loop constants; the prior unbounded-delete hypothesis did not hold in current HEAD.
- Public data projections still omit filename/GPS/admin-only fields through the public select/privacy guard tests.

## Risks Needing Manual Validation

- Confirm production never runs more than one web writer against the same DB/upload tree. The repo documents single-writer mode and compose supports it, but there is no runtime lease to make accidental scale-out self-detecting.
- Confirm operator recovery expectations for restore failures that keep maintenance active. The code deliberately keeps maintenance on possible partial import/migration failure; runbook coverage should state how to inspect DB state and safely restart or recover.
- Confirm any intentional `QUEUE_CONCURRENCY` increase is capped operationally until the foreground queue receives the same pool-budget protection as backfill.

## Final Missed-Issues Sweep

Final sweep rechecked the competing hypotheses named in the request: deployment env/proxy handling, auth/session/token flows, mutating action provenance, browser and Lightroom uploads, upload quota rollback, GPS stripping/original storage, queue/delete races, image processing/backfill pool usage, public routes and rate limits, backup/download/restore/import/migration, OG/internal image fetching, upload fallback serving, semantic/similar search, settings/SEO/collection validation, privacy projections, audit/view retention, and UI-visible admin/public state transitions.

Skipped or intentionally limited:

- I did not modify source files.
- I did not inspect binary fixtures, screenshots, generated build output, `.next`, `node_modules`, local upload/data directories, or live production state.
- I did not exhaustively re-read every historical plan/review artifact; current source, current docs, adjacent review context, and relevant tests/scripts were reviewed for the requested flows.
- I did not run full lint, typecheck, build, Vitest, or Playwright. The three custom policy scanners listed above passed.
