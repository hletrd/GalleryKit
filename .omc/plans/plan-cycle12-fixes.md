# Plan — Cycle 12 Fixes

Date: 2026-04-29
Status: IN PROGRESS

## Source: Aggregate review AGG12-01

## Must-fix (none — no CRITICAL/HIGH)

None.

## Should-fix (none — no MEDIUM with HIGH confidence)

None.

## Consider-fix (LOW — batch into polish patch)

### Task 1: Gate `batchAddTags` audit log on `affectedRows > 0` (AGG12-01)

**File:** `apps/web/src/app/actions/tags.ts:327`
**Severity:** LOW / Confidence: MEDIUM
**Cross-agent:** 4 agents (code-reviewer, security-reviewer, critic, verifier)

The `batchAddTags` function at line 324 uses `db.insert(imageTags).ignore().values(values)`. When all rows are duplicates (tag already linked to all images), `affectedRows === 0` and no tags were actually linked, but the audit log at line 327 fires unconditionally with `count: existingIds.size`. The `batchUpdateImageTags` function (same file, line 414) correctly gates `added++` on `tagInsertResult.affectedRows > 0`, but `batchAddTags` does not gate its audit log.

This is the same class of issue as AGG10-01 (fixed for `addTagToImage` in cycle 10) and AGG11-01 (fixed for `removeTagFromImage` in cycle 11), but the batch-add counterpart was missed.

**Implementation:**
1. Capture the INSERT IGNORE result to get `affectedRows`
2. Gate the audit log on `affectedRows > 0`
3. Update the `count` metadata to use the actual `affectedRows` value instead of `existingIds.size`

**Code change:**

Before:
```typescript
await db.insert(imageTags).ignore().values(values);

const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'tags_batch_add', 'image', undefined, undefined, { count: existingIds.size, tag: cleanName }).catch(console.debug);
```

After:
```typescript
const [batchInsertResult] = await db.insert(imageTags).ignore().values(values);

// AGG12-01: only log the audit event when tags were actually linked.
// INSERT IGNORE returns affectedRows === 0 for duplicate rows, meaning
// no tags_batch_add event occurred.
if (batchInsertResult.affectedRows > 0) {
    const currentUser = await getCurrentUser();
    logAuditEvent(currentUser?.id ?? null, 'tags_batch_add', 'image', undefined, undefined, { count: batchInsertResult.affectedRows, tag: cleanName }).catch(console.debug);
}
```

**Progress:**
- [ ] Implement the affectedRows gating
- [ ] Run existing tests to verify no regression
- [ ] Run all gates

## Deferred (not implementing this cycle)

None new this cycle. All prior deferred items from `.omc/plans/plan-deferred-items.md` remain unchanged.
