# Plan 121-Deferred — Cycle 12 Round 2 Deferred Carry-Forward

**Created:** 2026-04-19 (Cycle 12, Round 2)
**Status:** DONE (deferred items documented)

---

## Cycle 12 Round 2 Review Result

2 findings deferred this cycle. Two findings (C12R2-01, C12R2-04) were implemented via plan-121.

## Deferred This Cycle

### C12R2-03: dumpDatabase/dumpRestore stderr logging may leak credentials [LOW] [MEDIUM confidence]

- **File+line:** `apps/web/src/app/[locale]/admin/db-actions.ts:142,331`
- **Original severity:** LOW, confidence MEDIUM
- **Reason for deferral:** Requires a MySQL misconfiguration to trigger. The admin is already authenticated. Log sanitization would reduce diagnostic value. Low risk since production MySQL errors rarely include passwords in stderr.
- **Exit criterion:** If DB credentials are ever found in production logs, this must be re-opened.

### C12R2-06: shareRateLimit has no DB persistence — resets on restart [LOW] [LOW confidence]

- **File+line:** `apps/web/src/app/actions/sharing.ts:22`
- **Original severity:** LOW, confidence LOW
- **Reason for deferral:** Share creation requires admin auth. The rate limit is defense-in-depth against accidental bulk creation, not security-critical. C12R2-04 addresses the TOCTOU issue which is more impactful. Adding full DB persistence for share rate limits adds complexity without proportional benefit.
- **Exit criterion:** If share operations become available to non-admin users, this must be re-opened.

## Deferred Items (No Change from Prior Cycles)

All previously deferred items from cycles 5-39 remain deferred with no change in status (see plan README for full list).
