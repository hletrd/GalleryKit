# Verifier Review — verifier (Cycle 14)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Evidence-based correctness check

### Verified behavior

1. **AGG13-01 (`batchUpdateImageTags` audit gating)**: VERIFIED — `tags.ts:457-460` gates the `tags_batch_update` audit event on `added > 0 || removed > 0` and uses `{ added, removed }` as the metadata. Correctly fixed.

2. **AGG12-01 (`batchAddTags` audit gating)**: VERIFIED — `tags.ts:329-332` gates the `tags_batch_add` audit event on `batchInsertResult.affectedRows > 0`. Still correct.

3. **AGG11-01 (`removeTagFromImage` audit gating)**: VERIFIED — `tags.ts:254` gates the `tag_remove` audit event on `deleteResult.affectedRows > 0`. Still correct.

4. **AGG10-01 (`addTagToImage` audit gating)**: VERIFIED — `tags.ts:193` gates the `tag_add` audit event on `linkResult.affectedRows > 0`. Still correct.

5. **AGG8R-01 (stateful `/g` regex fix)**: VERIFIED — `sanitize.ts:141` uses `UNICODE_FORMAT_CHARS` (non-`/g`) for `.test()`, while `UNICODE_FORMAT_CHARS_RE` (with `/g`) is only used in `.replace()` calls. Still correct.

6. **Privacy enforcement**: `publicSelectFields` still omits all sensitive fields. Compile-time guard `_SensitiveKeysInPublic` still enforces no leakage.

7. **Auth flow**: Login rate limiting still pre-increments before Argon2 verify. Password change validates form fields before consuming rate-limit attempts.

8. **Upload flow**: Full pipeline from FormData to DB insert to queue enqueue verified. `assertBlurDataUrl` contract enforced at both producer and consumer.

9. **All audit-log gating patterns across the codebase**: Re-verified every `logAuditEvent` call site — all confirmed correctly gated per the patterns established in cycles 10-13. No new ungated sites found.

### Full audit-log site inventory (re-verified)

- `tags.ts:89` (tag_update): gated by `affectedRows === 0` early return.
- `tags.ts:128` (tag_delete): gated by `deletedRows === 0` early return.
- `tags.ts:193` (tag_add): explicitly gated on `affectedRows > 0`.
- `tags.ts:256` (tag_remove): explicitly gated on `affectedRows > 0`.
- `tags.ts:331` (tags_batch_add): explicitly gated on `affectedRows > 0`.
- `tags.ts:458` (tags_batch_update): explicitly gated on `added > 0 || removed > 0`.
- `images.ts:414` (image_upload): gated by `successCount === 0` early return.
- `images.ts:496` (image_delete): gated by `deletedRows > 0`.
- `images.ts:603` (images_batch_delete): gated by `deletedRows > 0`.
- `images.ts:735` (image_update): gated by `affectedRows === 0` early return.
- `sharing.ts:134` (share_create): inside `affectedRows > 0` block.
- `sharing.ts:265` (group_share_create): inside successful transaction path.
- `sharing.ts:330` (share_revoke): gated by `affectedRows === 0` early return.
- `sharing.ts:373` (group_share_delete): gated by `GROUP_NOT_FOUND` throw.
- `db-actions.ts:104` (csv_export): acceptable — `rowCount: 0` is accurate metadata.
- `db-actions.ts:226` (db_backup): after successful dump.
- `db-actions.ts:487` (db_restore): after successful restore.
- `topics.ts:141` (topic_create): after successful insert.
- `topics.ts:286` (topic_update): after successful lock+update.
- `topics.ts:356` (topic_delete): gated by `deletedRows > 0`.
- `topics.ts:418` (topic_alias_create): after successful insert.
- `topics.ts:480-481` (topic_alias_delete): gated on `affectedRows > 0`.
- `settings.ts:151` (gallery_settings_update): after successful transaction.
- `seo.ts:145` (seo_settings_update): after successful transaction.
- `admin-users.ts:142` (user_create): gated on `Number.isFinite(newUserId) && newUserId > 0`.
- `admin-users.ts:232` (user_delete): after successful transaction commit.
- `auth.ts` login/logout/password_change: auth-flow events, correctly gated.

### New Findings

#### C14-V-01 (Low / Low). `audit.ts` metadata `preview` truncation may produce invalid JSON fragment

- Location: `apps/web/src/lib/audit.ts:29-33`
- The code-point slicing at line 30-32 produces a raw character slice of the stringified JSON. This slice is wrapped inside `JSON.stringify({ truncated: true, preview: ... })`, but the `preview` value itself is not valid JSON — it's a fragment. While `JSON.stringify` will properly escape the fragment, the resulting `preview` string is meaningless as structured data.
- This is a diagnostic quality issue, not a correctness bug. The `truncated: true` flag is present.
- Suggested fix: Append `"…"` or truncate at a key boundary.

## Carry-forward (unchanged — existing deferred backlog)

- C6-V-02: `bootstrapImageProcessingQueue` cursor continuation path untested.
- C4-CR-03/C5-CR-03/C6-V-01: NULL `capture_date` navigation integration test gap.
