# Architect — Cycle 1 Fresh Review (2026-04-27)

## Architectural Analysis

### Layer Boundaries

The codebase follows a clean layered architecture:

```
Pages (app/[locale]/) → Actions (app/actions/) → Data Layer (lib/data.ts) → DB (db/)
                       ↘ Lib Utilities (lib/*.ts)
```

- **Pages** render UI and call server actions
- **Actions** validate input, enforce auth, coordinate side effects
- **Data layer** abstracts DB queries with React `cache()` deduplication
- **DB layer** defines schema and connection pool

This is a well-structured Next.js App Router application.

---

## Findings

### C1-AR-01: Rate-limit logic is duplicated across modules
**File:** `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/app/actions/public.ts:38-74`
**Severity:** Medium | **Confidence:** High

Rate-limiting logic follows the same pattern across multiple files:
1. In-memory Map with count + resetAt/timestamp
2. Prune function with expiry + hard cap eviction
3. Pre-increment before check (TOCTOU fix)
4. Rollback on error

Each surface (login, search, load-more, OG, password change) re-implements this pattern with slight variations:
- `loginRateLimit` — DB-backed, `RateLimitEntry` with `count` + `lastAttempt`
- `searchRateLimit` — DB-backed, `{ count, resetAt }`
- `loadMoreRateLimit` — in-memory only, `{ count, resetAt }`
- `ogRateLimit` — in-memory only, `{ count, resetAt }`
- `passwordChangeRateLimit` — DB-backed, `RateLimitEntry`

The prune/pre-increment/rollback boilerplate is repeated ~5 times. This creates maintenance risk: a bug fix in one rate-limiter (e.g., the TOCTOU pre-increment pattern) must be manually applied to all others.

**Fix:** Extract a generic `BoundedRateLimiter` class or factory that encapsulates the in-memory Map, prune, pre-increment, rollback, and hard-cap eviction logic. Each surface would instantiate it with different limits and window sizes.

---

### C1-AR-02: `publicSelectFields` vs `adminSelectFields` pattern is fragile
**File:** `apps/web/src/lib/data.ts:115-201`
**Severity:** Low | **Confidence:** High

The privacy enforcement mechanism relies on destructuring `adminSelectFields` to omit sensitive fields:
```ts
const { latitude: _omitLatitude, ...publicSelectFieldCore } = adminSelectFields;
```

Adding a new sensitive field to `adminSelectFields` requires also adding it to the destructuring block. The compile-time guard catches omissions, but the mechanism requires developers to:
1. Add the field to `adminSelectFields`
2. Add the field to the destructuring omit list
3. Add the field to `_PrivacySensitiveKeys` type

This 3-step process is error-prone. However, the compile-time guard at line 197-200 catches any omissions at build time, making this a maintenance concern rather than a security vulnerability.

**Fix:** Consider a more explicit approach: define `publicSelectFields` independently (not derived from `adminSelectFields`) and use the compile-time guard to ensure no overlap with sensitive keys. This removes the destructuring step.

---

### C1-AR-03: `actions/images.ts` is a god module (432 lines)
**File:** `apps/web/src/app/actions/images.ts`
**Severity:** Low | **Confidence:** Medium

The `images.ts` action file contains 4 functions: `uploadImages` (316 lines), `deleteImage` (84 lines), `deleteImages` (134 lines), and `updateImageMetadata` (81 lines). The `uploadImages` function alone is 316 lines and handles upload validation, disk space checks, rate limiting, file processing, tag attachment, queueing, and audit logging. This makes it hard to test individual concerns in isolation.

**Fix:** Consider extracting:
- Upload validation into a separate module
- File cleanup logic (already partially extracted via `collectImageCleanupFailures`)
- Revalidation logic (already extracted via `revalidation.ts`)

---

### C1-AR-04: Storage abstraction exists but is not integrated
**File:** `apps/web/src/lib/storage/index.ts`, `apps/web/src/lib/storage/types.ts`, `apps/web/src/lib/storage/local.ts`
**Severity:** Low | **Confidence:** High (documented as deferred)

The `@/lib/storage` module defines a `StorageBackend` interface with `getFile`, `putFile`, `deleteFile`, etc., and a `LocalStorageBackend` implementation. However, the actual upload/processing/serving pipeline uses direct `fs` calls instead of going through this abstraction. CLAUDE.md explicitly notes: "The @/lib/storage module still exists as an internal abstraction, but the product currently supports local filesystem storage only. Do not document or expose S3/MinIO switching as a supported admin feature until the upload/processing/serving pipeline is wired end-to-end."

The unused abstraction adds maintenance burden without current value.

**Fix:** This is a known deferred item. No action needed until S3/MinIO support is planned.

---

### C1-AR-05: No structured error types for server action results
**File:** `apps/web/src/app/actions/*.ts`
**Severity:** Low | **Confidence:** Medium

All server actions return `{ error: string }` or `{ success: true }` with ad-hoc shapes. There's no shared `ActionResult<T>` type that standardizes the error/success shape. The `action-result.ts` file exists but appears to define a helper, not a comprehensive result type. This makes it harder to add client-side error handling that depends on error codes rather than error messages (which are i18n-translated).

**Fix:** Consider defining a structured `ActionResult<T>` type with error codes (enum) and optional message key, allowing the client to switch on codes rather than parse translated strings.

---

### C1-AR-06: Singleton state pattern via `Symbol.for()` and `globalThis` is consistent
**File:** `apps/web/src/lib/image-queue.ts:67`, `apps/web/src/lib/upload-tracker-state.ts:7`

The codebase consistently uses `Symbol.for('gallerykit.*')` + `globalThis` for singleton state that must survive HMR in development:
- `gallerykit.imageProcessingQueue` — PQueue + retry state
- `gallerykit.uploadTracker` — upload quota tracking

This pattern prevents duplicate state objects during Next.js dev server HMR cycles. Well-designed and consistent.

**Status:** Not an issue — pattern is correct and consistently applied.
