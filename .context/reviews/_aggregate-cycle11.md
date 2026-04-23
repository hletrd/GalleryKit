# Aggregate Review — Cycle 11 (2026-04-19)

**Source reviews:** cycle11-comprehensive-review (single reviewer, multi-angle)

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

Single-reviewer cycle — no deduplication needed. All findings are from the comprehensive review.

---

## Findings

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| C11-F01 | `uploadImages` tracker adjustment may operate on stale reference after Map eviction | MEDIUM | Medium | IMPLEMENT |
| C11-F02 | `api-auth.ts` returns hardcoded English `'Unauthorized'` string | MEDIUM | High | IMPLEMENT |
| C11-F03 | `photo-viewer.tsx` has hardcoded English fallback `'Failed to share'` | LOW | High | IMPLEMENT |
| C11-F04 | `login-form.tsx` references missing `description` translation key | LOW | High | IMPLEMENT |
| C11-F05 | `deleteImages` audit log omits `notFoundCount` from metadata | LOW | Medium | IMPLEMENT |

### C11-F01: uploadImages tracker stale reference [MEDIUM]
After eviction by pruneUploadTracker, the captured `tracker` object reference may be orphaned. The additive adjustment on lines 248-249 would not reflect concurrent modifications, and `uploadTracker.set()` on line 250 would overwrite the current Map entry.

**Fix:** Re-read tracker from Map immediately before adjustment.

### C11-F02: api-auth.ts hardcoded English [MEDIUM]
`withAdminAuth` returns `{ error: 'Unauthorized' }` — all server actions use `t('unauthorized')`. The `/api/admin/db/download` route uses this wrapper.

**Fix:** Import `getTranslations` and localize the string.

### C11-F03: photo-viewer.tsx English fallback [LOW]
`toast.error(result.error || 'Failed to share')` — should use `t('viewer.errorSharing')`.

**Fix:** Replace hardcoded fallback with `t('viewer.errorSharing')`.

### C11-F04: login-form missing description key [LOW]
`<CardDescription>{t('description')}</CardDescription>` — `login.description` key missing from both locale files.

**Fix:** Add `description` key to `en.json` and `ko.json` under `login` section.

### C11-F05: deleteImages audit metadata incomplete [LOW]
Audit log records `count: successCount` but omits `notFoundCount`.

**Fix:** Add `requested` and `notFound` to audit metadata.

---

## PREVIOUSLY FIXED — Confirmed Resolved

All cycle 1-10 findings remain resolved. No regressions detected.

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

---

## AGENT FAILURES

None — single reviewer completed successfully.

---

## TOTALS

- **2 MEDIUM** findings requiring implementation
- **3 LOW** findings recommended for implementation
- **0 CRITICAL/HIGH** findings
- **5 total** actionable findings (2M + 3L)
