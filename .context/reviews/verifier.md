# Verifier Review — verifier (Cycle 12)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Evidence-based correctness check

### Verified behavior

1. **AGG11-01 (`removeTagFromImage` audit gating)**: VERIFIED — `tags.ts:254` gates the `tag_remove` audit event on `deleteResult.affectedRows > 0`. When DELETE is a no-op (tag not linked), no audit event is recorded.

2. **AGG10-01 (`addTagFromImage` audit gating)**: VERIFIED — `tags.ts:193` gates the `tag_add` audit event on `linkResult.affectedRows > 0`. When INSERT IGNORE is a no-op (duplicate), no audit event is recorded.

3. **AGG10-02/AGG10-03 (`.length` safety documentation)**: VERIFIED — `validation.ts:22-24` documents `.length` safety for `isValidSlug` (ASCII regex). `validation.ts:99-103` documents `.length` safety for `isValidTagSlug` (BMP-normalized slugs).

4. **AGG9R-02 (`withAdminAuth` origin check)**: VERIFIED — `api-auth.ts:31-37` checks `hasTrustedSameOrigin(request.headers)` before `isAdmin()`. Returns 403 on failure.

5. **Privacy enforcement**: `publicSelectFields` still omits all sensitive fields. Compile-time guard `_SensitiveKeysInPublic` still enforces no leakage.

6. **Auth flow**: Login rate limiting still pre-increments before Argon2 verify. Password change validates form fields before consuming rate-limit attempts.

7. **Upload flow**: Full pipeline from FormData to DB insert to queue enqueue verified. `assertBlurDataUrl` contract enforced at both producer and consumer.

8. **All audit-log gating patterns**: Verified that `deleteTag` (line 128) only fires after the `deletedRows === 0` early return (line 122), so it's implicitly gated. Same for `updateTag` (line 89) after the `affectedRows === 0` early return (line 85-86). `deleteTopic` (line 356) is explicitly gated on `deletedRows > 0`. `deleteTopicAlias` (line 479) is explicitly gated on `delResult.affectedRows > 0`.

### New Findings

#### C12-V-01 (Low / Medium). `batchAddTags` audit log fires on INSERT IGNORE no-ops — same class as AGG10-01/AGG11-01

- Location: `apps/web/src/app/actions/tags.ts:327`
- Verified that `db.insert(imageTags).ignore().values(values)` at line 324 returns `affectedRows === 0` when all rows are duplicates. The audit log at line 327 fires unconditionally. The `batchUpdateImageTags` at line 414 correctly gates `added++` on `tagInsertResult.affectedRows > 0`, but `batchAddTags` does not gate its audit log. The `count` metadata uses `existingIds.size` (candidate count) instead of actual rows inserted.
- Suggested fix: Gate the audit log on `affectedRows > 0` and use the actual count in metadata.

## Carry-forward (unchanged — existing deferred backlog)

- C6-V-02: `bootstrapImageProcessingQueue` cursor continuation path untested.
- C4-CR-03/C5-CR-03/C6-V-01: NULL `capture_date` navigation integration test gap.
