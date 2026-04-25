# Tracer — Cycle 7 (review-plan-fix loop, 2026-04-25)

## Lens

Cross-file data flow, lifecycle, callsite invariants.

## Findings

### C7L-TRACE-01 — `settleUploadTrackerClaim` call sites
- Files: `apps/web/src/app/actions/images.ts:391-397`
- Severity: INFO
- Confidence: High
- Trace: Two call sites are mutually exclusive (line 391 returns before reaching 397). Deferred plan AGG7R-21 (claiming double-settle) is closed by inspection.

### C7L-TRACE-02 — `tagsString.split(',')` flow
- Files: `apps/web/src/app/actions/images.ts:141-149`
- Severity: LOW
- Confidence: High
- Trace: `tagsString` is sanitized once via `stripControlChars(...)`. Then split twice — once for filtering, once for counting. The second split is unreachable for `tagsString === ''` because of the truthiness guard at line 147. Functionally correct, but allocation and maintenance smell.

### C7L-TRACE-03 — Upload tracker key `${userId}:${ip}` round-trip
- Files: `apps/web/src/app/actions/images.ts:174` ↔ `upload-tracker.ts:12-26`
- Severity: INFO
- Confidence: High
- Trace: `images.ts` uses `${currentUser.id}:${uploadIp}` as the tracker key. `settleUploadTrackerClaim(tracker, ip, ...)` parameter is named `ip` but accepts any string key. Name divergence is cosmetic; behavior is correct.
- Suggested fix: Rename parameter `ip` → `key` in `upload-tracker.ts:14-19`.

### C7L-TRACE-04 — `containsUnicodeFormatting` lineage call sites
- Files: 7 production call sites in actions; consolidated through `validation.ts:50-52`
- Severity: NONE
- Confidence: High
- Trace: Single helper, used everywhere. Lineage comment in `validation.ts:21-32` lists C3L through C6L. All known surfaces covered.
