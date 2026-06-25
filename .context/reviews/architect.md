# GalleryKit Architectural Review
## HEAD: bcd67b12 | Date: 2026-06-25

---

## Summary

GalleryKit exhibits a mature, security-conscious architecture with strong defensive patterns: compile-time privacy guards, MySQL advisory locks for concurrency control, layered rate limiting, and a sophisticated color/HDR image pipeline. However, the codebase carries significant architectural debt from its iterative development through 10 review-plan-fix cycles. Key concerns include: (1) **single-instance topology constraints** that make horizontal scaling impossible without substantial rework; (2) **tight coupling between the image processing pipeline and database layer** that complicates testing and alternative storage backends; (3) **process-local state proliferation** (rate limit Maps, view count buffers, backfill runner state, queue state) that is correct for the current single-writer design but represents a fundamental scalability ceiling; (4) **storage abstraction incompleteness** — the `storage/` module exists but is not wired into the live pipeline; and (5) **schema complexity** in the `images` table (40+ columns) that conflates metadata, EXIF, color audit, and processing state. The architecture is appropriate for its intended use case (personal/photographer self-hosted gallery) but would require significant refactoring to support multi-instance deployments, alternative storage backends, or gallery sizes beyond tens of thousands of images.

---

## Analysis

### 1. Layering & Coupling

#### 1.1 Image Processing Pipeline — Tight Coupling to Sharp and Filesystem

The image processing pipeline in `lib/process-image.ts` (1633 lines) is the most complex module in the codebase. It couples:
- Sharp (libvips) for image encoding/decoding
- Direct filesystem operations (`fs/promises`, `createReadStream`)
- Color detection (NCLX/ICC parsing)
- GPS stripping (format-specific byte-level manipulation)
- Blur placeholder generation
- Post-encode verification (AVIF NCLX box scan, WebP ICCP chunk scan)

**Problem:** This module cannot be tested without the full Sharp + libvips + filesystem stack. There is no abstraction boundary between "image processing decisions" and "image processing execution." The `storage/` module (`lib/storage/index.ts:1-147`) exists as a singleton abstraction but the comment at line 7 explicitly states: "This storage backend is not yet wired into the live image pipeline. Direct fs operations are still used for uploads, processing, and public serving."

**File:line references:**
- `lib/process-image.ts:1-1633` — monolithic image processing module
- `lib/storage/index.ts:7-12` — unwired storage abstraction
- `lib/upload-paths.ts:1-103` — direct path construction and filesystem access

**Concrete failure scenario:** An operator wanting to use S3/MinIO for derivative storage would need to modify `process-image.ts` directly (where derivatives are written via `fs/promises` and `createWriteStream`) rather than implementing a storage backend interface. The atomic rename pattern (`.tmp` → final) at `process-image.ts:~600` assumes POSIX filesystem semantics.

#### 1.2 Data Access Layer — Mixed Responsibilities

`lib/data.ts` (600+ lines) combines:
- Data access (Drizzle ORM queries)
- React `cache()` deduplication
- View count buffering (in-memory Map with flush timer)
- Search logic (tag/alias fallback, GROUP BY derivation)
- Prev/next navigation logic with NULL capture_date handling

**Problem:** The view count buffering (`lib/data.ts:17-193`) is a cross-cutting concern that has nothing to do with data access. It uses module-level `let` variables (`viewCountBuffer`, `viewCountFlushTimer`, `consecutiveFlushFailures`) that are process-local and invisible to other instances. This is correct for the single-instance topology but represents a layering violation — the data layer should not own buffering/aggregation logic.

**File:line references:**
- `lib/data.ts:17-193` — view count buffering embedded in data layer
- `lib/data.ts:209-281` — adminSelectFields definition (40+ fields)
- `lib/data.ts:283-396` — publicSelectFields/publicMapSelectFields derivation via destructuring

#### 1.3 Database Schema — Table Bloat and Conflation

The `images` table has 40+ columns conflating:
- Core metadata (filename_*, width, height, title, description)
- EXIF data (camera_model, lens_model, iso, f_number, etc.)
- Color/HDR audit columns (color_primaries, transfer_function, is_hdr, has_gain_map, avif_10bit, pipeline_version)
- Processing state (processed, processing_error, failed_at)
- Privacy-sensitive data (latitude, longitude, filename_original, user_filename)

**Problem:** This violates the principle that tables should represent a single entity. The color/HDR columns (8 columns) are essentially a sidecar audit log that happens to live in the same table. The schema comment at `db/schema.ts:54-62` acknowledges this: "The schema columns below provide the foundation for future HDR delivery when the upstream API or an alternative encoder binding becomes viable."

**File:line references:**
- `db/schema.ts:19-117` — images table definition with 40+ columns
- `db/schema.ts:54-62` — comment acknowledging deferred HDR delivery

#### 1.4 Configuration Resolution — Circular Dependency Risk

`lib/gallery-config.ts` imports from `db/index.ts` (for `db` and `adminSettings`), and `db/index.ts` exports `POOL_CONNECTION_LIMIT` which is consumed by `lib/admin-backfill-runner.ts` for concurrency budgeting. This is not a circular dependency in practice but demonstrates tight coupling between configuration and database layers.

**File:line references:**
- `lib/gallery-config.ts:12-13` — imports db and adminSettings
- `db/index.ts:23` — exports POOL_CONNECTION_LIMIT
- `lib/admin-backfill-runner.ts:59` — imports POOL_CONNECTION_LIMIT

---

### 2. Scalability & Process-Local State

#### 2.1 Single-Instance Topology — Documented but Hardcoded

The CLAUDE.md explicitly documents: "The shipped Docker Compose deployment is a single web-instance / single-writer topology. Restore maintenance flags, upload quota tracking, and image queue state are process-local; do not horizontally scale the web service unless those coordination states are moved to a shared store."

This is an honest architectural constraint, but the process-local state is pervasive:

| State | Location | Shared Store Needed for Scale-Out |
|-------|----------|-----------------------------------|
| Image processing queue | `lib/image-queue.ts:76-196` (globalThis Symbol) | Redis / RabbitMQ |
| Rate limit fast-path Maps | `lib/rate-limit.ts:101-107`, `lib/auth-rate-limit.ts:19-100` | Redis |
| View count buffer | `lib/data.ts:17-33` | Redis / DB direct write |
| Backfill runner status | `lib/admin-backfill-runner.ts:144-251` (globalThis Symbol) | DB row |
| Upload tracker | `lib/upload-tracker-state.ts` (globalThis Symbol) | Redis |
| Restore maintenance flag | `lib/restore-maintenance.ts:1-57` (globalThis Symbol) | DB row |
| Session secret cache | `lib/session.ts:13-14` (module-level let) | Env var only |
| Serving settings hash cache | `lib/serve-upload.ts:47-48` (module-level let) | Shared cache |

**File:line references:**
- `lib/image-queue.ts:76-196` — globalThis-backed queue state
- `lib/admin-backfill-runner.ts:144-251` — globalThis-backed backfill state
- `lib/restore-maintenance.ts:1-57` — globalThis-backed maintenance flag
- `lib/data.ts:17-33` — module-level view count buffer

#### 2.2 Rate Limiting — Dual-Layer with Inconsistency Risk

The rate limiting uses an in-memory fast path (BoundedMap) with a DB backup. The DB is the "source of truth across restarts" but the in-memory Maps are the fast path. This is a well-documented pattern, but there are subtle inconsistencies:

- `loginRateLimit` (IP-scoped) and `accountLoginRateLimit` (account-scoped) are separate Maps with separate eviction policies
- The DB `rateLimitBuckets` table uses a composite primary key `(ip, bucketType, bucketStart)` but the in-memory Maps use different key formats
- `decrementRateLimit` wraps UPDATE + DELETE in a transaction, but the in-memory Map is decremented separately — a crash between the two leaves them inconsistent until the in-memory entry expires

**File:line references:**
- `lib/rate-limit.ts:101-107` — in-memory rate limit Maps
- `lib/rate-limit.ts:410-440` — decrementRateLimit with transaction
- `lib/auth-rate-limit.ts:19-100` — account-scoped and password-change Maps

#### 2.3 Connection Pool Budgeting — Backfill Concurrency Cap

The backfill runner's concurrency cap (`resolveBackfillConcurrency` at `lib/admin-backfill-runner.ts:129-142`) is a pragmatic solution to the shared pool problem, but it demonstrates the architectural tension: background maintenance ops compete with live request traffic for the same 10-connection pool.

**File:line references:**
- `lib/admin-backfill-runner.ts:105-142` — BACKFILL_RESERVED_LIVE_CONNECTIONS and resolveBackfillConcurrency
- `db/index.ts:31-32` — connectionLimit=10, queueLimit=20

---

### 3. Dependency Management

#### 3.1 Sharp/libvips — Native Dependency Complexity

Sharp is a critical dependency with native bindings. The codebase includes:
- Dynamic concurrency tuning based on CPU count (`process-image.ts:36-50`)
- 10-bit AVIF probe with Promise singleton (`process-image.ts:69-123`)
- Cache disabled for steady RSS (`process-image.ts:53`)

**Problem:** Sharp version upgrades can break the color pipeline. The 10-bit AVIF probe (`_probeHighBitdepthAvif`) exists because "Sharp's prebuilt binaries bundle libheif which may or may not support 10/12-bit AVIF encoding" (`process-image.ts:56-58`). This is a fragile dependency on Sharp's internal libheif configuration.

**File:line references:**
- `lib/process-image.ts:36-53` — Sharp concurrency and cache configuration
- `lib/process-image.ts:56-123` — 10-bit AVIF probe with retry logic

#### 3.2 MySQL2 — Connection Pool Wrapper Complexity

The `db/index.ts` module wraps `mysql2/promise` with custom `getConnection`, `query`, and `execute` overrides to handle:
- `SET group_concat_max_len = 65535` on every connection (`db/index.ts:60-68`)
- 10-second timeout on init query (`db/index.ts:88-102`)
- Symbol-based init promise tracking (`db/index.ts:58`)

**Problem:** This wrapper is complex and error-prone. The comment at `db/index.ts:41-50` references a specific mysql2 bug ("the 'try con.promise().query()' runtime guard fires when chaining .catch"). The wrapper overrides `poolConnection.getConnection`, `poolConnection.query`, and `poolConnection.execute` — any change to mysql2's API could break these overrides.

**File:line references:**
- `db/index.ts:40-125` — mysql2 pool wrapper with init query and timeout

#### 3.3 Drizzle ORM — Schema/Runtime Mismatch

The `imageEmbeddings` table uses `text("embedding")` in the Drizzle schema but the actual column is `MEDIUMBLOB` (`db/schema.ts:271-276`). The comment explains: "The Drizzle column is typed as `text` for schema diffing; the actual SQL migration creates it as MEDIUMBLOB." This is a documented workaround but represents a schema/runtime mismatch that could confuse tooling.

**File:line references:**
- `db/schema.ts:271-276` — imageEmbeddings with text/MEDIUMBLOB mismatch

---

### 4. Structural Integrity

#### 4.1 Compile-Time Privacy Guards — Strong but Fragile

The privacy guards (`_PrivacySensitiveKeys`, `_SensitiveKeysInPublic`) are a strong compile-time defense. However:
- They rely on TypeScript's structural typing — a runtime JavaScript consumer would bypass them entirely
- The `_omit*` destructuring pattern in `data.ts` (lines 290-396) is verbose and error-prone — adding a new sensitive field requires adding it to `_PrivacySensitiveKeys`, omitting it in three destructuring blocks, and adding it to the test fixture

**File:line references:**
- `lib/data.ts:398-450` — _PrivacySensitiveKeys type and _SensitiveKeysInPublic guard
- `lib/data.ts:290-396` — three destructuring blocks for field omission

#### 4.2 Smart Collections — AST Compiler Pattern

`lib/smart-collections.ts` implements a discriminated-union AST with a safe SQL compiler. This is a well-designed pattern:
- Column allowlist prevents injection (`ALLOWED_COLUMNS` at line 32)
- Depth limit prevents stack exhaustion (`MAX_DEPTH = 4` at line 141)
- Drizzle parameter binding for all values (no raw string concatenation)

However, the `compileTagPredicate` function (`lib/smart-collections.ts:248-271`) uses raw `sql` template literals for subqueries, which bypasses Drizzle's type safety. The `contains` operator uses `LIKE` with manual escaping (`replace(/[%_\\]/g, '\\$&')`) — while correct, it is a potential injection point if the escaping logic ever drifts.

**File:line references:**
- `lib/smart-collections.ts:156-186` — compileSmartCollection with allowlist and depth limit
- `lib/smart-collections.ts:248-271` — compileTagPredicate with raw sql template

#### 4.3 Service Worker — Template/Generated File Drift Risk

The service worker uses a template (`public/sw.template.js`) that is stamped into `public/sw.js` by `scripts/build-sw.ts`. The CLAUDE.md warns: "After editing the template, regenerate and commit sw.js." This is a manual step that can be forgotten. The LRU logic is duplicated between `lib/sw-cache.ts` (reference) and the template (shipped).

**File:line references:**
- `public/sw.template.js` — template source
- `public/sw.js` — generated file (must be regenerated manually)
- `lib/sw-cache.ts` — reference LRU implementation

#### 4.4 Advisory Locks — Server-Scoped, Not Database-Scoped

The advisory lock names are scoped to the MySQL server, not the database. The comment at `lib/advisory-locks.ts:8-15` explicitly warns: "Two GalleryKit instances pointed at the same MySQL server share the same lock namespace and will serialize each other's restores, upload-contract changes, topic renames, admin-user deletes, backfill runs, and image-processing claims across tenants."

This is a documented constraint but represents a multi-tenancy limitation that could surprise operators.

**File:line references:**
- `lib/advisory-locks.ts:8-15` — advisory lock scope warning
- `lib/advisory-locks.ts:18-44` — lock name registry

---

### 5. Testing & Observability

#### 5.1 Test-Only Exports

Multiple modules export test-only helpers prefixed with `_`:
- `lib/admin-backfill-runner.ts:261-282` — `_resetAdminBackfillStateForTesting`
- `lib/serve-upload.ts:86-89` — `_resetServingSettingsHashCacheForTesting`
- `lib/rate-limit.ts:209-211` — `resetSearchRateLimitPruneStateForTests`
- `lib/rate-limit.ts:255-257` — `resetOgRateLimitForTests`
- `lib/rate-limit.ts:319-321` — `resetSemanticRateLimitForTests`

These are necessary for test isolation but represent leakage of test concerns into production code. The `process.env.NODE_ENV !== 'test'` guard in `_resetAdminBackfillStateForTesting` is a runtime check that should be unnecessary if tests properly mock the module.

**File:line references:**
- `lib/admin-backfill-runner.ts:261-282` — test-only state reset with env guard

#### 5.2 Error Handling — Inconsistent Patterns

The codebase uses multiple error handling patterns:
- `try/catch` with `instanceof Error` checks
- `hasMySQLErrorCode` helper (`lib/validation.ts:153-160`)
- Discriminated result types (`ReprocessResult` in `lib/admin-backfill-runner.ts:417-419`)
- Fire-and-forget with `.catch(() => undefined)` (queue shutdown, backfill lock release)

The `isMySQLError` type guard (`lib/validation.ts:153-155`) is a runtime check that could be replaced by a more robust error taxonomy.

**File:line references:**
- `lib/validation.ts:153-160` — MySQL error type guards
- `lib/admin-backfill-runner.ts:417-419` — discriminated result type

---

## Root Cause

The architectural tension in GalleryKit stems from a fundamental mismatch between the codebase's evolved complexity and its original single-instance, single-photographer design intent. After 10 review-plan-fix cycles, the codebase has accumulated:

1. **Defensive depth without abstraction boundaries** — every cycle added guards, checks, and locks, but rarely introduced new abstraction layers. The result is a codebase that is secure and correct but tightly coupled.

2. **Process-local state as a design shortcut** — Using `globalThis` Symbols and module-level `let` variables was faster than introducing Redis or a shared state service, but it hardcodes the single-instance assumption throughout the codebase.

3. **Schema evolution without normalization** — The `images` table grew from a simple metadata store to a 40+ column behemoth because adding columns was faster than creating sidecar tables. The color/HDR columns are essentially a separate concern that happens to share the same table.

4. **Storage abstraction as an uncompleted migration** — The `storage/` module was introduced but never wired into the live pipeline, leaving direct filesystem operations throughout the codebase.

---

## Recommendations

### High Priority

1. **Extract view count buffering from data layer** — Move the view count buffer/flush logic to a dedicated module (`lib/view-count-buffer.ts`) that exposes a clean interface. This separates the buffering concern from data access and makes it easier to replace with a shared store later.
   - **Effort:** Medium | **Impact:** Improves testability and separation of concerns
   - **File:** `lib/data.ts:17-193`

2. **Normalize images table into metadata + color_audit sidecar** — Create a `color_audit` table with `(image_id, color_primaries, transfer_function, matrix_coefficients, is_hdr, has_gain_map, pipeline_version, was_downscaled, avif_10bit)` and migrate the columns. This reduces the images table to core metadata and improves query performance for listings that don't need color data.
   - **Effort:** High | **Impact:** Reduces table bloat, improves query performance, cleaner schema
   - **File:** `db/schema.ts:19-117`

3. **Complete the storage abstraction migration** — Wire `lib/storage/` into the upload, processing, and serving paths. Replace direct `fs/promises` calls in `process-image.ts`, `upload-paths.ts`, and `serve-upload.ts` with storage backend calls. This is prerequisite to supporting S3/MinIO.
   - **Effort:** High | **Impact:** Enables alternative storage backends, improves testability
   - **Files:** `lib/process-image.ts`, `lib/upload-paths.ts`, `lib/serve-upload.ts`, `lib/storage/index.ts`

### Medium Priority

4. **Introduce a shared state abstraction for process-local Maps** — Create a `lib/state/` module with pluggable backends (in-memory for single-instance, Redis for multi-instance). Migrate `viewCountBuffer`, `loginRateLimit`, `accountLoginRateLimit`, `uploadTracker`, and `backfillState` to this abstraction.
   - **Effort:** High | **Impact:** Enables horizontal scaling without rewriting each consumer
   - **Files:** `lib/data.ts`, `lib/rate-limit.ts`, `lib/auth-rate-limit.ts`, `lib/upload-tracker-state.ts`, `lib/admin-backfill-runner.ts`

5. **Refactor process-image.ts into pipeline stages** — Split the 1633-line module into: (a) `lib/pipeline/decision.ts` (color pipeline decisions), (b) `lib/pipeline/encode.ts` (Sharp encoding), (c) `lib/pipeline/verify.ts` (post-encode verification), (d) `lib/pipeline/gps-strip.ts` (GPS stripping). This improves testability and allows swapping individual stages.
   - **Effort:** High | **Impact:** Improves testability, enables alternative encoders
   - **File:** `lib/process-image.ts`

6. **Remove test-only exports from production modules** — Use dependency injection or module mocking in tests instead of `_reset*ForTesting` exports. The `globalThis` state pattern is already mockable by manipulating the Symbol-keyed property directly in tests.
   - **Effort:** Low | **Impact:** Reduces production code surface, cleaner module boundaries
   - **Files:** `lib/admin-backfill-runner.ts`, `lib/serve-upload.ts`, `lib/rate-limit.ts`

### Low Priority

7. **Automate sw.js regeneration** — Add a pre-commit hook or build step that regenerates `public/sw.js` from `public/sw.template.js` when the template changes. This prevents template/generated file drift.
   - **Effort:** Low | **Impact:** Prevents service worker drift
   - **Files:** `public/sw.template.js`, `public/sw.js`, `scripts/build-sw.ts`

8. **Add a schema drift check to CI** — Verify that `db/schema.ts` and `drizzle/` migrations are in sync. The non-monotonic `when` timestamps in `_journal.json` caused a production incident; a CI check could prevent this.
   - **Effort:** Low | **Impact:** Prevents migration skip incidents
   - **Files:** `drizzle/meta/_journal.json`, `scripts/migrate.js`

9. **Document the multi-tenancy advisory lock limitation** — Add a "Multi-tenancy" section to the operational docs explaining that multiple GalleryKit instances on the same MySQL server will share advisory locks.
   - **Effort:** Low | **Impact:** Prevents operator surprise
   - **File:** `CLAUDE.md` (Operational Playbook section)

---

## Trade-offs

| Option | Pros | Cons |
|--------|------|------|
| **Keep process-local state** | Simple, no infrastructure dependencies, correct for single-instance | Hardcodes single-instance topology, no horizontal scaling |
| **Introduce Redis for shared state** | Enables horizontal scaling, industry standard | Adds infrastructure dependency, complexity, latency |
| **Normalize images table** | Cleaner schema, better query performance, separation of concerns | Migration complexity, risk of query drift, needs backfill |
| **Keep monolithic process-image.ts** | All image logic in one place, easier to trace | 1600+ lines, untestable without full stack, hard to swap stages |
| **Split into pipeline stages** | Testable, swappable stages, cleaner architecture | Refactoring risk, needs careful verification of color pipeline correctness |
| **Complete storage abstraction** | Enables S3/MinIO, testable with mock backends | Significant refactoring, atomic rename semantics differ across backends |
| **Keep current privacy guards** | Compile-time enforcement, strong TypeScript safety | Verbose, error-prone to maintain, no runtime enforcement for JS consumers |

---

## Consensus Addendum

- **Antithesis (steelman):** The architecture is appropriate for its intended use case. A personal photographer's gallery with a single admin does not need horizontal scaling, Redis, or storage abstraction. The process-local state is a feature, not a bug — it eliminates infrastructure dependencies and keeps the deployment simple. The tight coupling in `process-image.ts` is acceptable because the color pipeline is a domain-specific, carefully tuned system that should not be abstracted prematurely.

- **Tradeoff tension:** The codebase's defensive depth (compile-time guards, advisory locks, rate limiting, privacy checks) adds significant complexity. For a single-instance deployment, this complexity is "insurance" against bugs and security issues. For a multi-instance deployment, the same complexity becomes "debt" that must be paid to extract shared state. The tension is: when does insurance become debt? The current answer is "when you want to scale horizontally," which is a deliberate product decision.

- **Synthesis (if viable):** Preserve the single-instance simplicity for the default deployment path, but introduce abstraction boundaries (storage interface, state interface) that make the shared-store migration a configuration change rather than a rewrite. The `storage/` module is already a step in this direction — it just needs to be completed.

---

## References

- `apps/web/src/lib/process-image.ts:1-1633` — Monolithic image processing with Sharp, filesystem, color detection, GPS stripping, and verification
- `apps/web/src/lib/storage/index.ts:7-12` — Unwired storage abstraction with explicit "not yet wired" comment
- `apps/web/src/lib/data.ts:17-193` — View count buffering embedded in data layer with module-level state
- `apps/web/src/lib/data.ts:209-396` — Privacy field selection with three destructuring omission blocks
- `apps/web/src/db/schema.ts:19-117` — images table with 40+ columns conflating metadata, EXIF, color audit, and processing state
- `apps/web/src/db/index.ts:40-125` — mysql2 pool wrapper with custom getConnection, query, and execute overrides
- `apps/web/src/lib/image-queue.ts:76-196` — globalThis-backed processing queue state
- `apps/web/src/lib/admin-backfill-runner.ts:144-251` — globalThis-backed backfill runner state
- `apps/web/src/lib/rate-limit.ts:101-107` — In-memory rate limit Maps with DB backup
- `apps/web/src/lib/advisory-locks.ts:8-15` — Advisory lock scope warning (server-scoped, not database-scoped)
- `apps/web/src/lib/smart-collections.ts:156-271` — AST compiler with allowlist and raw sql subqueries
- `apps/web/src/lib/session.ts:13-14` — Module-level session secret cache
- `apps/web/src/lib/serve-upload.ts:47-48` — Module-level serving settings hash cache
- `apps/web/src/lib/gallery-config.ts:12-13` — Configuration layer importing database layer
- `apps/web/src/lib/upload-paths.ts:1-103` — Direct filesystem path construction
- `apps/web/src/proxy.ts:76-141` — Middleware with CSP nonce generation and admin route protection
- `apps/web/src/lib/content-security-policy.ts:63-118` — CSP builder with GA4 source allowlist
- `apps/web/src/lib/validation.ts:153-160` — MySQL error type guards
- `apps/web/src/lib/bounded-map.ts:32-151` — Generic bounded Map with FIFO eviction
- `apps/web/src/public/sw.template.js` — Service worker template requiring manual regeneration
- `apps/web/src/public/sw.js` — Generated service worker (must be kept in sync with template)
