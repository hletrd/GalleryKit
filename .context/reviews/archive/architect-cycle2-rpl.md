# architect — cycle 2 rpl

HEAD: `00000006e`.

## Architectural posture

### ARCH2R-01 — Provenance check is layered at the wrong boundary for mutations
- **Observation:** the repository has two defense-in-depth layers for auth: (a) `proxy.ts` middleware redirects unauth'd admin HTML routes; (b) `withAdminAuth` wraps `/api/admin/*` route handlers. Server actions are a third boundary, and the only one where `hasTrustedSameOrigin` is inconsistently applied.
- **Architectural risk:** the `'use server'` directive is a trust boundary in the Next.js app-router model. Today, that boundary has one consistent gate (`isAdmin()`) and one inconsistent gate (`hasTrustedSameOrigin`). A consistent wrapper (a `withServerActionGuard` helper) would centralize these checks and prevent drift.
- **Severity / confidence:** MEDIUM / MEDIUM.
- **Fix:** factor a single helper that takes the request's locale-level t(), runs `isAdmin()`, runs `hasTrustedSameOrigin(headers)`, and runs `getRestoreMaintenanceMessage`, returning early with a localized `{ error: ... }` on any failure. Apply everywhere. This is essentially the same as CR2R-02 but framed as a "boundary wrapper" rather than "add a call site".

### ARCH2R-02 — Duplicate error-guard boilerplate across every mutating server action
- **Observation:** every mutating action opens with the same three checks (isAdmin → restoreMaintenance → some form of input validation). Origin check would be the fourth. Adding them inline keeps local reasoning simple, but increases surface area for drift.
- **Mitigation pattern:** a wrapper `withAdminServerAction(t, handler)` or similar. Optional — repo style currently inlines these for readability. Not urgent.

### ARCH2R-03 — `in-memory` rate-limit maps duplicated across 4 files
- Pre-existing observation (matches plan-142). Not new. Re-confirmed.

### ARCH2R-04 — The privacy field guard uses a TypeScript compile-time assertion
- **Observation:** `apps/web/src/lib/data.ts:197-200` is an excellent defense — any future addition of a sensitive key to `publicSelectFields` fails at compile time with a named error message. This is idiomatic and correct.
- **Fix:** none. Architectural praise only.

### ARCH2R-05 — `restoreDatabase` properly quiesces queues and flushes buffered view counts before swapping DB state
- **Observation:** `apps/web/src/app/[locale]/admin/db-actions.ts:273-293` — before starting the restore, the code flushes the buffered view-count map and quiesces the image-processing queue, then resumes after restore. This is the correct shape for a long-running maintenance window and the advisory-lock choreography is sound.
- **Fix:** none. Praise.

## Summary
Two substantive findings: ARCH2R-01 (mutation-surface provenance boundary) — agrees with code-reviewer / security-reviewer / critic / tracer / debugger. ARCH2R-02 is a framing note.
