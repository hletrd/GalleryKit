# Verifier Review — Cycle 17

## Verification approach

Evidence-based correctness check against stated behavior. Each finding is validated against the code, not just the comments.

## Findings

### C17-VR-01: `getImage` privacy guard verified correct
- **Confidence**: High
- **Verification**: `getImage()` (data.ts:663-778) uses `publicSelectFields` which omits `latitude`, `longitude`, `filename_original`, `user_filename`, `original_format`, `original_file_size`, and `processed`. The compile-time `_privacyGuard` (line 265) enforces this at build time. The `blur_data_url` is explicitly fetched only in individual queries (line 672). **Verified correct.**

### C17-VR-02: `login` rate-limit no-rollback fix verified
- **Confidence**: High
- **Verification**: The outer try/catch in `auth.ts:243-254` catches unexpected errors and returns `{ error: t('authFailed') }` WITHOUT rolling back rate-limit counters. The comment explicitly states the reasoning (C1F-CR-04/C1F-SR-01). The test `auth-no-rollback-on-infrastructure-error.test.ts` covers this case. **Verified correct.**

### C17-VR-03: `sanitizeAdminString` null-on-rejection verified
- **Confidence**: High
- **Verification**: `sanitize.ts:156-158` returns `{ value: null, rejected: true }` when `UNICODE_FORMAT_CHARS.test(input)` is true. All callers (images.ts:697-700, topics.ts, tags.ts, seo.ts) check `rejected` and return an error. The null value prevents accidental persistence even if a caller forgets to check `rejected`. **Verified correct.**

### C17-VR-04: Image queue permanent-failure tracking verified
- **Confidence**: High
- **Verification**: `image-queue.ts:341-354` adds failed IDs to `permanentlyFailedIds` set (capped at 1000 with FIFO eviction). The bootstrap query (line 437) uses `notInArray(images.id, [...state.permanentlyFailedIds])` to exclude these IDs. `quiesceImageProcessingQueueForRestore` (line 518) clears the set on DB restore. **Verified correct.**

### C17-VR-05: View-count buffer cap enforcement verified
- **Confidence**: High
- **Verification**: `data.ts:112-126` enforces the `MAX_VIEW_COUNT_BUFFER_SIZE` cap after re-buffering by evicting oldest entries (FIFO). The `bufferGroupViewCount` function (line 46) checks capacity before adding. The retry counter (`viewCountRetryCount`) has its own cap (`MAX_VIEW_COUNT_RETRY_SIZE = 500`) with FIFO eviction (lines 152-160). **Verified correct.**

### C17-VR-06: `processImageFormats` output verification before marking processed
- **Confidence**: High
- **Verification**: `image-queue.ts:294-305` verifies all 3 output formats exist and are non-zero before the conditional UPDATE. If any file is missing, the job throws and enters the retry/permanent-failure path. This prevents marking images as "processed" when Sharp silently fails. **Verified correct.**

### C17-VR-07: `UNICODE_FORMAT_CHARS` regex without `/g` flag verified
- **Confidence**: High
- **Verification**: `validation.ts:51` uses `/[...]/` (no `g` flag) while `sanitize.ts:15` uses `/[...]/g` (with `g` flag). The comment at `sanitize.ts:144-150` explains: `test()` with `/g` is stateful (advances `lastIndex`), so the non-`/g` variant is used for `test()` calls in `sanitizeAdminString` and `containsUnicodeFormatting`. The `/g` variant is only used in `stripControlChars` which calls `.replace()`. **Verified correct.**

### C17-VR-08: `searchImages` LIKE wildcard escaping verified
- **Confidence**: High
- **Verification**: `data.ts:967` escapes `%`, `_`, and `\` before wrapping in `%...%`. The `like()` function in Drizzle ORM generates parameterized LIKE queries. **Verified correct.**

### C17-VR-09: Potential issue — `UNICODE_FORMAT_CHARS` regex in `validation.ts` vs `sanitize.ts` must stay in sync
- **Confidence**: High
- **Severity**: Low (risk)
- **Location**: `validation.ts:51` and `sanitize.ts:15`
- **Issue**: Two separate regex literals define the same character set: `UNICODE_FORMAT_CHARS` (no `/g`) in `validation.ts` and `UNICODE_FORMAT_CHARS_RE` (with `/g`) in `sanitize.ts`. If one is updated without the other, the sanitization and validation layers would disagree. The comments reference each other, but there's no compile-time enforcement of synchronization.
- **Fix**: Derive `UNICODE_FORMAT_CHARS_RE` from `UNICODE_FORMAT_CHARS` by appending the `g` flag programmatically, or define the base pattern once in `validation.ts` and import it in `sanitize.ts`.
