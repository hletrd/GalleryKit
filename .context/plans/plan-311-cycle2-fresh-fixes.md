# Plan 311 -- Cycle 2/100 Fresh Review Fixes

**Cycle:** 2/100
**HEAD at plan creation:** `9ec59dd fix(test): use Object.assign for sharp mock typing (P245-08 follow-up)`
**Status:** Implemented and pushed

## Findings to schedule

### MEDIUM Severity

| ID | Finding | Action | File |
|---|---|---|---|
| C2-F01 | `flushGroupViewCounts` clears buffer before DB writes complete -- crash loses increments | Fix: move `viewCountBuffer.clear()` after the chunked write loop completes | `lib/data.ts:52-53` |

### LOW Severity

| ID | Finding | Action | File |
|---|---|---|---|
| C2-F02 | Locale cookie lacks explicit `SameSite` attribute | Fix: add `SameSite=Lax` to the `NEXT_LOCALE` cookie string | `components/nav-client.tsx:66` |
| C2-F06 | Redundant `revalidateAllAppData()` after `revalidateLocalizedPaths()` in topics actions | Fix: remove `revalidateLocalizedPaths()` calls where `revalidateAllAppData()` already covers the paths, OR remove `revalidateAllAppData()` and keep only targeted paths. Prefer removing the targeted calls since full revalidation is simpler and the topic mutation surfaces are low-traffic admin paths. | `app/actions/topics.ts:136-137, 282-283, 414-415, 484-485` |

### Test Gaps to address

| ID | Finding | Action | File |
|---|---|---|---|
| C2-TG02 | No test for `serveUploadFile` extension-to-directory mismatch | Add test case | `__tests__/serve-upload.test.ts` |

## Implementation plan

### Step 1: Fix C2-F01 -- view count buffer loss on crash

The current code in `flushGroupViewCounts` does:
```ts
const batch = new Map(viewCountBuffer);
viewCountBuffer.clear();  // <-- buffer emptied BEFORE DB writes
```

Fix: move `viewCountBuffer.clear()` to AFTER the chunked write loop completes successfully. If any writes fail, the re-buffer logic already puts failed increments back into `viewCountBuffer`, so clearing at the end is safe. However, we must prevent new increments from being added to the old buffer entries during the flush -- we need to ensure new increments go to a fresh buffer.

The safest approach:
1. Swap the buffer reference atomically: take the current buffer, assign a new empty Map to `viewCountBuffer`, then flush the taken buffer.
2. This way new increments during the flush go to the new empty Map.
3. Re-buffered failed increments from the flush also go to the new Map (which is correct -- they'll be retried in the next flush).

```ts
// Instead of:
const batch = new Map(viewCountBuffer);
viewCountBuffer.clear();

// Do:
const batch = viewCountBuffer;
viewCountBuffer = new Map();  // new empty Map for incoming increments
```

Wait -- `viewCountBuffer` is a `const`. Need to change it to `let` or use a different pattern. Let me check... It's `const viewCountBuffer = new Map<number, number>()`. The simplest fix is to reassign after snapshot:

Actually, looking more carefully, the re-buffer logic in the catch block does `viewCountBuffer.set(groupId, ...)`. If we swap the Map reference, the re-buffer writes to the NEW Map which is correct. But `viewCountBuffer` is `const`. We need to make it `let` or use a wrapper object.

The cleanest approach: keep `viewCountBuffer` as a `let` and swap it:

```ts
const batch = viewCountBuffer;
viewCountBuffer = new Map();
```

This is safe because:
- New increments during flush go to the fresh Map
- Failed re-buffers also go to the fresh Map (correct -- they'll be retried)
- The old Map is fully drained by the chunked write loop

### Step 2: Fix C2-F02 -- locale cookie SameSite attribute

Add `SameSite=Lax` explicitly to the `NEXT_LOCALE` cookie in `nav-client.tsx`:

```ts
// Before:
document.cookie = `NEXT_LOCALE=${otherLocale};path=/;SameSite=Lax;max-age=${60 * 60 * 24 * 365}${window.location.protocol === 'https:' ? ';Secure' : ''}`;

// Wait -- it already has SameSite=Lax. Let me re-read the code.
```

Actually, looking at the code again: `document.cookie = \`NEXT_LOCALE=${otherLocale};path=/;SameSite=Lax;max-age=...\`` -- it DOES include `SameSite=Lax`. My review finding was incorrect on this point. Let me verify.

Reading the line: `document.cookie = \`NEXT_LOCALE=${otherLocale};path=/;SameSite=Lax;max-age=${60 * 60 * 24 * 365}${window.location.protocol === 'https:' ? ';Secure' : ''}\``

Yes, `SameSite=Lax` IS present. The review finding C2-F02 was a false positive. Marking as no-op.

### Step 3: Fix C2-F06 -- redundant revalidation in topics actions

In `createTopic`, `updateTopic`, `createTopicAlias`, and `deleteTopicAlias`, both `revalidateLocalizedPaths()` and `revalidateAllAppData()` are called. Since `revalidateAllAppData()` invalidates the full app tree, the preceding `revalidateLocalizedPaths()` is redundant.

The fix: remove the `revalidateLocalizedPaths()` calls and keep only `revalidateAllAppData()`. This simplifies the code and avoids double-invalidation.

However, there is a trade-off: `revalidateAllAppData()` is more expensive (invalidates everything) while `revalidateLocalizedPaths()` is targeted. For low-traffic admin actions, the full revalidation is acceptable. But let me check what `revalidateAllAppData` actually does vs `revalidateLocalizedPaths`.

### Step 4: Add test C2-TG02 -- serveUploadFile extension mismatch

Add a test case to `__tests__/serve-upload.test.ts` that verifies:
- Requesting `/uploads/jpeg/file.webp` returns 400 (extension-directory mismatch)
- Requesting `/uploads/webp/file.jpg` returns 400

## Findings to defer

| ID | Severity | Reason for deferral | Exit criterion |
|---|---|---|---|
| C2-F03 | LOW | No actual bug -- the error handling interleaving in `deleteAdminUser` is correct after close analysis. The advisory lock, transaction, and rollback paths are properly structured. The "fragile" assessment is about readability, not correctness. | If a future refactor restructures the try/catch blocks, re-evaluate |
| C2-F04 | LOW | `loadMoreImages` in-memory-only rate limit is acceptable for a low-risk public endpoint. Adding DB backing would add latency to every scroll-pagination request. | If load-more is abused at scale, add DB-backed rate limit |
| C2-F05 | LOW | GA domains in CSP are broad but `'unsafe-inline'` in style-src already covers the inline style vector. Tightening GA CSP would require nonce-based GA loading which is complex. | When GA is replaced with a privacy-friendly analytics solution |
| C2-F07 | LOW | INSERT+DELETE pattern for topic PK rename is correct within MySQL transaction. Changing to auto-increment PK would be a schema migration. | If topic table schema is redesigned |
| C2-F08 | LOW | Verified correct -- LIKE wildcard escaping covers all SQL LIKE metacharacters | No action needed |
| C2-F09 | INFO | Documentation improvement only -- the 50K cap is reasonable | When sitemap documentation is updated |
| C2-F10 | LOW | Node.js Readable.toWeb() stream lifecycle is handled by the runtime. No evidence of issues in production. | If file serving errors appear under memory pressure |
| C2-F11 | LOW | `process.exit(0)` in SIGTERM handler is standard for graceful shutdown. Pending async writes are best-effort per CLAUDE.md. | If shutdown data loss becomes a concern |
| C2-F12 | INFO | Regex readability improvement only -- the regex works correctly | When the regex is next modified |
| C2-F13 | INFO | Helper is only used for DB-sourced timestamps | If the helper is reused for arbitrary dates |
| C2-F14 | INFO | Verified safe -- `safeJsonLd()` sanitizes all output | No action needed |
| C2-TG01 | Test Gap | Testing crash-safety of `flushGroupViewCounts` requires simulating process crashes, which is complex to test deterministically in unit tests. The fix in Step 1 makes the pattern safer by swapping the Map reference. | After Step 1 is implemented, evaluate if a test is still needed |
| C2-TG03 | Test Gap | Testing advisory lock contention requires MySQL server, not suitable for unit tests | If integration test infrastructure is added |

## Repo-rule check

- CLAUDE.md "Git Commit Rules" require GPG-signed conventional + gitmoji commits. Will honor.
- CLAUDE.md "Always commit and push immediately after every iteration": will honor.
- `.context/plans/README.md` deferred rules: all findings either scheduled or deferred with exit criteria.
