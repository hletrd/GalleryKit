# Plan — Cycle 13 Fixes

Date: 2026-04-29
Status: Completed

## Findings to address

### AGG13-01 (Low / Low). `batchUpdateImageTags` audit log fires when `added === 0 && removed === 0`

- **Source**: C13-CR-01, C13-SEC-01, C13-CRIT-01, C13-V-01, C13-TR-01 (5 agents)
- **File**: `apps/web/src/app/actions/tags.ts:452`
- **Issue**: The `tags_batch_update` audit event fires unconditionally after the transaction, even when no tags were actually added or removed (`added === 0 && removed === 0`). This can occur when all tag names were invalid, had slug collisions, or were already in the desired state.
- **Impact**: Low — the metadata `{ added: 0, removed: 0 }` is accurate (no false positive count), but the event is unnecessary noise. Same class as AGG10-01/AGG11-01/AGG12-01.
- **Fix**: Gate the audit log on `added > 0 || removed > 0`.

### AGG13-02 (Low / Low). No unit test for `batchUpdateImageTags` audit-log gating on zero-mutation path

- **Source**: C13-TE-01 (1 agent)
- **File**: `apps/web/src/__tests__/tags-actions.test.ts`
- **Issue**: No test verifies that `batchUpdateImageTags` does NOT log a `tags_batch_update` event when all tag operations are no-ops.
- **Fix**: Add a test case where all addTagNames/removeTagNames are invalid, verify `added: 0, removed: 0`, and assert no `tags_batch_update` audit event was logged.

## Implementation plan

1. Edit `apps/web/src/app/actions/tags.ts:452` — wrap the `logAuditEvent` call in a guard: `if (added > 0 || removed > 0)`.
2. Add a test case in `apps/web/src/__tests__/tags-actions.test.ts` for the zero-mutation audit-log gating.

## Deferred findings (not addressed this cycle)

None new. All carry-forward deferred items from prior cycles remain unchanged.

## Exit criteria

- [x] `batchUpdateImageTags` audit log gated on `added > 0 || removed > 0`
- [x] Test case added for zero-mutation audit-log gating
- [x] All gates pass: eslint, tsc --noEmit, build, vitest, lint:api-auth, lint:action-origin
- [x] Changes committed and pushed
