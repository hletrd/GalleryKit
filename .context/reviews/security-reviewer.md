# Security Reviewer — Cycle 9

## C9-SR-01 (Medium): Advisory lock names are scattered string literals — risk of accidental collision

**File+line**: Multiple files:
- `apps/web/src/app/[locale]/admin/db-actions.ts:280` — `gallerykit_db_restore`
- `apps/web/src/lib/upload-processing-contract-lock.ts` — `gallerykit_upload_processing_contract`
- `apps/web/src/app/actions/topics.ts:55` — `gallerykit_topic_route_segments`
- `apps/web/src/app/actions/admin-users.ts:209` — `gallerykit_admin_delete:${id}`
- `apps/web/src/lib/image-queue.ts:153` — `gallerykit:image-processing:${jobId}`

Lock names are defined as inline string literals in separate files. A new contributor could accidentally reuse a name. C8R-RPL-06 / AGG8R-05 already notes these locks are scoped to the MySQL server, not the database. Centralizing the names into a shared constants module would reduce collision risk and improve auditability.

**Confidence**: Medium
**Fix**: Extract all advisory lock name patterns to a shared `@/lib/advisory-locks.ts` module.

## C9-SR-02 (Low): `searchImages` LIKE patterns are correctly escaped

**File+line**: `apps/web/src/lib/data.ts:1048-1049`

Verified that `%`, `_`, and `\` are correctly escaped before wrapping with `%...%`. No issue found.

## C9-SR-03 (Low): Session token verification uses `timingSafeEqual` — confirmed correct

**File+line**: `apps/web/src/lib/session.ts:117`

Verified HMAC signature comparison uses `timingSafeEqual`. No issue found.
