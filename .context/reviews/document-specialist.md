# Document Specialist Review - Cycle 24

Date: 2026-06-30 KST
HEAD reviewed: `a6efd6fd584fe44138be3729d90743ceb76dbfad`
Role: `document-specialist`
Scope: documentation-code drift against current repo rules and implementation. Output-only change: this review file.

## Inventory

- Repo rules loaded first: `AGENTS.md`, `CLAUDE.md`, plus the routed `code-review` workflow instructions.
- Authoritative docs reviewed: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `AGENTS.md`, `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/src/site-config.example.json`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`.
- Deploy/env surfaces reviewed: root/app `package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`.
- Migration/schema surfaces reviewed: `apps/web/drizzle/meta/_journal.json`, committed migration files, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, migration/source-contract tests.
- Source-contract and implementation surfaces reviewed: env readers, upload/delete processing, CLIP/semantic search, settings/config, caption/alt-text, PAT upload, storage quarantine, route/security scanners, privacy/i18n copy, and relevant tests under `apps/web/src/__tests__/`.
- Inventory counts from current `HEAD`: 187 Markdown/MDX files; 196 doc/env/deploy/package files matching the review filters; 572 files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, and `apps/web/messages`.
- Historical `.context/**`, `plan/**`, and archived review files were inventoried and keyword-swept for stale claims, but not treated as authoritative unless a current top-level doc or active review artifact points to them.

## Confirmed Issues

### DOC24-01 - NAS-tunable image cleanup concurrency is documented only in a source comment

- Severity: Low
- Confidence: High
- Status: confirmed
- Region: `apps/web/src/app/actions/images.ts:832-837`, `apps/web/.env.local.example:32-39`, `CLAUDE.md:100-110`
- Mismatch: the implementation says batch image cleanup is env-configurable through `IMAGE_CLEANUP_CONCURRENCY`, default `5`, max `32`, specifically so NAS-backed deployments can tune higher-latency file cleanup. The operator docs and env example list adjacent processing/backfill knobs but omit this one.
- Failure scenario: an operator on slow network storage sees bulk image deletes lag or produce I/O pressure, reads `.env.local.example` and `CLAUDE.md`, and concludes only `QUEUE_CONCURRENCY`, `SHARP_CONCURRENCY`, or backfill concurrency are tunable. They either leave deletes slow or tune the wrong processing path.
- Fix: add `IMAGE_CLEANUP_CONCURRENCY` to `.env.local.example` and `CLAUDE.md` Optional Operational Variables. Include default `5`, max `32`, and narrow it to post-DB image-file cleanup for deletes, not upload or encoder concurrency.

### DOC24-02 - Internal auto-alt-text comments still describe the current feature as Florence/AI

- Severity: Low
- Confidence: High
- Status: confirmed
- Region: `apps/web/src/lib/caption-generator.ts:1-15`, `apps/web/src/lib/caption-constants.ts:12-13`, `apps/web/src/lib/gallery-config-shared.ts:39-40`, `apps/web/messages/en.json:741-744`
- Mismatch: user-facing copy correctly says the feature creates EXIF-derived hints and local Florence-2 inference is not implemented. Some internal comments still title the current feature as "Auto alt-text via local Florence-2" or call the prefix an "AI-generated alt-text stub."
- Failure scenario: a future doc generator or contributor copies the source comments into README/admin docs and accidentally advertises AI captioning/FLORENCE behavior even though runtime only emits deterministic EXIF-derived hints.
- Fix: reword current-state comments to "EXIF-derived auto alt-text hints; future Florence-2 hook deferred." Reserve "AI-generated" for the future real model path.

## Likely Issues

- None found with enough current evidence to elevate beyond the confirmed items above.

## Risks Needing Manual Validation

### RISK24-01 - Path override env vars are intentionally undocumented, but the boundary is implicit

- Severity: Low
- Confidence: Medium
- Status: manual-validation risk
- Region: `apps/web/src/lib/upload-paths.ts:12-30`, `apps/web/src/lib/process-topic-image.ts:15-31`, `apps/web/.env.local.example:32-39`, `CLAUDE.md:89-118`
- Observation: `UPLOAD_ROOT`, `TOPIC_RESOURCES_ROOT`, and `TOPIC_RESOURCES_TMP_ROOT` are real module-load env overrides. Tests and comments frame topic-resource overrides as sandbox/test redirection, while `UPLOAD_ROOT` also affects `serve-upload` and the dormant storage local backend. They are absent from operator docs.
- Failure scenario if these are supported: a custom deployment that must relocate mutable public derivatives/resources has no documented, supported way to set the paths and may change bind mounts or Docker paths incorrectly.
- Failure scenario if these are intentionally internal: a future agent may add them to public env docs without explaining the module-load timing and bind-mount implications.
- Fix: make the boundary explicit. Either document them as internal/test-only path overrides, or add an operational section with safe usage and rebuild/restart requirements.

## Verified Clean Areas

- Package scripts and documented quality gates align: lint, three custom security lints, typecheck, build, Vitest, and e2e commands exist at the documented workspace paths.
- Deploy docs match scripts: root `npm run deploy` uses `.env.deploy`, derives SSH config, runs `apps/web/deploy.sh`, and the remote script builds before Docker pruning. The auto-prune guarantees in `AGENTS.md`/`CLAUDE.md` match `deploy.sh`.
- Upload limits and nginx caps match code: 200 MiB per file, 2 GiB default batch window, 100 files/window, 266 MiB default server-action body limit, 250 MiB DB restore cap, 216 MiB dashboard/PAT upload locations.
- Migration docs match implementation: the journal currently has 28 entries and known historical non-monotonic `when` values; `migrate.js` uses hash-based reconciliation and postcondition checks as documented.
- CLIP semantic-search docs match runtime gates and constants: `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, `CLIP_MODELS_ROOT`, `jina-clip-v2-d512-q8`, threshold `0.22`, `SEMANTIC_SCAN_LIMIT`, and `SEMANTIC_TOP_K_MAX` all line up with source.
- Storage backend docs are honest: current docs say local filesystem only, and source search shows the storage abstraction remains quarantined from the live upload/process/serve pipeline.
- Paid downloads/Stripe remain removed from current product docs and source surfaces; remaining mentions are comments/tests about the removal contract or historical `.context` provenance.
- Google Analytics docs match implementation: `google_analytics_id` in `site-config.json` drives layout script injection, privacy copy, and CSP via `proxy.ts`.

## Final Missed-Doc-Drift Sweep

- Re-ran focused greps for env knobs, deploy host/config, Docker prune guarantees, CLIP paths/model/version gates, Lightroom/PAT wording, storage/S3/MinIO, Stripe/payment, migration journal state, upload limits, analytics copy, and auto-alt-text/FLORENCE wording.
- Rechecked the prior target file and replaced its stale cycle-23/old-HEAD content with this current cycle-24 report.
- No lint/typecheck/test/build gates were run because the task is a review artifact update only and source files were not modified.

## Skipped-File Confirmation

- No relevant authoritative doc class was intentionally skipped.
- I did not manually line-review every historical `.context` archive or every old plan file; they were inventoried and keyword-swept, then treated as provenance rather than current source of truth unless referenced by active docs.
- I did not modify source files, env examples, scripts, tests, or docs other than this review artifact.

## Totals

- Confirmed issues: 2
- Likely issues: 0
- Manual-validation risks: 1
- Highest severity: Low
