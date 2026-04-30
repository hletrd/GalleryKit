# Plan 78 — Cycle 32 Fixes

**Created:** 2026-04-19 (Cycle 32)
**Status:** Completed

## Overview

Address findings from cycle 32 comprehensive review. Two actionable fixes plus deferred items.

## Tasks

### Task 1: Fix CLAUDE.md connection pool documentation mismatch [C32-01]

**File:** `CLAUDE.md` (Connection pool section)
**Severity:** MEDIUM, High Confidence

The CLAUDE.md states "Connection pool: 8 connections, queue limit 20" but the actual code uses `connectionLimit: 10` in `apps/web/src/db/index.ts:18`.

**Implementation:**
1. Update the CLAUDE.md "Connection pool" reference from "8 connections" to "10 connections" to match the actual code.

### Task 2: Wrap `getCurrentUser()` in try-catch in `restoreDatabase` close callback [C32-02]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts`, lines 325-326
**Severity:** LOW, Medium Confidence

The `restoreDatabase` close callback calls `getCurrentUser()` directly without error handling. If `getCurrentUser()` throws (e.g., DB temporarily unavailable after a restore), the promise rejects and the client sees a generic error despite the restore succeeding. The `dumpDatabase` function was hardened with the same fix in cycle 31 (C31-01/C31-05).

**Implementation:**
1. Wrap `getCurrentUser()` and `logAuditEvent()` in try-catch, matching the `dumpDatabase` pattern:

```ts
// Before (line 325-326):
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'db_restore', 'database', DB_NAME).catch(console.debug);

// After:
try {
    const currentUser = await getCurrentUser();
    logAuditEvent(currentUser?.id ?? null, 'db_restore', 'database', DB_NAME).catch(console.debug);
} catch (err) {
    console.debug('Failed to log audit event for restore:', err);
}
```

## Completion Criteria

- [x] Task 1: CLAUDE.md already reflects connectionLimit: 10 (already fixed in prior cycle — false positive)
- [x] Task 2: restoreDatabase wraps getCurrentUser in try-catch
- [x] All changes GPG-signed and pushed
