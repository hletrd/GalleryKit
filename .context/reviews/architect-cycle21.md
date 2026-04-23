# Architecture Review — Cycle 21

**Reviewer:** architect
**Date:** 2026-04-19

## Review Scope

Full repository scan focusing on architectural/design risks, coupling, layering.

## Findings

### ARCH-21-01: `data.ts` remains a god module — known deferred item, no change [INFO]
- **File:** `apps/web/src/lib/data.ts`
- **Description:** This file (718 lines) handles image queries, topic queries, tag queries, shared group queries, search, sitemap, SEO settings, and view count buffering. This is a known deferred item (ARCH-38-03). No new architectural risks introduced this cycle.

### ARCH-21-02: Rate limit pattern duplicated across 4 modules [LOW] [HIGH confidence]
- **File:** `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/rate-limit.ts`
- **Description:** The pre-increment + DB-check + rollback-on-failure pattern is implemented independently in login, password change, admin user creation, and share link creation. Each has its own in-memory Map, prune function, and DB fallback. The logic is identical except for the window/max/constants. This is a DRY violation that increases the chance of bugs when the pattern is updated (e.g., the rollback logic was missing in one module before cycle 7 fixed it).
- **Concrete failure scenario:** A security fix is applied to the login rate-limit rollback logic but not to the share-link rate-limit because the developer didn't realize they were duplicated.
- **Fix:** Extract a shared `RateLimitGuard` class or higher-order function that encapsulates the pre-increment/check/rollback pattern. Each action would call it with its own parameters.
- **Status:** DEFERRED — matches existing CRI-38-01 DRY concern. Re-noted for visibility.

### ARCH-21-03: Storage backend abstraction is well-implemented [INFO]
- **File:** `apps/web/src/lib/storage/index.ts`, `apps/web/src/lib/storage/local.ts`, `apps/web/src/lib/storage/minio.ts`, `apps/web/src/lib/storage/s3.ts`
- **Description:** The storage backend abstraction cleanly separates local, MinIO, and S3 implementations behind a common interface. The `switchStorageBackend` function properly validates backend names and the `updateGallerySettings` roll-back on switch failure is correctly implemented. Good architectural pattern.

## Summary
- 0 CRITICAL findings
- 0 MEDIUM findings
- 1 LOW finding (DRY violation in rate limit — re-flagged)
- 2 INFO findings
