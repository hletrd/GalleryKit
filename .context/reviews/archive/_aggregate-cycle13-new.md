# Aggregate Review — Cycle 13 (2026-04-19)

**Source reviews:** cycle13-comprehensive-review (multi-angle single reviewer)

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

Single-reviewer cycle — no deduplication needed. All findings are from the comprehensive review.

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

### C13-F01: uploadTracker stale fallback when entry evicted [MEDIUM]

**File:** `apps/web/src/app/actions/images.ts:249-252`

If `pruneUploadTracker()` evicted this IP's entry during the upload loop, `uploadTracker.get(uploadIp)` returns `undefined`, and we fall back to `tracker` — the stale reference from the start. Any concurrent request's pre-increment contribution that was applied between the eviction and this write is lost.

**Fix:** Only adjust if the entry still exists in the Map:

```ts
const currentTracker = uploadTracker.get(uploadIp);
if (currentTracker) {
    currentTracker.count += (successCount - files.length);
    currentTracker.bytes += (uploadedBytes - totalSize);
    uploadTracker.set(uploadIp, currentTracker);
}
```

### C13-F02: loadMoreImages offset does not floor float values [LOW]

**File:** `apps/web/src/app/actions/public.ts:13`

`Number("1.5")` passes through as a float. Add `Math.floor`:

```ts
const safeOffset = Math.max(Math.floor(Number(offset)) || 0, 0);
```

### C13-F03: deleteImages audit-logs after transaction [LOW]

**File:** `apps/web/src/app/actions/images.ts:419-420`

Move audit log before the DB transaction, matching the single-delete pattern.

### C13-F04: createTopicAlias catch block returns misleading error [LOW]

**File:** `apps/web/src/app/actions/topics.ts:263`

The catch block returns `invalidAliasFormat` for any non-MySQL error. Return a generic error instead.

---

## PREVIOUSLY FIXED — Confirmed Resolved

All cycle 1-12 findings remain resolved. No regressions detected.

---

## DEFERRED CARRY-FORWARD

All previously deferred items from cycles 5-37 remain deferred with no change in status:

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
- C13-F05: batchUpdateImageTags N+1 queries (performance optimization)
- C13-F06: photo-viewer.tsx showLightbox effect re-registration (informational)

---

## AGENT FAILURES

None — single reviewer completed successfully.

---

## TOTALS

- **1 MEDIUM** finding requiring implementation (C13-F01)
- **3 LOW** findings recommended for implementation (C13-F02, F03, F04)
- **0 CRITICAL/HIGH** findings
- **4 total** actionable findings (1M + 3L)
