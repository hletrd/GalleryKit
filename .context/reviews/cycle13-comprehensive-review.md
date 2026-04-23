# Comprehensive Code Review — Cycle 13 (2026-04-19)

**Reviewer:** Multi-angle deep review (code quality, security, performance, i18n, architecture)
**Scope:** Full repository — all server actions, data layer, middleware, UI components, security modules

---

## Methodology

Every source file under `apps/web/src/` was examined, including:
- All 7 server action modules (`actions/*.ts`)
- Data layer (`lib/data.ts`), schema (`db/schema.ts`)
- Security modules (`session.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `validation.ts`, `sql-restore-scan.ts`, `serve-upload.ts`)
- Image processing pipeline (`process-image.ts`, `image-queue.ts`, `process-topic-image.ts`)
- All React components
- All unit test files
- i18n message files (`en.json`, `ko.json`)
- Middleware (`proxy.ts`), admin DB actions, instrumentation

Previous cycle findings (C1 through C12) were checked for regressions — none found. All deferred items were reviewed for relevance.

---

## Findings

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| C13-F01 | `uploadTracker` adjustment uses stale fallback when entry evicted during upload loop | MEDIUM | High | IMPLEMENT |
| C13-F02 | `loadMoreImages` offset does not floor float values | LOW | High | IMPLEMENT |
| C13-F03 | `deleteImages` audit-logs after transaction (inconsistent with single `deleteImage`) | LOW | High | IMPLEMENT |
| C13-F04 | `createTopicAlias` catch block returns misleading `invalidAliasFormat` for non-MySQL errors | LOW | High | IMPLEMENT |
| C13-F05 | `batchUpdateImageTags` N+1 queries inside transaction | LOW | Medium | DEFER |
| C13-F06 | `photo-viewer.tsx` keyboard effect re-registers on `showLightbox` changes | LOW | Low | DEFER |

---

### C13-F01: uploadTracker stale fallback when entry evicted [MEDIUM]

**File:** `apps/web/src/app/actions/images.ts:249-252`

After the upload loop, the tracker is adjusted:
```ts
const currentTracker = uploadTracker.get(uploadIp) || tracker;
currentTracker.count += (successCount - files.length);
currentTracker.bytes += (uploadedBytes - totalSize);
uploadTracker.set(uploadIp, currentTracker);
```

If `pruneUploadTracker()` evicted this IP's entry during the upload loop (called on line 78 at the start, but the upload loop can take seconds), `uploadTracker.get(uploadIp)` returns `undefined`, and we fall back to `tracker` — the stale reference captured at line 79. The adjustment adds `(successCount - files.length)` and `(uploadedBytes - totalSize)` to the stale tracker values, then writes stale+adjustment back to the Map. Any concurrent request's pre-increment contribution that was applied between the eviction and this write is lost.

**Concrete scenario:** Admin uploads from IP A. During the long upload loop (processing multiple files), `pruneUploadTracker()` runs on a subsequent request from another IP. IP A's entry was old enough (>2x window) to be evicted. Now `uploadTracker.get('A')` returns `undefined`, fallback to `tracker` (which has the pre-incremented values from the start of *this* request), and any concurrent request from IP A that also pre-incremented between the eviction and this line has its contribution silently overwritten.

**Fix:** If the entry was evicted, don't adjust — the entry is already gone:

```ts
const currentTracker = uploadTracker.get(uploadIp);
if (currentTracker) {
    currentTracker.count += (successCount - files.length);
    currentTracker.bytes += (uploadedBytes - totalSize);
    uploadTracker.set(uploadIp, currentTracker);
}
```

---

### C13-F02: loadMoreImages offset does not floor float values [LOW]

**File:** `apps/web/src/app/actions/public.ts:13`

```ts
const safeOffset = Math.max(Number(offset) || 0, 0);
```

`Number("1.5")` is `1.5`, and `Math.max(1.5, 0)` is `1.5`. MySQL will truncate to an integer, but this is implicit. While the DoS protection on line 15 (`safeOffset > 10000`) still works, passing a float to the DB is sloppy. The type signature says `offset: number`, but server action callers could pass a float.

**Fix:** Add `Math.floor`:

```ts
const safeOffset = Math.max(Math.floor(Number(offset)) || 0, 0);
```

---

### C13-F03: deleteImages audit-logs after transaction [LOW]

**File:** `apps/web/src/app/actions/images.ts:419-420`

`deleteImage` (single) logs the audit event *before* the DB transaction (line 311), with the comment: "Logging here ensures the audit is recorded even if concurrent deletion causes the transaction to delete 0 rows."

`deleteImages` (batch) logs the audit event *after* the DB transaction (line 420). If the transaction deletes 0 rows (all images already deleted by another admin), the audit log still fires with `count: foundIds.length` which counts *found* IDs, not actually deleted rows. This is inconsistent with the single-delete pattern.

**Fix:** Move the audit log before the transaction, matching the single-delete pattern. Place it after the queue state cleanup (line 393) and before the transaction (line 396).

---

### C13-F04: createTopicAlias catch block returns misleading error [LOW]

**File:** `apps/web/src/app/actions/topics.ts:263`

```ts
return { error: t('invalidAliasFormat') };
```

The catch block at the end of `createTopicAlias` returns `invalidAliasFormat` for any non-ER_DUP_ENTRY, non-ER_NO_REFERENCED_ROW_2 error. A transient DB connection error would show "Invalid alias format" to the user, which is misleading.

**Fix:** Return a generic error message:

```ts
console.error('Failed to create topic alias:', e);
return { error: t('failedToCreateTopic') }; // or add a new t('failedToCreateAlias') key
```

---

### C13-F05: batchUpdateImageTags N+1 queries [DEFERRED]

**File:** `apps/web/src/app/actions/tags.ts:282-314`

Inside the transaction, tag names are iterated one-by-one, each performing 2-3 queries. For 20 add + 20 remove tags, that is ~80 queries in a single transaction, holding it open longer than necessary.

**Deferral reason:** Performance optimization, not a correctness issue. The transaction is necessary for atomicity. Typical tag counts are < 10. Batch INSERT/SELECT would require significant restructuring. Exit criterion: if admin UI shows noticeable latency with > 20 tags, re-evaluate.

---

### C13-F06: photo-viewer.tsx keyboard effect re-registration [DEFERRED]

**File:** `apps/web/src/components/photo-viewer.tsx:109-152`

The keyboard `useEffect` depends on `[navigate, showLightbox]`. `showLightbox` changes frequently, causing unnecessary effect re-registration. The closure values are always fresh because `navigate` captures current state.

**Deferral reason:** No user-visible bug. Performance impact is negligible (adding/removing one event listener). Exit criterion: if performance profiling shows this as a hot path, re-evaluate.

---

## Previously Fixed — Confirmed Resolved

All cycle 1-12 findings remain resolved. No regressions detected:
- C12-F01 (error message leakage): Fixed in bd111fb
- C12-F02 (dynamic import): Fixed in 2f674a2
- C12-F03 (deleteTopicAlias revalidation): Fixed in a407aeb
- C12-F04 (writeStream error swallowing): Fixed in 81b9acd

---

## Areas Reviewed With No New Issues Found

- **Session management** (`session.ts`): HMAC-SHA256 signing, timing-safe comparison, 24-hour expiry, production SESSION_SECRET requirement
- **Path traversal prevention** (`serve-upload.ts`, `validation.ts`): SAFE_SEGMENT regex, ALLOWED_UPLOAD_DIRS, resolvedPath.startsWith, symlink rejection
- **SQL injection prevention** (`sql-restore-scan.ts`): Dangerous SQL pattern scanning with comment/literal stripping
- **CSRF protection**: Cookie sameSite lax, httpOnly, secure flag conditional on HTTPS
- **Race condition protections**: Queue claim checks, conditional updates, transactional deletes, INSERT IGNORE + re-fetch
- **Rate limiting**: Pre-increment TOCTOU fix, DB-backed + in-memory dual layer, hard caps on map sizes
- **Image processing pipeline**: Sharp limitInputPixels, ICC bounds checking, queue claim mechanism, orphaned file cleanup
- **Data privacy**: GPS coordinates excluded from public API, filename_original excluded, compile-time privacy guard
- **CSV injection prevention**: Formula character prefix, CR/LF stripping
- **Argon2 timing-safe user enumeration**: Dummy hash for non-existent users
- **Upload tracker**: Pre-increment + post-adjust pattern, hard cap on keys

---

## DEFERRED CARRY-FORWARD

All previously deferred items remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03 / C7-F01: `flushGroupViewCounts` re-buffers without retry limit
- C30-04 / C36-02 / C8-01: `createGroupShareLink` insertId validation / BigInt coercion
- C9-F01: original_file_size bigint mode: 'number' precision [MEDIUM]
- C9-F03: searchImagesAction rate limit check/increment window [LOW]
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C4-F02 / C6-F04: Admin checkboxes use native `<input>` (no Checkbox component)
- C6-F03: No E2E test coverage for upload pipeline
- C7-F03: No test coverage for view count buffering system
- C7-F04: No test for search rate limit rollback logic
- C8-F01: deleteTopicAlias revalidation (informational)
- C12-F05: photo-viewer.tsx keyboard handler stale closure (informational)
- C13-F05: batchUpdateImageTags N+1 queries (performance)
- C13-F06: photo-viewer.tsx showLightbox effect re-registration (informational)

---

## TOTALS

- **1 MEDIUM** finding requiring implementation (C13-F01)
- **3 LOW** findings recommended for implementation (C13-F02, F03, F04)
- **2 LOW** findings deferred (C13-F05, C13-F06)
- **0 CRITICAL/HIGH** findings
- **4 total** actionable findings (1M + 3L)
