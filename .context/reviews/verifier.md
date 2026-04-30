# Verifier Review — verifier (Cycle 13)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Evidence-based correctness check

### Verified behavior

1. **AGG12-01 (`batchAddTags` audit gating)**: VERIFIED — `tags.ts:329-332` gates the `tags_batch_add` audit event on `batchInsertResult.affectedRows > 0` and uses `batchInsertResult.affectedRows` as the `count` metadata. Correctly fixed.

2. **AGG11-01 (`removeTagFromImage` audit gating)**: VERIFIED — `tags.ts:254` gates the `tag_remove` audit event on `deleteResult.affectedRows > 0`. Still correct.

3. **AGG10-01 (`addTagToImage` audit gating)**: VERIFIED — `tags.ts:193` gates the `tag_add` audit event on `linkResult.affectedRows > 0`. Still correct.

4. **AGG8R-01 (stateful `/g` regex fix)**: VERIFIED — `sanitize.ts:141` uses `UNICODE_FORMAT_CHARS` (non-`/g`) for `.test()`, while `UNICODE_FORMAT_CHARS_RE` (with `/g`) is only used in `.replace()` calls. Still correct.

5. **Privacy enforcement**: `publicSelectFields` still omits all sensitive fields. Compile-time guard `_SensitiveKeysInPublic` still enforces no leakage.

6. **Auth flow**: Login rate limiting still pre-increments before Argon2 verify. Password change validates form fields before consuming rate-limit attempts.

7. **Upload flow**: Full pipeline from FormData to DB insert to queue enqueue verified. `assertBlurDataUrl` contract enforced at both producer and consumer.

8. **All audit-log gating patterns across the codebase**: Verified every `logAuditEvent` call site:
   - `tags.ts:89` (tag_update): gated by `affectedRows === 0` early return.
   - `tags.ts:128` (tag_delete): gated by `deletedRows === 0` early return.
   - `tags.ts:193` (tag_add): explicitly gated on `affectedRows > 0`.
   - `tags.ts:256` (tag_remove): explicitly gated on `affectedRows > 0`.
   - `tags.ts:331` (tags_batch_add): explicitly gated on `affectedRows > 0`.
   - `tags.ts:452` (tags_batch_update): **NOT gated** — fires when `added === 0 && removed === 0`.
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

#### C13-V-01 (Low / Low). `batchUpdateImageTags` audit log fires when `added === 0 && removed === 0` — unnecessary audit noise

- Location: `apps/web/src/app/actions/tags.ts:452`
- Verified that the `tags_batch_update` audit event fires unconditionally after the transaction. When all tag operations are no-ops (invalid names, slug collisions, or already in desired state), `added === 0 && removed === 0` but the audit event still fires. The metadata `{ added: 0, removed: 0 }` is accurate, so this is not misleading — just noisy.
- This is the last remaining audit-log site in the tag action surface that does not gate on actual mutations. The `batchAddTags` counterpart was fixed in cycle 12 (AGG12-01).
- Suggested fix: Gate the audit log on `added > 0 || removed > 0`.

## Carry-forward (unchanged — existing deferred backlog)

- C6-V-02: `bootstrapImageProcessingQueue` cursor continuation path untested.
- C4-CR-03/C5-CR-03/C6-V-01: NULL `capture_date` navigation integration test gap.
