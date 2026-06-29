# Architecture Review - review-plan-fix cycle 3

Date: 2026-06-29

Role: architect

HEAD reviewed: `3d3b7816` (`docs(reviews): record cycle 3 code review`). The application source is unchanged from `3f24038b`; the extra HEAD commit only updates `.context/reviews/code-reviewer.md`.

Scope: current HEAD only. Static architecture/design review of layering, shared contracts, schema/migration posture, process-local state, deployment/runtime topology, cache consistency, and long-horizon maintainability. Report-only pass; no application source was edited.

## Inventory Coverage

- Read first: `AGENTS.md`, `CLAUDE.md`, current `.context/reviews/*`, `.context/plans/cycle-2-2026-06-29-{plan,deferred}.md`, and recent review history needed to avoid re-filing fixed claims.
- Current HEAD inventory: 2,207 tracked files in the app/config/review surface; 476 TypeScript/TSX runtime/test files under `apps/web/src`; 25 Drizzle journal entries; Docker, compose, nginx, deploy, migration scripts, service worker, and package/config files.
- Directly inspected: admin/public routes, server actions, `lib/data*`, semantic search/CLIP modules, upload tracker/queue/backfill/restore coordination, advisory-lock registry consumers, schema/migration reconciliation, storage quarantine, privacy selectors, cache/settings hash path, Docker/nginx topology, and tests that encode those contracts.
- Stale fixed claims avoided: cycle-2 `.claude/` Docker-context leakage is fixed; standalone Docker default now binds localhost; CLIP backfill docs now use `--production --force`; admin metadata and timeline/year i18n fixes are present; storage quarantine and topic-slug registry tests already exist.

## Findings

### ARCH-C3-01 - Process-local coordination remains a hard single-instance topology constraint

Severity: Medium
Confidence: High
Risk status: Manual-validation / topology-gated

Evidence:
- `apps/web/src/lib/restore-maintenance.ts:1-56` stores restore maintenance in a `globalThis` symbol.
- `apps/web/src/app/[locale]/admin/db-actions.ts:266-354` holds DB restore and upload-contract advisory locks, but only the process that entered restore calls `beginRestoreMaintenance()`.
- `apps/web/src/lib/upload-tracker-state.ts:7-20` stores upload quota state in a process-local `Map`; `:70-79` treats that map as the active-claim source.
- `apps/web/src/lib/rate-limit.ts:77-89`, `:103-108`, and `:314-318` keep public OG/share/search/semantic limiter buckets in memory.
- `apps/web/src/lib/image-queue.ts:180-224` stores queue state in `globalThis`.

Failure scenario: under the documented single web-instance deployment this is coherent. If the service is horizontally scaled first, one process can enter restore mode while another still accepts uploads/actions; public rate limits become per-instance; upload quota windows split by process; and queue/claim status is no longer globally visible.

Concrete fix: keep single-instance/single-writer as an enforced production invariant, or migrate these states to DB/Redis/shared leases before adding replicas. Add a startup/deploy guard that fails when multiple web replicas are configured without an explicit shared-state mode.

### ARCH-C3-02 - Production CLIP embedding work bypasses image-queue backpressure

Severity: Medium
Confidence: High
Risk status: Confirmed concurrency/design risk

Evidence:
- `apps/web/src/lib/image-queue.ts:204-212` bounds Sharp processing with `QUEUE_CONCURRENCY`.
- `apps/web/src/lib/image-queue.ts:490-567` launches embedding in a detached `void` IIFE after `processed=true`.
- `apps/web/src/lib/image-queue.ts:535-537` calls `embedImageReal()` for production mode.
- `apps/web/src/lib/clip-model.ts:151-186` decodes/resizes with Sharp, allocates a large `Float32Array`, and invokes the model.

Failure scenario: a bulk upload in production semantic mode can have real CLIP inference still running while the main queue starts the next Sharp encode. CPU, libvips work, model runtime, and memory can exceed the operator's expected `QUEUE_CONCURRENCY` envelope.

Concrete fix: introduce a bounded embedding queue (`EMBEDDING_CONCURRENCY=1` default) or make production embeddings part of the existing job before completion. If detached latency is required, persist embedding jobs and drain them through a worker with queue-depth/duration/error metrics.

### ARCH-C3-03 - Semantic search is still a request-path brute-force vector scan

Severity: Medium
Confidence: High
Risk status: Confirmed scaling/product-quality risk

Evidence:
- `apps/web/src/app/api/search/semantic/route.ts:240-281` reads newest embedding blobs, decodes/scores them, and sorts on the request path.
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-170` repeats the same scan/score shape for image-to-image search.
- `apps/web/src/lib/clip-embeddings.ts:32-40` lets `SEMANTIC_SCAN_LIMIT` rise as high as 1,000,000.
- `apps/web/src/lib/clip-embeddings.ts:160-164` filters and sorts the entire scored list.
- `apps/web/src/db/schema.ts:271-286` indexes `(model_version, updated_at)` for recency-limited scans, not nearest-neighbor search.

Failure scenario: at default scale this is bounded. As embeddings grow, relevance is capped by newest-first ordering; raising the scan cap shifts DB payload, vector decode, scoring, and sorting onto the Node request path and can delay unrelated requests.

Concrete fix: keep production caps conservative and warn when embedding count exceeds the scan cap. Replace whole-list sort with a fixed-size heap if caps grow. Before materially raising limits, define a vector-index/ANN/worker boundary and expose scan-count/latency metrics.

### ARCH-C3-04 - Shared CLIP helpers mix client-safe constants with server-only env policy

Severity: Low
Confidence: High
Risk status: Confirmed boundary smell

Evidence:
- `apps/web/src/lib/clip-embeddings.ts:18-40` reads `process.env.SEMANTIC_TOP_K_MAX` and `SEMANTIC_SCAN_LIMIT` at module load.
- `apps/web/src/components/search.tsx:1,19` is a client component importing from the same module.
- `apps/web/src/app/api/search/semantic/route.ts:41-53` and `apps/web/src/app/api/search/similar/[id]/route.ts:37-45` import the env-derived symbols server-side.

Failure scenario: today the client imports only `SEMANTIC_TOP_K_DEFAULT`, so no live bug exists. A future client import of `SEMANTIC_TOP_K_MAX` or `SEMANTIC_SCAN_LIMIT` would receive browser fallback values while the server enforces operator-configured values. The same exported symbol would mean different things by bundle.

Concrete fix: move env-derived semantic limits to a server-only module consumed by routes/scripts, leaving `clip-embeddings.ts` for pure constants and vector utilities. Alternatively add a source-contract test that forbids client modules from importing env-derived CLIP limit symbols.

### ARCH-C3-05 - Upload quota settlement depends on hand-maintained rollback paths

Severity: Medium
Confidence: High
Risk status: Confirmed maintainability risk; currently fenced

Evidence:
- `apps/web/src/app/actions/images.ts:224-228` pre-claims quota synchronously.
- `apps/web/src/app/actions/images.ts:230-279` manually rolls back on disk/topic early exits and errors.
- `apps/web/src/app/actions/images.ts:511-521` documents the only post-claim await that is not paired with settlement.
- `apps/web/src/app/actions/images.ts:541-564` reconciles the claim on all-failed and success paths.
- `apps/web/src/lib/upload-tracker.ts:19-32` contains the settlement math, but not the lifecycle guard.

Failure scenario: a future awaited operation added between claim and final settle can throw before a rollback path, inflating the user's upload window for roughly the tracking window despite no files completing. The comments are clear, but the invariant is convention-based.

Concrete fix: wrap the whole post-claim region in a single `try/finally` or a small claim object with exactly-once `settle()` / `rollback()` semantics. Add regression coverage for a thrown awaited step in the claim-to-settle span.

### ARCH-C3-06 - Topic identity is a mutable natural key with manual fan-out

Severity: Medium
Confidence: High
Risk status: Confirmed design risk; test-fenced

Evidence:
- `apps/web/src/db/schema.ts:4-17` makes `topics.slug` the primary key and `topic_aliases.topic_slug` an FK.
- `apps/web/src/db/schema.ts:19-33` stores `images.topic` as an FK to `topics.slug`.
- `apps/web/src/db/schema.ts:234-243` stores `topic_views.topic` as another FK to `topics.slug`.
- `apps/web/src/db/schema.ts:288-302` stores smart-collection topic predicates as JSON.
- `apps/web/src/app/actions/topics.ts:282-337` renames by insert/repoint/delete and manually remaps FK children plus smart-collection JSON.
- `apps/web/src/__tests__/topic-slug-fk-registry.test.ts:1-83` confirms this is known and fenced by a source-registry test.

Failure scenario: adding a new slug-referencing table or JSON store without extending the rename transaction can orphan rows, cascade-delete history, or silently change smart-collection results. The current registry test helps for FK siblings, but the architecture still couples new data stores to a manual rename fan-out.

Concrete fix: long term, introduce immutable topic IDs and treat slug as an attribute/alias. Short term, keep the registry test strict, add any new non-FK slug store to an explicit rename registry, and require rename fan-out updates in the migration checklist.

### ARCH-C3-07 - Public image field contracts are guarded but still split across manual mirrors

Severity: Low-Medium
Confidence: High
Risk status: Confirmed architecture risk; no current leak found

Evidence:
- `apps/web/src/lib/data.ts:364-483` defines `publicSelectFields`, `publicMapSelectFields`, and `PrivacySensitiveKeys`.
- `apps/web/src/lib/data-timeline.ts:35-73` mirrors a timeline public select and exports `timelineSelectFieldKeys`.
- `apps/web/src/lib/search-enrichment-fields.ts:29-47` defines a separate search enrichment public select.
- `apps/web/src/__tests__/privacy-fields.test.ts:6-42` hand-maintains `SENSITIVE_KEYS`, and `:83-114` checks admin/public/timeline symmetry.

Failure scenario: the current guards are good, and no PII leak was found. The maintainability risk is that each new public image read path can create another manual selector plus another guard. Privacy then depends on developers knowing which public selector family to extend and which fixture to update.

Concrete fix: extract a canonical public image select module and derive map/timeline/search subsets from it. Keep one bidirectional privacy test around `admin - public == sensitive`, and make specialized selectors prove they are subsets/extensions of the canonical public shape.

### ARCH-C3-08 - `lib/api-auth.ts` still depends upward on a server-action module

Severity: Low-Medium
Confidence: Medium
Risk status: Confirmed layering smell

Evidence:
- `apps/web/src/lib/api-auth.ts:1` imports `isAdmin` from `@/app/actions/auth`.
- `apps/web/src/app/actions/auth.ts:1-23` is a server-action module with login/logout/password concerns and framework action context.
- `apps/web/src/app/actions/auth.ts:23-56` also owns pure current-session/current-user/admin helpers.
- Admin API routes consume `withAdminAuth()` from `lib/api-auth.ts`.

Failure scenario: this works today because both sides are server-only. The boundary is inverted: a lower-level route-auth library depends on an app action module. Future auth refactors can create circular pressure or accidentally make API auth inherit action-only dependencies.

Concrete fix: move `getSession()`, `getCurrentUser()`, and `isAdmin()` into a server-only `lib/current-user.ts` or `lib/auth.ts`; re-export them from `app/actions/auth` for compatibility; leave action-only login/logout/password mutations in the action module.

### ARCH-C3-09 - Dormant storage abstraction is quarantined but still load-bearing enough to misuse

Severity: Low
Confidence: High
Risk status: Likely future-coupling risk; currently quarantined

Evidence:
- `apps/web/src/lib/storage/index.ts:4-12` states the abstraction is not wired into uploads/processing/serving.
- `apps/web/src/lib/storage/index.ts:52-146` exposes working `getStorage()`, `getStorageSync()`, and backend switching APIs.
- `apps/web/src/__tests__/storage-quarantine.test.ts:1-27` documents the hazard and `:111-131` prevents non-test imports.
- `rg` found no non-test live importers outside the storage subtree.

Failure scenario: if a future feature bypasses the quarantine, it can create a second storage write path parallel to `uploadImages()` / `process-image` / `serve-upload`, diverging on path containment, symlink checks, GPS stripping, derivative cache invalidation, and original-private storage rules.

Concrete fix: keep the quarantine test until a deliberate storage-backend design lands. If multi-backend storage is not scheduled, delete the abstraction. If it is scheduled, integrate it through the canonical upload/process/serve boundary in one plan and update CLAUDE.md plus the quarantine test in the same change.

## Healthy Boundaries Reconfirmed

- Migration/journal posture is intentionally hardened: `apps/web/scripts/migrate.js:686-745` reconciles and hash-baselines every journal entry, then fails if any hash is missing. `apps/web/src/__tests__/migration-journal*.test.ts` and `migrate-reconcile-coverage.test.ts` pin the known non-monotonic journal and reconcile mirrors.
- Settings-hash/cache contract is centralized: `settings-hash.ts:45-57` owns the byte-impacting setting list, and `serve-upload.ts:50-83` debounces validated config hashing for the serving path before ETag construction at `:191-215`.
- Storage is currently quarantined by source test, not just prose.
- Topic slug fan-out has a registry test, so the mutable-natural-key risk is known and fenced.
- Public privacy selectors have compile-time and fixture guards; no current public PII leak was identified.
- Cycle-2 Docker-context and direct-exposure risks are fixed in current source: `.dockerignore` excludes `.claude/`, and `apps/web/Dockerfile:80-85` plus `apps/web/docker-compose.yml:14-21` default the app to loopback behind nginx.

## Final Missed-Issues Sweep

Checked and did not file new findings for: admin route metadata signatures, timeline/year i18n card labels, CLIP pre-enable docs, service-worker stamp behavior, route-auth lint gate shape, server-action origin gates, backup/restore lock release paths, advisory-lock constant centralization, settings-hash key membership, migration journal/reconcile coverage, storage import quarantine, public privacy selectors, map GPS visibility guards, and Docker/nginx body-cap alignment.

Validation evidence: static, line-numbered source inspection plus current review/plan history filtering. I did not run lint/typecheck/tests because this pass only rewrote the review artifact and made no application code changes.

Finding count: 9 total — 7 confirmed risks/smells, 1 likely future-coupling risk, 1 manual-validation topology risk. No Critical or High findings.
