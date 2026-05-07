# Architect -- Cycle 6 (Round 3, 2026-04-20)

## Scope
Architectural/design risks, coupling, layering. Mature codebase with 46+ prior cycles.

## Findings

### A6R3-01: Storage backend abstraction is declared but not integrated -- dead code risk [MEDIUM] [MEDIUM confidence]
**File:** `apps/web/src/lib/storage/index.ts`, `apps/web/src/lib/storage/s3.ts`, `apps/web/src/lib/storage/minio.ts`, `apps/web/src/lib/storage/local.ts`
**Description:** The storage backend abstraction (`StorageBackend` interface, `LocalStorageBackend`, `S3StorageBackend`, `MinIOStorageBackend`) is fully implemented but the NOTE in `storage/index.ts` explicitly states: "The storage backend is not yet integrated into the image processing pipeline. Direct fs operations are still used for uploads and serving." This means:
1. `switchStorageBackend` in `settings.ts` can change the singleton, but actual file I/O bypasses it
2. Admin can select "minio" or "s3" in settings, which will succeed (the backend inits), but uploads still go to local disk
3. The `S3StorageBackend.writeStream` collects the entire stream into memory (unlike local which streams), creating a hidden memory bomb if ever activated

This is not a bug today, but it's an architectural risk: the setting exists in the admin UI but doesn't actually do what it claims.
**Fix:** Either:
1. Remove the storage backend setting from the admin UI until integration is complete, or
2. Add a clear disclaimer in the settings UI that storage backend switching is not yet active, or
3. Complete the integration.

### A6R3-02: Duplicated rate-limit Map pattern still present (carried from D44-P01) [LOW] [LOW confidence]
**File:** `apps/web/src/app/actions/images.ts` (uploadTracker), `apps/web/src/app/actions/sharing.ts` (shareRateLimit), `apps/web/src/app/actions/admin-users.ts` (userCreateRateLimit), `apps/web/src/lib/auth-rate-limit.ts` (passwordChangeRateLimit)
**Description:** This is a known deferred item (D44-P01). Each rate-limit Map duplicates the same prune/max-keys/evict-oldest pattern. The pattern is consistent and correct across all instances. Noting it again for completeness but it remains deferred.

## No New High/Critical Findings

The architecture is sound:
- Clear separation between server actions, data layer, and presentation
- React cache() for SSR deduplication
- Transactional consistency for destructive operations
- Privacy enforcement via compile-time guard on publicSelectFields
- Graceful degradation (DB unavailable fallbacks)
