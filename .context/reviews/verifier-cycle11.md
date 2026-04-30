# Verifier Review — verifier (Cycle 11)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Evidence-based correctness check

### Verified behavior

1. **AGG10-01 (`addTagToImage` audit gating)**: VERIFIED — `tags.ts:193` gates the `tag_add` audit event on `linkResult.affectedRows > 0`. When INSERT IGNORE is a no-op (duplicate), no audit event is recorded.

2. **AGG10-02/AGG10-03 (`.length` safety documentation)**: VERIFIED — `validation.ts:22-24` documents `.length` safety for `isValidSlug` (ASCII regex). `validation.ts:99-103` documents `.length` safety for `isValidTagSlug` (BMP-normalized slugs).

3. **AGG9R-02 (`withAdminAuth` origin check)**: VERIFIED — `api-auth.ts:31-37` checks `hasTrustedSameOrigin(request.headers)` before `isAdmin()`. Returns 403 on failure.

4. **Privacy enforcement**: `publicSelectFields` still omits all sensitive fields. Compile-time guard `_SensitiveKeysInPublic` still enforces no leakage.

5. **Auth flow**: Login rate limiting still pre-increments before Argon2 verify. Password change validates form fields before consuming rate-limit attempts.

6. **Upload flow**: Full pipeline from FormData to DB insert to queue enqueue verified. `assertBlurDataUrl` contract enforced at both producer and consumer.

### New Findings

#### C11-V-01 (Low / Medium). `removeTagFromImage` audit log fires on no-op DELETE — same class as AGG10-01

- Location: `apps/web/src/app/actions/tags.ts:252`
- Verified that `db.delete(imageTags)` at line 236 returns `affectedRows === 0` when the tag was not linked to the image. The code checks image existence at lines 242-248 but does NOT gate the audit log at line 252. The `batchUpdateImageTags` at line 429 correctly gates `removed++` on `deleteResult.affectedRows > 0`, but the standalone `removeTagFromImage` does not gate its audit log.
- Suggested fix: Gate the audit log on `deleteResult.affectedRows > 0`.

## Carry-forward (unchanged — existing deferred backlog)

- C6-V-02: `bootstrapImageProcessingQueue` cursor continuation path untested.
- C4-CR-03/C5-CR-03/C6-V-01: NULL `capture_date` navigation integration test gap.
