# Cycle 21 Tracer Review

Scope: repository-wide causal tracing review at HEAD `45b32d1db373e03d82a29511f53832051c770880` for `/Users/hletrd/flash-shared/gallery`.

Required context read first: `AGENTS.md`, `CLAUDE.md`, and `.context/plans/README.md`.

Validation evidence:

- `git rev-parse HEAD` returned `45b32d1db373e03d82a29511f53832051c770880`.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Existing dirty files under `.context/reviews/` were treated as concurrent work and left untouched.

## Trace Inventory

### Upload -> Queue -> Process -> Serve

- Browser upload enters `apps/web/src/app/actions/images.ts:129-653`: restore maintenance gate, same-origin guard, admin mutation barrier, admin identity, file/topic/tag validation, upload-processing contract lock, config snapshot, quota preclaim, disk free check, topic existence check, original save, HDR/GPS policy, late restore recheck, DB insert, tag insert, queue enqueue, quota settle, audit, and revalidation.
- Lightroom upload enters `apps/web/src/app/api/admin/lr/upload/route.ts:84-634`: `withAdminAuth(..., { allowTokenScope: 'lr:upload' })`, restore and body-size gates, upload tracker preclaim before multipart parse, post-parse restore recheck, upload contract lock, topic/settings/disk checks, original save, HDR/GPS parity, DB insert, post-commit PAT touch, enqueue, audit, and revalidation.
- Processing is owned by `apps/web/src/lib/image-queue.ts:668-993`: per-image advisory claim, pending-row check, original resolution, upload-time processing snapshot fallback to current config for legacy rows, atomic derivative generation, nonzero derivative verification, conditional `processed=true` update, deleted-mid-process derivative cleanup, tracked caption and embedding side effects.
- Original and derivative file lifecycle is handled in `apps/web/src/lib/process-image.ts:864-1462` and `apps/web/src/lib/upload-paths.ts:68-171`: private original root, safe names/extensions, EXIF/color extraction, 0600 original writes, atomic derivative writes with rollback/backup cleanup, and original deletion containment.
- Public derivative serving is routed through `apps/web/src/app/uploads/[...path]/route.ts:1-22`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:1-20`, and `apps/web/src/lib/serve-upload.ts:162-380`: directory/extension allowlist, segment validation, realpath containment, no-symlink serving, ETag with pipeline/settings hash, 304 and HEAD no-body fast paths, fd-stat GET streaming, abort cleanup.

### Restore Maintenance

- Restore action is in `apps/web/src/app/[locale]/admin/db-actions.ts:420-713`: same-origin/admin gate, dedicated advisory-lock connection, DB-restore lock, upload-processing contract lock, color and semantic backfill locks, durable maintenance marker, ordered drain checklist, restore import, post-restore migrate, marker clear/keep behavior, queue resume, pending session revocation flush, and lock release.
- Restore SQL ingestion is in `apps/web/src/app/[locale]/admin/db-actions.ts:717-954`: file cap, temp stream, plausible SQL header, mysqldump completion trailer, chunked dangerous-SQL scan using actual bytes read, minimal mysql child env, watchdog, stderr redaction, and maintenance retention on import/migration failure.
- Durable marker handling is in `apps/web/src/lib/restore-maintenance-durable.ts:24-120`: `/app/data` marker resolution, fail-closed read, process flag sync at boot, write rollback only when this call started maintenance, clear on successful recovery.
- Restore drains cover shared group view counts, image queue, background DB writes, maintenance sweeps, and admin mutations via `apps/web/src/app/[locale]/admin/db-actions.ts:580-635`; the shared-group drain helper is declared at `apps/web/src/app/[locale]/admin/db-actions.ts:47-57`.

### Auth / Session Revocation

- Login path in `apps/web/src/app/actions/auth.ts:79-273`: maintenance gate, trusted same-origin check, mutation barrier, IP/account pre-increment rate limits, Argon2 dummy-hash timing equalization, transactional new-session insert plus old-session delete, secure cookie decision from trusted protocol.
- Logout path in `apps/web/src/app/actions/auth.ts:275-317`: trusted same-origin redirect gate, DB-side session revocation under mutation slot when possible, queued pending revocation during restore/barrier failures, cookie deletion regardless.
- Password update path in `apps/web/src/app/actions/auth.ts:319-487`: trusted same-origin check before user read, maintenance and mutation barrier, pre-incremented password-change limit, Argon2 verification, transactional password change plus session rotation, fresh cookie.
- Session primitives and pending revocation flush are in `apps/web/src/lib/session.ts` and `apps/web/src/lib/pending-session-revocations.ts:1-75`; the accepted residual risk is process-local revocation loss on crash after cookie clear.

### Server Actions / Admin Mutation Barriers

- Scanner gate passed and currently enforces same-origin plus mutation-barrier shape. Relevant scanner/source-contract regions: `apps/web/scripts/check-action-origin.ts:52-169`, `apps/web/scripts/check-action-origin.ts:1371-1482`, and `apps/web/src/__tests__/check-action-origin.test.ts:620-742`.
- Real admin mutating action families inspected: `apps/web/src/app/actions/images.ts`, `topics.ts`, `tags.ts`, `settings.ts`, `sharing.ts`, `collections.ts`, `lr-tokens.ts`, `admin-users.ts`, `embeddings.ts`, `admin-backfill.ts`, and `auth.ts`.
- Barrier implementation is `apps/web/src/lib/admin-mutation-barrier.ts`: shared slots reject while exclusive restore is active, and restore drains foreground mutations before import.

### Public Routes / Rate Limits

- Public API route inventory includes `route.ts` and `route.tsx`: `apps/web/src/app/api/health/route.ts`, `live/route.ts`, `search/semantic/route.ts`, `search/similar/[id]/route.ts`, `api/og/route.tsx`, and `api/og/photo/[id]/route.tsx`; admin API routes are under `api/admin`.
- Public route lint passed via `apps/web/scripts/check-public-route-rate-limit.ts`, which includes `route.tsx` and scans expensive GET/HEAD plus mutating methods.
- Semantic routes charge before protected DB/embedding work: `apps/web/src/app/api/search/semantic/route.ts:107-270` and `apps/web/src/app/api/search/similar/[id]/route.ts:68-230`.
- OG routes have route-specific in-memory limits and no-store failure caching: `apps/web/src/app/api/og/route.tsx:71-270` and `apps/web/src/app/api/og/photo/[id]/route.tsx:82-430`.
- Upload derivative routes carry explicit no-rate-limit exemptions backed by path containment, cache validators, and abort cleanup.

### Semantic Search / Backfills

- Queue writes embeddings only after `processed=true` and resolves mode at write time: `apps/web/src/lib/image-queue.ts:943-993`.
- Public semantic search filters by active model version and bounded scan limit: `apps/web/src/app/api/search/semantic/route.ts:186-270`; similar search is production-only and filters target/scan rows by `PRODUCTION_MODEL_VERSION`: `apps/web/src/app/api/search/similar/[id]/route.ts:115-190`.
- Admin action backfill is fenced by same-origin, mutation barrier, per-admin rate limit, semantic advisory lock, maintenance recheck, and active-model selection: `apps/web/src/app/actions/embeddings.ts:59-165`.
- Operator sidecar backfill checks durable restore marker before start, after lock, per loop, and before writes; it uses target model-version `notExists` selection and bounded concurrency: `apps/web/scripts/backfill-clip-embeddings.ts:109-260`.
- CLIP runtime is dark by default unless production mode/env/model-root requirements are satisfied in `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/clip-model.ts`, and `apps/web/src/lib/clip-embeddings.ts`.

### Service Worker Caching

- Route classification in `apps/web/public/sw.template.js:51-72`: derivative paths are handled by SWR, admin routes bypass, photo/share/group/collection/map HTML pages bypass offline HTML cache as revocable/public-object pages.
- Image cache path in `apps/web/public/sw.template.js:312-443`: cached derivatives perform bounded HEAD revalidation with `If-None-Match`, evict on 404/410, preserve freshness on 304/same ETag, and use metadata LRU.
- HTML network-first cache in `apps/web/public/sw.template.js:446-501`: ignores normal `no-cache` only for offline fallback, skips admin-rendered pages via `x-gk-admin-render`, stamps `sw-cached-at`, and expires entries after 24h.
- Fetch handler in `apps/web/public/sw.template.js:533-567`: GET-only, admin bypass, derivative SWR, revocable HTML bypass, other HTML network-first fallback.
- Template/generated-worker contracts in `apps/web/src/__tests__/sw-template-contract.test.ts` intentionally pin photo-page HTML bypass behavior; the apparent `/p/:id` offline-cache exclusion is not a current defect.

### Deploy / Migrate

- Remote deploy wrapper uses a root `.env.deploy` or configured secret file, enforces 0600-ish permissions before sourcing, and builds an SSH command from config: `scripts/deploy-remote.sh:22-93`.
- Host deploy requires private `apps/web/.env.local`, config JSON, `docker compose up -d --build`, health check, then post-health Docker prune preserving bind-mounted data: `apps/web/deploy.sh:15-108`.
- Startup registers durable restore marker sync before queue bootstrap and maintenance scheduler before queue bootstrap in `apps/web/src/instrumentation.ts:1-18`.
- Migration bootstrap/reconcile lives in `apps/web/scripts/migrate.js:329-410` and `apps/web/scripts/migrate.js:744-1030`: per-entry baseline, DML baseline refusal, pending-tail handling, postcondition that every journal hash is recorded, strong admin seed, legacy original migration, and production public-original assertion.

## Findings

No confirmed defects were found in the traced flows at current HEAD.

I specifically retired these competing hypotheses after tracing the current code:

- Stale cycle-20 restore-drain wedge: current `restoreDatabase()` includes `shared-group-view-counts` as the first bounded checklist stage (`apps/web/src/app/[locale]/admin/db-actions.ts:593-597`) and the source contract now expects `drainSharedGroupViewCountsForRestore`, so the older pre-checklist unbounded flush finding is not present at this HEAD.
- Stale cycle-20 mutation-barrier lint false-green: the scanner now resolves `acquireAdminMutationSlot` provenance from `@/lib/admin-mutation-barrier` and tests reject shadowed, fake-import, bare-call, non-`using`, and missing-acquired-gate shapes (`apps/web/src/__tests__/check-action-origin.test.ts:659-742`).
- Browser and Lightroom upload drift: both paths now carry the same high-risk checkpoints: maintenance gates, contract lock, upload settings snapshot, HDR rejection, GPS original stripping, late restore cleanup, DB insert before enqueue, and post-commit processing.
- Service-worker `/p/:id` HTML bypass: this initially looked like a possible offline-photo-page regression, but `sw-template-contract.test.ts` intentionally classifies photo pages as revocable/public-object bypass routes. Current behavior is pinned, not accidental.
- Semantic stub/production mixing: read and write paths consistently key on `model_version`; production search ignores stub rows, and backfills reselect rows missing the target version.
- Migration silent-skip class: `migrate.js` still has the per-entry baseline, DML refusal, pending-tail distinction, and postcondition guard for every journal hash.

## Residual Risks

- I did not run the full lint/typecheck/build/test/e2e suite because this was a read-only review plus report rewrite. The three relevant custom scanners passed.
- I did not inspect binary/media assets, generated `.next` output, or runtime production data volumes. They are outside the source-flow review surface.
- UI component rendering outside the causal flows above was not exhaustively reviewed except where it participates in public routing, service-worker registration, OG generation, or analytics side effects.
- External production state, deployed container logs, MySQL live schema, and actual CLIP model files were not inspected.

## Final Sweep

Relevant source categories inspected: required docs, app actions, API routes including `route.tsx`, queue/processing/storage helpers, restore/durable maintenance, auth/session/revocation, public route limiters, semantic search/backfill writers, service worker template/generated worker contracts, deploy scripts, Docker compose, startup instrumentation, migration script, and current scanner/test contracts.

Relevant categories not inspected: binary assets/media files, generated build artifacts, live production data, and external service state.
