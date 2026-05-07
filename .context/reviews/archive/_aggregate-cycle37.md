# Aggregate Review — Cycle 37 (2026-04-19)

## Summary

Cycle 37 review of the full codebase found **0 new actionable issues**. No CRITICAL or HIGH findings. No regressions from prior cycles. The codebase remains in strong shape after 36 prior cycles of fixes.

## Findings

No new findings this cycle.

## Deferred Carry-Forward

All previously deferred items from cycles 5-36 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)

## Review Coverage

- All server actions (auth, images, topics, tags, sharing, admin-users, public)
- Middleware (proxy.ts)
- Data layer (data.ts, cache deduplication, view count buffering)
- Image processing pipeline (process-image.ts, image-queue.ts)
- Auth & session management (session.ts, api-auth.ts)
- Rate limiting (rate-limit.ts, auth-rate-limit.ts)
- Upload security (serve-upload.ts, upload-limits.ts)
- DB schema (schema.ts)
- Admin pages (dashboard, db, password, users, categories, tags)
- Public pages (photo, shared group, shared photo, topic, home)
- API routes (health, og, db download)
- Instrumentation & graceful shutdown
- Validation (validation.ts)
- Audit logging (audit.ts)
- i18n & locale paths
- Frontend components (image-manager, photo-viewer, tag-input, etc.)
- SQL restore scanning (sql-restore-scan.ts)
