# Cycle 8 Architect Review - 2026-06-29

Role: `architect`
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `1e18296971bbea8bed66415c7c249e9362afff01`
Constraint: review-only; no implementation files edited. Current HEAD differs from `d43f9fc5` only by review artifacts, so application-code evidence is the same as the cycle-8 peer review baseline.

## Scope And Inventory

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Inventory before findings:

- Current cycle peer context: `.context/reviews/cycle-8-2026-06-29/code-reviewer.md`, `security-reviewer.md`, `perf-reviewer.md`, `critic.md`, and `verifier.md`.
- Prior active context: `.context/reviews/_aggregate.md`, `.context/reviews/architect.md`, `.context/plans/cycle-7-2026-06-29-plan.md`, `.context/plans/cycle-7-2026-06-29-deferred.md`, run9-cycle8 aggregate/deferred records, and current plan/deferred indexes.
- Architecture-sensitive source: upload actions/routes, image queue/bootstrap, processing snapshots, config resolution, privacy selectors, schema/migrations/reconcile, analytics retention/index surfaces, semantic-search routes, CLIP model boundary, smart collections, topic rename fan-out, restore/deploy topology, and client/server boundary tests.
- Tests and contracts inspected: cycle-7 source contracts, image queue bootstrap/wiring tests, gallery config tests, privacy fields, topic slug FK registry, action/API/rate-limit lint scanners, migration/reconcile tests, semantic/similar route tests, and peer validation reports.
- Config/deploy/docs inspected: root/app package files, Dockerfile, compose, nginx, deploy script, Next config, service worker source/generated worker, READMEs, and env examples.

Skipped as non-current-source for architecture review: `node_modules`, generated `.next`, binary fixtures/assets/screenshots, runtime uploads/data, ignored env files, and historical archive bodies beyond targeted duplicate checks.

## Confirmed Findings

### ARCH-C8-01 - Durable semantic-search snapshots bypass the runtime production opt-in gate

Severity: Medium
Confidence: High
Status: Confirmed code path, operational failure scenario
Area: configuration authority, runtime capability gating, queue/bootstrap boundary

Evidence:

- `apps/web/src/lib/gallery-config.ts:123-140` deliberately heals a stored `semantic_search_mode='production'` to `'disabled'` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` is present.
- `apps/web/src/lib/image-queue.ts:85-95` includes `semanticSearchMode` in `ProcessingSettingsSnapshot`; `apps/web/src/lib/image-queue.ts:97-112` copies the resolved config value into that snapshot; `apps/web/src/lib/image-queue.ts:151-163` applies the snapshot back onto a queue job.
- Browser and Lightroom uploads persist the whole snapshot to `images.processing_settings_json` at `apps/web/src/app/actions/images.ts:418` and `apps/web/src/app/api/admin/lr/upload/route.ts:424`.
- Bootstrap rehydrates the persisted snapshot at `apps/web/src/lib/image-queue.ts:847-868`.
- The embedding side effect then uses `resolvedSemanticMode ?? job.semanticSearchMode ?? 'disabled'` at `apps/web/src/lib/image-queue.ts:620-621` and calls `embedImageReal` when that value is `'production'` at `apps/web/src/lib/image-queue.ts:632-636`; there is no second check of `SEMANTIC_SEARCH_ALLOW_PRODUCTION`.
- Existing source-contract tests pin this behavior as intentional wiring: `apps/web/src/__tests__/image-queue-embed-wiring.test.ts:23-35` requires the queue to prefer `job.semanticSearchMode`, and `apps/web/src/__tests__/images-actions.test.ts:241-276` verifies an upload can enqueue `semanticSearchMode: 'production'`.

Concrete failure scenario:

An operator temporarily enables production semantic search (`SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`) and uploads a batch, so pending rows persist `processing_settings_json` with `semanticSearchMode: "production"`. Before the queue drains, the operator removes the env opt-in because weights are missing, CPU is overloaded, or production search should be dark. After restart, `bootstrapImageProcessingQueue()` rehydrates the old snapshot and the embedding side effect still enters `embedImageReal()` even though the current runtime would heal the DB setting to disabled. Public search routes may be disabled, but the web process still loads the real CLIP stack, preprocesses originals, burns CPU/memory, and can write production embeddings against an operator-disabled deployment.

Concrete fix:

Separate durable byte-processing settings from runtime capability gates. Do not treat `semanticSearchMode` as an immutable processing snapshot without reapplying the current env opt-in. Options:

- Store only byte-affecting processing settings in `processing_settings_json`, then resolve semantic mode at execution time through the same env-gated resolver.
- Or keep the snapshot field but pass it through a `resolveSemanticModeForRuntime(snapshot.semanticSearchMode)` helper that heals `'production'` to `'disabled'` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` at queue-consume time.

Add a regression test where a persisted snapshot says production but the env flag is absent; queue/bootstrap must not call `embedImageReal()`.

### ARCH-C8-02 - Failed-image retry still reopens the fail-open processing-config path

Severity: Medium
Confidence: High
Status: Confirmed
Area: write-path config ownership, retry architecture, queue defaults

Evidence:

- Cycle 7 added strict config for initial upload write paths: `getGalleryConfigStrict()` fails instead of falling back at `apps/web/src/lib/gallery-config.ts:194-200`, and browser upload uses it before snapshot creation at `apps/web/src/app/actions/images.ts:181-188`.
- `retryFailedImage()` clears durable failure state and explicitly clears `processing_settings_json` at `apps/web/src/app/actions/images.ts:1183-1186`.
- The same retry action then enqueues a job with filenames, width, topic, ICC/color/caption hints, but no `quality`, `imageSizes`, chroma, force-sRGB, AVIF effort, wide-gamut cap, auto-alt, or semantic snapshot at `apps/web/src/app/actions/images.ts:1196-1215`.
- The queue treats snapshotless jobs as bootstrap/legacy jobs, reads non-strict `getGalleryConfig()` at `apps/web/src/lib/image-queue.ts:491-509`, and on any config-read error falls through to defaults with only a comment at `apps/web/src/lib/image-queue.ts:509-511`.
- That non-strict resolver catches `admin_settings` failures and returns fresh-install defaults at `apps/web/src/lib/gallery-config.ts:184-190`.

Concrete failure scenario:

An admin fixes a transient processing issue and clicks retry on a failed image while current settings include non-default output sizes, chroma, AVIF effort, `force_srgb_derivatives`, or production/stub semantic behavior. The retry action succeeds in reading/updating the image row, clears the snapshot, and enqueues a snapshotless job. If the queue's later `getGalleryConfig()` read fails transiently while processing otherwise succeeds, the image is encoded with fallback defaults and then marked `processed=true` at `apps/web/src/lib/image-queue.ts:544-548`. The admin sees a successful retry, but the bytes and side effects do not match the settings authority that initial uploads now fail closed to protect.

Concrete fix:

Make retry a strict write path too. Have `retryFailedImage()` call `getGalleryConfigStrict()`, create a fresh `ProcessingSettingsSnapshot`, persist it when clearing `processing_error` / `failed_at`, and pass the same snapshot into `enqueueImageProcessing()`. If strict settings cannot be read, return a retryable admin error and leave the row failed. Alternatively, make the queue treat snapshotless non-legacy retry jobs as retryable failures when config cannot be read, rather than processing with defaults. Add a regression test that forces `getGalleryConfig()` failure during a retry and proves the row is not marked processed with defaults.

## Current-Cycle Findings Not Duplicated

These were already filed by peer lanes in `.context/reviews/cycle-8-2026-06-29/` and are not re-filed here:

- `SEC-C8-01`: tracked review log discloses credential material.
- `CODE-C8-01`: concurrency env knobs accept `Infinity`, fractions, and unbounded values.
- `PERF-C8-01`: CLIP image preprocessing/admission sits outside the inference governor.
- `PERF-C8-02`: stateful grid fallback hydrates every archive/share image card.
- `C8-CRIT-01`: analytics top-view queries lack matching bot/time/entity indexes.
- `C8-CRIT-02`: referrer sanitizer misses IPv4/IPv6 link-local hosts.
- `C8-V-01`: action-origin docs/comments still claim `public.ts` is excluded.

Carried-forward performance/topology items from `.context/plans/cycle-7-2026-06-29-deferred.md` were rechecked but not duplicated: initial listing grouped/window-count query shape, analytics/retention index batching, upload preview virtualization follow-up, semantic scan cap disclosure/vector-index strategy, TLS/proxy validation, and process-local scale-out constraints.

## Positive Architecture Evidence

- Initial browser and Lightroom uploads now use strict gallery config reads, persist processing snapshots, and queue the same snapshot fields across both ingest paths.
- `images.processing_settings_json` is schema-backed, reconciled in `migrate.js`, and guarded as admin-only/internal by `PrivacySensitiveKeys`.
- Queue bootstrap skips durable failed rows (`processing_error IS NULL`) and rehydrates pending-row snapshots before enqueue.
- Topic slug rename has a registry test that derives FK children from `schema.ts` and asserts `updateTopic()` re-points every known child before deleting the old natural-key row.
- Migration journal monotonicity, reconcile coverage, action-origin, admin-API auth, public mutating route rate limits, and privacy field symmetry all have dedicated scanner or fixture tests.

## Final Missed-Issue Sweep

Final sweeps covered:

- Upload -> DB insert -> durable snapshot -> queue -> bootstrap -> retry.
- Runtime config ownership, especially env-gated settings and fail-open/fail-closed boundaries.
- Schema/migration/reconcile parity for the new processing snapshot column and analytics tables.
- Public/admin data selectors, map selector exception, semantic/similar enrichment fields, and privacy guards.
- Client/server boundaries around `clip-model`, `GridPicture`, public pages, and native/server-only imports.
- Deployment assumptions: single instance, process-local state, Docker bind mounts, host MySQL, nginx/TLS/proxy caveats, and deploy script guarantees.

No implementation files were changed; this report is the only artifact written by this architect pass.
