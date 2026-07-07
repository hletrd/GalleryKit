# Cycle 15 Document-Specialist Review - 2026-07-07

Reviewer: document-specialist. Repo: `/Users/hletrd/flash-shared/gallery`. HEAD reviewed: `6256a988`.
Mode: static whole-repository documentation/source mismatch review. Only this assigned artifact was written; no source, deploy, DB, service, container, commit, or push action was performed. The worktree already contained unrelated edits in other `.context/reviews/*.md` files, which were left untouched.

## Inventory

Required instructions and review prompts examined:

- `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- `.context/reviews/prompts/common_review_scope.md` and `.context/reviews/prompts/document-specialist.md`.

Documentation and planning surfaces examined:

- Active docs under `docs/`: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`.
- Current review/plan provenance docs relevant to this cycle: `.context/reviews/_aggregate.md`, `.context/plans/README.md`, `.context/plans/cycle-15-plan.md`, `.context/plans/cycle-15-2026-06-30-deferred.md`.
- Historical `.context/plans/**` and `.context/reviews/**` surfaces were inventoried/keyword-swept for live-operator contradictions, but not treated as authoritative current product docs unless a current pointer referenced them.

Package, config, and runtime surfaces examined:

- `package.json`, `package-lock.json`, `apps/web/package.json`.
- `.env.deploy.example`, `apps/web/.env.local.example`.
- `scripts/deploy-remote.sh`, `scripts/check-proxy-topology.mjs`.
- `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`.
- `apps/web/next.config.ts`, `apps/web/drizzle.config.ts`, `apps/web/tsconfig.json`, `apps/web/tsconfig.typecheck.json`, `apps/web/eslint.config.mjs`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`.

Scripts examined:

- Root scripts: `scripts/deploy-remote.sh`, `scripts/check-proxy-topology.mjs`.
- App scripts: `backfill-alt-text.ts`, `backfill-cicp-recheck.ts`, `backfill-clip-embeddings.ts`, `backfill-color-pipeline.ts`, `build-color-fixtures.ts`, `build-sw.ts`, `check-action-origin.ts`, `check-api-auth.ts`, `check-js-scripts.mjs`, `check-public-route-rate-limit.ts`, `clip-model-manifest.ts`, `download-clip-models.ts`, `ensure-site-config.mjs`, `entrypoint.sh`, `generate-pwa-icons.ts`, `init-db.ts`, `migrate-admin-auth.ts`, `migrate-aliases.ts`, `migrate-capture-date.js`, `migrate-titles.ts`, `migrate.js`, `migration-add-column.ts`, `mysql-connection-options.js`, `prepare-next-typegen.mjs`, `restore-maintenance-recovery.mjs`, `run-e2e-server.mjs`, `seed-admin.ts`, `seed-e2e.ts`.

Implementation areas cross-checked against docs:

- Database schema/migration/journal/reconcile flow: `apps/web/src/db/**`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, committed migrations.
- Deploy/runtime/env behavior: Docker build/runner, compose bind mounts, root deploy helper, app deploy helper, nginx body limits and proxy headers.
- Security and auth: sessions, same-origin guards, admin API wrappers, PAT token verification, rate-limit helpers, public route scan gates.
- Upload/image processing: browser upload, LR upload, upload limits, original/derivative paths, queue processing, color/HDR pipeline, GPS strip behavior.
- CLIP semantic search: config resolver/UI, CLIP path/model loader, embedding scripts/routes, model download/preflight docs.
- Auto alt-text: caption generator, upload hook/backfill script, admin-facing docs.
- Site config/SEO/CSP/SW: JSON import/build-time behavior, image base URL validation, CSP, feed/sitemap/public route freshness, service-worker template/build script.
- Privacy/product boundaries: public select fields and privacy guards, smart collections, storage backend quarantine, no payment/reaction/editing/culling/scoring claims.

Skipped deliberately:

- Secret-bearing local env files (`.env.deploy`, `apps/web/.env.local`) were not opened.
- Generated/build artifacts (`.next/**`, `node_modules/**`) and nested worktrees were not treated as source-of-truth docs.
- No live host, production database rows, seeded model weights, deployed nginx config, or deployed env values were inspected.

No review-relevant file in the inventory above was skipped.

## Confirmed Issues

### DOC-15-01 - Cycle 15 provenance points to an aggregate that is still Cycle 14

- Confidence: High
- File/code region: `.context/plans/cycle-15-plan.md:1-6`; `.context/plans/cycle-15-2026-06-30-deferred.md:1-16`; `.context/reviews/_aggregate.md:1-5`; `.context/plans/README.md:34-39`.
- Why this is a problem: the Cycle 15 plan says its source is `.context/reviews/_aggregate.md` at "cycle 15, HEAD `2f886351`", and the deferred register cites `AGG-C15-*` findings. The actual `_aggregate.md` is titled "Cycle 14 Aggregate Review" and records reviewed HEAD `14d31ea4`. The plan index's "Active Current-Cycle Plans" section still points at loop-B Cycle 7 and Cycle 14, not Cycle 15.
- Concrete failure scenario: a later agent tries to audit or resume Cycle 15, opens the cited aggregate, and cannot trace the `AGG-C15-*` IDs used by the plan/deferred files. That can cause findings to be dropped, duplicated, or re-triaged against the wrong cycle.
- Suggested fix: regenerate or restore the real Cycle 15 aggregate at `.context/reviews/_aggregate.md`, or update the Cycle 15 plan/deferred files to cite the actual aggregate path. Also update `.context/plans/README.md` so its active-current section points at the latest cycle, or replace the prose section with a machine-checkable latest-cycle pointer.

### DOC-15-02 - The CLIP backfill script's embedded production sidecar example is incomplete and partly stale

- Confidence: High
- File/code region: `apps/web/scripts/backfill-clip-embeddings.ts:9-20`, `apps/web/scripts/backfill-clip-embeddings.ts:48-49`, `apps/web/scripts/backfill-clip-embeddings.ts:73-78`; `apps/web/src/lib/clip-model.ts:17-33`; `apps/web/Dockerfile:150-155`; correct command in `CLAUDE.md:579-590`.
- Why this is a problem: the script header gives an inline production `docker run --rm` example and says it follows the CLAUDE/color-pipeline sidecar pattern, but the example omits the `apps/web/tsconfig.json` read-only mount that the canonical CLIP command includes. The script imports `../src/lib/clip-model`, and that module imports path-aliased modules such as `@/lib/clip-embeddings`, `@/lib/clip-model-id`, and `@/lib/clip-paths`. The production runner image copy list does not include the app `tsconfig.json`, so the inline example is not equivalent to the canonical command. The same header also still says operators can raise backfill concurrency "once the real ONNX inference ships" even though `--production` already uses the real `embedImageReal` path.
- Concrete failure scenario: an operator copies the command from the script header instead of CLAUDE.md. The sidecar starts with mounted `src`/`scripts` but without the TS path-alias config, so `tsx` can fail resolving `@/...` imports before any embeddings are written. Separately, the stale "once real ONNX inference ships" sentence can make a maintainer think production CLIP is still future-only despite the current runbook and implementation.
- Suggested fix: either remove the inline production command and point only to the canonical CLAUDE.md command, or add the missing `-v <deploy-root>/apps/web/tsconfig.json:/app/apps/web/tsconfig.json:ro` mount and keep the command byte-for-byte aligned with CLAUDE.md. Replace the stale concurrency sentence with current wording: real ONNX inference is shipped, `BATCH_CONCURRENCY` is a script constant, and `CLIP_INFERENCE_CONCURRENCY` is the runtime/env-capped encoder knob.

### DOC-15-03 - The alt-text backfill header overstates current inference cost and operator tunability

- Confidence: High
- File/code region: `apps/web/scripts/backfill-alt-text.ts:10-18`, `apps/web/scripts/backfill-alt-text.ts:35-38`; `apps/web/src/lib/caption-generator.ts:4-15`, `apps/web/src/lib/caption-generator.ts:57-67`; active docs `apps/web/README.md:93-95`, `CLAUDE.md:630-632`.
- Why this is a problem: the active product docs correctly say auto alt-text is a default-off local EXIF/metadata hint pipeline, not a remote or full vision-captioning feature. The implementation confirms that `generateCaption` calls a deterministic EXIF-derived stub. The backfill script header still explains its `BATCH_CONCURRENCY=1` cap as being "because Florence-2 ONNX inference is heavy" and says operators can raise it once the real model ships. There is no env/operator knob here; raising it means editing the script constant.
- Concrete failure scenario: an operator with a large legacy gallery reads the script header, assumes the current backfill is a heavy Florence-2/ONNX job, and avoids or serializes a low-cost EXIF-stub backfill unnecessarily. A future maintainer may also "raise" the hardcoded constant under the false assumption that this is an intended runtime operator control.
- Suggested fix: rewrite the header to match current behavior: the script currently runs the lightweight EXIF-derived stub, `BATCH_CONCURRENCY=1` is a conservative hardcoded script default, and real caption inference must not be implied until a model, download script, runtime path, concurrency/env controls, and operator runbook exist.

## Likely Issues

No additional likely issues were promoted beyond the confirmed mismatches above. The remaining suspicious hits in historical plans/reviews were either explicitly historical, already contradicted by current authoritative docs, or tied to manual production state rather than repository text.

## Risks Requiring Manual Validation

### DOC-15-RISK-01 - Static repo review cannot verify live operational state

- Confidence: High that manual validation is still required; not a confirmed repo-text defect.
- File/code region: semantic-search caveat in `CLAUDE.md:169`; activation flow in `apps/web/README.md:78-91`; host nginx/deploy boundary in `CLAUDE.md:247`; proxy/DB/env notes in `apps/web/README.md:52-58`.
- Why this matters: the repo docs distinguish implementation/runbook truth from live host state. This review validated the checked-in code and documentation, but did not inspect the deployed host's env file, nginx config, DB rows, CLIP model volume, backup storage, or current container health.
- Concrete failure scenario: a production operator treats repository docs as proof that semantic search is active, that the host nginx config matches the checked-in template, or that DB TLS/proxy settings are correctly deployed. The repo can only prove the intended contract, not the current host state.
- Suggested validation: before operational claims, verify the live deploy env, host nginx config, `/api/live`, DB `admin_settings.semantic_search_mode`, model files under `CLIP_MODELS_ROOT`, representative `image_embeddings.model_version` rows, and backup filesystem controls.

## Verified Aligned Areas

- Deploy docs align with `scripts/deploy-remote.sh`, `.env.deploy.example`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, and `apps/web/Dockerfile`: config-driven SSH, env-file permission checks, root `npm run deploy`, compose build/recreate, `/api/live` health gate, bind-mounted persistence, and prune-after-up without `volume prune -a`.
- Migration docs align with `apps/web/scripts/migrate.js` and `apps/web/drizzle/meta/_journal.json`: monotonic journal authoring, hash post-condition, `reconcileLegacySchema` mirroring, DML-baseline guard, and admin seed behavior.
- Security docs align with auth/API code: `withAdminAuth(...)`, same-origin action guard expectations, public mutating route rate-limit scans, `X-GalleryKit-Token`, `gk_` token format, SHA-256 token storage, scopes, expiry, and last-used tracking.
- Upload docs align with implementation and nginx: 200 MiB per file, 2 GiB total app window, LR upload route token/cookie auth, dedicated `/api/admin/lr/upload` body limit, private originals, public derivatives/resources, and GPS/HDR/color pipeline boundaries.
- Canonical CLIP docs align with source aside from the script-header issue above: default disabled mode, stub honesty, production env opt-in, offline weights under `CLIP_MODELS_ROOT`, model-version-gated serving, bounded newest-first scan, and no one-click production toggle in the admin UI.
- Site config and asset-origin docs align with code: JSON imports are build-time inlined, DB-backed SEO/branding overrides are runtime, `IMAGE_BASE_URL` has build-time `next/image` and runtime CSP halves, and production rejects insecure/malformed asset origins.
- Product-boundary docs align with source: no payment/Stripe surface, no shipped external Lightroom plugin, no culling/scoring/editing workflow, local filesystem storage is the supported backend, and smart-collection authoring is not documented as a shipped admin UI.

## Final Sweep

Search/inspection terms included: deploy/prune/env, Docker/compose/nginx, DB SSL, migrations/journal/reconcile/baseline, backup/restore, same-origin, admin token, rate limit, upload/body limits, LR upload, GPS/privacy, CLIP/semantic/model_version/ONNX, alt-text/caption/Florence, site-config, IMAGE_BASE_URL, CSP, service worker, sitemap/feed freshness, storage backends, Stripe/payment/reactions, smart collections, Lightroom plugin, editing/culling/scoring, and current-cycle plan/aggregate provenance.

No tests or live commands were run because this was a static documentation/source review. No relevant inventory file was skipped; generated artifacts, secrets, and live production state were intentionally excluded as noted above.
