# Cycle 10 Tracer Review

Date: 2026-07-07  
Persona: tracer  
Repository: `/Users/hletrd/flash-shared/gallery`  
Mode: read-only source review; only this report file was written.

## Inventory

- Project instructions and docs inspected: `AGENTS.md` from the prompt, `CLAUDE.md`, `apps/web/README.md`, prior `.context/reviews/tracer.md`, and the pre-existing untracked `.context/reviews/cycle10-2026-07-07/code-reviewer.md`.
- Source inventory inspected with `rg --files` / `find`: `apps/web/src/app`, `apps/web/src/lib`, `apps/web/src/db`, `apps/web/scripts`, `apps/web/drizzle`, deployment scripts, nginx config, and targeted tests.
- Upload/process/queue: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, and upload/queue tests.
- Auth/session/origin: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/proxy.ts`, admin API route files, and auth/origin lint gates.
- Public search: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, CLIP helpers, and semantic/similar tests.
- Schema migration/reconcile: `apps/web/scripts/migrate.js`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, Drizzle schema, and migration/reconcile tests.
- Deploy: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, and deploy contract tests.
- Maintenance/shutdown: `apps/web/src/instrumentation.ts`, `apps/web/src/lib/restore-maintenance*.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/lib/single-writer-guard.ts`, queue quiesce/shutdown paths, and related tests.
- Data privacy: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, map/privacy tests, JSON-LD/OG sanitizers, CSV escaping, and public select guards.

## Findings

No reportable findings.

I did not find a new causal defect that met the bar for a severity-rated finding in the required flow set. The main suspicious prior finding, semantic embedding storage keyed only by `image_id`, is now an intentional contract in this checkout rather than a bug: the docs and a dedicated test state that `image_embeddings` stores one active row per image and that changing model/mode replaces the prior vector (`apps/web/README.md:73-75`, `CLAUDE.md:160`, `apps/web/src/__tests__/semantic-embedding-storage-contract.test.ts:10-22`). The physical schema and writers match that active-row design (`apps/web/src/db/schema.ts:286-300`, `apps/web/drizzle/0012_image_embeddings.sql:5-11`, `apps/web/src/lib/image-queue.ts:512-523`).

## Flow Traces

### Upload / Process / Queue

Competing hypotheses:
- Unsafe: a browser or Lightroom upload can slip through restore maintenance, leave a private original behind, bypass GPS stripping, or enqueue stale processing settings.
- Safe: both upload paths fence restore/settings changes, clean late failures, snapshot processing settings, and queue work with bootstrap recovery.

Evidence:
- Browser upload checks restore maintenance, same-origin/admin, mutation drain slot, upload-processing contract lock, quota preclaim/settlement, topic existence, GPS strip/delete-on-fail, late restore cleanup, DB insert, and queue enqueue (`apps/web/src/app/actions/images.ts:129-652`).
- Lightroom upload uses token/cookie auth through `withAdminAuth`, rejects chunked/oversized bodies, preclaims upload quota, serializes multipart parsing, rechecks restore after parsing, acquires the same upload-processing contract lock, strips GPS originals, deletes originals on late restore or post-save failure, and enqueues with the full processing snapshot (`apps/web/src/app/api/admin/lr/upload/route.ts:84-611`).
- Queue processing guards restore, retries claim/delete races, resolves runtime semantic mode before embedding writes, atomically marks processed rows, records permanent failures, and has restore/shutdown quiesce paths (`apps/web/src/lib/image-queue.ts:485-535`, `apps/web/src/lib/image-queue.ts:670-1310`).

Conclusion: no finding. The Lightroom path does not hold `acquireAdminMutationSlot`, but restore acquires the upload-processing contract lock before import and aborts with `restoreBlockedByUpload` when a prior upload holds it (`apps/web/src/app/[locale]/admin/db-actions.ts:440-454`), so this route is fenced by the upload-specific advisory lock rather than the server-action barrier.

### Auth / Session / Origin

Competing hypotheses:
- Unsafe: a new admin API route or mutating action relies on cookies without a trusted same-origin check.
- Safe: API wrappers and action lint gates enforce origin/auth centrally.

Evidence:
- `withAdminAuth` enforces token scope for PAT requests and trusted same-origin for cookie-authenticated admin API calls before `isAdmin()` (`apps/web/src/lib/api-auth.ts:58-144`).
- `hasTrustedSameOrigin` fails closed unless `Origin` or `Referer` matches the expected host/protocol (`apps/web/src/lib/request-origin.ts:79-107`).
- `npm run lint:api-auth --workspace=apps/web` passed and covered both admin API routes.
- `npm run lint:action-origin --workspace=apps/web` passed and reported every mutating action as guarded or explicitly exempt/read-only.

Conclusion: no finding.

### Public Search

Competing hypotheses:
- Unsafe: anonymous search can bypass rate limits, serve production-labeled stub embeddings, or leak private fields through enrichment.
- Safe: search is same-origin, pre-increment rate-limited before DB/embedding work, mode-gated, and enrichment is compile-guarded.

Evidence:
- Semantic POST requires same-origin, JSON content type, non-chunked bounded body, rate-limit pre-increment before config lookup, active-mode gating, active model-version scan, and no-store responses (`apps/web/src/app/api/search/semantic/route.ts:107-305`).
- Similar GET requires same-origin, positive id, shared semantic limiter, production-only mode, production target embedding lookup, production scan, and score stripping (`apps/web/src/app/api/search/similar/[id]/route.ts:68-285`).
- Enrichment fields are shared and type-guarded against `PrivacySensitiveKeys` (`apps/web/src/lib/search-enrichment-fields.ts:29-47`).
- Targeted semantic tests passed: 4 files, 44 tests.

Conclusion: no finding.

### Schema Migration / Reconcile

Competing hypotheses:
- Unsafe: non-monotonic Drizzle journal timestamps or reconcile baselining can silently skip committed SQL.
- Safe: the migration script distinguishes pending migrations from drift, refuses unsafe baselining, mirrors current DDL, and verifies all journal hashes after migrate.

Evidence:
- Reconcile mirrors table/column/index/FK shape, including current image, analytics, smart collection, and embedding schema (`apps/web/scripts/migrate.js:348-730`).
- Baseline logic refuses above-cursor entries and DML-bearing entries unless explicitly allowlisted (`apps/web/scripts/migrate.js:784-841`).
- Pending-vs-drift split leaves true pending migrations for Drizzle and only baselines at/below-cursor drift (`apps/web/scripts/migrate.js:858-947`).
- Run post-condition verifies every committed migration hash is recorded (`apps/web/scripts/migrate.js:949-974`).
- Targeted migration tests passed: 6 files, 137 tests.

Conclusion: no finding.

### Deploy

Competing hypotheses:
- Unsafe: deploy prunes live data/images, sources unsafe env files, or boots without migrations.
- Safe: deploy is config-driven, refuses unsafe env permissions, health-checks before prune, keeps persistence on bind mounts, and runs migration before server start.

Evidence:
- Remote deploy env selection is config-driven and refuses group/world-readable deploy env files before sourcing (`scripts/deploy-remote.sh:22-93`).
- Runtime deploy refuses unsafe `.env.local`, runs compose, waits for health, then prunes only after health succeeds (`apps/web/deploy.sh:15-77`, `apps/web/deploy.sh:79-104`).
- Runtime container runs `node apps/web/scripts/migrate.js && exec node apps/web/server.js`, so migration failure blocks boot and `exec` preserves signal delivery (`apps/web/Dockerfile:190-197`).
- Compose bind-mounts only `data`, `public/uploads`, `public/resources`, and read-only site config, matching the prune safety contract (`apps/web/docker-compose.yml:24-32`).

Conclusion: no finding.

### Maintenance / Shutdown

Competing hypotheses:
- Unsafe: restore can import over in-flight writes, or shutdown can drop queued writes/view counters.
- Safe: restore marks durable maintenance, drains queues/background/foreground writes before import, and shutdown races a bounded drain against an explicit timeout.

Evidence:
- Restore acquires DB restore, upload-processing, color-backfill, and semantic-backfill locks; begins durable restore maintenance; flushes shared view counts; quiesces image processing; drains background DB writes, maintenance sweeps, and foreground admin mutations before `runRestore` (`apps/web/src/app/[locale]/admin/db-actions.ts:405-620`).
- Admin mutation barrier blocks new shared slots while restore drains current ones (`apps/web/src/lib/admin-mutation-barrier.ts:76-135`).
- Startup syncs durable restore marker before queue bootstrap (`apps/web/src/instrumentation.ts:1-10`).
- Shutdown drains image queue, shared view counts, background DB writes, and the single-writer guard, then exits `0` only when completed before timeout (`apps/web/src/instrumentation.ts:33-84`).

Conclusion: no finding.

### Data Privacy

Competing hypotheses:
- Unsafe: public listing/search/timeline/map routes can leak original filenames, GPS, uploader IDs, or admin-only HDR/color details.
- Safe: public selects are derived from admin selects by explicit omission, mirrors carry type/runtime tests, and the only public GPS route is opt-in by topic.

Evidence:
- `publicSelectFields` omits every `PrivacySensitiveKeys` member; `publicMapSelectFields` allows only GPS in addition to public fields and has a separate type guard (`apps/web/src/lib/data.ts:410-488`).
- Timeline and search enrichment mirrors reuse the privacy-sensitive key type and test fixtures (`apps/web/src/lib/data-timeline.ts:20-73`, `apps/web/src/lib/search-enrichment-fields.ts:29-47`).
- Public map GPS output is restricted to processed images in `topics.map_visible=true` with both latitude and longitude present, plus runtime assertion (`apps/web/src/lib/data.ts:1743-1783`).
- Privacy tests passed: 3 files, 26 tests.

Conclusion: no finding.

## Final Missed-Issues Sweep

The final sweep searched for TODO/FIXME/HACK markers, origin/rate-limit exemptions, public route exemptions, `dangerouslySetInnerHTML`, raw SQL, spawned child processes, advisory lock use, duplicate-key writes, ignored inserts, timers, shutdown paths, and empty catches across `apps/web/src`, `apps/web/scripts`, migrations, deploy scripts, and the cycle 10 reviewer artifact. No additional high-confidence causal issue surfaced.

Validation run:
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm test --workspace=apps/web -- src/__tests__/semantic-embedding-storage-contract.test.ts src/__tests__/backfill-clip-embeddings-reembed.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts` passed: 4 files, 44 tests.
- `npm test --workspace=apps/web -- src/__tests__/privacy-fields.test.ts src/__tests__/map-privacy.test.ts src/__tests__/search-route-privacy.test.ts` passed: 3 files, 26 tests.
- `npm test --workspace=apps/web -- src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/migrate-pending-migrations.test.ts src/__tests__/migration-journal.test.ts src/__tests__/restore-upload-lock.test.ts src/__tests__/image-queue-quiesce.test.ts src/__tests__/deploy-script-contract.test.ts` passed: 6 files, 137 tests.

Residual risk:
- This was a targeted tracer review, not a full `npm test` / `npm run build` rerun.
- I did not run Playwright e2e because no browser-flow-specific finding surfaced.
- No source files were edited.
