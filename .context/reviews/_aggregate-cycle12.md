# Aggregate Review — Cycle 12 (2026-04-19)

**Source reviews:** cycle12-comprehensive-review (single reviewer, multi-angle)

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

Single-reviewer cycle — no deduplication needed. All findings are from the comprehensive review.

---

## Findings

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| C12-F01 | `db-actions.ts` exposes `e instanceof Error ? e.message : 'Unknown error'` to client in toast messages | MEDIUM | High | IMPLEMENT |
| C12-F02 | `uploadImages` disk space check uses dynamic `import('fs/promises')` on every invocation | LOW | Medium | IMPLEMENT |
| C12-F03 | `deleteTopicAlias` missing `/admin/tags` revalidation (inconsistent with other topic ops) | LOW | High | IMPLEMENT |
| C12-F04 | `db-actions.ts` backup writeStream error swallowing during flush returns success on corrupt file | LOW | High | IMPLEMENT |
| C12-F05 | `photo-viewer.tsx` keyboard handler stale closure — informational only | LOW | Low | DEFER |

### C12-F01: Error message leakage in DB admin page [MEDIUM]

**File:** `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:51,80,112`

Catch blocks in backup/restore/export handlers expose raw error messages to the client UI. Server errors could contain DB hostnames, file paths, or stack trace fragments.

**Fix:** Replace `e instanceof Error ? e.message : 'Unknown error'` with `t('errorUnknown')` or just omit the raw error from toast.

### C12-F02: Dynamic import on every upload invocation [LOW]

**File:** `apps/web/src/app/actions/images.ts:91-93`

`await import('fs/promises')` for `statfs` is unnecessary since Node.js 24+ guarantees availability.

**Fix:** Use top-level static import.

### C12-F03: deleteTopicAlias missing /admin/tags revalidation [LOW]

**File:** `apps/web/src/app/actions/topics.ts:295`

`deleteTopicAlias` does not revalidate `/admin/tags`, while `createTopic` and `updateTopic` do. Inconsistency risk.

**Fix:** Add `/admin/tags` to revalidation paths.

### C12-F04: Backup writeStream error swallowing during flush [LOW]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:154`

`writeStream.on('error', resolveFlush)` silently resolves the promise even if the backup file is corrupt/truncated, leading to `{ success: true }` on a bad backup.

**Fix:** Track writeStream errors via a flag; return failure if the error occurred.

---

## PREVIOUSLY FIXED — Confirmed Resolved

All cycle 1-11 findings remain resolved. No regressions detected.

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

---

## AGENT FAILURES

None — single reviewer completed successfully.

---

## TOTALS

- **1 MEDIUM** finding requiring implementation (C12-F01)
- **3 LOW** findings recommended for implementation (C12-F02, F03, F04)
- **0 CRITICAL/HIGH** findings
- **4 total** actionable findings (1M + 3L)
