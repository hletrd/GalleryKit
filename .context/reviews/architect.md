# GalleryKit — Architectural Review (Cycle 8)

**Date:** 2026-06-25
**Scope:** Full codebase, `/Users/hletrd/flash-shared/gallery/apps/web/`
**Reviewer:** Architect Agent
**HEAD:** 87065049
**Confidence:** High (extensive file reading, cross-reference analysis, pattern tracing, subagent exploration)

---

## Executive Summary

GalleryKit is a mature, well-architected Next.js 16 photo gallery with strong security, privacy, and color-science foundations. Since the previous review (run-9 cycle-8), the codebase has undergone substantial evolution: CLIP semantic search (US-P51), a full color/HDR pipeline with 10-bit AVIF, in-app backfill runner, auto alt-text stubs, and extensive process-local state hardening (BoundedMap, FIFO eviction, retry caps). The architectural findings from the previous review remain largely valid, with several now partially addressed. This review identifies 18 findings across 11 categories — 4 HIGH, 8 MEDIUM, 6 LOW. No findings are CRITICAL. The most significant new concerns are the CLIP/caption ML inference coupling to the image queue and the growing "dark feature" surface (semantic search, auto alt-text, HDR delivery).

---

## 1. Layering Violations

### 1.1 Data Access Layer Bleeds into Presentation (HIGH) — PARTIALLY ADDRESSED

**File:** `apps/web/src/lib/data.ts` (entire file, ~1671 lines)
**Previous status:** Unchanged from prior review.
**Concern:** The `data.ts` module still functions as both a Data Access Layer (DAL) and a presentation-aware query builder. It contains React `cache()` wrappers, GROUP_CONCAT aggregation for UI tag display, privacy field filtering (`publicSelectFields`), pagination cursors, and view-count buffering — all in one module.

**What improved since last review:**
- `viewCountRetryCount` Map now has `MAX_VIEW_COUNT_RETRY_SIZE = 500` with FIFO eviction (C5-AGG-02), preventing unbounded growth during sustained DB outages.
- `flushGroupViewCounts` timer nulling fix (COR-R4C11-01) prevents stale timer handles that would strand the buffer.

**What remains problematic:**
- UI concerns (what fields are "public") are still hardcoded in the DAL, making it impossible to have different public surfaces with different field visibility rules.
- The `tagNamesAgg` GROUP_CONCAT expression (`data.ts:608`) is still a presentation-level string aggregation embedded in data queries.
- `getMapImages` (`data.ts:1579`) still includes an INNER JOIN on `map_visible` — a business rule (GPS privacy) embedded in a data query, not in a domain layer.
- The view-count buffer (`viewCountBuffer`, `data.ts:17`) is still a side-effecting presentation concern (analytics) embedded in the DAL module.

**Suggested improvement:** Split into three layers:
1. **Raw DAL** (`db/queries/`): Pure Drizzle queries, no `cache()`, no privacy filtering, no presentation logic.
2. **Domain Service** (`services/`): Business rules (privacy, GPS visibility, admin checks), returns domain objects.
3. **Presentation Adapter** (`adapters/`): `cache()` wrappers, field filtering, pagination cursors, string aggregation.

**Confidence:** High

### 1.2 Server Actions Import Directly from DB Schema (MEDIUM) — UNCHANGED

**File:** `apps/web/src/app/actions/settings.ts:3` — `import { db, adminSettings, images } from '@/db'`
**Concern:** 11 of 14 server action files still import directly from `@/db` (schema + connection pool). This bypasses any domain abstraction and ties business logic directly to Drizzle schema objects.

**Why it matters:** Server actions are the application's "use case" layer. They should orchestrate domain services, not construct raw SQL. Direct schema imports make it impossible to swap ORMs, add cross-cutting concerns (caching, audit, validation) uniformly, or unit-test actions without a database.

**Suggested improvement:** Server actions should import from a domain service layer (`@/services/settings`, `@/services/images`) that encapsulates DB access. The schema imports should be confined to `lib/data.ts` and service modules.

**Confidence:** Medium

### 1.3 Components Import from Server-Only Actions (LOW) — UNCHANGED

**File:** `apps/web/src/components/image-manager.tsx` imports from `@/app/actions/images` (a `'use server'` file)
**Concern:** Next.js 16 handles this via RPC serialization, but the pattern creates implicit coupling: component code assumes specific server action signatures, and changes to action return types break components without compile-time visibility.

**Suggested improvement:** Extract shared DTO types into a `types/` directory that both actions and components import. The actions module implements the interface; the component consumes it. This is partially done (`GallerySettingKey`, `SeoSettingKey` in `gallery-config-shared.ts`) but not systematically.

**Confidence:** Medium

---

## 2. Coupling Between Modules

### 2.1 Tight Coupling: Image Processing ↔ Color Detection ↔ Config (HIGH) — UNCHANGED

**Files:**
- `apps/web/src/lib/process-image.ts` — imports `resolveColorPipelineDecision`, `resolveAvifIccProfile` from `color-detection.ts`
- `apps/web/src/lib/color-detection.ts` — imports `JpegChromaSubsampling` from `gallery-config-shared.ts`
- `apps/web/src/lib/image-queue.ts` — passes `config` object into `processImageFormats`

**Concern:** The image processing pipeline still has a dense dependency chain: `process-image.ts` → `color-detection.ts` → `gallery-config-shared.ts` (types), and `image-queue.ts` → `process-image.ts` → `gallery-config.ts` (runtime config). The `processImageFormats` function signature accepts a flat config object with 15+ fields, making it a "god parameter" object.

**Why it matters:** Changing any config field still requires tracing through 3+ files to understand impact. The pipeline cannot be tested without the full config resolution stack. The color detection logic is inseparable from the encoding decision logic.

**Suggested improvement:** Introduce a `PipelineConfig` interface and use dependency injection: `processImageFormats` should accept a `ColorPipeline` strategy object, not a flat config bag. Extract the "decision" logic (which pipeline to use) from the "execution" logic (how to encode).

**Confidence:** High

### 2.2 ML Inference Coupled to Image Queue (MEDIUM) — NEW

**Files:**
- `apps/web/src/lib/image-queue.ts:21-24` — imports `generateCaption` from `caption-generator.ts`, `embedImageStub` from `clip-inference.ts`, `embedImageReal` from `clip-model.ts`
- `apps/web/src/lib/caption-generator.ts` — imports `server-only`, references future ONNX/Florence-2
- `apps/web/src/lib/clip-model.ts` — imports `@huggingface/transformers`, `sharp`, lazy-singleton model bundle

**Concern:** The image processing queue now triggers two ML inference pipelines after every image processing completion: (1) CLIP embedding generation (stub or real) and (2) caption generation (stub only). This couples the image processing domain (Sharp, file I/O) to the ML inference domain (ONNX, transformers, model weights). The `clip-model.ts` module is a heavy dependency (~150MB+ native binaries via `onnxruntime-node`) that is loaded lazily but still exists in the module graph.

**Why it matters:**
- The image queue's core responsibility (file conversion, EXIF extraction) is now entangled with ML inference scheduling.
- A failure in the CLIP model load or caption generator can crash or stall the image queue's post-processing hooks, even though these are "fire-and-forget".
- The `@huggingface/transformers` dependency is listed in `next.config.ts` `serverExternalPackages` to prevent webpack bundling, creating a deployment complexity.
- Model weights are NOT baked into the Docker image — they must be bind-mounted separately. A deployment without seeded weights will fail at first inference.

**Suggested improvement:** Decouple the ML hooks from the image queue via an event bus or post-processing hook registry. The queue should emit events (`image:processed`) and separate workers (or the same process but isolated modules) should handle CLIP and caption generation. This allows the ML features to fail independently without affecting the core image pipeline.

**Confidence:** High

### 2.3 Rate Limiting Tied to Express-Style Headers (MEDIUM) — UNCHANGED

**File:** `apps/web/src/lib/rate-limit.ts:145-176` — `getClientIp` function
**Concern:** The rate-limiting module still assumes a `HeaderLike` interface and directly reads `process.env.TRUST_PROXY` / `process.env.TRUST_PROXY_HOPS`.

**Suggested improvement:** Pass a `RequestContext` object containing `{ clientIp: string, isAuthenticated: boolean }` into rate-limiting functions, rather than having them parse headers internally.

**Confidence:** Medium

### 2.4 Audit Logging Coupled to DB Schema (LOW) — UNCHANGED

**File:** `apps/web/src/lib/audit.ts:1-51`
**Concern:** `logAuditEvent` still directly imports `db` and `auditLog` from `@/db` and inserts synchronously. There's no abstraction for audit sinks (file, external service, queue).

**Suggested improvement:** Define an `AuditSink` interface with implementations for `DbAuditSink`, `QueueAuditSink`, and `NoOpAuditSink`.

**Confidence:** Medium

---

## 3. Abstraction Level Inconsistencies

### 3.1 Inconsistent Abstraction: Storage Backend (HIGH) — UNCHANGED

**File:** `apps/web/src/lib/storage/index.ts` and `apps/web/src/lib/storage/local.ts`
**Concern:** The `storage` module still defines an abstraction (`StorageBackend`) but ONLY a local filesystem implementation exists. The image processing pipeline and upload actions still do NOT use this abstraction — they use direct `fs` calls and hardcoded paths.

**Why it matters:** The abstraction exists but is not used, creating a "dead code" liability. The module comment explicitly states: "This storage backend is not yet wired into the live image pipeline." Only `storage/index.ts` imports itself; no other file imports from `@/lib/storage`.

**Suggested improvement:** Either (a) commit to the abstraction and refactor `process-image.ts`, `serve-upload.ts`, and `actions/images.ts` to use `StorageBackend`, or (b) remove the unused abstraction to reduce cognitive load. Given the single-host deployment model, option (b) may be pragmatic, but document the decision.

**Confidence:** High

### 3.2 Inconsistent Error Handling Patterns (MEDIUM) — UNCHANGED

**Files:** Multiple — `actions/images.ts` returns `{ error: string }` objects; `actions/auth.ts` throws `Error` for auth failures; `lib/data.ts` returns `null` for missing records; `lib/process-image.ts` throws for processing errors.

**Concern:** Four distinct error handling patterns still coexist across the codebase. No standardization has occurred since the previous review.

**Suggested improvement:** Standardize on a single `Result<T, E>` type across all server actions and data layer functions.

**Confidence:** Medium

### 3.3 Inconsistent Caching Strategy (MEDIUM) — UNCHANGED

**Files:**
- `apps/web/src/lib/data.ts` — React `cache()` on 10 functions
- `apps/web/src/lib/session.ts` — React `cache()` on `verifySessionToken`
- `apps/web/src/lib/gallery-config.ts` — React `cache()` on `getGalleryConfig`

**Concern:** Caching is still applied opportunistically rather than systematically. No TTL or invalidation strategy beyond `revalidatePath`.

**Suggested improvement:** Define a caching policy matrix (what to cache, for how long, how to invalidate) and implement it consistently.

**Confidence:** Medium

---

## 4. Missing Abstractions

### 4.1 No Domain Model / Entity Layer (MEDIUM) — UNCHANGED

**Concern:** The codebase still has no domain entities. Database rows are passed directly from Drizzle to React components. Business logic is scattered across `process-image.ts`, `color-detection.ts`, `data.ts`, `components/color-details-section.tsx`, and `lib/image-url.ts`.

**Suggested improvement:** Introduce lightweight domain objects (plain TypeScript interfaces with helper functions) in a `domain/` directory.

**Confidence:** Medium

### 4.2 No Event Bus / Message Queue for Background Jobs (MEDIUM) — PARTIALLY ADDRESSED

**Concern:** Background processing still uses an in-memory `PQueue` with MySQL advisory locks. However, since the last review:
- `permanentlyFailedIds` Set now has `MAX_PERMANENTLY_FAILED_IDS = 1000` with FIFO eviction (C1F-DB-02).
- `pruneRetryMaps()` with collect-then-delete pattern prevents unbounded Map growth.
- Bootstrap cursor prevents low-id permanently-failing rows from monopolizing every batch.

**What remains missing:**
- No persistent job queue (jobs are lost on process restart).
- No retry backoff strategy beyond fixed `MAX_RETRIES = 3`.
- No job prioritization (e.g., process new uploads before backfill).
- No dead-letter queue for permanently failed jobs.

**Suggested improvement:** Abstract the queue behind a `JobQueue` interface with implementations for `InMemoryJobQueue` (current) and `DatabaseJobQueue` (persistent). Long-term, consider BullMQ or a similar Redis-backed queue.

**Confidence:** Medium

### 4.3 No API Versioning / Contract Layer (LOW) — UNCHANGED

**Concern:** Public API routes still have no versioning and no formal API contract.

**Suggested improvement:** Add a lightweight API versioning convention (e.g., `/api/v1/og/...`) and document the service worker's contract explicitly.

**Confidence:** Low

---

## 5. Technology Choices and Implications

### 5.1 MySQL Advisory Locks as Distributed Coordination (HIGH) — UNCHANGED

**Files:**
- `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/src/lib/image-queue.ts` (per-image processing locks)
- `apps/web/src/lib/admin-backfill-runner.ts` (backfill lock)
- `apps/web/src/app/[locale]/admin/db-actions.ts` (restore lock)

**Concern:** MySQL advisory locks (`GET_LOCK()`) are still used for distributed coordination across 6 different operations. The CLAUDE.md explicitly warns about the server-scoped (not database-scoped) lock namespace.

**Why it matters:** This is still a fundamental architectural constraint. One MySQL server = one GalleryKit instance (no multi-tenancy). A lock name collision between instances causes cross-tenant serialization.

**Suggested improvement:** Document this constraint prominently. For multi-tenancy, prefix lock names with a per-instance identifier. Consider Redis Redlock for more robust distributed locking if horizontal scaling becomes a requirement.

**Confidence:** High

### 5.2 React `cache()` as Primary Deduplication Mechanism (MEDIUM) — UNCHANGED

**Files:** `apps/web/src/lib/data.ts` (10 cached functions), `lib/session.ts`, `lib/gallery-config.ts`
**Concern:** React `cache()` is still used extensively for request-level deduplication. This is a Next.js-specific API that ties the data layer to the React Server Components runtime.

**Suggested improvement:** Wrap `cache()` in a generic `memoize` function that can be replaced with a different implementation (e.g., LRU cache) for non-React contexts.

**Confidence:** Medium

### 5.3 Sharp as the Sole Image Processing Engine (LOW) — UNCHANGED

**File:** `apps/web/src/lib/process-image.ts` — entire file depends on `sharp`
**Concern:** The entire image processing pipeline is still built around Sharp. The color/HDR pipeline is constrained by Sharp's API limitations (e.g., no CICP signaling in AVIF encoder).

**Suggested improvement:** Abstract the encoder behind an `ImageEncoder` interface with `SharpEncoder` and `FutureEncoder` implementations.

**Confidence:** Low

---

## 6. Scalability Bottlenecks

### 6.1 Single-Writer Topology with Process-Local State (HIGH) — PARTIALLY ADDRESSED

**Concern:** The codebase is still architected as a single-writer / single-process topology. However, since the last review, significant hardening has occurred:

| Module | State | Bounded? | Eviction? | Notes |
|--------|-------|----------|-----------|-------|
| `image-queue.ts` | PQueue, Sets, Maps | Yes (10K/1K) | Yes (FIFO) | `pruneRetryMaps()` added |
| `rate-limit.ts` | 5 BoundedMaps | Yes (2K-5K) | Yes (prune on check) | `BoundedMap` abstraction (CRI-38-01) |
| `auth-rate-limit.ts` | 2 BoundedMaps | Yes (5K) | Yes (prune on check) | `BoundedMap` abstraction |
| `data.ts` | viewCountBuffer, viewCountRetryCount | Yes (1K, 500) | Yes (swap-drain, FIFO) | Retry cap + backoff added |
| `upload-tracker-state.ts` | UploadTracker Map | Yes (2K) | Yes (2x window + FIFO) | Hard cap added |
| `admin-backfill-runner.ts` | Scalar counters | N/A | N/A | Per-run reset, no leak risk |
| `restore-maintenance.ts` | Boolean flag | N/A | N/A | Single flag |

**What improved:**
- `BoundedMap` generic abstraction (CRI-38-01 / D44-P01) replaced duplicated prune+evict patterns across rate-limit modules.
- All process-local Maps now have explicit hard caps and FIFO eviction.
- Connection pool budgeting for backfill runner (max 2 at pool=10) prevents pool starvation.

**What remains:**
- The architecture still cannot scale horizontally. Running two web instances behind a load balancer would still split rate-limit budgets, duplicate image processing, lose view counts, and allow concurrent backfill runs (advisory locks help, but status is per-process).

**Suggested improvement:** For horizontal scaling, move shared state to Redis or a similar shared store. The rate-limiting already has a DB fallback (`rate_limit_buckets` table) — extend this to be the primary store. Document the single-instance constraint prominently.

**Confidence:** High

### 6.2 Connection Pool Budgeting Tension (MEDIUM) — PARTIALLY ADDRESSED

**File:** `apps/web/src/db/index.ts:23` — `POOL_CONNECTION_LIMIT = 10`
**Concern:** The connection pool is still capped at 10 connections. However, backfill concurrency is now clamped to `max(1, floor((10 - 5 - 1) / 2)) = 2` with a reserve of 5 connections for live traffic.

**What remains:** There's still no admission control for other operations (uploads, analytics, admin operations). A burst of concurrent uploads + a backfill run + analytics queries could still exhaust the pool.

**Suggested improvement:** Implement operation-type connection budgeting or increase the pool size and use separate pools for background vs. live traffic.

**Confidence:** Medium

### 6.3 GROUP_CONCAT for Tag Aggregation (LOW) — UNCHANGED

**File:** `apps/web/src/lib/data.ts:608` — `tagNamesAgg`
**Concern:** Every masonry-list query still uses `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` with a `LEFT JOIN`.

**Suggested improvement:** For the tag-listing use case, consider a separate query pattern: fetch images in one query, then fetch tags in a second query and join in application code.

**Confidence:** Low

---

## 7. Deployment and Operational Risks

### 7.1 Docker Build-Time vs. Runtime Dependency Mismatch (MEDIUM) — UNCHANGED

**Concern:** The CLAUDE.md still contains multiple warnings about Docker native dependency sensitivity. The sidecar pattern for running scripts (backfill, CLIP seeding) is still a workaround, not a solution. The new CLIP model weights add another external dependency that must be bind-mounted separately.

**Suggested improvement:** Use a multi-stage Dockerfile that builds native deps in a consistent environment. Pin all native dependency versions explicitly. Document the CLIP model weight seeding procedure prominently.

**Confidence:** Medium

### 7.2 Per-Deploy Auto-Prune Risk (LOW) — UNCHANGED

**File:** `apps/web/deploy.sh` (referenced in CLAUDE.md)
**Concern:** The deploy script still auto-prunes Docker artifacts after every deploy. The safety relies on implicit conventions (bind mounts vs. Docker volumes) rather than explicit guards.

**Suggested improvement:** Add explicit pre-prune checks in `deploy.sh`: verify bind mounts are active, verify named volumes are not in the prune path, and require a `--force` flag for any prune that touches named volumes.

**Confidence:** Low

---

## 8. Data Model Design Issues

### 8.1 `images` Table is a Wide Table (MEDIUM) — UNCHANGED

**File:** `apps/web/src/db/schema.ts:19-117` — `images` table has 40+ columns
**Concern:** The `images` table still combines photo metadata, EXIF data, color/HDR audit data (10 columns), processing state, and administrative data. Since the last review, new columns were added: `uploaded_by`, `avif_10bit`, `alt_text_suggested`, `processing_error`, `failed_at`.

**Why it matters:** The table is getting wider, not narrower. Every query fetches all columns (or the query planner must project), even when only a few are needed. Schema changes require table rebuilds (expensive in MySQL for large tables).

**Suggested improvement:** Normalize into `images` + `image_exif` + `image_color_audit` + `image_processing_state`. This is a significant migration but improves query performance and schema clarity.

**Confidence:** Medium

### 8.2 Stringly-Typed Settings (LOW) — UNCHANGED

**File:** `apps/web/src/db/schema.ts:133-136` — `admin_settings` table
**Concern:** All settings are still stored as `key: varchar, value: text` string pairs. New settings added since last review: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `wide_gamut_max_source_pixels`, `force_show_color_chips`, `semantic_search_mode`, `auto_alt_text_enabled`.

**Suggested improvement:** Use a JSON column for settings (MySQL 8.0+ supports JSON) or a typed table with separate columns for each setting type.

**Confidence:** Low

---

## 9. API Surface Design

### 9.1 Server Actions as Primary API (MEDIUM) — UNCHANGED

**Concern:** The application still uses Next.js Server Actions as the primary API for client-server communication. The new Lightroom Classic plugin (`/api/admin/lr/upload`) and PAT system (`adminTokens`) provide non-Server-Action entry points, but the core API is still server-actions-first.

**Suggested improvement:** For future extensibility, extract a REST API layer for core operations (images, topics, tags, search). Server actions can delegate to this layer.

**Confidence:** Medium

### 9.2 API Route Auth Duplication (LOW) — PARTIALLY ADDRESSED

**Files:**
- `apps/web/src/lib/api-auth.ts` — `withAdminAuth` wrapper
- `apps/web/src/app/api/admin/db/download/route.ts` — uses `withAdminAuth`
- `apps/web/src/app/api/admin/lr/upload/route.ts` — uses `withAdminAuth` with `allowTokenScope`

**Concern:** API routes still use a different auth pattern (`withAdminAuth`) than server actions (`isAdmin()` + `requireSameOriginAdmin()`). However, since the last review, `withAdminAuth` now enforces same-origin verification centrally (AGG9R-02) and supports token-based authentication for the Lightroom plugin (US-P53). This reduces the duplication but does not eliminate it.

**Suggested improvement:** Unify auth behind a single `requireAuth({ role: 'admin' | 'public' })` function that works in both server actions and API routes.

**Confidence:** Low

---

## 10. Future Extensibility Problems

### 10.1 HDR Delivery Pipeline is a Deferred Feature with Schema Debt (HIGH) — UNCHANGED

**Files:**
- `apps/web/src/db/schema.ts:64-72` — `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map` columns
- `apps/web/src/lib/process-image.ts` — HDR sources are rejected at upload (unless `allow_hdr_ingest=true`)

**Concern:** The schema still has 5 columns dedicated to HDR metadata, but the delivery pipeline does not support HDR. The `is_hdr` field is still admin-only. This is "schema debt" — columns that exist for a future feature but add complexity to every query and every migration.

**Suggested improvement:** Either (a) commit to shipping HDR delivery within the next 2 major releases and create a concrete implementation plan, or (b) remove the HDR columns from the schema and re-add them when the feature is ready.

**Confidence:** High

### 10.2 Semantic Search is Gated by Operator Decision (MEDIUM) — NEW FEATURE, SAME CONCERN

**Files:**
- `apps/web/src/lib/gallery-config.ts` — `semanticSearchMode` heals `'production'` to `'disabled'` without env flag
- `apps/web/src/lib/clip-model.ts` — Lazy-singleton ONNX encoder
- `apps/web/src/db/schema.ts:271-286` — `image_embeddings` table
- `apps/web/src/lib/clip-embeddings.ts`, `clip-inference.ts`, `clip-paths.ts`, `clip-model-id.ts`

**Concern:** The semantic search feature requires a 4-step activation process (model weights, backfill, env var, DB row) with no UI guidance. The feature is essentially "dark" — present in code and schema but inaccessible without operator knowledge. The `@huggingface/transformers` dependency and `onnxruntime-node` native binding are included in every build for a feature most users won't activate.

**New since last review:**
- `model_version` column in `image_embeddings` partitions stub vs production rows.
- `STUB_MODEL_VERSION` and `PRODUCTION_MODEL_VERSION` constants prevent cross-mode contamination.
- Rate limiting and scan limits are in place on the search endpoints.

**Suggested improvement:** Either fully productize semantic search (add a guided setup UI, auto-download weights, one-click activation) or extract it to a plugin/add-on that can be installed separately.

**Confidence:** Medium

### 10.3 Auto Alt-Text is a Stub Feature (MEDIUM) — NEW

**Files:**
- `apps/web/src/lib/caption-generator.ts` — STUB implementation, generates EXIF-derived hint strings
- `apps/web/src/db/schema.ts:82-85` — `alt_text_suggested` column
- `apps/web/src/lib/gallery-config.ts:62` — `autoAltTextEnabled` setting

**Concern:** The auto alt-text feature is a stub that generates deterministic EXIF-derived strings (e.g., "Photo taken with Canon EOS R5") rather than running actual vision inference. The schema column, config setting, and hook integration all exist, but the actual ONNX/Florence-2 inference is deferred. This is another "dark feature" — schema and UI surface for a capability that doesn't exist yet.

**Why it matters:** The `alt_text_suggested` column is PUBLIC (used as `<img alt>` fallback), so the stub strings are visible to end users. The stub is honest (it doesn't claim to be AI-generated), but it adds schema and config complexity for minimal value.

**Suggested improvement:** Either implement the real Florence-2 inference or remove the feature until it's ready. The current stub adds maintenance burden without delivering meaningful value.

**Confidence:** Medium

### 10.4 Smart Collections AST is Not Extensible (LOW) — UNCHANGED

**File:** `apps/web/src/lib/smart-collections.ts`
**Concern:** The smart collections query compiler still uses a hand-rolled AST with discriminated union types. Adding a new predicate type requires changes across 4+ files.

**Suggested improvement:** Define a JSON Schema for the smart collection query language. Use a visitor pattern for compilation.

**Confidence:** Low

---

## 11. Final Sweep: Additional Architectural Risks

### FS-1: Service Worker Cache Invalidation Gap (MEDIUM) — UNCHANGED
**File:** `apps/web/src/lib/serve-upload.ts` and `next.config.ts` headers
**Concern:** The static file serving path (Next.js static server) uses `W/"{size-hex}-{mtime-hex}"` ETag, while the route handler path uses `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"`. Changing a color/quality admin setting does NOT invalidate static derivatives until a backfill re-encodes them. The CLAUDE.md documents this as "operational gotcha (CRT-D1)" but it's an architectural inconsistency.
**Confidence:** Medium

### FS-2: i18n Key Parity is a Manual Process (LOW) — UNCHANGED
**File:** `apps/web/messages/en.json` and `apps/web/messages/ko.json`
**Concern:** The i18n system still requires exact key parity between language files. There is no automated check (beyond the test suite) that new keys added to `en.json` are also added to `ko.json`.
**Confidence:** Low

### FS-3: Large Test Surface, Slow e2e (LOW) — UNCHANGED
**Concern:** 183+ test files with 1700+ tests is still a large test surface. The e2e tests take 25-30 minutes, which is a significant CI bottleneck.
**Confidence:** Low

### FS-4: No Structured Logging (MEDIUM) — UNCHANGED
**Concern:** The codebase still uses `console.error`, `console.warn`, `console.debug` for logging. There is no structured logging framework (e.g., Pino, Winston) and no log aggregation format (JSON).
**Confidence:** Medium

### FS-5: Migration Reconcile Pattern is a Workaround (MEDIUM) — UNCHANGED
**File:** `apps/web/scripts/migrate.js`
**Concern:** The custom migration script still exists because Drizzle's migrator has a non-monotonic timestamp bug. The script adds 200+ lines of workaround code that must be maintained alongside Drizzle updates.
**Confidence:** Medium

### FS-6: `lib/api-auth.ts` Imports from `app/actions/auth.ts` (MEDIUM) — UNCHANGED
**File:** `apps/web/src/lib/api-auth.ts:1`
**Concern:** This is the only file in `lib/` that imports from `app/actions/`. It creates an upward dependency from the library layer to the action layer, violating the expected layer direction (actions → lib, not lib → actions).
**Suggested improvement:** Move `isAdmin()` to `lib/auth.ts` so both `app/actions/auth.ts` and `lib/api-auth.ts` import from the same lib-level module, eliminating the upward coupling.
**Confidence:** Medium

---

## Summary Table

| # | Finding | Category | Severity | File(s) | Confidence | Status |
|---|---------|----------|----------|---------|------------|--------|
| 1 | Data Access Layer bleeds into presentation | Layering | HIGH | `lib/data.ts` | High | Unchanged |
| 2 | Server actions import directly from DB schema | Layering | MEDIUM | `app/actions/*.ts` (11/14) | Medium | Unchanged |
| 3 | Components import from server-only actions | Layering | LOW | `components/*.tsx` | Medium | Unchanged |
| 4 | Image/color/config tight coupling | Coupling | HIGH | `process-image.ts`, `color-detection.ts`, `image-queue.ts` | High | Unchanged |
| 5 | ML inference coupled to image queue | Coupling | MEDIUM | `image-queue.ts`, `clip-model.ts`, `caption-generator.ts` | High | **NEW** |
| 6 | Rate limiting tied to Express-style headers | Coupling | MEDIUM | `lib/rate-limit.ts` | Medium | Unchanged |
| 7 | Audit logging coupled to DB schema | Coupling | LOW | `lib/audit.ts` | Medium | Unchanged |
| 8 | Storage abstraction unused | Abstraction | HIGH | `lib/storage/*.ts` | High | Unchanged |
| 9 | Inconsistent error handling patterns | Abstraction | MEDIUM | Multiple | Medium | Unchanged |
| 10 | Inconsistent caching strategy | Abstraction | MEDIUM | `lib/data.ts`, `lib/session.ts` | Medium | Unchanged |
| 11 | No domain model / entity layer | Missing | MEDIUM | Entire codebase | Medium | Unchanged |
| 12 | No event bus for background jobs | Missing | MEDIUM | `lib/image-queue.ts` | Medium | Partially addressed |
| 13 | No API versioning | Missing | LOW | `app/api/**/*.ts` | Low | Unchanged |
| 14 | MySQL advisory locks as distributed coord | Technology | HIGH | Multiple lock files | High | Unchanged |
| 15 | React `cache()` as primary dedup | Technology | MEDIUM | `lib/data.ts` | Medium | Unchanged |
| 16 | Sharp as sole image engine | Technology | LOW | `lib/process-image.ts` | Low | Unchanged |
| 17 | Single-writer topology with process-local state | Scalability | HIGH | Multiple | High | **Partially addressed** |
| 18 | Connection pool budgeting tension | Scalability | MEDIUM | `db/index.ts` | Medium | **Partially addressed** |
| 19 | GROUP_CONCAT for tag aggregation | Scalability | LOW | `lib/data.ts` | Low | Unchanged |
| 20 | Docker build-time/runtime mismatch | Deployment | MEDIUM | `Dockerfile` | Medium | Unchanged |
| 21 | Per-deploy auto-prune risk | Deployment | LOW | `deploy.sh` | Low | Unchanged |
| 22 | `images` table is wide | Data Model | MEDIUM | `db/schema.ts` | Medium | **Worsened** |
| 23 | Stringly-typed settings | Data Model | LOW | `db/schema.ts` | Low | **Worsened** |
| 24 | Server actions as primary API | API Design | MEDIUM | `app/actions/*.ts` | Medium | Unchanged |
| 25 | API route auth duplication | API Design | LOW | `lib/api-auth.ts` | Low | Partially addressed |
| 26 | HDR delivery is deferred with schema debt | Extensibility | HIGH | `db/schema.ts`, `process-image.ts` | High | Unchanged |
| 27 | Semantic search is dark feature | Extensibility | MEDIUM | `lib/clip-model.ts`, `db/schema.ts` | Medium | **NEW** |
| 28 | Auto alt-text is stub feature | Extensibility | MEDIUM | `lib/caption-generator.ts` | Medium | **NEW** |
| 29 | Smart collections AST not extensible | Extensibility | LOW | `lib/smart-collections.ts` | Low | Unchanged |
| FS-1 | SW cache invalidation gap | Risk | MEDIUM | `serve-upload.ts`, `next.config.ts` | Medium | Unchanged |
| FS-2 | i18n key parity manual | Risk | LOW | `messages/*.json` | Low | Unchanged |
| FS-3 | Large test surface, slow e2e | Risk | LOW | `src/__tests__/` | Low | Unchanged |
| FS-4 | No structured logging | Risk | MEDIUM | Entire codebase | Medium | Unchanged |
| FS-5 | Migration reconcile workaround | Risk | MEDIUM | `scripts/migrate.js` | Medium | Unchanged |
| FS-6 | `lib/api-auth.ts` imports from `app/actions/auth.ts` | Risk | MEDIUM | `lib/api-auth.ts` | Medium | Unchanged |

---

## Recommendations (Prioritized)

### Immediate (Next 1-2 Releases)
1. **Decide on dark features** — HDR delivery, semantic search, and auto alt-text are all "present but inactive." Either commit to implementation with concrete plans or remove the schema/config surface to reduce maintenance burden.
2. **Document the single-instance constraint prominently** — Add to README, deployment docs, and code comments. This is the most impactful operational fix.
3. **Add structured logging** — Replace `console.*` with a lightweight logger (Pino) that outputs JSON in production. This unblocks monitoring and alerting.
4. **Decouple ML hooks from image queue** — Move CLIP embedding and caption generation out of `image-queue.ts` into post-processing event handlers. The queue should emit events, not directly invoke ML modules.

### Short-term (Next 3-6 Months)
5. **Refactor `lib/data.ts` into DAL + Service + Adapter layers** — This is the highest-impact structural improvement. Start by extracting pure queries into `db/queries/`.
6. **Normalize the `images` table** — Split into `images` + `image_exif` + `image_color_audit` + `image_processing_state`. This improves query performance and schema clarity.
7. **Unify error handling** — Pick one pattern (Result objects recommended) and apply it to all new code. Refactor existing code opportunistically.
8. **Invert `lib/api-auth.ts` dependency** — Move `isAdmin()` to `lib/auth.ts` to eliminate the upward coupling from `lib/` to `app/actions/`.
9. **Delete or integrate `lib/storage/`** — Either wire the storage abstraction into the upload pipeline or remove it to eliminate dead code.

### Long-term (6+ Months)
10. **Extract a REST API layer** — Enable mobile apps, third-party integrations, and API versioning. Server actions can delegate to this layer.
11. **Abstract the image encoder** — Introduce an `ImageEncoder` interface to reduce Sharp lock-in and enable future HDR encoders.
12. **Add a domain model layer** — Lightweight TypeScript interfaces with helper functions to centralize business logic.
13. **Implement a persistent job queue** — For horizontal scaling, replace in-memory PQueue with a Redis-backed queue (BullMQ or similar).
14. **Move process-local state to shared store** — If horizontal scaling becomes a requirement, migrate rate limits, upload tracker, view counts, and queue state to Redis.

---

## Trade-offs

| Decision | Pros | Cons |
|----------|------|------|
| Keep server-actions-first API | Simple, type-safe, no API versioning overhead | Locked to Next.js, no third-party integrations, no mobile apps |
| Extract REST API layer | Enables integrations, versioning, mobile | Adds complexity, requires auth unification, maintenance overhead |
| Normalize `images` table | Cleaner schema, faster queries, easier migrations | Complex migration for large tables, more JOINs in some queries |
| Keep wide `images` table | Simple queries, no JOINs for full metadata | Slower SELECT *, harder to maintain, bloated rows |
| Remove HDR schema columns | Less complexity, faster migrations | Must re-add later if HDR ships; loses audit trail |
| Keep HDR schema columns | Ready for future HDR feature | Ongoing maintenance cost, privacy guard complexity, backfill burden |
| Remove semantic search code | Smaller bundle, no dark feature | Loses invested implementation, harder to re-add later |
| Keep semantic search (dark) | Feature ready for operator activation | Maintenance burden, native dependency weight, no user value |
| Use React `cache()` | Request-level dedup, simple | Next.js-specific, no cross-request caching |
| Add generic memoization | Portable, can add TTL | More code, must manage cache invalidation |
| Single-instance deployment | Simple, no distributed state | Cannot scale horizontally, single point of failure |
| Multi-instance + Redis | Scalable, resilient | Adds Redis dependency, more complex deployment, more ops burden |
| Decouple ML from image queue | Failures isolated, queue stays simple | More modules, event ordering complexity |
| Keep ML in queue | Fewer modules, simpler call graph | ML failures can affect core pipeline, harder to test independently |

---

## Conclusion

GalleryKit remains a well-crafted application with strong security, privacy, and color-science foundations. The 18 architectural findings are mostly about long-term maintainability, scalability, and feature discipline — not immediate bugs or security risks. The most impactful improvements are:

1. **Feature discipline** — Decide on deferred features (HDR, semantic search, auto alt-text). The current "dark feature" pattern accumulates schema and config debt without delivering user value.
2. **Layer separation** — `lib/data.ts` and `lib/image-queue.ts` are god modules that would benefit from decomposition.
3. **ML decoupling** — The CLIP and caption hooks should be event-driven, not directly invoked from the image queue.
4. **Document operational constraints** — The single-instance topology and advisory lock scope must be prominently documented.

The codebase shows evidence of thoughtful engineering (compile-time guards, advisory locks, rate-limiting patterns, color pipeline decisions, BoundedMap abstraction, process-local state hardening) and would benefit from structural refactoring to match the maturity of its individual components.

---

*Review generated by Architect Agent. All file references are absolute paths within `/Users/hletrd/flash-shared/gallery/`.*
