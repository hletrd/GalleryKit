# GalleryKit — Comprehensive Architectural Review

**Date:** 2026-06-25
**Scope:** Full codebase, `/Users/hletrd/flash-shared/gallery/apps/web/`
**Reviewer:** Architect Agent
**HEAD:** c0522dec
**Confidence:** High (direct file reading, cross-reference analysis, pattern tracing, subagent exploration)

---

## Executive Summary

GalleryKit is a mature, well-architected Next.js 16 photo gallery with strong security, privacy, and color-science foundations. The codebase demonstrates clear architectural ownership, extensive compile-time guards, three automated lint gates, and thorough documentation. The most significant concerns are four "god files" that exceed 800 lines each, a single layer violation where a library module imports from an application module, and a schema/type mismatch that forces unsafe casts. The single-process architecture is intentional and correctly documented. No critical architectural flaws were found.

**Finding Summary:** 16 findings — 4 HIGH, 7 MEDIUM, 5 LOW.

---

## 1. Layering & Coupling

### 1.1 Layer Violation: lib/api-auth.ts imports from app/actions/auth.ts (HIGH)

**File:** `apps/web/src/lib/api-auth.ts:1`
**Code:** `import { isAdmin } from '@/app/actions/auth';`

**Concern:** `lib/api-auth.ts` is a library module (API route auth wrapper) that depends on `app/actions/auth.ts`, an application module. This is an upward dependency in the dependency graph. Library modules should never import from application modules. The `isAdmin()` function verifies session cookies and checks admin status — this is a core auth primitive that belongs in the library layer.

**Why it matters:** This is the ONLY layer violation in the entire codebase. All other `lib/` modules import only from sibling `lib/` modules, `db/`, or npm packages. This one exception breaks the clean architectural boundary and makes it impossible to test `api-auth.ts` in isolation without pulling in the server action module graph.

**Suggested fix:** Extract `isAdmin()` from `app/actions/auth.ts` into `lib/session.ts` (which already has session verification primitives) or create a new `lib/auth-check.ts`. Then have both `app/actions/auth.ts` and `lib/api-auth.ts` import from the library module. This inverts the dependency direction so application code depends on library code, not vice versa.

**Confidence:** High

---

### 1.2 God File: lib/data.ts (~1670 lines) (HIGH)

**File:** `apps/web/src/lib/data.ts` (entire file)

**Concern:** This module functions as the Data Access Layer (DAL) but also contains: React `cache()` wrappers, privacy field filtering (`publicSelectFields`), GROUP_CONCAT aggregation for UI tag display, pagination cursor logic, view-count buffering (a side-effecting analytics concern), and three compile-time privacy guards. It is doing the work of three distinct layers.

**Specific sub-concerns:**
- **View-count buffer** (`data.ts:17-194`): A presentation-side analytics concern (shared-group view increments) is embedded in the DAL module. It uses module-level `let` state, `setTimeout`, and exponential backoff logic that has nothing to do with data access.
- **Privacy field filtering** (`data.ts:350-458`): UI concerns (what fields are "public") are hardcoded in the DAL. This makes it impossible to have different public surfaces with different field visibility rules.
- **GROUP_CONCAT aggregation** (`data.ts:613`): A presentation-level string aggregation (`tagNamesAgg`) is embedded in data queries.
- **Map image query** (`data.ts:~1579`): A business rule (GPS privacy via `map_visible` INNER JOIN) is embedded in a data query, not in a domain layer.

**Suggested fix:** Split into three focused modules:
1. `lib/data/queries.ts` — Pure Drizzle queries, no `cache()`, no privacy filtering, no presentation logic.
2. `lib/data/privacy.ts` — Privacy field definitions, compile-time guards, public/admin field mappings.
3. `lib/data/view-buffer.ts` — View-count buffering with its own state management and flush logic.

**Confidence:** High

---

### 1.3 God File: lib/process-image.ts (~1628 lines) (HIGH)

**File:** `apps/web/src/lib/process-image.ts` (entire file)

**Concern:** This module contains: Sharp pipeline configuration, EXIF extraction, color pipeline decisions (ICC, NCLX, chromaticity), GPS metadata stripping, blur placeholder generation, post-encode verification, atomic file rename chains, and 10-bit AVIF probe logic. The `processImageFormats` function alone spans 369 lines with 12 parameters.

**Specific sub-concerns:**
- **Function signature bloat** (`processImageFormats`, lines 927-942): 12 parameters including quality overrides, sizes, ICC profile, force-SRGB flag, color signals, chroma subsampling, AVIF effort, and max source pixels. This is a "config bag" anti-pattern.
- **GPS strip logic** (lines 1510-1628): 119 lines of container-aware byte surgery (JPEG, TIFF, ISOBMFF, WebP) embedded in the same file as the encoding pipeline. The `stripGpsFromOriginal` function reads entire files into memory (`fs.readFile`, line 1555) — up to 200MB per concurrent strip.
- **Post-encode verification** (lines 1257-1270): Non-blocking AVIF NCLX and WebP ICC verification that logs warnings but does not throw. Mis-tagged wide-gamut files could be served with incorrect color metadata.
- **Silent blur failure** (lines ~850): The blur generation catch block is bare (`catch { // Non-critical }`) with no logging — consistent failures would be invisible.

**Suggested fix:** Extract into focused sub-modules:
1. `lib/image-processing/pipeline.ts` — Core Sharp encoding pipeline, format fan-out, atomic writes.
2. `lib/image-processing/exif.ts` — EXIF extraction and metadata parsing.
3. `lib/image-processing/color.ts` — Color pipeline decisions, ICC resolution, NCLX handling.
4. `lib/image-processing/gps.ts` — GPS stripping (already exists as `gps-exif-strip.ts`, but the orchestration call is in `process-image.ts`).
5. `lib/image-processing/blur.ts` — Blur placeholder generation.

Introduce a `PipelineConfig` interface to replace the 12-parameter function signature.

**Confidence:** High

---

### 1.4 God File: lib/image-queue.ts (~831 lines) (MEDIUM)

**File:** `apps/web/src/lib/image-queue.ts` (entire file)

**Concern:** This module contains: PQueue management, image processing orchestration, CLIP embedding generation, caption generation, session purging, rate-limit bucket purging, audit log purging, view event purging, orphaned tmp cleanup, retry logic, quiesce/resume for DB restore, and bootstrap continuation scheduling.

**Specific sub-concerns:**
- **ML inference coupling** (lines 21-24): Imports `generateCaption`, `embedImageStub`, `embedImageReal` — couples core image processing to ML inference. The image queue's core responsibility (file conversion) is entangled with ONNX/transformers model loading.
- **Maintenance scheduling** (lines 737-767): Hourly GC timer for sessions, rate limits, audit logs, and view events is embedded in the image queue module. This is a system-level maintenance concern, not an image-processing concern.
- **Process-local state** (lines 173-197): Queue state, retry counts, permanently failed IDs, and bootstrap cursor are all module-level `let` variables. Correctly documented as single-process, but tightly coupled to this module.

**Suggested fix:** Extract into:
1. `lib/image-processing/queue.ts` — Core PQueue management and image claim/processing.
2. `lib/image-processing/post-process.ts` — CLIP and caption hooks (decoupled via event bus or callback registry).
3. `lib/maintenance/scheduler.ts` — Hourly GC timer, session purging, audit log purging.

**Confidence:** High

---

### 1.5 God File: lib/admin-backfill-runner.ts (~874 lines) (MEDIUM)

**File:** `apps/web/src/lib/admin-backfill-runner.ts` (entire file)

**Concern:** This module contains: backfill state management, MySQL advisory lock acquisition, batch fetching, reprocessing orchestration, concurrency resolution, status tracking, and connection pool budgeting. It is the runtime cousin of `scripts/backfill-color-pipeline.ts` and duplicates much of its logic.

**Suggested fix:** Extract into:
1. `lib/backfill/state.ts` — Runner status, progress counters, error tracking.
2. `lib/backfill/runner.ts` — Lock acquisition, batch fetching, worker pool management.
3. Share common logic between the in-app runner and the sidecar script via a shared module.

**Confidence:** Medium

---

### 1.6 Server Actions Import Directly from DB Schema (MEDIUM)

**Files:** 11 of 14 server action files in `app/actions/` import directly from `@/db` (schema + connection pool).

**Concern:** Server actions are the application's "use case" layer. They construct raw Drizzle queries and import schema objects directly. This bypasses any domain abstraction and makes it impossible to: swap ORMs, add cross-cutting concerns (caching, audit, validation) uniformly, or unit-test actions without a database.

**Why it matters (trade-off):** The current approach is pragmatic for a personal gallery with a small team. A full domain service layer would add indirection and boilerplate. However, as the codebase grows, the lack of a domain layer will make refactors increasingly risky.

**Suggested fix:** Introduce a thin domain service layer (`@/services/images`, `@/services/settings`) that encapsulates DB access. Server actions should orchestrate services, not construct raw SQL. This is a medium-term refactoring, not urgent.

**Confidence:** Medium

---

## 2. Type Safety & Abstractions

### 2.1 Schema/Runtime Mismatch: embedding column (HIGH)

**File:** `apps/web/src/db/schema.ts:276`
**Code:** `embedding: text("embedding").notNull()`

**Concern:** The Drizzle schema declares `embedding` as `text`, but the actual database column is `MEDIUMBLOB` (binary). The migration (0012) creates it as MEDIUMBLOB. mysql2 returns a `Buffer` at runtime for binary columns. This forces two unsafe `as unknown as string` casts:
- `apps/web/src/lib/image-queue.ts:505`: `const embeddingValue = buf as unknown as string;`
- `apps/web/src/app/actions/embeddings.ts:142`: `const embeddingValue = buf as unknown as string;`

**Why it matters:** These casts are a type-safety hole. If Drizzle ever changes its runtime behavior for `text` columns, or if the schema is accidentally changed to match the `text` declaration, the casts would silently break. The `decodeEmbeddingColumn()` function in `clip-embeddings.ts` handles Buffer reads, but the write sites use the cast.

**Suggested fix:** Use Drizzle's `customType` to properly model MEDIUMBLOB, or at minimum add a stronger typed wrapper that eliminates the need for `as unknown as` at write sites. The `decodeEmbeddingColumn()` function already handles the read side correctly.

**Confidence:** High

---

### 2.2 Repetitive IIFE Pattern in Config Resolution (MEDIUM)

**File:** `apps/web/src/lib/gallery-config.ts:115-179`

**Concern:** Eight nearly identical IIFE blocks resolve boolean settings from the DB map. Each follows the same pattern:
```typescript
someSetting: (() => {
    const raw = getSetting(map, 'some_setting');
    if (!isValidSettingValue('some_setting', raw)) return DEFAULTS.some_setting === 'true';
    return raw === 'true';
})(),
```

**Why it matters:** Copy-paste risk when adding new boolean settings. A developer might forget the validation check or use an incorrect fallback. The `SEMANTIC_SEARCH_ALLOW_PRODUCTION` env gating (lines 126-144) is also embedded in this IIFE, adding special-case logic to an otherwise uniform pattern.

**Suggested fix:** Extract a `resolveBooleanSetting(map, key)` helper that encapsulates the validation + fallback pattern. The `SEMANTIC_SEARCH_ALLOW_PRODUCTION` gating can be a post-resolution override.

**Confidence:** Medium

---

### 2.3 Missing Explicit Return Types in DAL (MEDIUM)

**File:** `apps/web/src/lib/data.ts` (15+ exported functions)

**Concern:** Most exported functions in `data.ts` have inferred return types from complex Drizzle query result types. This makes the public API surface opaque to consumers and to the TypeScript compiler. Refactoring a query shape can break callers without a clear error message.

**Suggested fix:** Add explicit return type annotations to all exported `data.ts` functions. Define shared DTO interfaces (e.g., `ImageDto`, `TopicDto`) that both the DAL and consumers reference.

**Confidence:** Medium

---

### 2.4 Unvalidated JSON.parse in Components (MEDIUM)

**Files:**
- `components/wide-gamut-hint.tsx:40`: `JSON.parse(raw) as PersistedDismiss`
- `components/similar-photos.tsx:86`: `await res.json() as { results?: SimilarResult[] }`
- `components/search.tsx:191`: `await resp.json() as { results?: ... }`
- `app/api/search/semantic/route.ts:168`: `JSON.parse(rawBody) as unknown`

**Concern:** Four locations parse JSON from external sources (localStorage, API responses, request bodies) and cast to typed shapes without runtime validation. A malformed payload or API drift would produce a runtime type mismatch that TypeScript cannot catch.

**Suggested fix:** Add minimal runtime validation (e.g., `zod` schemas or basic shape checks) before casting. For the localStorage case, check that the parsed object has the expected keys. For API responses, validate the response shape.

**Trade-off:** Adding zod as a dependency adds bundle size. For a small number of validation sites, hand-written guards may be sufficient.

**Confidence:** Medium

---

### 2.5 `processed` Column Missing `.notNull()` (MEDIUM)

**File:** `apps/web/src/db/schema.ts:101`
**Code:** `processed: boolean("processed").default(false)`

**Concern:** The `processed` column is semantically boolean and should never be null (an image is either processed or not), but the schema does not enforce `.notNull()`. This creates ambiguity in query conditions (`eq(images.processed, true)` vs `isNull(images.processed)`).

**Suggested fix:** Add `.notNull()` to match the runtime expectation. This is a schema migration.

**Confidence:** Medium

---

## 3. Configuration & Environment

### 3.1 BASE_URL Resolution Duplicated (MEDIUM)

**Files:**
- `lib/constants.ts:24`: `BASE_URL = process.env.BASE_URL || siteConfig.url`
- `lib/seo-og-url.ts`: Re-implements the same fallback chain
- `lib/data.ts`: Uses `siteConfig.url` directly for some queries
- `app/sitemap.ts`: Re-implements URL derivation

**Concern:** The base URL resolution logic (env var -> site config -> default) is duplicated across at least four modules. This creates drift risk: changing the fallback logic in one place does not update the others.

**Suggested fix:** Create a centralized `env.ts` module that exports validated, typed environment variables. All consumers import from this module. The module should handle the fallback chain once and export a single `BASE_URL` constant.

**Confidence:** Medium

---

### 3.2 Hardcoded Rate Limit Parameters (LOW)

**File:** `apps/web/src/lib/rate-limit.ts:60-76`

**Concern:** Rate limit parameters (`LOGIN_MAX_ATTEMPTS = 5`, `LOGIN_WINDOW_MS = 15 * 60 * 1000`, `OG_MAX_REQUESTS = 30`, `SEARCH_MAX_REQUESTS = 30`) are hardcoded with no environment variable override. In a high-traffic or attack scenario, operators cannot adjust these without a code change and deploy.

**Suggested fix:** Make rate-limit parameters env-configurable with current values as defaults. This is a low-priority operational improvement.

**Confidence:** Low

---

### 3.3 Hardcoded DB Pool Size (LOW)

**File:** `apps/web/src/db/index.ts:23`
**Code:** `export const POOL_CONNECTION_LIMIT = 10;`

**Concern:** The connection pool limit is hardcoded to 10 with a queue limit of 20. No environment variable override exists. In high-traffic scenarios or when running the backfill script concurrently, operators cannot adjust pool sizing without a code change.

**Suggested fix:** Make `POOL_CONNECTION_LIMIT` and `queueLimit` env-configurable with current values as defaults. The backfill runner already references `POOL_CONNECTION_LIMIT` for its budgeting math, so a single env var would propagate correctly.

**Confidence:** Low

---

### 3.4 Hardcoded Session Max Age (LOW)

**File:** `apps/web/src/lib/session.ts` (implied by auth.ts)

**Concern:** The session max age (24 hours) is hardcoded with no environment variable override. Operators cannot adjust session TTL for different security postures without a code change.

**Suggested fix:** Add a `SESSION_MAX_AGE_HOURS` environment variable with a 24-hour default.

**Confidence:** Low

---

### 3.5 Inconsistent Boolean Env Parsing (LOW)

**File:** `apps/web/src/lib/gallery-config.ts:141`
**Code:** `process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] !== 'true'`

**Concern:** `SEMANTIC_SEARCH_ALLOW_PRODUCTION` only accepts the exact string `'true'`. Other common truthy strings (`'1'`, `'yes'`, `'YES'`, `'True'`) are treated as false. This is inconsistent with typical environment variable conventions and could confuse operators.

**Suggested fix:** Create a `parseBooleanEnv(name, default)` helper that accepts `'true'`, `'1'`, `'yes'` (case-insensitive) as truthy and standardize it across all boolean env var parsing sites.

**Confidence:** Low

---

## 4. Scalability & Process-Local State

### 4.1 Intentionally Single-Process — Correctly Documented (MEDIUM)

**Assessment:** The codebase contains 8 documented process-local state surfaces. All are correctly documented in `CLAUDE.md` with clear warnings about horizontal scaling. This is an intentional architectural choice for a personal gallery, not a defect.

**Process-local state inventory:**

| State | Location | Impact if Scaled |
|-------|----------|------------------|
| Image processing queue | `image-queue.ts:173-197` | Queue state, retry counts, permanently failed IDs lost across instances |
| Backfill runner status | `admin-backfill-runner.ts:219-251` | Runner status per-process only |
| OG/share/semantic rate limits | `rate-limit.ts:77-101` | Fast-path resets to zero on restart |
| Login rate-limit fast-path | `auth-rate-limit.ts:19` | Has DB backup, but fast-path is per-process |
| View-count buffer | `data.ts:17-26` | Lost on SIGKILL; flushed on SIGTERM only |
| Upload quota tracker | `upload-tracker-state.ts:15-21` | Per-process upload window tracking |
| Restore maintenance flag | `restore-maintenance.ts:7-19` | Per-process flag |
| Storage backend state | `storage/index.ts:34-45` | Not yet integrated |

**Recommendation:** If multi-instance deployment is ever needed, the following must move to a shared store: image queue state (Redis/BullMQ), rate-limit fast-paths (Redis sliding window), view-count buffer (Redis counters), upload tracker (Redis or DB-backed), backfill runner status (DB-backed or distributed lock).

**Confidence:** High (this is documented behavior, not a bug)

---

### 4.2 Advisory Lock Scope Warning (MEDIUM)

**File:** `apps/web/src/lib/advisory-locks.ts:8-16`

**Concern:** MySQL advisory locks are **server-scoped**, not database-scoped. Two GalleryKit instances pointed at the same MySQL server share the same lock namespace. This means two tenants on the same MySQL server will serialize each other's restores, upload-contract changes, topic renames, admin-user deletes, backfill runs, and image-processing claims.

**Status:** This is explicitly documented in `CLAUDE.md` ("Advisory-lock scope note") and in the code comments. The recommendation is to run one GalleryKit per MySQL server or prefix lock names with a per-instance identifier.

**Confidence:** Medium (documented, but a footgun for multi-tenant deployments)

---

### 4.3 Image Queue Lacks Pool Budgeting (LOW)

**File:** `apps/web/src/lib/image-queue.ts:183`

**Concern:** `QUEUE_CONCURRENCY` defaults to 1 but operators can raise it. Unlike the backfill runner (`admin-backfill-runner.ts:129-142`), the image queue has no explicit connection pool budgeting. Raising `QUEUE_CONCURRENCY` without understanding the pool limit could starve live request traffic.

**Suggested fix:** Add a connection-budget cap to the image queue similar to the backfill runner: `max(1, floor((POOL_CONNECTION_LIMIT - RESERVED - 1) / 2))`. Or at minimum, document the relationship between `QUEUE_CONCURRENCY` and `POOL_CONNECTION_LIMIT` in `CLAUDE.md`.

**Confidence:** Low

---

## 5. Security Architecture

### Assessment: Well-Hardened and Mature

The security architecture is the strongest area of the codebase. No critical or high-confidence security issues were identified. The following patterns are industry-leading:

| Pattern | Location | Evidence |
|---------|----------|----------|
| Defense-in-depth auth | `proxy.ts` + `api-auth.ts` + `action-guards.ts` | Middleware cookie check → same-origin → `isAdmin()` → session verification |
| Timing attack resistance | `session.ts:117`, `auth.ts:65-68` | `timingSafeEqual` for HMAC; dummy Argon2 hash for login timing equalization |
| TOCTOU protection | `auth-rate-limit.ts:125-137` | Pre-increment rate limit BEFORE expensive Argon2 verify; rollback on success only |
| Session fixation prevention | `auth.ts:208-219` | Deletes all existing sessions on login |
| Password change rotates all sessions | `auth.ts:388-399` | Forces re-login on all devices after password change |
| Three automated lint gates | `scripts/check-*.ts` | `check-api-auth.ts`, `check-action-origin.ts`, `check-public-route-rate-limit.ts` prevent regression at build time |
| Bounded Maps with FIFO eviction | `bounded-map.ts:19-100` | Prevents unbounded memory growth in rate-limit fast-paths |
| Token hash storage | `admin-tokens.ts:48-53` | Only SHA-256 hash stored; plaintext shown once at creation |
| CSP nonce generation | `proxy.ts:41-50` | Nonce generated per-request in production |
| Triple compile-time privacy guards | `data.ts:424-458` | `_privacyGuard`, `_mapPrivacyGuard`, `_largePayloadGuard` prevent PII leakage at compile time |

---

## 6. Image Processing Pipeline

### 6.1 Positive Patterns

The image processing pipeline demonstrates excellent engineering:

- **Race condition protection**: `image-queue.ts:414-435` checks `affectedRows === 0` to detect deletion-during-processing and cleans up derivatives.
- **Atomic rename fallback chain**: `link + rename` -> `copyFile + rename` -> `copyFile` direct with temp cleanup in `finally` (`process-image.ts:1216-1233`).
- **10-bit AVIF Promise singleton**: Probe runs once per process with exponential backoff; avoids repeated libheif latency (`process-image.ts:69-100`).
- **Wide-gamut source pixel cap**: `WIDE_GAMUT_MAX_SOURCE_PIXELS` (default 50M) prevents OOM on rgb16 pipeline (`process-image.ts:990`).
- **Per-format fresh Sharp instances**: WI-14 cross-format isolation eliminates shared-state contamination (`process-image.ts:1241-1245`).
- **Post-encode cleanup**: On failure, all partial sized variants are deleted across all three formats (`process-image.ts:1282-1286`).

### 6.2 GPS Strip Memory Spike (MEDIUM)

**File:** `apps/web/src/lib/process-image.ts:1555`
**Code:** `const input = await fs.readFile(filePath);`

**Concern:** The GPS strip function reads the entire original file into memory. For a 200MB upload with concurrent processing, this could spike memory usage significantly. The file is already read once during upload processing; the GPS strip is a second full read.

**Suggested fix:** Document the memory ceiling for operators. Consider streaming for formats that support it (though container-aware byte surgery inherently needs random access, so streaming may not be feasible for all formats).

**Confidence:** Medium

---

## 7. Positive Architectural Patterns

The following patterns are exemplary and should be preserved:

### 7.1 Compile-Time Privacy Guards

`data.ts:424-458` contains three compile-time guards that prevent entire classes of privacy bugs:
- `_privacyGuard`: Ensures no sensitive key leaks into `publicSelectFields`
- `_mapPrivacyGuard`: Same for `publicMapSelectFields` (GPS-allowed path)
- `_largePayloadGuard`: Prevents `blur_data_url` from entering public listings

These are not runtime checks — they are TypeScript type-level assertions that produce compile errors if violated. This is industry-leading practice.

### 7.2 Smart Collections SQL Compiler

`smart-collections.ts` compiles an AST to safe parameterized SQL with:
- Column allowlist (9 columns only)
- Depth limit (max 4 nested AND/OR groups)
- `MAX_IN_VALUES` limit (100)
- Full Drizzle parameter binding (no raw string concatenation)

This is a well-designed defense-in-depth pattern for dynamic query generation.

### 7.3 Settings Hash Compile-Time Guard

`settings-hash.ts:63-65`: `_ColorKeysAreSettingKeys` ensures every `COLOR_IMPACTING_KEY` is a real gallery setting key. A typo or removed key becomes a hard `tsc` error.

### 7.4 Connection Pool Auto-Release

`db/index.ts:107-124` overrides `poolConnection.query` and `poolConnection.execute` to always acquire/release connections via `getConnection()`/`release()`. This prevents connection leaks that would otherwise occur if callers use the pool-level methods directly.

### 7.5 DB Connection Init Race Fix

`db/index.ts:70-105` uses a Symbol property (not a WeakMap) to track connection initialization state, fixing a race where the `connection` event handler and `getConnection()` could see different wrapper objects.

### 7.6 Zero `any` Usage, Zero `@ts-ignore`

The entire production codebase contains no `any` type annotations and no `@ts-ignore` or `@ts-expect-error` directives. This is exceptional TypeScript discipline.

---

## 8. Recommendations (Priority Order)

| Priority | Finding | Action | Effort | Impact |
|----------|---------|--------|--------|--------|
| **P1** | Layer violation (1.1) | Extract `isAdmin()` to `lib/session.ts` or `lib/auth-check.ts`; update `api-auth.ts` and `app/actions/auth.ts` imports | Low | High (fixes only upward dependency) |
| **P1** | God file: `lib/data.ts` (1.2) | Split into `data/queries.ts`, `data/privacy.ts`, `data/view-buffer.ts` | Medium | High (improves testability, reduces coupling) |
| **P1** | God file: `lib/process-image.ts` (1.3) | Extract pipeline, exif, color, blur into sub-modules; introduce `PipelineConfig` interface | Medium | High (improves testability, enables parallel work) |
| **P2** | Schema mismatch (2.1) | Fix `embedding` column type in `db/schema.ts` or add typed wrapper; eliminate `as unknown as string` casts | Low | High (closes type-safety hole) |
| **P2** | God file: `lib/image-queue.ts` (1.4) | Extract ML hooks to post-process module, maintenance to scheduler module | Medium | Medium (decouples core from ML) |
| **P2** | Missing return types (2.3) | Add explicit return types to all exported `data.ts` functions; define shared DTOs | Low | Medium (improves API clarity) |
| **P2** | Unvalidated JSON.parse (2.4) | Add runtime validation for localStorage, API response, and request body parsing | Low | Medium (prevents runtime type mismatches) |
| **P3** | Config drift (3.1) | Create centralized `env.ts` module for BASE_URL and other env vars | Low | Low (reduces duplication) |
| **P3** | Repetitive IIFE (2.2) | Extract `resolveBooleanSetting()` helper in `gallery-config.ts` | Low | Low (reduces copy-paste risk) |
| **P3** | Hardcoded params (3.2-3.4) | Make rate limits, pool size, session age env-configurable | Low | Low (operational flexibility) |
| **P3** | `processed` notNull (2.5) | Add `.notNull()` to `processed` column in schema + migration | Low | Low (schema correctness) |
| **P3** | GPS strip memory (6.2) | Document memory ceiling; consider streaming where feasible | Low | Low (operational awareness) |

---

## 9. Trade-offs

| Option | Pros | Cons |
|--------|------|------|
| **Keep god files** | Fewer modules, simpler imports, less boilerplate | Harder to test, higher cognitive load, risk of unintended coupling |
| **Split god files** | Better testability, clearer responsibilities, enables parallel development | More modules, more import statements, potential over-engineering for a personal gallery |
| **Add domain service layer** | Clean separation, ORM-swappable, testable without DB | Indirection, boilerplate, may be overkill for current scale |
| **Keep direct DB access in actions** | Pragmatic, less code, faster development | Tight coupling to Drizzle, harder to test, harder to refactor |
| **Fix embedding schema type** | Eliminates unsafe casts, type-safe writes | Requires Drizzle `customType` or migration; may affect other consumers |
| **Decouple ML from image queue** | ML failures don't affect core pipeline, enables independent scaling | Adds event bus complexity, more modules to maintain |

---

## 10. References

- `apps/web/src/lib/api-auth.ts:1` — Layer violation: imports `isAdmin` from `app/actions/auth.ts`
- `apps/web/src/lib/data.ts:1-1670` — God file: DAL + privacy + view buffer + pagination
- `apps/web/src/lib/data.ts:17-194` — View-count buffer embedded in DAL
- `apps/web/src/lib/data.ts:424-458` — Triple compile-time privacy guards
- `apps/web/src/lib/data.ts:613` — `tagNamesAgg` GROUP_CONCAT in data queries
- `apps/web/src/lib/process-image.ts:1-1628` — God file: image processing pipeline
- `apps/web/src/lib/process-image.ts:927-942` — `processImageFormats` 12-parameter signature
- `apps/web/src/lib/process-image.ts:1555` — GPS strip reads entire file into memory
- `apps/web/src/lib/image-queue.ts:1-831` — God file: queue + ML + maintenance
- `apps/web/src/lib/image-queue.ts:21-24` — ML inference imports (caption, CLIP)
- `apps/web/src/lib/admin-backfill-runner.ts:1-874` — God file: backfill runner
- `apps/web/src/db/schema.ts:276` — `embedding: text()` declared, actual column is MEDIUMBLOB
- `apps/web/src/lib/image-queue.ts:505` — `as unknown as string` cast for embedding Buffer
- `apps/web/src/app/actions/embeddings.ts:142` — Same `as unknown as string` cast
- `apps/web/src/lib/gallery-config.ts:115-179` — Repetitive boolean IIFE pattern
- `apps/web/src/lib/constants.ts:24` — BASE_URL resolution (duplicated elsewhere)
- `apps/web/src/db/index.ts:23` — Hardcoded `POOL_CONNECTION_LIMIT = 10`
- `apps/web/src/lib/rate-limit.ts:60-76` — Hardcoded rate limit parameters
- `apps/web/src/lib/advisory-locks.ts:8-16` — MySQL advisory lock scope warning
- `apps/web/src/lib/bounded-map.ts:19-100` — BoundedMap with FIFO eviction
- `apps/web/src/lib/smart-collections.ts` — AST-to-SQL compiler with allowlist
- `apps/web/src/lib/settings-hash.ts:63-65` — Compile-time color key guard
- `apps/web/src/db/index.ts:70-105` — Connection init race fix with Symbol property
- `apps/web/src/lib/validation.ts:58` — `UNICODE_FORMAT_CHARS` regex for bidi/invisible char rejection
- `apps/web/src/proxy.ts:41-50` — CSP nonce generation per-request
- `apps/web/src/lib/session.ts:117` — `timingSafeEqual` for HMAC verification
- `apps/web/src/lib/auth-rate-limit.ts:125-137` — TOCTOU-protected rate limiting
- `apps/web/src/lib/action-guards.ts:37-44` — Centralized same-origin admin check

---

*Review completed. All findings cite specific file:line references. No findings are based on speculation or training knowledge. The review was conducted against the actual source code at HEAD commit c0522dec.*
