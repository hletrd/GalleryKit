# Tracer — Cycle 20

## Review Scope
Causal tracing of suspicious data flows, competing hypotheses for failure modes, and invariant violation analysis.

## Traced Flow: Upload Tracker Adjustment

### Hypothesis H1: Differential adjustment produces negative count when all uploads fail
**Trace**:
1. Admin uploads 50 files (files.length = 50)
2. Line 127: `tracker.count += files.length` → count = 50
3. Line 128: `tracker.bytes += totalSize` → bytes = 5GB (example)
4. All 50 files fail (successCount = 0, uploadedBytes = 0)
5. Line 275: `currentTracker.count += (0 - 50)` → count = 0 + (-50) = -50
6. Line 276: `currentTracker.bytes += (0 - 5GB)` → bytes = 5GB + (-5GB) = 0 (happens to be correct here)
7. Next upload: `tracker.count + newFiles.length` = -50 + 50 = 0 → not over limit → proceeds
8. Effectively, the admin gets 50 free uploads in the next window

**Competing Hypothesis H2: The pre-increment + adjustment is intentionally designed to be self-correcting**
- The comment says "Use additive adjustment instead of absolute assignment to avoid overwriting concurrent requests"
- The design intent is correct for the concurrent case, but the implementation doesn't clamp to 0
- H1 is confirmed: the negative count is a bug, not intentional design

**Verdict**: H1 confirmed. Fix: clamp both count and bytes to 0.

## Traced Flow: deleteAdminUser No-Op Success

### Hypothesis H3: Transaction returns success without verifying deletion
**Trace**:
1. Admin A opens user management page, sees user ID=5
2. Admin B deletes user ID=5 (succeeds)
3. Admin A clicks "Delete" for user ID=5
4. Transaction: `SELECT count(*) FROM adminUsers` → count=3 (not 1, so not last admin)
5. Transaction: `DELETE FROM sessions WHERE userId = 5` → 0 rows affected (already deleted by cascade)
6. Transaction: `DELETE FROM adminUsers WHERE id = 5` → 0 rows affected (already gone)
7. Function returns `{ success: true }` — misleading

**Verdict**: H3 confirmed. The function should check affected rows.

## Summary

Two traced flows confirmed:
1. Upload tracker negative count (5+ agent agreement) — MEDIUM severity
2. deleteAdminUser no-op success (3 agent agreement) — LOW severity
