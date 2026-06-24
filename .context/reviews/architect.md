# GalleryKit — Architectural Review

**Date:** 2026-06-25
**Scope:** Full codebase, `/Users/hletrd/flash-shared/gallery/apps/web/`
**Reviewer:** Architect Agent
**Confidence:** High (extensive file reading, cross-reference analysis, pattern tracing)

---

## Executive Summary

GalleryKit is a mature, well-architected Next.js 16 photo gallery with strong security, privacy, and color-science foundations. The codebase demonstrates excellent defense-in-depth patterns (compile-time privacy guards, rate-limiting, advisory locks), a sophisticated image processing pipeline with HDR/wide-gamut support, and comprehensive test coverage. However, there are 15 architectural findings across 10 categories — mostly around monorepo structure, horizontal scalability barriers, tight coupling between data access and presentation, and several long-term extensibility risks. No findings are CRITICAL; 5 are HIGH, 6 are MEDIUM, and 4 are LOW.

---

## 1. Layering Violations

### 1.1 Data Access Layer Bleeds into Presentation (HIGH)

**File:** `apps/web/src/lib/data.ts` (entire file, ~1666 lines)
**Concern:** The `data.ts` module functions as both a Data Access Layer (DAL) and a presentation-aware query builder. It contains React `cache()` wrappers, GROUP_CONCAT aggregation for UI tag display, privacy field filtering (`publicSelectFields`), pagination cursors, and view-count buffering — all in one module.

**Why it matters:** This conflation means:
- UI concerns (what fields are "public") are hardcoded in the DAL, making it impossible to have different public surfaces (e.g., a JSON API vs. HTML rendering) with different field visibility rules.
- The `tagNamesAgg` GROUP_CONCAT expression (`data.ts:608`) is a presentation-level string aggregation embedded in data queries. If a future API needs tags as an array, the DAL must be forked or refactored.
- `getMapImages` (`data.ts:1579`) includes an INNER JOIN on `map_visible` — a business rule (GPS privacy) embedded in a data query, not in a domain layer.
- The view-count buffer (`viewCountBuffer`, `data.ts:17`) is a side-effecting presentation concern (analytics) embedded in the DAL module.

**Suggested improvement:** Split into three layers:
1. **Raw DAL** (`db/queries/`): Pure Drizzle queries, no `cache()`, no privacy filtering, no presentation logic.
2. **Domain Service** (`services/`): Business rules (privacy, GPS visibility, admin checks), returns domain objects.
3. **Presentation Adapter** (`adapters/`): `cache()` wrappers, field filtering, pagination cursors, string aggregation.

**Confidence:** High

### 1.2 Server Actions Import Directly from DB Schema (MEDIUM)

**File:** `apps/web/src/app/actions/settings.ts:3` — `import { db, adminSettings, images } from '@/db'`
**Concern:** 11 of 14 server action files import directly from `@/db` (schema + connection pool). This bypasses any domain abstraction and ties business logic directly to Drizzle schema objects.

**Why it matters:** Server actions are the application's "use case" layer. They should orchestrate domain services, not construct raw SQL. Direct schema imports make it impossible to swap ORMs, add cross-cutting concerns (caching, audit, validation) uniformly, or unit-test actions without a database.

**Suggested improvement:** Server actions should import from a domain service layer (`@/services/settings`, `@/services/images`) that encapsulates DB access. The schema imports should be confined to `lib/data.ts` and service modules.

**Confidence:** Medium

### 1.3 Components Import from Server-Only Actions (LOW)

**File:** `apps/web/src/components/image-manager.tsx` imports from `@/app/actions/images` (a `'use server'` file)
**Concern:** Next.js 16 handles this via RPC serialization, but the pattern creates implicit coupling: component code assumes specific server action signatures, and changes to action return types break components without compile-time visibility.

**Why it matters:** The component layer should depend on stable contracts (TypeScript interfaces), not on implementation modules. When a server action's return type changes, the component breakage is discovered at runtime or via typecheck, not via module boundaries.

**Suggested improvement:** Extract shared DTO types into a `types/` directory that both actions and components import. The actions module implements the interface; the component consumes it. This is partially done (`GallerySettingKey`, `SeoSettingKey` in `gallery-config-shared.ts`) but not systematically.

**Confidence:** Medium

---

## 2. Coupling Between Modules

### 2.1 Tight Coupling: Image Processing ↔ Color Detection ↔ Config (HIGH)

**Files:**
- `apps/web/src/lib/process-image.ts` — imports `resolveColorPipelineDecision`, `resolveAvifIccProfile` from `color-detection.ts`
- `apps/web/src/lib/color-detection.ts` — imports `JpegChromaSubsampling` from `gallery-config-shared.ts`
- `apps/web/src/lib/image-queue.ts` — passes `config` object into `processImageFormats`

**Concern:** The image processing pipeline has a circular dependency chain: `process-image.ts` → `color-detection.ts` → `gallery-config-shared.ts` (types), and `image-queue.ts` → `process-image.ts` → `gallery-config.ts` (runtime config). The `processImageFormats` function signature accepts a flat config object with 15+ fields, making it a "god parameter" object.

**Why it matters:** Changing any config field requires tracing through 3+ files to understand impact. The pipeline cannot be tested without the full config resolution stack. The color detection logic is inseparable from the encoding decision logic — they are in different files but must change together.

**Suggested improvement:** Introduce a `PipelineConfig` interface (already partially present) and use dependency injection: `processImageFormats` should accept a `ColorPipeline` strategy object, not a flat config bag. Extract the "decision" logic (which pipeline to use) from the "execution" logic (how to encode).

**Confidence:** High

### 2.2 Rate Limiting Tied to Express-Style Headers (MEDIUM)

**File:** `apps/web/src/lib/rate-limit.ts:145-176` — `getClientIp` function
**Concern:** The rate-limiting module assumes a `HeaderLike` interface (`{ get(name: string): string | null }`) that mirrors Next.js `Headers` but is custom-defined. It also directly reads `process.env.TRUST_PROXY` and `process.env.TRUST_PROXY_HOPS`.

**Why it matters:** This coupling to Next.js header semantics and environment variable names makes it difficult to reuse the rate-limiting logic in non-Next.js contexts (e.g., a standalone CLI tool, a future API gateway). The `HeaderLike` abstraction is too thin — it doesn't capture the full request context.

**Suggested improvement:** Pass a `RequestContext` object containing `{ clientIp: string, isAuthenticated: boolean }` into rate-limiting functions, rather than having them parse headers internally. The caller (middleware or route handler) is responsible for IP extraction.

**Confidence:** Medium

### 2.3 Audit Logging Coupled to DB Schema (LOW)

**File:** `apps/web/src/lib/audit.ts:1-51`
**Concern:** `logAuditEvent` directly imports `db` and `auditLog` from `@/db` and inserts synchronously. There's no abstraction for audit sinks (file, external service, queue).

**Why it matters:** In a high-throughput scenario, synchronous DB audit writes add latency to every admin action. The current "fire-and-forget" pattern (`.catch(console.debug)`) is a band-aid, not an architecture. If the DB is slow, audit writes block the event loop.

**Suggested improvement:** Define an `AuditSink` interface with implementations for `DbAuditSink`, `QueueAuditSink`, and `NoOpAuditSink`. The default should be `DbAuditSink`, but operators could configure `QueueAuditSink` for high-volume deployments.

**Confidence:** Medium

---

## 3. Abstraction Level Inconsistencies

### 3.1 Inconsistent Abstraction: Storage Backend (HIGH)

**File:** `apps/web/src/lib/storage/index.ts` and `apps/web/src/lib/storage/local.ts`
**Concern:** The `storage` module defines an abstraction (`StorageBackend` with `save`, `read`, `delete`, `exists`) but ONLY a local filesystem implementation exists. The image processing pipeline (`process-image.ts`) and upload actions (`actions/images.ts`) do NOT use this abstraction — they use direct `fs` calls and hardcoded paths like `public/uploads/avif/`.

**Why it matters:** The abstraction exists but is not used, creating a "dead code" liability. The `storage` module was built for future S3/MinIO support (noted in CLAUDE.md as "not yet integrated"), but the rest of the codebase has ossified around direct filesystem access. Adding a new storage backend would require refactoring ~15 files.

**Suggested improvement:** Either (a) commit to the abstraction and refactor `process-image.ts`, `serve-upload.ts`, and `actions/images.ts` to use `StorageBackend`, or (b) remove the unused abstraction to reduce cognitive load. Given the single-host deployment model, option (b) may be pragmatic, but document the decision.

**Confidence:** High

### 3.2 Inconsistent Error Handling Patterns (MEDIUM)

**Files:** Multiple — `actions/images.ts` returns `{ error: string }` objects; `actions/auth.ts` throws `Error` for auth failures; `lib/data.ts` returns `null` for missing records; `lib/process-image.ts` throws for processing errors.

**Concern:** Four distinct error handling patterns coexist:
1. **Result objects:** `{ success: true, data } | { error: string }` (settings.ts, images.ts bulk operations)
2. **Exceptions:** `throw new Error(...)` (auth.ts, process-image.ts)
3. **Null returns:** `return null` (data.ts getters)
4. **HTTP responses:** `NextResponse.json({ error }, { status })` (API routes)

**Why it matters:** Inconsistent error handling makes it impossible to write generic error boundaries, middleware, or client-side error handlers. A client calling a server action cannot know whether to expect a thrown error, a null result, or an `{ error }` object.

**Suggested improvement:** Standardize on a single `Result<T, E>` type (e.g., `type Result<T> = { ok: true; value: T } | { ok: false; error: string }`) across all server actions and data layer functions. API routes can adapt this to HTTP responses. This is a large refactor but pays dividends in type safety.

**Confidence:** Medium

### 3.3 Inconsistent Caching Strategy (MEDIUM)

**Files:**
- `apps/web/src/lib/data.ts` — React `cache()` on 10 functions
- `apps/web/src/lib/session.ts` — React `cache()` on `verifySessionToken`
- `apps/web/src/lib/gallery-config.ts` — React `cache()` on `getGalleryConfig`
- `apps/web/src/lib/seo.ts` — No caching (assumed, based on `getSeoSettings` being in `data.ts`)

**Concern:** Caching is applied opportunistically rather than systematically. Some expensive queries (e.g., `getImagesLitePage` with GROUP_CONCAT) are cached; others (e.g., analytics data in `analytics-data.ts`) are not. There's no TTL or invalidation strategy beyond `revalidatePath`.

**Why it matters:** Opportunistic caching leads to cache inconsistency bugs. If `getImagesLitePage` is cached but `getTopicsCached` is not, a page may render with stale image data but fresh topic data. The `revalidateAllAppData()` function (`revalidation.ts:55`) revalidates the entire layout — a blunt instrument.

**Suggested improvement:** Define a caching policy matrix (what to cache, for how long, how to invalidate) and implement it consistently. Consider a lightweight in-memory cache with TTL for config/settings, and explicit cache tags for data queries.

**Confidence:** Medium

---

## 4. Missing Abstractions

### 4.1 No Domain Model / Entity Layer (MEDIUM)

**Concern:** The codebase has no domain entities. Database rows are passed directly from Drizzle to React components. There is no `Image` class or interface that encapsulates behavior (e.g., `image.getDisplayUrl()`, `image.isWideGamut()`, `image.getColorPipelineDecision()`).

**Why it matters:** Business logic is scattered across:
- `process-image.ts` (encoding decisions)
- `color-detection.ts` (color signal detection)
- `data.ts` (privacy field filtering)
- `components/color-details-section.tsx` (UI rendering of color metadata)
- `lib/image-url.ts` (URL construction)

An `Image` domain object would centralize this logic and make the codebase more maintainable.

**Suggested improvement:** Introduce lightweight domain objects (plain TypeScript interfaces with helper functions, not classes) in a `domain/` directory. Example:
```typescript
// domain/image.ts
interface Image {
  id: number;
  filename: ImageFilename; // value object
  colorMetadata: ColorMetadata;
  // ...
}

function getDisplayUrl(image: Image, format: 'avif' | 'webp' | 'jpeg', size: number): string;
function isWideGamut(image: Image): boolean;
function getPrivacySafeFields(image: Image, isAdmin: boolean): Partial<Image>;
```

**Confidence:** Medium

### 4.2 No Event Bus / Message Queue for Background Jobs (MEDIUM)

**Concern:** Background processing (image queue, CLIP embeddings, caption generation) uses an in-memory `PQueue` (`lib/image-queue.ts`) with MySQL advisory locks. There is no event bus, no job queue abstraction, and no dead-letter queue.

**Why it matters:** The current design:
- Cannot survive process restarts (in-memory queue is lost)
- Cannot scale horizontally (advisory locks are per-MySQL-server, not per-instance)
- Has no retry backoff strategy beyond fixed `MAX_RETRIES = 3`
- Cannot prioritize jobs (e.g., process new uploads before backfill)

**Suggested improvement:** Abstract the queue behind a `JobQueue` interface with implementations for `InMemoryJobQueue` (current) and `DatabaseJobQueue` (persistent). Long-term, consider BullMQ or a similar Redis-backed queue for production deployments.

**Confidence:** Medium

### 4.3 No API Versioning / Contract Layer (LOW)

**Concern:** Public API routes (`/api/og/*`, `/api/search/*`, `/api/health`) have no versioning and no formal API contract. The service worker (`sw.template.js`) directly fetches these URLs, creating an implicit contract that is not documented.

**Why it matters:** Changing a public API route's response format breaks the service worker and any external clients. There's no way to introduce a v2 API while maintaining v1 compatibility.

**Suggested improvement:** Add a lightweight API versioning convention (e.g., `/api/v1/og/...`) and document the service worker's contract explicitly. The SW cache logic should be versioned alongside the API.

**Confidence:** Low

---

## 5. Technology Choices and Implications

### 5.1 MySQL Advisory Locks as Distributed Coordination (HIGH)

**Files:**
- `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/src/lib/image-queue.ts` (per-image processing locks)
- `apps/web/src/lib/admin-backfill-runner.ts` (backfill lock)
- `apps/web/src/app/[locale]/admin/db-actions.ts` (restore lock)

**Concern:** MySQL advisory locks (`GET_LOCK()`) are used for distributed coordination across 6 different operations. The CLAUDE.md explicitly warns: "MySQL advisory lock names are scoped to the MySQL SERVER, not to an individual database. Two GalleryKit instances pointed at the same MySQL server share the same lock namespace."

**Why it matters:** This is a fundamental architectural constraint. It means:
- One MySQL server = one GalleryKit instance (no multi-tenancy)
- A lock name collision between instances causes cross-tenant serialization
- Advisory locks are released on connection close, so a crashed process may leave a lock held until the connection times out

**Suggested improvement:** Document this constraint prominently in deployment docs. For multi-tenancy, prefix lock names with a per-instance identifier (e.g., `gallerykit_{instance_id}:image-processing:{jobId}`). Consider Redis Redlock for more robust distributed locking if horizontal scaling becomes a requirement.

**Confidence:** High

### 5.2 React `cache()` as Primary Deduplication Mechanism (MEDIUM)

**Files:** `apps/web/src/lib/data.ts` (10 cached functions), `lib/session.ts`, `lib/gallery-config.ts`
**Concern:** React `cache()` is used extensively for request-level deduplication. This is a Next.js-specific API that ties the data layer to the React Server Components runtime.

**Why it matters:** If the application ever needs to run outside Next.js (e.g., a standalone API server, a CLI tool), these `cache()` wrappers become dead weight. The caching is also request-scoped, not process-scoped, so it doesn't help across requests.

**Suggested improvement:** Wrap `cache()` in a generic `memoize` function that can be replaced with a different implementation (e.g., LRU cache) for non-React contexts. Or, use a repository pattern where caching is an opt-in decorator.

**Confidence:** Medium

### 5.3 Sharp as the Sole Image Processing Engine (LOW)

**File:** `apps/web/src/lib/process-image.ts` — entire file depends on `sharp`
**Concern:** The entire image processing pipeline is built around Sharp. The color/HDR pipeline is constrained by Sharp's API limitations (e.g., "Sharp 0.34.5 does not expose CICP signaling in the avif() encoder API", noted in `schema.ts:58-62`).

**Why it matters:** Sharp's roadmap determines GalleryKit's feature ceiling. HDR AVIF delivery (WI-09) is blocked on Sharp's CICP support. If Sharp deprecates features or changes behavior, the pipeline must be rewritten.

**Suggested improvement:** Abstract the encoder behind an `ImageEncoder` interface with `SharpEncoder` and `FutureEncoder` implementations. The `process-image.ts` pipeline should work with the interface, not Sharp directly. This is partially done (the `resolveColorPipelineDecision` function is somewhat abstracted) but not at the encoder level.

**Confidence:** Low

---

## 6. Scalability Bottlenecks

### 6.1 Single-Writer Topology with Process-Local State (HIGH)

**Concern:** The CLAUDE.md explicitly states: "The shipped Docker Compose deployment is a single web-instance / single-writer topology. Restore maintenance flags, upload quota tracking, and image queue state are process-local."

**Specific process-local state:**
- `uploadTracker` (`lib/upload-tracker-state.ts`) — per-IP cumulative upload tracking in a Map
- `backfillRunnerStatus` (`lib/admin-backfill-runner.ts`) — in-memory status object
- `loginRateLimit`, `searchRateLimit`, `ogRateLimit`, `shareRateLimit` (`lib/rate-limit.ts`) — in-memory Maps
- `imageQueue` (`lib/image-queue.ts`) — PQueue instance
- `sharedGroupViewBuffer` (implied by "best-effort approximate analytics")

**Why it matters:** This architecture cannot scale horizontally. Running two web instances behind a load balancer would:
- Split rate-limit budgets (each instance has its own counters)
- Duplicate image processing (no shared queue state)
- Lose view counts (buffer is per-instance)
- Allow concurrent backfill runs (advisory locks help, but status is per-process)

**Suggested improvement:** For horizontal scaling, move shared state to Redis or a similar shared store. The rate-limiting already has a DB fallback (`rate_limit_buckets` table) — extend this to be the primary store. The image queue should use a persistent job store (Redis, database-backed queue). Document the single-instance constraint prominently.

**Confidence:** High

### 6.2 Connection Pool Budgeting Tension (MEDIUM)

**File:** `apps/web/src/db/index.ts:23` — `POOL_CONNECTION_LIMIT = 10`
**Concern:** The connection pool is capped at 10 connections with a queue limit of 20. The backfill runner budgets connections using a complex formula (`max(1, floor((10 - 5 - 1) / 2)) = 2`). Live traffic + backfill + image processing + admin operations all compete for these 10 connections.

**Why it matters:** At high load, the queue limit of 20 means requests will wait up to 5 seconds (connectTimeout) before failing. A burst of concurrent uploads + a backfill run + analytics queries could exhaust the pool. The backfill concurrency cap of 2 is conservative, but there's no admission control for other operations.

**Suggested improvement:** Implement operation-type connection budgeting (e.g., reserve 3 connections for live traffic, 2 for uploads, 2 for admin, 3 for background). Or, increase the pool size and use separate pools for background vs. live traffic. Monitor pool queue depth in production.

**Confidence:** Medium

### 6.3 GROUP_CONCAT for Tag Aggregation (LOW)

**File:** `apps/web/src/lib/data.ts:608` — `tagNamesAgg`
**Concern:** Every masonry-list query uses `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` with a `LEFT JOIN` across `imageTags` and `tags`. For galleries with thousands of tags per image, this could approach the `group_concat_max_len = 65535` limit.

**Why it matters:** While the current limit is generous (65K chars), a gallery with heavy tagging could silently truncate tag lists. The GROUP_CONCAT also forces a filesort and temporary table in MySQL for large result sets.

**Suggested improvement:** For the tag-listing use case, consider a separate query pattern: fetch images in one query, then fetch tags in a second query and join in application code. This is the "N+1 vs. JOIN" tradeoff — for small tag counts, GROUP_CONCAT is fine; for large counts, separate queries scale better.

**Confidence:** Low

---

## 7. Deployment and Operational Risks

### 7.1 Docker Build-Time vs. Runtime Dependency Mismatch (MEDIUM)

**File:** `apps/web/Dockerfile` (not fully read, but inferred from CLAUDE.md warnings)
**Concern:** The CLAUDE.md contains multiple warnings about Docker:
- "never `npm install` inside the running production container"
- "The runtime's `/app/node_modules` is the prod-deps tree from the Dockerfile build"
- "An in-container `npm install --no-save` clobbered `argon2` / `mysql2` / `sharp` once"

**Why it matters:** This indicates a fragile build process where native dependencies (argon2, sharp, mysql2) are sensitive to the build environment. The sidecar pattern for running scripts (backfill, CLIP seeding) is a workaround, not a solution.

**Suggested improvement:** Use a multi-stage Dockerfile that builds native deps in a consistent environment and copies them to the runtime stage. Pin all native dependency versions explicitly. Consider using `npm ci --omit=dev` with a lockfile hash check at startup to detect tampering.

**Confidence:** Medium

### 7.2 Per-Deploy Auto-Prune Risk (LOW)

**File:** `apps/web/deploy.sh` (referenced in CLAUDE.md)
**Concern:** The deploy script auto-prunes Docker artifacts after every deploy. While the CLAUDE.md documents the safety guarantees (bind mounts, no named volume prune, prune-after-up), any future modification to this script could accidentally delete data.

**Why it matters:** Automated pruning is a destructive operation. The safety relies on implicit conventions (bind mounts vs. Docker volumes) rather than explicit guards. A developer adding a new volume type might not realize the prune implications.

**Suggested improvement:** Add explicit pre-prune checks in `deploy.sh`: verify bind mounts are active, verify named volumes are not in the prune path, and require a `--force` flag for any prune that touches named volumes. Log the prune actions for auditability.

**Confidence:** Low

---

## 8. Data Model Design Issues

### 8.1 `images` Table is a Wide Table (MEDIUM)

**File:** `apps/web/src/db/schema.ts:19-117` — `images` table has 40+ columns
**Concern:** The `images` table combines photo metadata (title, description), EXIF data (camera, lens, ISO, GPS), color/HDR audit data (10 columns), processing state (processed, error, failed_at), and administrative data (uploaded_by). This is a classic "wide table" anti-pattern.

**Why it matters:** Wide tables have several issues:
- Every query fetches all columns (or the query planner must project), even when only a few are needed
- Schema changes require table rebuilds (expensive in MySQL for large tables)
- The mental model is unclear — is this a "photo entity" or a "photo + EXIF + processing state" aggregate?

**Suggested improvement:** Normalize into:
- `images` (core: id, filename, width, height, title, description, topic, created_at)
- `image_exif` (EXIF data: image_id FK, camera_model, lens_model, etc.)
- `image_color_audit` (color/HDR: image_id FK, color_pipeline_decision, is_hdr, etc.)
- `image_processing_state` (processing: image_id FK, processed, error, failed_at, pipeline_version)

This is a significant migration but improves query performance and schema clarity.

**Confidence:** Medium

### 8.2 Stringly-Typed Settings (LOW)

**File:** `apps/web/src/db/schema.ts:133-136` — `admin_settings` table
**Concern:** All settings are stored as `key: varchar, value: text` string pairs. Boolean settings (`strip_gps_on_upload`, `allow_hdr_ingest`) are stored as `'true'`/`'false'` strings. Numeric settings (`image_quality_webp`) are stored as strings and parsed at runtime.

**Why it matters:** String storage loses type safety. A typo in a setting value (`'ture'` instead of `'true'`) passes schema validation but fails at runtime. The `isValidSettingValue` function in `gallery-config-shared.ts` catches most errors, but the storage layer itself is untyped.

**Suggested improvement:** Use a JSON column for settings (MySQL 8.0+ supports JSON) or a typed table with separate columns for each setting type. Alternatively, store settings as a JSON blob with a JSON Schema validator.

**Confidence:** Low

---

## 9. API Surface Design

### 9.1 Server Actions as Primary API (MEDIUM)

**Concern:** The application uses Next.js Server Actions (`'use server'`) as the primary API for client-server communication. 14 action files handle CRUD, auth, uploads, settings, and admin operations. There is no separate REST or GraphQL API layer.

**Why it matters:** Server Actions are a Next.js-specific feature with several limitations:
- They cannot be called from non-Next.js clients (mobile apps, third-party integrations)
- They serialize arguments via a custom protocol, which limits the types that can be passed
- They are tightly coupled to the React component tree
- They cannot be versioned independently of the UI

The Lightroom Classic plugin (`/api/admin/lr/upload`) and the PAT system (`adminTokens`) suggest awareness of this limitation, but the core API is still server-actions-first.

**Suggested improvement:** For future extensibility, extract a REST API layer for core operations (images, topics, tags, search). Server actions can delegate to this layer. This enables mobile apps, third-party integrations, and API versioning.

**Confidence:** Medium

### 9.2 API Route Auth Duplication (LOW)

**Files:**
- `apps/web/src/lib/api-auth.ts` — `withAdminAuth` wrapper
- `apps/web/src/app/api/admin/db/download/route.ts` — uses `withAdminAuth`
- `apps/web/src/app/api/admin/lr/upload/route.ts` — uses `withAdminAuth`
- `apps/web/src/app/api/search/semantic/route.ts` — no auth (public)
- `apps/web/src/app/api/search/similar/[id]/route.ts` — no auth (public)

**Concern:** API routes use a different auth pattern (`withAdminAuth`) than server actions (`isAdmin()` + `requireSameOriginAdmin()`). The `api-auth.ts` wrapper is only used for admin API routes; public API routes have their own rate limiting but no auth.

**Why it matters:** Two auth patterns increase the risk of inconsistency. A new developer might add an API route and forget to wrap it with `withAdminAuth`, or might use the wrong auth function.

**Suggested improvement:** Unify auth behind a single `requireAuth({ role: 'admin' | 'public' })` function that works in both server actions and API routes. The lint scripts (`lint:api-auth`) already enforce the wrapper pattern — extend this to cover all auth entry points.

**Confidence:** Low

---

## 10. Future Extensibility Problems

### 10.1 HDR Delivery Pipeline is a Deferred Feature with Schema Debt (HIGH)

**Files:**
- `apps/web/src/db/schema.ts:64-72` — `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map` columns
- `apps/web/src/lib/process-image.ts` — HDR sources are rejected at upload (unless `allow_hdr_ingest=true`)
- CLAUDE.md: "HDR AVIF delivery and rendering intent are deferred" (US-CM12)

**Concern:** The schema has 5 columns dedicated to HDR metadata, but the delivery pipeline does not support HDR. The `is_hdr` field is admin-only (never shown to public). This is "schema debt" — columns that exist for a future feature but add complexity to every query and every migration.

**Why it matters:** Schema debt accumulates. Each new migration must account for these columns. The privacy field guards (`_PrivacySensitiveKeys`) must include them. The backfill runner must persist them. The ETag settings hash must account for them. All this complexity exists for a feature that may never ship.

**Suggested improvement:** Either (a) commit to shipping HDR delivery within the next 2 major releases and create a concrete implementation plan, or (b) remove the HDR columns from the schema and re-add them when the feature is ready. The current "deferred but schema-present" state is the worst of both worlds.

**Confidence:** High

### 10.2 Semantic Search is Gated by Operator Decision (MEDIUM)

**Files:**
- `apps/web/src/lib/gallery-config.ts` — `semanticSearchMode` heals `'production'` to `'disabled'` without env flag
- `apps/web/src/lib/clip-model.ts` — Lazy-singleton ONNX encoder
- `apps/web/src/db/schema.ts:271-286` — `image_embeddings` table

**Concern:** The semantic search feature requires:
1. Model weights downloaded to a bind-mounted directory
2. A `--production` backfill run
3. `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` env var
4. DB row `admin_settings.semantic_search_mode='production'`

This is a 4-step activation process with no UI guidance. The feature is essentially "dark" — present in code and schema but inaccessible without operator knowledge.

**Why it matters:** Dark features add maintenance burden (tests, schema, dependencies) without delivering value. The `@huggingface/transformers` dependency and `onnxruntime-node` native binding are included in every build for a feature most users won't activate.

**Suggested improvement:** Either fully productize semantic search (add a guided setup UI, auto-download weights, one-click activation) or extract it to a plugin/add-on that can be installed separately. The current "operator-only, 4-step activation" is not a product feature, it's a developer experiment.

**Confidence:** Medium

### 10.3 Smart Collections AST is Not Extensible (LOW)

**File:** `apps/web/src/lib/smart-collections.ts`
**Concern:** The smart collections query compiler uses a hand-rolled AST with discriminated union types (`ScalarPredicate`, `ContainsPredicate`, `BetweenPredicate`, `InPredicate`, `TagPredicate`). Adding a new predicate type requires:
1. Adding to the union type
2. Adding to the `compileSmartCollection` function
3. Adding to the `parseSmartCollectionQuery` validator
4. Adding UI support in the admin client

**Why it matters:** The AST is not self-describing. There's no schema for the query language, no introspection, and no way for the UI to dynamically generate predicate builders. Each new predicate type is a code change across 4+ files.

**Suggested improvement:** Define a JSON Schema for the smart collection query language. Use a visitor pattern for compilation. Consider using a lightweight query builder library (e.g., `json-logic-js` for the frontend, with a custom compiler for the backend) to make the query language extensible.

**Confidence:** Low

---

## Final Sweep: Additional Architectural Risks

### FS-1: Service Worker Cache Invalidation Gap
**File:** `apps/web/src/lib/serve-upload.ts` and `next.config.ts` headers
**Concern:** The static file serving path (Next.js static server) uses `W/"{size-hex}-{mtime-hex}"` ETag, while the route handler path uses `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"`. Changing a color/quality admin setting does NOT invalidate static derivatives until a backfill re-encodes them. The CLAUDE.md documents this as "operational gotcha (CRT-D1)" but it's an architectural inconsistency.
**Confidence:** Medium

### FS-2: i18n Key Parity is a Manual Process
**File:** `apps/web/messages/en.json` and `apps/web/messages/ko.json`
**Concern:** The i18n system requires exact key parity between language files. There is no automated check (beyond the test suite) that new keys added to `en.json` are also added to `ko.json`. The plural convention asymmetry (English uses ICU plural, Korean uses fixed form) is documented but not enforced.
**Confidence:** Low

### FS-3: Test File Location Mirrors Source (Good), but Test Count is High
**Concern:** 183+ test files with 1700+ tests is a large test surface. The test files are co-located with source (`src/__tests__/`) rather than in a separate `tests/` directory. This is fine for unit tests but may become unwieldy as the codebase grows. The e2e tests take 25-30 minutes, which is a significant CI bottleneck.
**Confidence:** Low

### FS-4: No Structured Logging
**Concern:** The codebase uses `console.error`, `console.warn`, `console.debug` for logging. There is no structured logging framework (e.g., Pino, Winston) and no log aggregation format (JSON). In production, parsing these logs for monitoring or alerting is difficult.
**Confidence:** Medium

### FS-5: Migration Reconcile Pattern is a Workaround
**File:** `apps/web/scripts/migrate.js`
**Concern:** The custom migration script (`migrate.js`) exists because Drizzle's migrator has a non-monotonic timestamp bug. The script adds 200+ lines of workaround code (reconcile, baseline, hash verification) that must be maintained alongside Drizzle updates. This is technical debt from an upstream bug.
**Confidence:** Medium

---

## Summary Table

| # | Finding | Category | Severity | File(s) | Confidence |
|---|---------|----------|----------|---------|------------|
| 1 | Data Access Layer bleeds into presentation | Layering | HIGH | `lib/data.ts` | High |
| 2 | Server actions import directly from DB schema | Layering | MEDIUM | `app/actions/*.ts` (11/14) | Medium |
| 3 | Components import from server-only actions | Layering | LOW | `components/*.tsx` | Medium |
| 4 | Image/color/config tight coupling | Coupling | HIGH | `process-image.ts`, `color-detection.ts`, `image-queue.ts` | High |
| 5 | Rate limiting tied to Express-style headers | Coupling | MEDIUM | `lib/rate-limit.ts` | Medium |
| 6 | Audit logging coupled to DB schema | Coupling | LOW | `lib/audit.ts` | Medium |
| 7 | Storage abstraction unused | Abstraction | HIGH | `lib/storage/*.ts` | High |
| 8 | Inconsistent error handling patterns | Abstraction | MEDIUM | Multiple | Medium |
| 9 | Inconsistent caching strategy | Abstraction | MEDIUM | `lib/data.ts`, `lib/session.ts` | Medium |
| 10 | No domain model / entity layer | Missing | MEDIUM | Entire codebase | Medium |
| 11 | No event bus for background jobs | Missing | MEDIUM | `lib/image-queue.ts` | Medium |
| 12 | No API versioning | Missing | LOW | `app/api/**/*.ts` | Low |
| 13 | MySQL advisory locks as distributed coord | Technology | HIGH | Multiple lock files | High |
| 14 | React `cache()` as primary dedup | Technology | MEDIUM | `lib/data.ts` | Medium |
| 15 | Sharp as sole image engine | Technology | LOW | `lib/process-image.ts` | Low |
| 16 | Single-writer topology with process-local state | Scalability | HIGH | Multiple | High |
| 17 | Connection pool budgeting tension | Scalability | MEDIUM | `db/index.ts` | Medium |
| 18 | GROUP_CONCAT for tag aggregation | Scalability | LOW | `lib/data.ts` | Low |
| 19 | Docker build-time/runtime mismatch | Deployment | MEDIUM | `Dockerfile` | Medium |
| 20 | Per-deploy auto-prune risk | Deployment | LOW | `deploy.sh` | Low |
| 21 | `images` table is wide | Data Model | MEDIUM | `db/schema.ts` | Medium |
| 22 | Stringly-typed settings | Data Model | LOW | `db/schema.ts` | Low |
| 23 | Server actions as primary API | API Design | MEDIUM | `app/actions/*.ts` | Medium |
| 24 | API route auth duplication | API Design | LOW | `lib/api-auth.ts` | Low |
| 25 | HDR delivery is deferred with schema debt | Extensibility | HIGH | `db/schema.ts`, `process-image.ts` | High |
| 26 | Semantic search is dark feature | Extensibility | MEDIUM | `lib/clip-model.ts`, `db/schema.ts` | Medium |
| 27 | Smart collections AST not extensible | Extensibility | LOW | `lib/smart-collections.ts` | Low |
| FS-1 | SW cache invalidation gap | Risk | MEDIUM | `serve-upload.ts`, `next.config.ts` | Medium |
| FS-2 | i18n key parity manual | Risk | LOW | `messages/*.json` | Low |
| FS-3 | Large test surface, slow e2e | Risk | LOW | `src/__tests__/` | Low |
| FS-4 | No structured logging | Risk | MEDIUM | Entire codebase | Medium |
| FS-5 | Migration reconcile workaround | Risk | MEDIUM | `scripts/migrate.js` | Medium |

---

## Recommendations (Prioritized)

### Immediate (Next 1-2 Releases)
1. **Document the single-instance constraint prominently** — Add to README, deployment docs, and code comments. This is the most impactful operational fix.
2. **Add structured logging** — Replace `console.*` with a lightweight logger (Pino) that outputs JSON in production. This unblocks monitoring and alerting.
3. **Unify error handling** — Pick one pattern (Result objects recommended) and apply it to all new code. Refactor existing code opportunistically.

### Short-term (Next 3-6 Months)
4. **Refactor `lib/data.ts` into DAL + Service + Adapter layers** — This is the highest-impact structural improvement. Start by extracting pure queries into `db/queries/`.
5. **Decide on HDR delivery** — Either commit to implementation (with a concrete plan) or remove the schema columns. The current deferred state is expensive.
6. **Productize or remove semantic search** — The 4-step activation is not a product. Either add a guided setup UI or extract to a plugin.
7. **Normalize the `images` table** — Split into `images` + `image_exif` + `image_color_audit` + `image_processing_state`. This improves query performance and schema clarity.

### Long-term (6+ Months)
8. **Extract a REST API layer** — Enable mobile apps, third-party integrations, and API versioning. Server actions can delegate to this layer.
9. **Abstract the image encoder** — Introduce an `ImageEncoder` interface to reduce Sharp lock-in and enable future HDR encoders.
10. **Add a domain model layer** — Lightweight TypeScript interfaces with helper functions to centralize business logic.
11. **Implement a persistent job queue** — For horizontal scaling, replace in-memory PQueue with a Redis-backed queue (BullMQ or similar).

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
| Use React `cache()` | Request-level dedup, simple | Next.js-specific, no cross-request caching |
| Add generic memoization | Portable, can add TTL | More code, must manage cache invalidation |
| Single-instance deployment | Simple, no distributed state | Cannot scale horizontally, single point of failure |
| Multi-instance + Redis | Scalable, resilient | Adds Redis dependency, more complex deployment, more ops burden |

---

## Conclusion

GalleryKit is a well-crafted application with strong security, privacy, and color-science foundations. The 15 architectural findings are mostly about long-term maintainability and scalability, not immediate bugs or security risks. The most impactful improvements are:
1. **Layer separation** (DAL/Service/Adapter)
2. **Deciding on deferred features** (HDR, semantic search)
3. **Documenting operational constraints** (single-instance, advisory lock scope)

The codebase shows evidence of thoughtful engineering (compile-time guards, advisory locks, rate-limiting patterns, color pipeline decisions) and would benefit from a structural refactoring to match the maturity of its individual components.

---

*Review generated by Architect Agent. All file references are absolute paths within `/Users/hletrd/flash-shared/gallery/`.*
