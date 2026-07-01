# Cycle 92 Debugger Review

Review date: 2026-07-01 cycle label; executed in `/tmp/gallery-recovery-check` on 2026-07-02 Asia/Seoul.
HEAD reviewed: `a2a9e40` (`docs(review): 📝 surface cycle 92 test risks`).
Lane: debugger — latent bug surfaces, failure modes, race conditions, edge-case regressions, and error handling across the full repo.

## Inventory First

I read the workspace contracts before analysis: `AGENTS.md` and `CLAUDE.md`.

Tracked inventory built before forming findings:

- Total tracked files: 3172 (`git ls-files`).
- App source: 559 files under `apps/web/src/`.
- Route/action surface sampled: 69 tracked `.ts/.tsx` files under `apps/web/src/app/` including public pages, admin pages, API routes, upload-serving routes, and server actions.
- Components: 59 files under `apps/web/src/components/`.
- Library/data/security/processing helpers: 106 files under `apps/web/src/lib/`.
- Scripts: 29 files under `apps/web/scripts/`.
- Drizzle SQL migrations: 29 SQL files under `apps/web/drizzle/` plus metadata.
- Unit/source-contract tests: 309 files under `apps/web/src/__tests__/`.
- Runtime/config/deploy files reviewed: root/app `package.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/drizzle/meta/_journal.json`, and cycle context files already present under `.context/reviews/cycle-92-2026-07-01/`.

High-risk code paths inspected with exact line evidence below:

- Restore and maintenance fencing: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/settings.ts`.
- Upload/processing queue and retries: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`.
- Semantic search/model-version storage: `apps/web/src/db/schema.ts`, `apps/web/drizzle/0012_image_embeddings.sql`, `apps/web/drizzle/0022_image_embeddings_model_version_idx.sql`, `apps/web/src/lib/image-queue.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`.
- Auth, origin, and rate-limit surfaces: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, public route/action scanners.
- Public read/error paths: share routes, topic/smart collection routes, public search/load-more actions, analytics view writers, upload serving route, backup download route.
- Data privacy/schema/runbooks: `apps/web/src/lib/data.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/scripts/migrate.js`, `apps/web/src/lib/sql-restore-scan.ts`, `CLAUDE.md` operational sections.

## Summary

| ID | Status | Severity | Confidence | Area |
| --- | --- | --- | --- | --- |
| DBG-C92-01 | Confirmed issue | High | High | Restore/admin mutation race |
| DBG-C92-02 | Confirmed issue | Medium | High | Semantic embedding version storage |
| DBG-C92-03 | Likely issue | Medium | Medium-High | Image queue retry/error handling |
| MV-C92-01 | Manual-validation risk | Medium | Medium | Runtime `site-config.json` contract |
| MV-C92-02 | Manual-validation risk | Medium | High | Proxy/IP rate-limit deployment config |
| MV-C92-03 | Manual-validation risk | High if topology changes | High | Process-local coordination / scale-out |
| MV-C92-04 | Manual-validation risk | Medium | High | Failed restore recovery path |

No critical unauthenticated auth bypass, path traversal, migration-journal mismatch, public PII leak, or missing route/action auth-rate-limit wrapper was confirmed in this pass.

## Confirmed Issues

### DBG-C92-01 — Restore maintenance does not fence already-in-flight non-upload admin mutations

Severity: **High**
Confidence: **High**
Category: race condition / restore safety / cross-file mutation invariant

Evidence:

- `restoreDatabase` takes the DB restore advisory lock at `apps/web/src/app/[locale]/admin/db-actions.ts:390`-`398`.
- It explicitly takes the upload-processing contract lock for the restore window at `apps/web/src/app/[locale]/admin/db-actions.ts:400`-`410`.
- It also fences color and semantic backfills via advisory locks at `apps/web/src/app/[locale]/admin/db-actions.ts:413`-`447`.
- Durable/process restore maintenance begins only after those locks at `apps/web/src/app/[locale]/admin/db-actions.ts:449`-`452`, then the restore path flushes/quiesces queue/background work at `apps/web/src/app/[locale]/admin/db-actions.ts:492`-`503`.
- The maintenance flag used by ordinary server actions is process-local and a point-in-time boolean read: `isRestoreMaintenanceActive()` returns `getRestoreMaintenanceState().active` at `apps/web/src/lib/restore-maintenance.ts:21`-`23`, and `getRestoreMaintenanceMessage()` only checks that flag at `apps/web/src/lib/restore-maintenance.ts:29`-`31`.
- Representative non-upload mutation `updateTopic` checks maintenance once at entry (`apps/web/src/app/actions/topics.ts:182`-`185`), then does awaited work before the final write window: current-topic read at `apps/web/src/app/actions/topics.ts:232`-`235` and optional topic-image processing at `apps/web/src/app/actions/topics.ts:240`-`243`.
- The same `updateTopic` then enters its own route lock/transaction later at `apps/web/src/app/actions/topics.ts:249`-`256` and performs multiple table writes: inserting the new topic at `apps/web/src/app/actions/topics.ts:285`-`291`, updating `images`/`topicAliases` at `apps/web/src/app/actions/topics.ts:292`-`293`, updating `topicViews` at `apps/web/src/app/actions/topics.ts:301`, rewriting smart-collection JSON at `apps/web/src/app/actions/topics.ts:331`-`334`, and deleting the old topic at `apps/web/src/app/actions/topics.ts:338`-`339`.
- Representative settings mutation has the same one-time-check shape: `updateGallerySettings` checks maintenance at `apps/web/src/app/actions/settings.ts:41`-`44`, performs awaited DB reads at `apps/web/src/app/actions/settings.ts:93`-`116` and `apps/web/src/app/actions/settings.ts:137`-`154`, then writes `admin_settings` inside a later transaction at `apps/web/src/app/actions/settings.ts:163`-`175`.

Why this is a bug:

An admin action can pass its entry maintenance check, then `restoreDatabase` can enter durable maintenance, and the already-running action can still perform application-table writes during or after the restore import starts. Uploads/backfills have dedicated locks; broad non-upload admin writers do not share a restore write barrier. This can cause lost updates, writes into a database being dropped/recreated, stale revalidation/audit events, or DB/filesystem split-brain depending on timing.

Recommended fix:

Add a shared foreground admin mutation barrier for final write windows, not just action entry. For example, wrap every application-table writer in `withRestoreWriteBarrier(actionName, fn)` that acquires a restore-mutating advisory lock also held by `restoreDatabase`, and rechecks durable/process maintenance immediately before the transaction/write. Cover `topics`, `tags`, `images`, `settings`, `sharing`, `collections`, `admin-users`, `lr-tokens`, `seo`, and in-app backfill trigger paths. Add a regression test where restore begins after a representative action's entry check but before its transaction.

### DBG-C92-02 — `image_embeddings` filters by model version but can store only one version per image

Severity: **Medium**
Confidence: **High**
Category: schema/query mismatch / rollback and model-upgrade failure mode

Evidence:

- Drizzle defines `imageEmbeddings.imageId` as the primary key at `apps/web/src/db/schema.ts:284`-`285`; `modelVersion` is a normal non-key column at `apps/web/src/db/schema.ts:289`-`290`.
- The physical migration matches one row per image: `apps/web/drizzle/0012_image_embeddings.sql:5`-`11` creates `PRIMARY KEY (image_id)`.
- The later serving index adds `(model_version, updated_at)` only; it does not permit multiple versions per image: `apps/web/drizzle/0022_image_embeddings_model_version_idx.sql:1`-`9`.
- Semantic search selects an active model version at `apps/web/src/app/api/search/semantic/route.ts:186`-`204` and scans rows filtered by that version at `apps/web/src/app/api/search/semantic/route.ts:263`-`279`.
- Similar-photo search is production-only and requires `PRODUCTION_MODEL_VERSION` for both the target row and scan rows: `apps/web/src/app/api/search/similar/[id]/route.ts:135`-`143` and `apps/web/src/app/api/search/similar/[id]/route.ts:168`-`177`.
- The queue writer upserts on the primary key and overwrites `modelVersion` for the image: `apps/web/src/lib/image-queue.ts:379`-`390`.
- The sidecar backfill intentionally selects rows missing the target version (`apps/web/scripts/backfill-clip-embeddings.ts:161`-`180`) but then also upserts on the same single-row primary key and overwrites `modelVersion`: `apps/web/scripts/backfill-clip-embeddings.ts:212`-`223`.
- The in-process bootstrap similarly looks for missing active-version rows at `apps/web/src/lib/image-queue.ts:404`-`422` and stores through the same single-row overwrite path at `apps/web/src/lib/image-queue.ts:433` and `apps/web/src/lib/image-queue.ts:379`-`390`.

Why this is a bug:

The read path and index design are version-aware, but persistence is destructive across versions. Switching between stub and production, rolling back semantic mode, or introducing a future production model version replaces prior embeddings image-by-image. During a migration, active-version queries can be empty or partial until the current active version is fully re-embedded, and rollback is another destructive re-embedding pass instead of a safe version switch.

Recommended fix:

Migrate to one row per `(image_id, model_version)` with a composite primary key or unique key. Update Drizzle schema, migrations, `reconcileLegacySchema` in `apps/web/scripts/migrate.js`, queue writes, sidecar backfill, and route queries. Add a test that stores two model versions for one image and proves active-version scans select only the requested version without deleting the other.

## Likely Issues

### DBG-C92-03 — Transient queue/DB infrastructure errors can create invisible stuck pending images until process restart

Severity: **Medium**
Confidence: **Medium-High**
Category: background processing failure mode / admin recovery visibility

Evidence:

- Each queue job first acquires a DB connection and advisory lock at `apps/web/src/lib/image-queue.ts:469`-`485`, and the worker awaits that claim at `apps/web/src/lib/image-queue.ts:542`.
- Any thrown error in the worker's main try block reaches the generic retry/permanent-failure handler at `apps/web/src/lib/image-queue.ts:758`-`769`; the handler does not distinguish corrupt image/input errors from transient DB/pool failures.
- After three failures, the job is marked permanently failed in process memory at `apps/web/src/lib/image-queue.ts:771`-`778`.
- The code then attempts to persist `processing_error`/`failed_at` at `apps/web/src/lib/image-queue.ts:801`-`807`, but if that DB write fails it only logs at `apps/web/src/lib/image-queue.ts:808`-`810`; it does not remove the id from `permanentlyFailedIds` or schedule a different recovery path.
- Bootstrap excludes in-memory permanently failed ids at `apps/web/src/lib/image-queue.ts:898`-`906`, and also only selects pending rows where `processing_error IS NULL` at `apps/web/src/lib/image-queue.ts:900`.
- The admin failed-image dashboard only shows rows with `processed=false AND processing_error IS NOT NULL`: `apps/web/src/lib/data.ts:1019`-`1041`.
- The admin retry action likewise requires `processing_error IS NOT NULL`: `apps/web/src/app/actions/images.ts:1224`-`1250`.

Failure scenario:

If MySQL/pool access is unavailable long enough for a queued image to hit the three-attempt limit, the same outage can make the permanent-failure persistence update fail. The process then has the id in `permanentlyFailedIds`, so bootstrap will not rediscover it, while the DB row still has `processed=false` and `processing_error=NULL`, so the admin failed-image panel and retry action cannot see it. A process restart clears the in-memory set and may recover, but until then the image can stay pending and invisible.

Recommended fix:

Classify infrastructure/DB failures separately from deterministic image-processing failures. If the final `processing_error` persistence update fails, do not keep the id in `permanentlyFailedIds`; leave it discoverable for bootstrap with exponential backoff or a DB-health retry queue. Add a regression test where `connection.getConnection()` or the final `db.update(images)` fails through the retry limit and prove the row remains either admin-retry-visible or bootstrap-discoverable.

## Manual-Validation Risks

### MV-C92-01 — Runtime `site-config.json` bind mount may not match static-import behavior

Severity: **Medium**
Confidence: **Medium**
Status: **Manual validation needed in built standalone/Docker image**

Evidence:

- Compose bind-mounts host `./src/site-config.json` into the running container at `apps/web/docker-compose.yml:24`-`28`.
- The Docker build validates `site-config.json` before `next build` at `apps/web/Dockerfile:96`-`100`, then copies the standalone output and public assets into the runtime image at `apps/web/Dockerfile:130`-`145`.
- Runtime consumers statically import JSON: layout imports `siteConfig` at `apps/web/src/app/[locale]/layout.tsx:11` and uses it for GA script inclusion at `apps/web/src/app/[locale]/layout.tsx:147`-`155`; the client nav imports it at `apps/web/src/components/nav-client.tsx:14` and uses `home_link` at `apps/web/src/components/nav-client.tsx:72`-`74`; SEO fallback uses it at `apps/web/src/lib/data.ts:1793`-`1800`.
- CLAUDE documents `site-config.json` as imported directly and partly static/build-time fallback: `CLAUDE.md:663`-`673`.

Risk:

If operators treat the bind mount as a runtime-editable config, static imports may be bundled into server/client artifacts and not reflect host JSON edits without rebuild. Client-side `home_link` and GA inclusion are especially likely to be build-bound. This is not fully confirmed without inspecting the generated standalone bundle or Docker smoke behavior.

Recommended validation/fix:

Run a Docker/standalone smoke: build once, change the mounted `src/site-config.json`, restart without rebuild, and verify `home_link`, GA script inclusion, and SEO fallback behavior. Then document one contract: rebuild-required static config, or true runtime config via a validated server-side loader plus client-safe prop injection.

### MV-C92-02 — Proxy/IP rate-limit correctness depends on production proxy env staying aligned

Severity: **Medium**
Confidence: **High** for the dependency; no current compose misconfig found

Evidence:

- `docker-compose.yml` sets `TRUST_PROXY: "true"` for the web service at `apps/web/docker-compose.yml:20`-`22`.
- `getClientIp()` trusts `x-forwarded-for`/`x-real-ip` only when `TRUST_PROXY === 'true'`: `apps/web/src/lib/rate-limit.ts:166`-`189`.
- If proxy headers are present but `TRUST_PROXY` is not set in production, it returns the literal bucket key `unknown` and logs that all users share one rate-limit bucket: `apps/web/src/lib/rate-limit.ts:191`-`196`; the warning predicate is at `apps/web/src/lib/rate-limit.ts:199`-`208`.
- Origin host/proto also changes behavior based on trusted proxy headers: `apps/web/src/lib/request-origin.ts:45`-`68`.

Risk:

Current compose is correct, but any deployment override that drops `TRUST_PROXY=true` behind nginx/CDN collapses IP-based buckets into `unknown`, causing shared lockouts and weaker public rate-limit behavior. Misconfigured `TRUSTED_PROXY_HOPS` can also select the wrong XFF hop.

Recommended validation:

Include `TRUST_PROXY=true` and expected `TRUSTED_PROXY_HOPS` in deployment smoke evidence. Exercise one request through the real proxy and confirm app logs/rate-limit buckets see the real client hop, not `unknown` or a proxy address.

### MV-C92-03 — Correctness assumes the documented single web-instance topology

Severity: **High if topology changes**
Confidence: **High**

Evidence:

- CLAUDE explicitly documents the shipped deployment as a **single web-instance / single-writer** topology and warns that restore maintenance, upload quota tracking, image queue state, backfill status, in-memory rate-limit fast paths, and shared-group view buffering are process-local: `CLAUDE.md:235`.
- The image queue state is stored on `globalThis` with in-process `Set`/`Map` state at `apps/web/src/lib/image-queue.ts:277`-`340`.
- Restore maintenance process state is also `globalThis`-backed at `apps/web/src/lib/restore-maintenance.ts:1`-`27`, with durable-marker sync only at startup/recovery boundaries (`apps/web/src/lib/restore-maintenance-durable.ts:88`-`106`).
- Shared-group view counts buffer in module-level maps/timers at `apps/web/src/lib/data.ts:13`-`41`.

Risk:

A horizontal scale-out or multiple Node worker topology would weaken or break parts of upload tracking, queue visibility, public fast-path rate limiting, shared-group view flushing, and in-process restore state unless those states move to MySQL/Redis/shared locks. Some advisory locks protect correctness, but not all status/rate-limit/buffer semantics are distributed.

Recommended validation:

Keep deploy topology single-instance unless a dedicated distributed-state migration is done. Add a startup assertion or deployment health note that reports instance count/state-backend assumptions.

### MV-C92-04 — Failed restore intentionally leaves durable maintenance active and needs operator recovery evidence

Severity: **Medium**
Confidence: **High**

Evidence:

- Restore failure paths resolve with `keepMaintenance: true` for timeout/stdin/spawn/read failures at `apps/web/src/app/[locale]/admin/db-actions.ts:686`-`696`, post-restore migration failure at `apps/web/src/app/[locale]/admin/db-actions.ts:731`-`733`, and nonzero mysql exit at `apps/web/src/app/[locale]/admin/db-actions.ts:745`-`747`.
- `restoreDatabase` only clears durable maintenance when restore succeeded or `keepMaintenance` is false: `apps/web/src/app/[locale]/admin/db-actions.ts:507`-`519`.
- The recovery script exposes `status` and guarded `clear --confirm-clear-restore-maintenance`: `apps/web/scripts/restore-maintenance-recovery.mjs:52`-`87`.
- CLAUDE documents that a failed restore can require the recovery command and restart/redeploy to reset process-local state: `CLAUDE.md:398`-`401`.

Risk:

This is intentional fail-closed behavior, not a source bug. The operational risk is that a failed restore leaves the site in maintenance until an authorized operator runs the documented recovery and restarts/redeploys if needed.

Recommended validation:

For any restore failure drill, record marker status, recovery command output, process restart/redeploy evidence, and a post-recovery `/api/health` smoke.

## Positive Findings / Guardrails Confirmed

- Admin API wrapper scan passed via `NODE_OPTIONS='--import tsx' node scripts/check-api-auth.ts`: both admin API route exports are wrapped (`src/app/api/admin/db/download/route.ts`, `src/app/api/admin/lr/upload/route.ts`).
- Mutating server-action origin scan passed via `NODE_OPTIONS='--import tsx' node scripts/check-action-origin.ts`; mutating admin actions enforce `requireSameOriginAdmin()` or have approved exemptions, and public view-record actions are rate-limited.
- Public route rate-limit scan passed via `NODE_OPTIONS='--import tsx' node scripts/check-public-route-rate-limit.ts`; expensive public API routes are rate-limited or carry explicit exemptions.
- Migration/journal inventory matched: 29 journal entries, 29 SQL files, no missing/extra SQL files. The historical non-monotonic `when` values remain present, but the latest `when` is the max and `migrate.js` contains the post-condition hash assertion at `apps/web/scripts/migrate.js:803`-`823`.
- Public share key/data paths validate key shape before lookup (`apps/web/src/lib/data.ts:1234`-`1238`, `apps/web/src/lib/data.ts:1300`-`1305`) and omit public PII via guarded field sets (`apps/web/src/lib/data.ts:375`-`404`, `apps/web/src/lib/data.ts:417`-`445`, `apps/web/src/__tests__/privacy-fields.test.ts:7`-`45`).
- Upload serving validates path segments, symlinks, containment, file type, ETag, HEAD behavior, and stream cleanup in `apps/web/src/lib/serve-upload.ts:133`-`202` and `apps/web/src/lib/serve-upload.ts:229`-`327`.
- Backup download uses authenticated route wrapper and opens the already-validated realpath handle for streaming: `apps/web/src/app/api/admin/db/download/route.ts:21`-`57` and `apps/web/src/app/api/admin/db/download/route.ts:58`-`108`.

## Validation Evidence and Gaps

Commands run successfully:

- `NODE_OPTIONS='--import tsx' node scripts/check-api-auth.ts` from `apps/web` — passed.
- `NODE_OPTIONS='--import tsx' node scripts/check-action-origin.ts` from `apps/web` — passed.
- `NODE_OPTIONS='--import tsx' node scripts/check-public-route-rate-limit.ts` from `apps/web` — passed.
- Python journal/SQL inventory check — 29 entries, 29 SQL, no missing/extra SQL.

Commands attempted but blocked by this sandbox:

- `omx explore --prompt ...` failed with app-server initialization `Operation not permitted`; I fell back to direct repository inspection.
- `npm run lint:api-auth --workspace=apps/web`, `npm run lint:action-origin --workspace=apps/web`, and `npm run lint:public-route-rate-limit --workspace=apps/web` failed because the `tsx` CLI tried to create a pipe under `/var/folders/.../T/tsx-501/*.pipe` and received `listen EPERM`. The equivalent `NODE_OPTIONS='--import tsx' node scripts/...` invocations passed.

Not run in this debugger lane:

- Full ESLint, typecheck, build, full Vitest, and Playwright e2e. This was a static/debugger review, and the user constrained writes to this report file only.
- Docker/standalone smoke, production CLIP inference, real restore drills, and live proxy/IP validation.

## Final Missed-Issue Sweep

After forming the findings, I performed an additional sweep over:

- Route/action inventories and scanner output for missing admin auth, same-origin guards, and public rate-limit pre-increments.
- Grep classes: `TODO`, `FIXME`, `@ts-ignore`, `@ts-expect-error`, `dangerouslySetInnerHTML`, `spawn`, `GET_LOCK`, `RELEASE_LOCK`, `isRestoreMaintenanceActive`, `processing_error`, `failed_at`, `modelVersion`, `siteConfig`, timers, background `void`, `Promise.all`/`allSettled`, file `unlink`/`rename`/`createReadStream`/`createWriteStream`, and JSON parse sites.
- High-risk data helpers around cursor pagination, smart-collection parsing/compilation, topic alias routing, feed data, public search, map GPS privacy, shared single/group pages, and analytics view buffering.
- SQL restore scanning, migration reconciliation, DB connection initialization, admin tokens, session/origin checks, public upload serving, backup download streaming, and CLIP model inference queueing.
- Existing cycle-92 review artifacts already present in `.context/reviews/cycle-92-2026-07-01/` to avoid missing active deferred issues while independently confirming line evidence.

No further confirmed issues were found beyond the findings above. This report is the only file I wrote.
