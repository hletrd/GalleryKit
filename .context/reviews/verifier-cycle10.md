# Verifier Review — verifier (Cycle 10)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Evidence-based correctness check

### Verified behavior

1. **AGG9R-01 (countCodePoints for DoS bounds)**: VERIFIED — `images.ts:139` uses `countCodePoints(tagsString) > 1000`. `public.ts:117` uses `countCodePoints(sanitizedQuery) > 200`. Imports present in both files.

2. **AGG9R-02 (withAdminAuth origin check)**: VERIFIED — `api-auth.ts:31-37` checks `hasTrustedSameOrigin(request.headers)` before `isAdmin()`. Returns 403 JSON on failure. The redundant check in `/api/admin/db/download/route.ts` was removed.

3. **AGG9R-03 (username .length documentation)**: VERIFIED — `admin-users.ts:98-100` has comment explaining `.length` is correct for ASCII-validated usernames.

4. **C10R3-01 (OG route topic validation)**: VERIFIED — `og/route.tsx:32` validates `topic` against `isValidSlug()` and checks length. Returns 400 if invalid.

5. **C10R3-02 (OG route tag validation)**: VERIFIED — `og/route.tsx:74` filters tags through `isValidTagName(t)`.

6. **C10R3-03 (deleteAdminUser affectedRows)**: VERIFIED — `admin-users.ts:227-229` checks `Number(deleteResult.affectedRows ?? 0) === 0` and throws `USER_NOT_FOUND` before the audit log.

7. **Privacy enforcement**: `publicSelectFields` still omits all sensitive fields. Compile-time guard `_SensitiveKeysInPublic` still enforces no leakage.

8. **Auth flow**: Login rate limiting still pre-increments before Argon2 verify. Password change validates form fields before consuming rate-limit attempts.

9. **Upload flow**: Full pipeline from FormData to DB insert to queue enqueue verified. `assertBlurDataUrl` contract enforced at both producer and consumer.

### New Findings

#### C10-V-01 (Low / Medium). `addTagToImage` audit log fires on INSERT IGNORE no-op — same class as C10R3-03

- Location: `apps/web/src/app/actions/tags.ts:191`
- Verified that `db.insert(imageTags).ignore()` at line 176 returns `affectedRows === 0` for duplicate rows. The audit log at line 191 fires unconditionally. The `batchUpdateImageTags` at line 403-404 correctly gates `added++` on `affectedRows > 0`, but the standalone `addTagToImage` does not gate its audit log.
- Suggested fix: Gate the audit log on `linkResult.affectedRows > 0`.

## Carry-forward (unchanged — existing deferred backlog)

- C6-V-02: `bootstrapImageProcessingQueue` cursor continuation path untested.
- C4-CR-03/C5-CR-03/C6-V-01: NULL `capture_date` navigation integration test gap.
