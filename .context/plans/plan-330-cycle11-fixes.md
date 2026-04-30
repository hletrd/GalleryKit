# Plan 330 — Cycle 11 Fixes

Date: 2026-04-29
Source: `.context/reviews/_aggregate-cycle11.md` (Cycle 11)
Status: Pending

## Findings to address

| ID | Description | Severity | Confidence | Status |
|---|---|---|---|---|
| AGG11-01 | `removeTagFromImage` audit log fires on no-op DELETE (tag was not linked to image) | LOW | MEDIUM | Pending |

## Implementation tasks

### Task 1: AGG11-01 — Gate `removeTagFromImage` audit log on `affectedRows > 0`

- File: `apps/web/src/app/actions/tags.ts`
- Current behavior: The `tag_remove` audit event at line 252 fires unconditionally after the DELETE, even when `deleteResult.affectedRows === 0` (the tag was not linked to the image, so the DELETE was a no-op). The code at lines 242-248 checks if the image still exists but does NOT return early or gate the audit log.
- Fix: Wrap the audit log in `if (deleteResult.affectedRows > 0)` so the `tag_remove` event is only logged when the tag was actually removed from the image. This matches the AGG10-01 fix applied to `addTagToImage` (which gates on `linkResult.affectedRows > 0`) and the `batchUpdateImageTags` pattern (line 429, which gates `removed++` on `deleteResult.affectedRows > 0`).
- Also add a comment explaining the gating, matching the AGG10-01 comment style.

## Gate verification

| Gate | Status |
|------|--------|
| eslint | Pending |
| tsc --noEmit | Pending |
| vitest | Pending |
| lint:api-auth | Pending |
| lint:action-origin | Pending |
| npm run build | Pending |

## Deferred findings carry-forward

No new deferred findings this cycle. All prior deferred items from plan-329 and earlier remain valid with no change in status.
