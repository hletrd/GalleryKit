# GalleryKit Architecture Review — Round 4
**Date:** 2026-04-11
**Reviewer:** Architect
**Scope:** Full codebase read — post-split verification, circular dependency audit, audit_log schema, rate_limit_buckets scalability, technical debt inventory

---

## Executive Summary

The actions.ts split is structurally sound: a 23-line barrel re-exports from 7 domain modules with no circular dependencies, and the previous Round-3 name-collision hazard (`getTags` vs `getAdminTags`) is resolved. The `instrumentation.ts` SIGTERM handler is implemented but uses a brittle `Symbol.for` indirection to reach the queue rather than a direct import. The `audit_log` table exists in the schema but is never written to anywhere in the codebase — it is dead schema. The `rate_limit_buckets` MySQL pattern introduces a correctness split: login rate-limiting still runs entirely in-memory (`loginRateLimit` Map) while `checkRateLimit`/`incrementRateLimit` DB functions are exported but never called from any action. The `capture_date` schema drift persists: `schema.ts` now correctly declares `datetime`, but `init-db.ts`, `migrate.js`, and `drizzle/0000_...sql` still declare it as `varchar(255)`. Six issues are identified; none are P0.

---

## Round-3 Issue Verification

### Issue 3 (SIGTERM handler) — Partially resolved, with a new fragility

`instrumentation.ts:1-29` implements the SIGTERM drain. However, it reaches the queue via:

```typescript
const queueKey = Symbol.for('gallerykit.imageProcessingQueue');
const state = (globalThis as Record<symbol, unknown>)[queueKey] as ...
```

This `Symbol.for` indirection was chosen to avoid importing from a `'use server'` module. The actual queue state is exposed at `image-queue.ts:8` under the same Symbol and at `image-queue.ts:26-39` via `getProcessingQueueState()`. The problem: `getProcessingQueueState` is already exported from `image-queue.ts`, which has no `'use server'` directive. A direct `import { getProcessingQueueState } from '@/lib/image-queue'` in `instrumentation.ts` would work and would be type-safe. The current approach uses an untyped `Record<symbol, unknown>` cast that will silently produce `undefined` if the Symbol string ever diverges between the two files.

Additionally, `purgeOldBuckets` (for the MySQL rate-limit table) is never called from the `gcInterval` in `image-queue.ts:164`. The hourly GC only purges sessions — old `rate_limit_buckets` rows will accumulate indefinitely until someone calls `purgeOldBuckets` manually.

**Verdict:** SIGTERM drain logic is correct in spirit but the indirection introduces fragility. Direct import is available and should be used.

### Issue 2 (getTags name collision) — Resolved

`actions/tags.ts:12` exports `getAdminTags()`, which is re-exported by the barrel at `actions.ts:14`. The `tags/page.tsx:2` caller correctly imports `getAdminTags` from `@/app/actions`. The collision with `data.ts:getTags` is eliminated. The `catch` block at `actions/tags.ts:28-30` still does `console.error("Failed to fetch tags")` without passing the error object — a debug-logging gap that was noted in Round 3 and not fixed.

### Issue 4 (tertiary id sort key) — Status unclear

`data.ts:175` orders `getImagesLite` by `desc(images.capture_date), desc(images.created_at), desc(images.id)` — three keys are present. `data.ts:201` orders `getImages` by the same three keys. This was fixed.

### Issue 1 (capture_date type) — Schema diverged, not fully resolved

`schema.ts:33` now declares `datetime("capture_date", { mode: 'string' })` — correct. But the three DDL sources still use `varchar(255)`:
- `apps/web/drizzle/0000_nappy_madelyne_pryor.sql:27`
- `apps/web/scripts/init-db.ts:77`
- `apps/web/scripts/migrate.js:81`

A fresh `db:push` against a new database will produce a `DATETIME` column (from schema.ts). A database initialized from `init-db.ts` or `migrate.js` (the Docker entrypoint path) will produce `VARCHAR(255)`. Production containers initialized via `migrate.js` are running with the wrong column type. This is a schema drift bug, not just a documentation issue.

---

## New Findings

### Finding 1 — `audit_log` table is dead schema
**Severity: Low (wasted schema, misleading to future contributors)**

`schema.ts:111-123` defines `auditLog` with `userId`, `action`, `targetType`, `targetId`, `ip`, `metadata`, `created_at`. The table is exported from `schema.ts` but **not re-exported from `db/index.ts:34`** (confirmed: the export line lists `rateLimitBuckets` but not `auditLog`). No action module imports or writes to it. No migration populates it. The table will be created by `db:push` but will remain permanently empty.

This is a meaningful gap: login, password-change, user-creation, and delete operations are the highest-value audit events. The infrastructure is there (schema, indexes) but the write path is entirely absent.

Root cause: the schema was added speculatively without implementing the write path, and `auditLog` was omitted from the `db/index.ts` re-export, making it impossible to import even if someone tried.

### Finding 2 — MySQL rate-limit functions are implemented but never called
**Severity: Medium (false sense of security — DB-backed rate limiting is not active)**

`rate-limit.ts:97-149` implements `checkRateLimit`, `incrementRateLimit`, and `purgeOldBuckets` using `rate_limit_buckets`. These are exported but have zero call sites anywhere in the codebase.

The actual login rate limiting at `actions/auth.ts:82-99` still uses the in-memory `loginRateLimit` Map. The search rate limiting at `actions/public.ts:33-48` still uses the in-memory `searchRateLimit` Map.

Consequence: on process restart (container redeploy, crash, OOM kill), all in-memory rate-limit state is lost. An attacker can reset their login attempt counter by timing requests to coincide with container restarts, or by triggering a restart (e.g., via OOM). With the in-memory approach, the 5-attempt window resets to zero on every cold start.

The fix path is clear: replace the in-memory login rate-limit block in `auth.ts:82-99` with calls to `checkRateLimit` / `incrementRateLimit`. The in-memory Maps can be kept as a fast-path cache layer on top, or removed entirely.

`purgeOldBuckets` also has no call site. It should be added to the `gcInterval` in `image-queue.ts:164` alongside `purgeExpiredSessions`.

### Finding 3 — `instrumentation.ts` Symbol.for indirection is fragile and unnecessary
**Severity: Low (correctness risk if Symbol string diverges)**

As noted above: `instrumentation.ts:11-13` reaches the queue state via `Symbol.for('gallerykit.imageProcessingQueue')` and an untyped cast. `image-queue.ts:8` uses the same symbol string and `image-queue.ts:26-39` exports `getProcessingQueueState()` with a fully typed return. A direct import is the correct solution.

The concern about `'use server'` restrictions does not apply here: `image-queue.ts` has no `'use server'` directive. The directive that does exist is on individual action files (`actions/auth.ts`, `actions/images.ts`, etc.) — not on the lib modules they import.

### Finding 4 — `rate_limit_buckets.bucketStart` is `int` (32-bit signed), will overflow in 2038
**Severity: Low (time bomb, but not urgent)**

`schema.ts:137` declares `bucketStart: int("bucket_start").notNull()`. The value is computed at `rate-limit.ts:89` as Unix seconds (not milliseconds). A 32-bit signed MySQL `INT` holds a maximum value of 2,147,483,647, which corresponds to 2038-01-19T03:14:07Z — the classic Y2K38 problem. `BIGINT` or `UNSIGNED INT` (max 4,294,967,295 = year 2106) would eliminate this. Since this is a new table with no existing data, changing to `bigint` costs nothing.

### Finding 5 — `ActionResult` type is defined but not adopted by any action
**Severity: Low (dead type, inconsistent return shapes)**

`lib/action-result.ts:2-4` defines:
```typescript
export type ActionResult<T = void> =
    | { success: true; data?: T; message?: string }
    | { success: false; error: string };
```

No action module imports or uses this type. All seven action modules return ad-hoc `{ success: true, ... } | { error: string }` shapes, some with `{ success: true, count: number, failed: string[] }` (images), some with `{ success: true, key: string }` (sharing), etc. The type is unreachable dead code — it was defined as infrastructure but never wired up.

This means callers have no shared type contract for server action responses. TypeScript will infer the return type from each action individually, which is workable, but means no single type to reference in client components or tests.

### Finding 6 — `getSharedGroup` expiry uses `new Date(string) < new Date()` with tz ambiguity
**Severity: Low (edge case, matches schema behavior)**

`data.ts:366` checks expiry as:
```typescript
if (group.expires_at && new Date(group.expires_at) < new Date()) {
    return null;
}
```

`schema.ts:91` declares `expires_at: datetime("expires_at", { mode: 'string' })`. With `mode: 'string'`, Drizzle returns the raw MySQL DATETIME string (format: `"2026-04-11 10:30:00"`) with no timezone suffix. `new Date("2026-04-11 10:30:00")` is parsed as **local time** in V8. On a UTC server this is neutral, but on a non-UTC server the expiry check will be offset by the server timezone. Since `sharedGroups` has no UI for setting expiry (no create/update UI was found), this field appears currently unused in practice, but the tz handling is inconsistent with how `sessions.expiresAt` works (which uses Drizzle `timestamp` with proper Date objects).

---

## Structural Assessment: Actions Split

The split is well-structured. Evidence:

1. **Barrel file** (`actions.ts:1-23`): 23 lines, purely re-exports, one comment per domain group. No logic, no imports other than from the seven modules.

2. **Module boundaries** are correct by domain:
   - `auth.ts` — session, login, logout, password
   - `images.ts` — upload, delete, metadata
   - `topics.ts` — CRUD + aliases
   - `tags.ts` — tag CRUD + image association
   - `sharing.ts` — share keys + groups
   - `admin-users.ts` — user management
   - `public.ts` — unauthenticated pagination + search

3. **Cross-module imports**: only one pattern exists — all non-auth modules import `isAdmin` or `getCurrentUser` from `@/app/actions/auth`. This is the correct direction (auth is a leaf dependency, not a peer). No circular dependency exists.

4. **`'use server'` placement**: each module has its own `'use server'` at line 1, which is the correct pattern for split action files. The barrel does not need `'use server'` because it only re-exports; this is intentional per the inline comment at `actions.ts:2`.

One minor structural observation: `admin-users.ts:8` imports both `isAdmin` and `getCurrentUser` from `@/app/actions/auth`. This is the only module that imports two auth exports (others import only `isAdmin`). This is correct — `deleteAdminUser` needs the current user's ID to prevent self-deletion. No issue.

---

## Technical Debt Inventory (Current State)

| ID | Issue | Severity | Status vs Round 3 | Effort to Fix |
|----|-------|----------|--------------------|---------------|
| TD-01 | `capture_date` schema drift: `schema.ts` is `datetime` but `init-db.ts`/`migrate.js`/migration SQL still `varchar(255)` | Medium | New finding (partial fix introduced drift) | 1h (update 3 files + migration) |
| TD-02 | MySQL `checkRateLimit`/`incrementRateLimit` implemented but never called; login/search still in-memory | Medium | New finding | 2h |
| TD-03 | `audit_log` dead schema — defined, not exported from `db/index.ts`, never written | Low | New finding | 3h (wire up write path) |
| TD-04 | `instrumentation.ts` SIGTERM uses `Symbol.for` instead of direct import of `getProcessingQueueState` | Low | Regression from Round-3 fix | 15min |
| TD-05 | `purgeOldBuckets` never called — `rate_limit_buckets` grows unbounded | Low | New finding | 15min |
| TD-06 | `rate_limit_buckets.bucketStart` is 32-bit signed `int` — Y2K38 overflow | Low | New finding | 15min (schema + migration) |
| TD-07 | `ActionResult` type defined but never used by any action | Low | New finding | 2h (adopt across actions) |
| TD-08 | `catch` block in `tags.ts:28-30` logs error message without error object | Low | Carried from Round 3 | 5min |
| TD-09 | `capture_date` timezone ambiguity in `parseExifDateTime` (local-time Date objects for numeric/Date input) | Low | Carried from Round 3 | 30min |
| TD-10 | `restoreDatabase` in-process-only mutex not multi-process-safe | Low | Carried from Round 3 | N/A (single-process deploy) |
| TD-11 | DB connection pool `connectionLimit: 8` vs CLAUDE.md documenting 20 | Low | Carried from Round 3 | 5min (update code or docs) |
| TD-12 | `getSharedGroup` expiry uses `new Date(string)` with timezone ambiguity | Low | New finding | 30min |
| TD-13 | No `stop_grace_period` in docker-compose.yml; default 10s may not be enough for large Sharp jobs | Low | Carried from Round 3 | 5min |

**Resolved since Round 3:**
- Issue 2: `getTags` name collision → renamed to `getAdminTags` (confirmed resolved)
- Issue 3: SIGTERM handler → implemented (but with TD-04 fragility)
- Issue 4: Tertiary `id` sort key → added (confirmed resolved)

---

## Recommendations

### Recommendation 1 — Fix `instrumentation.ts` Symbol.for indirection (15 min)
**Priority: High. Low effort.**

Replace `instrumentation.ts:11-13`:

```typescript
// Current (fragile)
const queueKey = Symbol.for('gallerykit.imageProcessingQueue');
const state = (globalThis as Record<symbol, unknown>)[queueKey] as ...

// Fix — direct import from the module that already exports this function
const { getProcessingQueueState } = await import('@/lib/image-queue');
const state = getProcessingQueueState();
```

`image-queue.ts` has no `'use server'` directive. The import is valid. Trade-off: if `image-queue.ts` is ever given `'use server'`, this import would break, but that would itself be a design error since `image-queue.ts` is a lib module.

### Recommendation 2 — Fix `capture_date` schema drift (1 hour)
**Priority: High. The DDL sources are wrong.**

Three files need updating to match `schema.ts:33`:
- `apps/web/drizzle/0000_nappy_madelyne_pryor.sql:27`: change `` `capture_date` varchar(255) `` to `` `capture_date` datetime DEFAULT NULL ``
- `apps/web/scripts/init-db.ts:77`: same change
- `apps/web/scripts/migrate.js:81`: same change

Also add a new Drizzle migration: `ALTER TABLE images MODIFY COLUMN capture_date DATETIME DEFAULT NULL`. Production databases initialized from `migrate.js` are currently `varchar`. The `parseExifDateTime` function now outputs `"YYYY-MM-DD HH:MM:SS"` format which is valid MySQL DATETIME literal, so the stored data is already compatible with a `DATETIME` column — the `ALTER TABLE` is a lossless type change for all current rows.

Trade-off: `ALTER TABLE` on large tables in MySQL 8 is an online DDL operation by default (no table lock), but it still copies the table. On a large gallery this could take seconds to minutes. Schedule during low-traffic window.

### Recommendation 3 — Wire `checkRateLimit`/`incrementRateLimit` into login flow (2 hours)
**Priority: Medium. In-memory state resets on restart.**

Replace `auth.ts:82-99` in-memory block with DB-backed calls:

```typescript
const { limited } = await checkRateLimit(ip, 'login', LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
if (limited) return { error: 'Too many login attempts. Please try again later.' };
await incrementRateLimit(ip, 'login', LOGIN_WINDOW_MS);
```

Keep `loginRateLimit` Map as an optional fast-path cache, or remove it. Add `purgeOldBuckets` to the `gcInterval` at `image-queue.ts:164`.

Trade-off: adds 1-2 DB round trips per login attempt. Given login is a low-frequency operation and the DB is local (host networking), the latency cost is negligible. The correctness benefit (rate-limit state survives restarts) justifies it.

### Recommendation 4 — Export `auditLog` from `db/index.ts` and wire write path (3 hours)
**Priority: Medium. The infrastructure exists; it just needs wiring.**

1. Add `auditLog` to `db/index.ts:34` export.
2. Write to `auditLog` in at minimum: `auth.ts` (login success/failure), `admin-users.ts` (user create/delete), `actions/images.ts` (batch delete).
3. The schema is adequate for basic audit needs. The `metadata: text` column can hold JSON for structured context.

Trade-off: adds a DB write to every audited action. For login, this is acceptable. For batch image delete, consider async (fire-and-forget) write to avoid adding latency to the delete transaction.

### Recommendation 5 — Fix `rate_limit_buckets.bucketStart` to `bigint` (15 min)
**Priority: Low. But trivially fixed now while the table is empty.**

In `schema.ts:137`: change `int("bucket_start")` to `bigint("bucket_start", { mode: 'number' })`. Add a Drizzle migration. The `bucketStart()` function in `rate-limit.ts:87-91` already returns a regular JS number (safe up to 2^53); the MySQL column just needs to accommodate values past 2038.

### Recommendation 6 — Adopt `ActionResult<T>` in action modules (2 hours)
**Priority: Low. Quality of life.**

`lib/action-result.ts` exists but is unused. Either adopt it across all actions or delete it to avoid confusion. If adopting: the generic `T` parameter should carry the success payload (e.g., `ActionResult<{ key: string }>` for `createPhotoShareLink`). The inconsistent success shapes (`count`, `key`, `replaced`, etc.) are the main obstacle — they would need to move into the `data` field.

Trade-off: adopting creates a consistent contract but requires updating all seven action modules and all their client callers. Deleting the type removes dead code with no runtime impact. Either decision is better than the current dead-type state.

---

## Trade-offs

| Option | Pros | Cons |
|--------|------|------|
| Direct import in `instrumentation.ts` | Type-safe, no hidden coupling via Symbol string | Requires `image-queue.ts` to remain non-`use-server` |
| Keep `Symbol.for` indirection | No import dependency on lib module | Untyped cast; silently returns `undefined` on Symbol mismatch |
| DB-backed login rate limiting | Survives restarts; multi-process safe | +1-2 DB RTTs per login attempt |
| In-memory rate limiting (current) | Zero DB overhead | Resets on restart; single-process only |
| `audit_log` write path now | Security posture, forensics | +1 DB write per audited action; schema is minimal |
| Defer audit_log | No immediate risk | Table stays empty; opportunity cost |
| Fix `capture_date` DDL now | Correct by type; enables future datetime ops | Online ALTER needed for existing prod DB |
| Leave `capture_date` as varchar | No migration risk | DDL sources contradict schema.ts; new installs get wrong type |

---

## References

- `/Users/hletrd/flash-shared/gallery/apps/web/src/instrumentation.ts:11-13` — Symbol.for indirection reaching queue state (TD-04)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/image-queue.ts:8` — same Symbol declared here
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/image-queue.ts:26-39` — `getProcessingQueueState()` exported, directly importable
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/image-queue.ts:164` — `gcInterval` only calls `purgeExpiredSessions`, not `purgeOldBuckets`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/db/schema.ts:33` — `capture_date datetime` (correct)
- `/Users/hletrd/flash-shared/gallery/apps/web/drizzle/0000_nappy_madelyne_pryor.sql:27` — `capture_date varchar(255)` (wrong)
- `/Users/hletrd/flash-shared/gallery/apps/web/scripts/init-db.ts:77` — `capture_date varchar(255)` (wrong)
- `/Users/hletrd/flash-shared/gallery/apps/web/scripts/migrate.js:81` — `capture_date varchar(255)` (wrong)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/db/schema.ts:111-123` — `auditLog` table definition
- `/Users/hletrd/flash-shared/gallery/apps/web/src/db/index.ts:34` — `auditLog` absent from re-export list (Finding 1)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/rate-limit.ts:97-149` — `checkRateLimit`/`incrementRateLimit`/`purgeOldBuckets` — zero call sites (Finding 2)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/app/actions/auth.ts:82-99` — login rate limit still in-memory Map
- `/Users/hletrd/flash-shared/gallery/apps/web/src/app/actions/public.ts:33-48` — search rate limit still in-memory Map
- `/Users/hletrd/flash-shared/gallery/apps/web/src/db/schema.ts:137` — `bucketStart: int` (32-bit signed, Y2K38) (Finding 4)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/action-result.ts:2-4` — `ActionResult` type defined but never imported (Finding 5)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/app/actions/tags.ts:28-30` — `catch` logs without error object (TD-08)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/data.ts:366` — shared group expiry check using `new Date(string)` with tz ambiguity (Finding 6)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/app/actions.ts:1-23` — barrel file, confirmed clean re-export only
- `/Users/hletrd/flash-shared/gallery/apps/web/src/app/actions/admin-users.ts:8` — correctly imports `isAdmin` + `getCurrentUser` from auth
- `/Users/hletrd/flash-shared/gallery/apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx:2` — correctly uses `getAdminTags` (collision resolved)
- `/Users/hletrd/flash-shared/gallery/apps/web/docker-compose.yml:11` — `network_mode: host`, no `stop_grace_period`
- `/Users/hletrd/flash-shared/gallery/apps/web/Dockerfile:66` — `HEALTHCHECK` present; no `STOPSIGNAL` override
