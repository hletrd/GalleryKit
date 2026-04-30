# Verifier Review — Cycle 13 (verifier)

## Review Scope
Evidence-based correctness verification of stated behavior, prior fix validation, contract enforcement.

## Findings

### C13-VF-01: Verified — `restoreDatabase` `endRestoreMaintenance()` called in `finally` block
- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:332`
- **Severity**: N/A | **Confidence**: High
- **Issue**: Confirming the C12-MED-01 FALSE POSITIVE finding. The inner `finally` at line 332 calls `endRestoreMaintenance()`, which executes before the `catch` block's `return` completes (JavaScript `finally` semantics). The code is correct.

### C13-VF-02: Verified — `enqueueImageProcessing` skips permanently-failed images
- **File+line**: `apps/web/src/lib/image-queue.ts:218-221`
- **Severity**: N/A | **Confidence**: High
- **Issue**: Confirming the C11-MED-02 fix. The `permanentlyFailedIds.has(job.id)` check at line 218 prevents re-enqueue of permanently failed images. The check occurs before the `enqueued.has(job.id)` duplicate check at line 222, ensuring permanently failed IDs are filtered even if they somehow leave the enqueued set.

### C13-VF-03: Verified — `uploadImages` validates topic existence
- **File+line**: `apps/web/src/app/actions/images.ts:244-250`
- **Severity**: N/A | **Confidence**: High
- **Issue**: Confirming the C11-MED-01 fix. The topic existence check at line 244 prevents uploads to deleted topics. The check uses a direct DB query (`db.select({ slug: topics.slug }).from(topics).where(eq(topics.slug, topic))`) before the upload loop.

### C13-VF-04: Verified — `buildCursorCondition` dated branch includes `isNotNull` guards
- **File+line**: `apps/web/src/lib/data.ts:564-569`
- **Severity**: N/A | **Confidence**: High
- **Issue**: Confirming the C10-LOW-01 fix. The dated branch includes `isNotNull(images.capture_date)` guards on all conditions that compare capture_date values. This matches the pattern in `getImage` adjacency queries.

### C13-VF-05: `sanitizeAdminString` returns `value: null` when `rejected: true` — contract verified
- **File+line**: `apps/web/src/lib/sanitize.ts:168-169`
- **Severity**: Medium | **Confidence**: High
- **Issue**: The C1F-CR-08 / C1F-TE-05 contract states that `sanitizeAdminString` returns `value: null` when Unicode formatting characters are detected (rejected=true). This prevents callers from accidentally persisting a visually-identical stripped string. I verified the code returns `null` (not `undefined` or the stripped value). However, the corresponding test file `sanitize-admin-string.test.ts` should explicitly assert `value === null` (not just `rejected === true`) to lock this contract. This matches C13-TE-03.
- **Fix**: Add explicit null-value assertion in test.

## Summary
- Total findings: 5 (4 verified-as-correct confirmations, 1 new test gap)
- MEDIUM: 1 (C13-VF-05 — test should assert null contract)
- All prior fixes verified as still intact
