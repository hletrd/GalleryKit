# Aggregate Review — Cycle 29 (2026-04-19) — Updated

**Source reviews:** fresh deep code review of all source files

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

Single-reviewer cycle — no deduplication needed.

---

## PREVIOUSLY FIXED (from prior cycle 29 aggregate)

- **C29-01** (dumpDatabase audit logging) — FIXED: `logAuditEvent` present at line 175
- **C29-02** (createPhotoShareLink revalidation) — FIXED: `/admin/dashboard` present at line 111
- **C29-03** (revokePhotoShareLink revalidation) — FIXED: `/admin/dashboard` present at line 268
- **C29-04** (batchUpdateImageTags revalidation) — FIXED: `/admin/tags` present at line 361
- **C29-05** (password change rate limit keys constant) — FIXED: dedicated `PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS` constant at line 56
- **C29-06** (audit log purge mechanism) — FIXED: `purgeOldAuditLog` called from hourly GC at lines 295, 300

---

## PRIORITY REMEDIATION ORDER — NEW FINDINGS

### MEDIUM Severity

1. **C29-07**: ~~`admin-users.ts` `checkUserCreateRateLimit` does not roll back the in-memory pre-increment~~ — ALREADY FIXED in prior cycle. Roll-back logic is present at lines 80-89. Withdrawn on re-inspection.

### LOW Severity

2. **C29-08**: `serve-upload.ts` calls `path.extname(filename)` twice for the same file — once for directory-extension validation (line 45) and again for content-type lookup (line 82). Fix: extract the extension once and reuse. **FIXED** in commit 00000006.

3. **C29-09**: `seo.ts` `updateSeoSettings` validates field lengths on the raw unsanitized input, then sanitizes with `stripControlChars` inside the transaction. Fix: sanitize before length validation. **FIXED** in commit 00000006.

---

## DEFERRED CARRY-FORWARD

All previously deferred items from cycles 5-28 remain deferred with no change in status.

---

## AGENT FAILURES

None — single reviewer completed successfully.

---

## TOTALS

- **0 CRITICAL/HIGH** findings
- **1 MEDIUM** finding (withdrawn — already fixed)
- **2 LOW** findings (fixed)
- **3 total** findings (1 withdrawn, 2 fixed)
