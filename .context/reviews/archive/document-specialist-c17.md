# Document Specialist Review — Cycle 17

## Code-documentation consistency check

### D1: CLAUDE.md "Image Processing Pipeline" section accuracy

**Claim**: "Sharp processes to AVIF/WebP/JPEG in parallel (Promise.all) at configurable sizes each (default: 640, 1536, 2048, 4096)"

**Verification**: `process-image.ts` uses `Promise.all` for the 3 format conversions. The default sizes are defined in `gallery-config-shared.ts` and can be overridden via admin settings. The `imageSizes` parameter is passed through the queue job. **Accurate.**

### D2: CLAUDE.md "Race Condition Protections" — advisory lock scope note

**Claim**: "MySQL advisory lock names are scoped to the MySQL SERVER, not to an individual database."

**Verification**: This is documented in the "Advisory-lock scope note" section. The lock names (`gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit:image-processing:{jobId}`) all share the `gallerykit` prefix. **Accurate.**

### D3: CLAUDE.md "Permanently Deferred" — 2FA/WebAuthn

**Claim**: "Not planned. Single-user admin with Argon2id + rate limiting is sufficient."

**Verification**: The codebase now supports multi-admin (plural) via `adminUsers` table. The "single-user admin" characterization is slightly outdated — it's now "multiple root admins". However, the deferral rationale (complexity without proportional benefit for a personal gallery) still holds. **Minor inaccuracy.**

### D4: CLAUDE.md "Runtime topology" — "single web-instance / single-writer"

**Claim**: The shipped Docker Compose deployment is a single web-instance / single-writer topology.

**Verification**: The `viewCountBuffer`, `processingQueueState`, and `uploadTracker` are all module-level closures (process-local). `permanentlyFailedIds` is a `Set<number>` on `globalThis`. None of these survive process restarts or are shared across processes. **Accurate.**

### D5: CLAUDE.md "Performance Optimizations" — "React cache() wraps getImage"

**Claim**: `getImage`, `getTopicBySlug`, `getTopicsWithAliases` are wrapped with `React.cache()` for SSR deduplication.

**Verification**: `data.ts:1089-1095` exports `getImageCached`, `getTopicBySlugCached`, `getTopicsCached`, `getTopicsWithAliasesCached`, `getTagsCached`, `getSeoSettings` — all wrapped with `cache()`. Also `getImageByShareKeyCached` and `getSharedGroupCached`. **Accurate.**

## Findings

### C17-DS-01: CLAUDE.md says "single-user admin" but codebase supports multiple root admins
- **Confidence**: High
- **Severity**: Low
- **Location**: CLAUDE.md "Permanently Deferred" section
- **Issue**: The deferral note says "Single-user admin with Argon2id + rate limiting is sufficient for a personal gallery." The codebase has had multi-admin support since early cycles (adminUsers table, user management UI). The rationale still holds (no role/capability model), but the wording should say "multiple root admins" instead of "single-user admin".
- **Fix**: Update the deferral note to say "Multiple root admins with Argon2id + rate limiting is sufficient for a personal gallery."

### C17-DS-02: CLAUDE.md "Key Files & Patterns" table is missing `auth-rate-limit.ts`
- **Confidence**: High
- **Severity**: Low
- **Location**: CLAUDE.md "Key Files & Patterns" table
- **Issue**: The table lists `proxy.ts`, `data.ts`, `image-queue.ts`, etc., but does not list `auth-rate-limit.ts` which contains the account-scoped rate limiting and password-change rate limiting logic. This file is security-critical and should be in the table.
- **Fix**: Add `auth-rate-limit.ts` to the Key Files table with description "Account-scoped and password-change rate limiting (in-memory Maps with DB backup for login)".
