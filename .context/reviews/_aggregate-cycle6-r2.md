# Aggregate Review — Cycle 6 Round 2 (2026-04-19)

**Source reviews:** cycle6-r2-code-reviewer, cycle6-r2-security-reviewer, cycle6-r2-perf-reviewer, cycle6-r2-architect, cycle6-r2-debugger, cycle6-r2-designer, cycle6-r2-test-engineer, cycle6-r2-verifier, cycle6-r2-critic, cycle6-r2-tracer, cycle6-r2-document-specialist

## Summary

Cycle 6 Round 2 deep multi-agent review found **15 new findings** (4 HIGH, 6 MEDIUM, 5 LOW). The dominant theme is that the StorageBackend abstraction and Gallery Settings features were shipped as incomplete integrations — the code exists but nothing uses it.

## Findings

| ID | Description | Severity | Confidence | File(s) | Reviewers |
|----|------------|----------|------------|---------|-----------|
| C6R2-F01 | StorageBackend abstraction exists but zero callers use it — dead code layer | HIGH | HIGH | `lib/storage/*.ts`, `lib/process-image.ts`, `lib/image-queue.ts`, `lib/serve-upload.ts`, `app/actions/images.ts` | code, architect, verifier, critic, tracer |
| C6R2-F02 | `switchStorageBackend` leaves app in broken state on init failure — no rollback | HIGH | HIGH | `lib/storage/index.ts:78-119` | debugger, security, tracer |
| C6R2-F03 | Gallery config settings have no effect on processing pipeline — quality, sizes, concurrency are all hard-coded | HIGH | HIGH | `lib/gallery-config.ts`, `lib/process-image.ts` | architect, verifier, tracer, critic |
| C6R2-F04 | Zero tests for StorageBackend abstraction (4 files, ~580 lines) | HIGH | HIGH | `lib/storage/*.ts` | test-engineer |
| C6R2-F05 | Storage backend switch has no credential validation — S3 client created with empty credentials | MEDIUM | HIGH | `lib/storage/s3.ts:57-78`, `app/actions/settings.ts:73-78` | security |
| C6R2-F06 | `settings-client.tsx` uses raw `<button>` toggle instead of Switch component — missing aria-label | MEDIUM | HIGH | `app/[locale]/admin/(protected)/settings/settings-client.tsx:211-219` | code, designer |
| C6R2-F07 | `settings-client.tsx` uses native `<select>` instead of shadcn/ui Select | MEDIUM | HIGH | `app/[locale]/admin/(protected)/settings/settings-client.tsx:277-286` | code, designer |
| C6R2-F08 | Duplicate UPLOAD_ROOT derivation in 3 files | MEDIUM | HIGH | `lib/process-image.ts:35-45`, `lib/storage/local.ts:17-27`, `lib/serve-upload.ts:8-9` | code, critic |
| C6R2-F09 | `selectFields` compile-time guard doesn't prevent per-query spread override | MEDIUM | MEDIUM | `lib/data.ts:92-139` | security |
| C6R2-F10 | `serve-upload.ts` reads from local filesystem regardless of storage backend | MEDIUM | HIGH | `lib/serve-upload.ts:27-98` | security |
| C6R2-F11 | S3 `writeStream` materializes entire file in memory (200MB) instead of streaming | MEDIUM | HIGH | `lib/storage/s3.ts:95-115` | perf |
| C6R2-F12 | `statfs` disk check always checks local disk regardless of storage backend | MEDIUM | MEDIUM | `app/actions/images.ts:91-98` | debugger, tracer |
| C6R2-F13 | S3 `deleteMany` uses individual deletes instead of batch `DeleteObjectsCommand` | LOW | MEDIUM | `lib/storage/s3.ts:182-186` | perf |
| C6R2-F14 | Zero tests for settings/SEO server actions | LOW | HIGH | `app/actions/settings.ts`, `app/actions/seo.ts` | test-engineer |
| C6R2-F15 | CLAUDE.md and storage JSDoc don't document integration gap | LOW | MEDIUM | `CLAUDE.md`, `lib/storage/index.ts` | document-specialist |

### C6R2-F01: StorageBackend is dead code — no consumers (HIGH)

Flagged by 5 reviewers. The entire StorageBackend abstraction (types, local, s3, minio, index) is never called by any production code path. All file operations still use direct `fs` via `UPLOAD_DIR_*` constants. The admin can "switch" backends in settings but the switch has no effect.

**Fix:** This is a large integration pass. See plan in PROMPT 2.

### C6R2-F02: Storage backend switch has no rollback on failure (HIGH)

Flagged by 3 reviewers. When `switchStorageBackend()` is called and the new backend's `init()` fails, the old backend has already been disposed and the new (broken) backend is stored in the singleton. The app enters a permanently broken state until server restart. The error is swallowed at the call site in `actions/settings.ts`.

**Fix:** Roll back to the old backend on init failure. Validate credentials before switching. Return error from settings action if switch fails.

### C6R2-F03: Gallery settings have no effect on processing pipeline (HIGH)

Flagged by 4 reviewers. The admin settings page lets users configure image quality (WebP/AVIF/JPEG), image sizes, queue concurrency, max file size, and max files per batch. None of these are read by the actual processing pipeline. All values are hard-coded or read from env vars.

**Fix:** Integrate `getGalleryConfig()` into `processImageFormats()` and queue initialization.

### C6R2-F04: Zero tests for StorageBackend (HIGH)

4 files, ~580 lines of new code with zero test coverage. Key untested paths include path traversal prevention, S3 error handling, stream conversion, and singleton state management.

## Cross-Agent Agreement

- **C6R2-F01** flagged by 5 reviewers (code, architect, verifier, critic, tracer) — strongest signal
- **C6R2-F02** flagged by 3 reviewers (debugger, security, tracer)
- **C6R2-F03** flagged by 4 reviewers (architect, verifier, critic, tracer)
- **C6R2-F09** same finding as C6-F01 but with additional analysis showing the compile-time guard is insufficient

## Previously Fixed — Confirmed Resolved

- C5-F02/C6-F02: `home-client.tsx` file-level eslint-disable — confirmed removed
- C6-F01: `selectFields` privacy — compile-time guard added (partial fix, see C6R2-F09)

## Deferred Carry-Forward

All previously deferred items from cycles 5-6 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C4-F02 / C6-F04: Admin checkboxes use native `<input>` (no Checkbox component)
- C4-F03: `isReservedTopicRouteSegment` rarely used
- C4-F05: `loadMoreImages` offset cap may allow expensive tag queries
- C4-F06: `processImageFormats` creates 3 sharp instances (informational)
- C6-F03: Missing E2E tests for upload pipeline

## AGENT FAILURES

None — all 11 review agents completed successfully.

## TOTALS

- **4 HIGH** findings requiring implementation
- **6 MEDIUM** findings recommended for implementation
- **5 LOW** findings for backlog
- **15 total** unique findings
