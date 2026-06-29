# Document-Specialist Review - Review-Plan-Fix Cycle 5

**Date:** 2026-06-29  
**HEAD reviewed:** `20e0d1f3dbc31bf4327288f60291eef1b1f24831`  
**Role:** documentation/code consistency reviewer.  
**Boundary:** Reviewed current `HEAD` only. This artifact is the only intended write.

## Inventory Coverage

Inventoried documentation and contract-bearing implementation surfaces before reporting:

- Governing docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Deploy/config surfaces: `.env.deploy.example`, `apps/web/.env.local.example`, root/app `package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `apps/web/scripts/ensure-site-config.mjs`.
- Migration/schema/runbook surfaces: `apps/web/drizzle/meta/_journal.json`, `apps/web/drizzle/*.sql`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, migration journal/reconcile tests.
- CLIP semantic-search docs/contracts: `CLAUDE.md` CLIP sections, `apps/web/README.md`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`, semantic route/action/image-queue code and tests.
- Generated artifacts and test contracts: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, service-worker tests, privacy field tests, nginx config tests, touch-target audit, semantic-search route/disclaimer/backfill tests.
- Planning/history context: existing `.context/reviews/document-specialist.md` Cycle 4 report, recent `.context/reviews/*`, `.context/plans/README.md`, and `docs/superpowers/{plans,specs}`.

## Findings

### DOC-C5-01 - Semantic route test setup comment still says only stub mode serves public requests

**Status:** Confirmed issue  
**Severity:** Low  
**Confidence:** High  
**Classification:** confirmed documentation/test-contract mismatch  
**Validation:** Source inspection against the current route and production-route test.

**Mismatched regions:**

- `apps/web/src/__tests__/semantic-search-route.test.ts:95-96` says: `CRT-R5C1-01: 'stub' is the only mode that serves public requests`, then defaults the mocked config to `semanticSearchMode: 'stub'`.
- Current route implementation at `apps/web/src/app/api/search/semantic/route.ts:209-227` explicitly serves both `'stub'` and `'production'`; only `'disabled'` and unknown values return 503. It then selects `PRODUCTION_MODEL_VERSION` for production.
- Current production route coverage at `apps/web/src/__tests__/semantic-route-production.test.ts:25-30` exercises production mode and confirms the route calls the real encoder before returning 503 only because no real embeddings are present.
- Authoritative docs match the implementation, not the stale comment: `CLAUDE.md:151`, `apps/web/README.md:58-60`, and `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:63-67` all describe operator-gated production mode as a served mode.

**Why this is a problem:** The comment is in a test setup block, so future maintainers can read it as the route's contract while adding semantic-search tests. It now encodes the pre-production CLIP state and conflicts with the route's real mode matrix.

**Concrete failure scenario:** A future test or refactor follows this comment and changes the semantic route to reject production requests again, or writes new coverage that treats production as unreachable. That would regress the live operator-gated production search path while still seeming consistent with the stale test comment.

**Concrete fix:** Update the comment to the current contract, for example: "`stub` is the default test mode; public requests are served in `stub` and operator-gated `production`, while `disabled` returns 503." Keep the mocked default as `stub` because most legacy route tests exercise stub behavior.

### DOC-C5-02 - `backfillClipEmbeddings` action header comment describes the old stub-only/backfill-future state

**Status:** Confirmed issue  
**Severity:** Low  
**Confidence:** High  
**Classification:** confirmed source-comment/implementation mismatch  
**Validation:** Source inspection against the function body and its contract test.

**Mismatched regions:**

- `apps/web/src/app/actions/embeddings.ts:3-9` says the action iterates processed images that lack an embedding row, generates embeddings via stub inference "(or real ONNX when replaced)," and upserts them.
- The implementation below is already replaced and mode-aware: `apps/web/src/app/actions/embeddings.ts:68-99` resolves `semanticSearchMode`, no-ops when disabled, selects `PRODUCTION_MODEL_VERSION` in production, and uses the active model version in the candidate query.
- The same file imports the real encoder and production constants at `apps/web/src/app/actions/embeddings.ts:16-18`.
- The regression test at `apps/web/src/__tests__/backfill-clip-embeddings-reembed.test.ts:19-35` documents the current contract: this unwired server action must match the sidecar by selecting candidates for the active `modelVersion` so stub rows can be upgraded to production rows if the action is ever surfaced.

**Why this is a problem:** The top-of-file comment is the first maintenance summary for an admin-gated server action. It implies the action still only handles missing rows and that real ONNX is future work, while the code now has production behavior and a model-version-aware selection invariant.

**Concrete failure scenario:** A future UI wiring or cleanup pass relies on the header comment, assumes the action is a harmless stub-only filler for missing rows, and removes the production branch or the model-version filter as "unneeded." In production mode, images with existing stub rows would then be skipped instead of upgraded to `jina-clip-v2-d512-q8`, leaving search incomplete or silently stale.

**Concrete fix:** Rewrite the header comment to say the action is currently unwired but mode-aware: disabled no-ops, stub writes `STUB_MODEL_VERSION`, production uses `embedImageReal` and `PRODUCTION_MODEL_VERSION`, and candidate selection is by active `model_version`, not merely by row absence. Keep the note that the sidecar script remains the canonical operational backfill path.

## Verified Non-Findings

- Cycle 4 document-specialist findings are fixed at this `HEAD`: deploy/disk docs now use `./public/uploads` and `./public/resources` instead of broad `./public`, and CLIP superpowers docs are marked shipped/historical rather than live stub-only instructions.
- Version claims match manifests/build image: Node 24+, Next.js 16.2.x, React 19, TypeScript 6, Sharp, MySQL 8.0+, and Docker standalone output claims align with `apps/web/package.json` and `apps/web/Dockerfile`.
- Deploy/helper docs align with implementation: root `.env.deploy` is the project policy, `.env.deploy.example` documents the external fallback, `docker-compose.yml` mounts only mutable public subdirectories, and `nginx-config.test.ts` locks that shape.
- Migration/runbook alignment checked: 25 SQL migration files match 25 journal entries; the historical non-monotonic `when` values are documented and guarded by hash-based baselining/post-conditions; reconcile drops removed paid-download and reaction schema.
- Env/default checks found no actionable drift for `SHARP_CONCURRENCY`, `QUEUE_CONCURRENCY`, `UPLOAD_MAX_TOTAL_BYTES`, `UPLOAD_MAX_FILES_PER_WINDOW`, `NEXT_UPLOAD_BODY_MAX_BYTES`, `VIEW_RETENTION_DAYS`, `SEMANTIC_SCAN_LIMIT`, `SEMANTIC_TOP_K_MAX`, `CLIP_MODELS_ROOT`, `HEALTH_CHECK_DB`, `TRUST_PROXY`, or `TRUSTED_PROXY_HOPS`.
- Privacy guards are aligned: `PrivacySensitiveKeys`, `SENSITIVE_KEYS`, `publicSelectFields`, `publicMapSelectFields`, search-enrichment guards, and the `uploaded_by` feed fallback comments remain consistent with `CLAUDE.md`.
- Route freshness docs match public pages: home, photo, topic, shared, smart collection, timeline, map, and year pages set `revalidate = 0`; sitemap intentionally uses `revalidate = 3600`.

## Final Missed-Issues Sweep

Ran targeted sweeps for stale `stub`/production CLIP wording, deploy bind-mount/public-assets claims, env-default claims, migration journal/reconcile drift, privacy field contracts, public freshness comments, touch-target docs, and test-contract comments. The remaining current-HEAD documentation/code mismatches I found are the two confirmed low-severity CLIP maintenance-comment findings above.

Coverage limits: I did not run the full runtime test suite, deploy, or manually validate production. This was a read-only documentation/code comparison except for writing this report.

**Disposition:** 2 confirmed findings, 0 likely findings, 0 manual-validation-only findings. No application-code edits.
