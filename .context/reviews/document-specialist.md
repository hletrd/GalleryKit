# Cycle 14 Document-Specialist Review

Date: 2026-06-30  
Reviewed HEAD: `c2da917d`  
Scope: documentation/code mismatch review for `/Users/hletrd/flash-shared/gallery`.

## Methodology and Inventory

Read first, as required: `AGENTS.md`, then `CLAUDE.md`.

Inventory built before inspection:

- Canonical docs and app docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Env/config examples: `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/src/site-config.example.json`.
- Deploy/runbook surfaces: root `package.json`, `apps/web/package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`.
- Migration/schema contracts: `apps/web/drizzle/**/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`.
- Tests-as-contract and lint gates: auth/action/rate-limit scanners, privacy fixtures, upload-limit tests, nginx config tests, semantic-search tests, service-worker contract tests, touch-target audit.
- Source comments carrying operational or safety contracts: upload paths, image processing, CLIP model/download/backfill, storage abstraction, DB restore, rate limiting, CSP, public routes, and admin actions.
- Historical/current planning and review docs under `docs/`, `plan/`, and `.context/` were inventoried and searched. Archived plans/reviews were treated as historical evidence unless they were linked from current authoritative docs.

Excluded from content review: `node_modules`, `.git`, build outputs, runtime data, uploads/resources, generated test output, and binary screenshots/media. Existing unrelated modified review files in `.context/reviews/` were ignored; this pass reviewed current HEAD behavior and wrote only this report.

## Confirmed Issues

### DOC14-01 - `db:push` is advertised as a normal database command even though the repo requires journaled migrations

Severity: Medium  
Confidence: High  
Category: unsafe operational guidance

Evidence:

- `CLAUDE.md:58-61` lists `npm run db:push` under "Database" with the description "Push schema to MySQL (drizzle-kit)" and no development-only warning.
- `apps/web/README.md:23-32` also lists `npm run db:push` as "Push schema to MySQL".
- The script exists and runs `drizzle-kit push`: `apps/web/package.json:17`.
- The authoritative schema policy says migrations must live in `apps/web/drizzle/NNNN_*.sql`, must be added to `_journal.json`, and must mirror `reconcileLegacySchema`: `AGENTS.md:22-27`, `CLAUDE.md:429-435`.
- The migration runbook explains why journal hashes and `__drizzle_migrations` postconditions are safety-critical after prior production drift: `CLAUDE.md:415-427`.

Concrete failure scenario:

An agent or operator follows the common-command table against a real `.env.local` and runs `npm run db:push` to apply a schema change. The database changes outside the committed SQL/journal/reconcile path. A later deploy or fresh restore cannot prove the schema via journal hashes, and the next migration author has no committed baseline for the out-of-band change.

Concrete fix:

Either remove `db:push` from operator-facing docs or mark it explicitly as local throwaway prototyping only, never production or committed schema work. Point schema changes to the migration checklist and `npm run init`/deploy migrator path instead.

### DOC14-02 - CLIP backfill concurrency docs imply a now-available operator tuning path that is not documented or wired at that layer

Severity: Low  
Confidence: High  
Category: stale source comment / missing operational docs

Evidence:

- `apps/web/scripts/backfill-clip-embeddings.ts:44-45` says concurrency is capped at `BATCH_CONCURRENCY=2` and "Operators can raise this once the real ONNX inference ships."
- Real ONNX/Transformers inference is already shipped and documented as production-active: `CLAUDE.md:527-539`.
- The script-level batch concurrency is still a hardcoded constant: `apps/web/scripts/backfill-clip-embeddings.ts:72-73`.
- The actual runtime inference limiter is a different env knob, `CLIP_INFERENCE_CONCURRENCY`, default `1`, max `4`: `apps/web/src/lib/clip-model.ts:53-56`.
- The CLIP runbook commands document `CLIP_MODELS_ROOT` but not `CLIP_INFERENCE_CONCURRENCY`: `CLAUDE.md:510-523`; `.env.local.example:68-72` also omits it.

Concrete failure scenario:

An operator sees slow production CLIP backfill after real ONNX inference is live. The script comment says concurrency can be raised, but the sidecar command and env example do not name the real knob. They may edit `BATCH_CONCURRENCY`, run multiple sidecars, or assume the backfill is already parallel, while actual model inference remains serialized by `CLIP_INFERENCE_CONCURRENCY=1`.

Concrete fix:

Update the script comment and CLIP runbook to distinguish script batch concurrency from model inference concurrency. Document `CLIP_INFERENCE_CONCURRENCY` with default `1`, max `4`, CPU/RAM caveats, and an example sidecar `-e CLIP_INFERENCE_CONCURRENCY=2` only when appropriate.

## Likely Issues

### DOC14-03 - Shipped CLIP design spec still uses the broad `./data/models/` path where implementation/runbooks use `data/models/clip`

Severity: Low  
Confidence: Medium  
Category: stale design doc / operator ambiguity

Evidence:

- The shipped/activated CLIP spec says weights are downloaded to `./data/models/`: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:24`, `:34`, `:41`, `:72`.
- The current implementation default is `data/models/clip`: `apps/web/src/lib/clip-paths.ts:48-65`.
- The downloader comment and production runbooks use the exact `clip` child path: `apps/web/scripts/download-clip-models.ts:5-30`, `CLAUDE.md:489-522`, `apps/web/README.md:62-72`.
- The same spec later mentions `./data/models/clip`, so the file is internally inconsistent: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:137`.

Concrete failure scenario:

A future operator or agent follows the shipped spec instead of the newer runbook and seeds/checks the parent `data/models` directory. The runtime loader points at `data/models/clip`, so offline model load can still fail even though "models" appears populated.

Concrete fix:

Update the spec's shipped-status sections to consistently say `data/models/clip` for the CLIP cache root, while noting that it sits under the persisted `data/` bind mount.

## Risks Needing Manual Validation

- Historical `.context/` and `plan/` files contain intentionally stale recommendations and old review findings. I inventoried and searched them, but did not treat every archived recommendation as live operational guidance. Manual validation is needed only if a future process starts linking a historical archive as authoritative current runbook material.
- Env docs still omit some low-level/test-only or advanced knobs (`UPLOAD_ROOT`, `TOPIC_RESOURCES_ROOT`, `IMAGE_CLEANUP_CONCURRENCY`, E2E-only variables). I did not file these as findings because current docs either frame them as sidecar/test overrides or do not present them as normal operator controls. Revisit if these become supported deployment knobs.

## Verified Non-Findings

- Deploy helper, `.env.deploy.example`, Docker bind mounts, host-network topology, and post-deploy Docker prune guidance match `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `docker-compose.yml`, and `Dockerfile`.
- Nginx body caps match docs and tests: 2 MiB default/admin API, 64 KiB login, 250 MiB DB restore, 216 MiB dashboard upload, 216 MiB Lightroom upload.
- Health docs match implementation: Docker probes `/api/live`; `/api/health` is liveness-only unless `HEALTH_CHECK_DB=true`.
- Privacy/admin-only field docs are aligned with `publicSelectFields`, `PrivacySensitiveKeys`, and `privacy-fields.test.ts`; prior stale privacy line-number comments are fixed.
- Prior stale Atom `uploaded_by` comments are fixed; browser and Lightroom upload comments now describe admin/audit linkage and feed-level public author fallback.
- CLIP production mode, model version, threshold, same-origin/rate-limit gates, and runtime limits match current search routes and constants, aside from the concurrency/path documentation issues above.

## Final Missed-Issues Sweep

Final sweep rechecked canonical docs, app README, env examples, deploy/runbook files, migration journal/runbook, security lint scripts, tests-as-contract, CLIP docs, storage docs, and high-risk source comments for `MUST`, `never`, `production`, `operator`, `rate-limit`, `migration`, `backfill`, `restore`, `prune`, `body cap`, `semantic`, `privacy`, and related terms.

No additional confirmed mismatch survived the evidence threshold. No relevant active documentation/code contract files were skipped; only non-authoritative generated/binary/runtime artifacts and historical archive material not used as current guidance were excluded as noted above.
