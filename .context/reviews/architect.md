# Architect Review - Cycle 23

Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `45208b2181add5db64395e4dac30134cfd1fcf35`
Review date: 2026-06-30

## Scope And Method

I read `AGENTS.md` and `CLAUDE.md` first, then inventoried the review-relevant repository surfaces across docs, source, tests, scripts, migrations, deployment config, and prior review/planning context.

Inventory evidence:
- `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, and `apps/web/e2e`: 579 files.
- `apps/web/src`: 513 files.
- `apps/web/src/__tests__`: 273 files.
- Main architectural surfaces reviewed included auth/action guards, admin API wrappers, public route rate-limit linting, data selectors/privacy guards, schema and migration reconciliation, upload and image queue lifecycle, restore/backup topology, semantic search, smart collections, public map access, deployment config, and source-contract tests.

Validation was static architecture review only. I did not run lint/typecheck/build/tests because this task only writes a review report and makes no runtime code changes.

## Findings

### ARCH23-01 - Duplicate Upload Ingest Orchestration Is Still A High-Drift Boundary

Severity: Medium
Confidence: High
Risk type: Confirmed

Evidence:
- Browser upload owns auth, quota, config snapshot, filesystem save, GPS stripping, DB insert, and queue payload construction in one action: `apps/web/src/app/actions/images.ts:114-190`, `apps/web/src/app/actions/images.ts:177-242`, `apps/web/src/app/actions/images.ts:340-531`.
- Lightroom/PAT upload independently repeats the same lifecycle: `apps/web/src/app/api/admin/lr/upload/route.ts:68-151`, `apps/web/src/app/api/admin/lr/upload/route.ts:243-275`, `apps/web/src/app/api/admin/lr/upload/route.ts:307-516`.
- The queue has a shared `ProcessingSettingsSnapshot`, but the upload adapters still manually assemble and thread it: `apps/web/src/lib/image-queue.ts:92-120`.
- Upload-processing settings are contract-locked separately from each adapter, so the invariant is distributed across settings, upload actions, and queue code: `apps/web/src/app/actions/settings.ts:40-100`, `apps/web/src/lib/upload-processing-contract-lock.ts:1-74`.

Failure scenario:
A future image-processing setting, metadata field, privacy decision, or queue payload field is added to one ingest path but not the other. Browser uploads and Lightroom uploads then process the same kind of image under different GPS, HDR, derivative, caption, or audit behavior. The code already relies on comments and mirrored field lists rather than a single executable ingest contract, so the next change must remember two separate orchestration owners.

Concrete fix:
Extract a server-only ingest service, for example `createImageIngestSession(input)`, that owns the shared lifecycle: maintenance/contract lock interaction, upload tracker/quota claim and settlement, metadata extraction, optional GPS stripping, DB insert, queue job construction, and cleanup on failure. Keep the browser action and LR route as thin adapters that translate transport/auth input into the shared DTO. Add an exhaustiveness/source-contract test that proves both adapters pass through the same required processing snapshot fields.

### ARCH23-02 - Image Processing Jobs Can Pin Most Of The Shared MySQL Pool During Sharp Work

Severity: Medium
Confidence: High
Risk type: Confirmed

Evidence:
- The global MySQL pool is fixed at 10 connections with a queue limit of 20: `apps/web/src/db/index.ts:23-33`.
- The image queue allows `QUEUE_CONCURRENCY` up to 8: `apps/web/src/lib/image-queue.ts:87-90`.
- Each job acquires a DB advisory-lock connection and keeps that connection as the claim token: `apps/web/src/lib/image-queue.ts:446-463`.
- The lock is acquired at job start and released only in the final cleanup: `apps/web/src/lib/image-queue.ts:513-520`, `apps/web/src/lib/image-queue.ts:812-815`.
- While that lock connection is held, the job performs filesystem checks, optional config reads, Sharp derivative generation, file verification, and DB updates: `apps/web/src/lib/image-queue.ts:554-657`.

Failure scenario:
An operator increases `QUEUE_CONCURRENCY` to 8 to catch up after a large import. Eight queue workers can hold eight of ten shared pool connections for the full duration of CPU and filesystem image processing. Foreground admin/public queries, restore maintenance, upload inserts, and semantic/search operations then contend for the two remaining connections plus the small pool wait queue. Under burst load, user-facing requests can time out even though the bottleneck is queue claim topology, not database query cost.

Concrete fix:
Stop holding a shared pool connection across Sharp work. Prefer a durable DB row claim such as `processing_started_at`/`processing_owner` with timeout recovery, or use a dedicated tiny lock pool isolated from foreground traffic. If advisory locks remain, cap queue concurrency from pool-budget arithmetic the same way backfill work does, and add a source-contract/stress test that proves image queue workers cannot consume more than the reserved background connection budget.

### ARCH23-03 - Single-Process Operational Topology Is Documented But Not Enforced At Startup

Severity: Medium
Confidence: High
Risk type: Likely

Evidence:
- `CLAUDE.md` states the accepted topology: a single web instance, shared MySQL, local filesystem, and process-local queues/guards: `CLAUDE.md:233-236`.
- Docker Compose currently declares one `web` service but has no executable startup lease that prevents a second app process or a scaled service from running: `apps/web/docker-compose.yml:1-28`.
- Restore maintenance is process-local global state: `apps/web/src/lib/restore-maintenance.ts:1-56`.
- Upload tracking is process-local global state: `apps/web/src/lib/upload-tracker-state.ts:7-20`, `apps/web/src/lib/upload-tracker-state.ts:70-78`.
- Image queue bootstrap and shutdown are process-local runtime hooks: `apps/web/src/instrumentation.ts:1-6`, `apps/web/src/instrumentation.ts:18-65`.
- Image queue state is also process-local and keyed off `globalThis`: `apps/web/src/lib/image-queue.ts:76-90`.
- Shared group view-count buffering lives in module-local process memory: `apps/web/src/lib/data.ts:13-18`.

Failure scenario:
A future deployment change starts two Node processes, two containers, or a platform-managed multi-instance rollout. Each process gets its own restore-maintenance flag, upload tracker, queue bootstrap state, permanently-failed queue set, and view-count buffer. One process can accept uploads while another is restoring the database, rate limits and upload quotas can split by process, duplicate queue bootstraps can race, and buffered view counts can be lost independently on shutdown.

Concrete fix:
Make the single-writer topology executable. Add a startup DB advisory lease or durable `runtime_instances` claim that fails fast when another web process is active. Alternatively, before supporting horizontal scaling, move restore state, upload claims, rate limits, queue claims, and view-count buffers to shared durable storage. Add a boot-time invariant test or startup source-contract test that documents which process-local modules require the single-instance lease.

### ARCH23-04 - `data.ts` Still Combines Privacy Contracts, Public Queries, Admin Queries, SEO, Search, Shares, Maps, And Side-Effect Buffers

Severity: Medium
Confidence: High
Risk type: Confirmed

Evidence:
- `apps/web/src/lib/data.ts` is 1,753 lines.
- It imports broad schema ownership and defines process-local view-count buffering at module load: `apps/web/src/lib/data.ts:1-18`.
- It owns the central admin/public selector and privacy guard contract: `apps/web/src/lib/data.ts:251-507`.
- It also owns public gallery listing, feeds, OG image lookup, admin image listing, image detail, shares, smart collections, search, sitemap IDs, map images, caches, and view updates: `apps/web/src/lib/data.ts:785-1705`.
- The public map selector intentionally diverges from the public privacy selector by adding coordinates under a topic gate: `apps/web/src/lib/data.ts:410-488`, `apps/web/src/lib/data.ts:1667-1697`.

Failure scenario:
A change meant for one route or behavior plane forces modification in the same file that owns privacy-sensitive field selection and process-local side effects. For example, adding a public search field, map field, or SEO field risks touching the same module-level selector contract that protects admin-only fields. The current compile-time guards reduce leakage risk, but the file remains an architectural choke point that makes ownership, review scope, and future decomposition harder.

Concrete fix:
Split the module by boundary rather than by convenience. Move selector/privacy contracts into a narrow `image-select-fields` module; move gallery/feed/search/map/share/sitemap queries into separate route-facing query modules; move the shared-group view-count buffer into its own runtime/state module. Keep the current `_PrivacySensitiveKeys` and public-map exceptions as central exported types/tests so decomposition strengthens, rather than weakens, the public/admin data boundary.

### ARCH23-05 - All Admins Remain Root Admins Across Restore, User Management, Settings, And Upload Tokens

Severity: Medium
Confidence: High
Risk type: Manual-validation risk

Evidence:
- The documented product assumption is that there are multiple root admins and no role/capability separation: `CLAUDE.md:5`, `CLAUDE.md:235`.
- Database restore is guarded by same-origin plus `isAdmin()`, not a narrower restore capability: `apps/web/src/app/[locale]/admin/db-actions.ts:363-370`.
- Database restore then acquires restore/backfill/upload locks and can import a dump that rewrites the persistence contract: `apps/web/src/app/[locale]/admin/db-actions.ts:372-548`.
- Admin user creation and deletion require only `isAdmin()` plus self/last-admin safeguards: `apps/web/src/app/actions/admin-users.ts:77-84`, `apps/web/src/app/actions/admin-users.ts:186-230`.
- Settings mutation similarly gates on root admin status only: `apps/web/src/app/actions/settings.ts:40-47`.
- The LR upload route supports token-scoped upload auth, but that scoping is at the upload route edge, not an admin capability model for broader control-plane actions: `apps/web/src/app/api/admin/lr/upload/route.ts:68-151`.

Failure scenario:
This is acceptable for the documented personal-gallery threat model, but it becomes a design risk as soon as "admin" means assistant, contractor, Lightroom-only operator, second photographer, or family curator. A compromised or less-trusted admin account can create other admins, delete admins, change image-processing settings, manage upload tokens, or run database restore. Audit logs help after the fact but do not constrain blast radius.

Concrete fix:
Before expanding multi-admin/studio use, introduce explicit admin capabilities such as `restore_database`, `manage_admins`, `manage_settings`, `manage_upload_tokens`, and `upload_images`. Keep the current root-admin role as a migration default, but make high-impact actions declare the capability they require. At minimum, add admin UI/docs warnings that every admin is currently a full control-plane operator.

### ARCH23-06 - Topic Slugs Are Still A Mutable Natural-Key Boundary, Though Current Tests Reduce Regression Risk

Severity: Low
Confidence: Medium
Risk type: Confirmed, currently mitigated

Evidence:
- Topics use slug as the primary key: `apps/web/src/db/schema.ts:4-17`.
- Images and topic views reference topic slug text: `apps/web/src/db/schema.ts:19-34`, `apps/web/src/db/schema.ts:239-242`.
- Smart collection rules can also reference topic slugs in JSON-like rule payloads: `apps/web/src/db/schema.ts:297-306`.
- Topic update logic performs coordinated slug retargeting across children: `apps/web/src/app/actions/topics.ts:255-339`.
- The registry test explicitly requires new topic-slug foreign-key children to be registered: `apps/web/src/__tests__/topic-slug-fk-registry.test.ts:1-83`.

Failure scenario:
The current registry test is valuable, but slug remains both display URL identity and relational identity. A future feature can add a topic-like reference outside the registered children, inside JSON rules, or outside Drizzle schema introspection. A slug rename then partially updates the graph, leaving smart collections, cached links, or analytics rows pointing at the old slug.

Concrete fix:
Long term, introduce immutable numeric topic IDs and treat slug as a mutable unique display attribute. Short term, keep the registry test blocking and add a route/source-contract test for every non-FK topic-slug reference, especially JSON rule payloads and URL-generation helpers.

## Confirmed Strengths / Non-Findings

- Public/admin image field separation is much stronger than in many gallery apps. `publicSelectFields` is derived from `adminSelectFields` with explicit omissions and compile-time privacy guards: `apps/web/src/lib/data.ts:251-507`.
- Search enrichment has a separate allowlist and type guard, reducing accidental leakage through semantic/search APIs: `apps/web/src/lib/search-enrichment-fields.ts:1-47`.
- Public map coordinate exposure is intentionally narrower than full admin exposure and is gated by `topics.map_visible`: `apps/web/src/lib/data.ts:410-488`, `apps/web/src/lib/data.ts:1667-1697`.
- Migration ordering and legacy reconciliation have explicit tests and post-conditions. The journal is ordered and non-duplicated: `apps/web/drizzle/meta/_journal.json:1-170`, `apps/web/src/__tests__/migration-journal.test.ts:1-121`, `apps/web/scripts/migrate.js:1-920`.
- Admin API and mutating action auth boundaries are backed by lint gates: `apps/web/scripts/check-api-auth.ts:1-170`, `apps/web/scripts/check-action-origin.ts:1-190`, `apps/web/scripts/check-public-route-rate-limit.ts:1-220`.
- The cycle-22 deploy-doc drift around `.env.deploy` appears fixed in current docs and source-contract tests: `CLAUDE.md:68`, `CLAUDE.md:658`, `apps/web/src/__tests__/cycle-22-source-contracts.test.ts:1-120`.
- Storage backend abstraction is intentionally quarantined rather than prematurely generalized: `apps/web/src/lib/storage/index.ts:1-120`, `apps/web/src/__tests__/storage-quarantine.test.ts:1-143`.

## Final Missed-Issues Sweep

I performed a final sweep over:
- docs and operational contracts: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/`, `.context/plans/`;
- auth/control-plane surfaces: server actions, API routes, middleware/proxy, lint scripts;
- data boundaries: selectors, privacy tests, search enrichment, public map, smart collections;
- persistence contracts: Drizzle schema, journal, migration reconciler, migration tests;
- image pipeline: upload actions, LR upload route, processing queue, process-image helpers, restore maintenance;
- deployment/runtime topology: Docker Compose, NGINX, instrumentation, deploy scripts;
- test surfaces relevant to the above contracts.

Skipped files:
- No live review-relevant source, schema, migration, script, e2e, or contract-test file was intentionally skipped.
- I did not line-review binary/static assets, generated build artifacts, dependency folders, test output directories, or historical archive artifacts except where they informed prior finding context. These are not architectural source-of-truth surfaces for this review.

## Verification Notes

No code changes were made. This review updates only `.context/reviews/architect.md`.
