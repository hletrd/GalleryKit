# Run-10 Cycle 35 Tracer Review

Date: 2026-07-08 KST
Role: cycle-35 tracer subagent
Workspace: `/Users/hletrd/flash-shared/gallery`
Mode: review-only; no product-code edits

## Scope And Inventory

Required instructions read first: `AGENTS.md` and `CLAUDE.md`. I also read the previous tracer report at this path to avoid re-filing fixed cycle-34 issues.

Trace inventory reviewed:

- Upload to DB to processing to serving: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`.
- Delete and cleanup: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/pending-file-deletions.ts`, `apps/web/drizzle/0030_pending_file_deletions.sql`.
- Restore and mutation fences: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/restore-drain-checklist.ts`, `apps/web/src/lib/pending-session-revocations.ts`.
- Auth/session and admin actions: `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/proxy.ts`.
- Share/search/view analytics: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/data.ts`, public share/photo/topic pages under `apps/web/src/app/[locale]/(public)/`.
- Backfill and sidecar processing: `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/backfill-alt-text.ts`.
- Deploy and migration flows: `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/docker-compose.yml`.
- Guard scripts run as validation: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`.

## Findings

No new confirmed, likely, or risk-class tracer findings were identified in this cycle.

Evidence:

- The cycle-34 Lightroom restore race is fixed. `apps/web/src/app/api/admin/lr/upload/route.ts:95-105` acquires `acquireAdminMutationSlot()` before multipart parsing; `route.ts:267-294` re-checks restore maintenance and acquires the upload-processing contract lock before topic verification/save/insert/enqueue. This now mirrors browser upload fencing in `apps/web/src/app/actions/images.ts:87-160`.
- Restore imports are fenced by DB restore, upload-contract, color backfill, semantic backfill, and alt-text backfill locks before the durable marker is set (`apps/web/src/app/[locale]/admin/db-actions.ts:430-570`). The import then drains shared-group view counts, image queue, background DB writes, maintenance sweeps, and admin mutations before `runRestore` (`db-actions.ts:571-680`).
- Foreground admin mutations consistently hold the restore drain slot; the custom scanner passed and reported OK for upload, delete, settings, share, auth, topic, tag, token, collection, and admin-user mutations. The mechanism is defined in `apps/web/src/lib/admin-mutation-barrier.ts:76-134`.
- Queue/backfill write paths use per-image advisory claims through re-encode and persistence. The live queue checks pending row state before processing and conditionally updates `processed=false`; deleted-mid-processing rows clean all derivative size variants (`apps/web/src/lib/image-queue.ts:761-936`). In-app and sidecar backfills mirror the deleted-mid-reencode cleanup and avoid version bumps on detection failure (`apps/web/src/lib/admin-backfill-runner.ts:496-679`, `apps/web/scripts/backfill-color-pipeline.ts:487-623`).
- Delete cleanup records durable `pending_file_deletions` rows in the same transaction as image-row deletion, then drains filesystem cleanup after commit (`apps/web/src/app/actions/images.ts:678-728`, `apps/web/src/app/actions/images.ts:809-893`).
- Public view analytics pre-increment rate limits before durable writes, then wrap asynchronous inserts in the restore-drained background write tracker (`apps/web/src/app/actions/public.ts:377-475`, `apps/web/src/app/actions/public.ts:477-559`, `apps/web/src/lib/background-db-writes.ts:42-112`).
- Semantic and similar search reject invalid origin/maintenance early and charge the shared semantic limiter before DB-backed mode lookup or embedding scans (`apps/web/src/app/api/search/semantic/route.ts:107-184`, `apps/web/src/app/api/search/similar/[id]/route.ts:68-131`).
- Serving uploaded derivatives is constrained to `jpeg|webp|avif`, validates path segments/extensions, rejects symlinks, checks realpath containment, uses fd-stat for GET bodies, handles HEAD without opening a stream, and wires abort cleanup (`apps/web/src/lib/serve-upload.ts:162-384`).
- Migration protection is explicit: all 31 journal entries have matching SQL files; the journal remains historically non-monotonic, but `apps/web/scripts/migrate.js:877-993` separates pending migrations from drift, refuses unsafe DML baselining, and asserts every journal hash after migrate.

## Causal Chains And Hypotheses Cleared

- Upload chain: browser/LR entry guard -> admin mutation slot -> upload contract lock -> original save/GPS/HDR gates -> late restore cleanup -> DB insert -> queue enqueue -> per-image queue claim -> derivative write -> conditional processed update -> serve-upload/static serving. Competing hypotheses checked: LR bypassed restore drain, topic validation ran before the upload contract lock, post-save restore could insert after marker, and delete during processing could orphan derivatives. Current code has fences for each.
- Auth/admin chain: origin/session/PAT verification -> mutation slot -> rate-limit pre-increment where applicable -> DB mutation -> audit/revalidation. Competing hypotheses checked: cookie admin API lacking origin, mutating action without barrier, and restore resurrecting logged-out sessions. Guard scripts passed; restore flushes pending session revocations before reopening maintenance (`db-actions.ts:686-724`).
- Restore/backup chain: backup/restore advisory lock -> durable marker -> drain checklist -> import -> migration/reconcile postconditions -> marker clear/resume. Competing hypotheses checked: backup racing restore, queued analytics writing into import, admin mutation admitted pre-marker, and sidecar backfill writing during restore. Backup shares the restore lock; drains and durable marker checks cover the write paths inspected.
- Share/search/view chain: public validation -> rate-limit pre-increment -> bounded DB/read/insert work -> rollback only on documented no-work/error paths. Competing hypotheses checked: expensive search before limiter, public analytics inserts untracked by restore drain, share-key TOCTOU, and public PII through semantic enrichment. Current code charges before protected work, tracks async analytics writes, uses conditional share-key updates, and shares compile-guarded public select fields.
- Deploy/migration chain: deploy pulls/builds/health-checks/prunes only after success; migrations reconcile/baseline with hash postconditions; nginx is a committed template requiring operator apply. Competing hypotheses checked: deploy prune deleting persistent data, missing migration SQL, journal skip not detected, and nginx limiter assumed live by deploy. Source behavior matches documented contracts; live nginx application remains an operator validation item, not a new source defect.

## Validation

Fresh commands run:

```bash
npm run lint:api-auth --workspace=apps/web
npm run lint:action-origin --workspace=apps/web
npm run lint:public-route-rate-limit --workspace=apps/web
node -e "const j=require('./apps/web/drizzle/meta/_journal.json'); let ok=true, max=-Infinity; for (const e of j.entries){ if(e.when<=max){ console.log('non-monotonic', e.idx, e.tag, e.when, '<=', max); ok=false;} max=Math.max(max,e.when);} console.log('entries', j.entries.length, 'strictlyMonotonic', ok, 'maxWhen', max);"
node -e "const fs=require('fs'); const j=require('./apps/web/drizzle/meta/_journal.json'); const missing=j.entries.filter(e=>!fs.existsSync('./apps/web/drizzle/'+e.tag+'.sql')); console.log('missingSql', missing.length, missing.map(e=>e.tag).join(','));"
```

Results:

- Admin API auth lint passed for both admin API routes.
- Server-action origin and mutation-barrier lint passed.
- Public route rate-limit lint passed for upload derivative, health/live, OG, search, feed, and public upload routes.
- Migration journal inspection found 31 entries, 31 SQL files, and no missing SQL. The journal is still historically non-monotonic at entries 7-17, which is the documented condition handled by `migrate.js`.

## Final Sweep

Commonly missed issue classes explicitly checked:

- Pre-marker restore races in browser upload, LR upload, auth, settings, share, delete, and retry paths.
- Untracked background DB writes during restore.
- Delete-before-ledger and deleted-mid-reencode derivative orphaning.
- Rate-limit order for public search, load-more, view analytics, OG/feed route classes, and semantic/similar scans.
- Public privacy field leakage through listing, map exception, semantic enrichment, and similar-image enrichment selects.
- Upload/original path traversal, symlink, and legacy public-original fallback behavior.
- Migration journal/hash drift, reconcile coverage for current schema, and deploy prune persistence guarantees.
- Host nginx/app proxy split-brain and limiter-key caveats.

Skipped files:

- `node_modules`, `.next`, test-results, runtime upload/resource/backups directories, binary/image/font assets, and historical archive screenshots.
- I did not exhaustively re-read every historical `.context/reviews/archive/**` artifact. Current source, current instructions, and the previous tracer report were sufficient for this lane.
- I observed unrelated modified review files in the worktree (`.context/reviews/code-reviewer.md`, `critic.md`, `perf-reviewer.md`, `security-reviewer.md`, `verifier.md`) and did not touch them.

No product code was edited. This report is the only file changed by this tracer pass.
