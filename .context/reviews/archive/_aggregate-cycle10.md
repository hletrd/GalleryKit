# Aggregate Review — Cycle 10 (2026-04-19)

## Summary

Cycle 10 deep review of the full codebase found **2 new LOW findings**. No CRITICAL or HIGH findings. No regressions from prior cycles. The codebase remains in strong shape after 37+ prior cycles of fixes. All previously fixed items (including the old C10-01 through C10-03 i18n issues) verified as resolved.

## Findings

| ID | Description | Severity | Confidence | File |
|----|------------|----------|------------|------|
| C10-F01 | `batchAddTags` returns `{ success: true }` even when all tag-image links silently fail via FK constraint | LOW | Medium | `apps/web/src/app/actions/tags.ts:222` |
| C10-F02 | Duplicated tag-filter subquery logic in `getImageCount` vs `buildTagFilterCondition` | LOW | Low | `apps/web/src/lib/data.ts:206-220 vs 230-243` |

### C10-F01: batchAddTags returns success on silent FK failures [LOW]

`INSERT IGNORE` into `imageTags` suppresses FK constraint errors. If imageIds were deleted between validation and insertion, the function returns success with no tags actually linked. Very low practical risk (race condition with deletion).

**Fix:** Verify affected rows count after insert, or fetch existing image IDs before inserting.

### C10-F02: Duplicated tag-filter subquery logic [LOW]

`getImageCount` duplicates the tag-filter subquery that `buildTagFilterCondition` already implements. DRY violation that could cause count/list inconsistencies if one is updated without the other.

**Fix:** Refactor `getImageCount` to use `buildTagFilterCondition`.

## Deferred Carry-Forward

All previously deferred items from cycles 5-37 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C9-F01: original_file_size BigInt mode: 'number' precision
- C9-F03: searchImagesAction rate limit check/increment window
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C4-F02 / C6-F04: Admin checkboxes use native `<input>` (no Checkbox component)
- C6-F03: No E2E test coverage for upload pipeline
- C7-F03: No test coverage for view count buffering system
- C7-F04: No test for search rate limit rollback logic
- C8-F01: deleteTopicAlias revalidation (informational)

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
- SQL restore scanning (sql-restore-scan.ts)

## AGENT FAILURES

None — single reviewer completed all angles.

## TOTALS

- **0 MEDIUM/HIGH** findings
- **2 LOW** findings
- **0 CRITICAL** findings
- **2 total** unique findings
