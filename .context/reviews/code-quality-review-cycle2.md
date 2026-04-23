# Code Quality Review — Cycle 2 (2026-04-19, New Loop)

**Reviewer:** code-quality
**Scope:** Full repository — all server actions, data layer, middleware, image processing, auth, rate limiting, upload security, DB schema, admin/public pages, API routes, and key UI components.

## Findings

### C2-01: `updateTopic` catch block uses fragile `e.message?.includes('Duplicate entry')` check [LOW, Medium Confidence]

**File:** `apps/web/src/app/actions/topics.ts:180`

**Problem:** The `updateTopic` function's catch block checks for duplicate entry using `e.message?.includes('Duplicate entry')` as a fallback, while `createTopic` (same file, line 90) and `createTopicAlias` (same file, line 257) use the more reliable `e.cause?.code === 'ER_DUP_ENTRY'` pattern. MySQL error messages can vary across versions and locales, making message-based checks fragile. This is a new instance of the same pattern previously flagged as C1N-04 for `admin-users.ts:54`.

**Current code:**
```typescript
if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.message?.includes('Duplicate entry'))) {
```

**Fix:** Replace with the consistent pattern:
```typescript
if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.cause?.code === 'ER_DUP_ENTRY')) {
```

**Failure scenario:** If MySQL changes the "Duplicate entry" message format in a future version, the fallback silently fails and the user gets a generic error instead of the specific "slug already exists" message. Low impact — the operation still fails safely, just with a less helpful error message.

---

### C2-02: `deleteTopicAlias` catch block returns misleading error for non-MySQL failures [LOW, Low Confidence]

**File:** `apps/web/src/app/actions/topics.ts:287-289`

**Problem:** The catch block in `deleteTopicAlias` returns `t('invalidAlias')` for all errors, including non-MySQL errors (e.g., DB connection failures). This could mislead debugging by suggesting the alias format is wrong when the actual issue is infrastructure.

**Fix:** Return a more generic error for non-MySQL failures, or at minimum log the actual error more prominently.

---

## Verified: Prior Cycle Findings Already Fixed

The following findings from the stale C2 reviews (prior loop) are confirmed as already fixed:

| Stale ID | Description | Verification |
|----------|-------------|--------------|
| C2-CQ-01 / C2-PERF-01 / C2-SEC-01 | uploadTracker pruning & size cap | `pruneUploadTracker()` at images.ts:27,78; `UPLOAD_TRACKER_MAX_KEYS=2000` at line 24 |
| C2-CQ-03 / C2-SEC-06 | batchUpdateImageTags tag array size validation | tags.ts:250 already checks `addTagNames.length > 100` |
| C2-CQ-09 / C2-04 | Password change separate rate-limit Map | Separate `passwordChangeRateLimit` Map in auth-rate-limit.ts |
| C2-CQ-06 / C2-PERF-02 | searchImages tag query limit | data.ts:575 already uses `effectiveLimit - results.length` |
| C2-PERF-05 | deleteImages redundant affectedTopics filter | images.ts:417 uses `imageRecords.map(r => r.topic)` directly |

## Summary

| ID | Severity | Confidence | Description | Status |
|----|----------|------------|-------------|--------|
| C2-01 | LOW | Medium | updateTopic fragile ER_DUP_ENTRY message check | Actionable |
| C2-02 | LOW | Low | deleteTopicAlias misleading error for non-MySQL failures | Actionable |

**New actionable findings:** 2 (both LOW)
