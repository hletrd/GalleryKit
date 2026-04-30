# Plan 120-Deferred — Cycle 11 Round 2 Deferred Carry-Forward

**Created:** 2026-04-19 (Cycle 11, Round 2)
**Status:** DONE (deferred items documented)

---

## Cycle 11 Round 2 Review Result

1 finding deferred this cycle. Two findings (C11R2-01, C11R2-02) were implemented via plan-120.

## Deferred This Cycle

### C11R2-03: Password confirmation only checked client-side in admin user creation [LOW] [MEDIUM confidence]

- **File+line:** `apps/web/src/app/actions/admin-users.ts:87-88`
- **Original severity:** LOW, confidence MEDIUM
- **Reason for deferral:** The `createAdminUser` server action requires admin authentication. Direct API calls with a valid admin session would intentionally set whatever password is provided. Adding server-side confirmation would require sending the password twice over the wire, which is unnecessary when the client already validates. The real protection is the admin auth gate.
- **Exit criterion:** If non-admin users ever gain the ability to create accounts, this must be re-opened.

## Deferred Items (No Change from Prior Cycles)

All previously deferred items from cycles 5-39 remain deferred with no change in status (see plan README for full list).
