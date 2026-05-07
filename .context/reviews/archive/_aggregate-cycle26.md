# Aggregate Review — Cycle 26 (2026-04-19)

**Source reviews:** comprehensive-review-cycle26 (single reviewer, multi-angle deep review)

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

Single-reviewer cycle — no deduplication needed. All findings are from the comprehensive review.

---

## PRIORITY REMEDIATION ORDER

### LOW Severity

1. **C26-02**: `passwordChangeRateLimit` uses `LOGIN_RATE_LIMIT_MAX_KEYS` instead of its own constant. If the login cap is changed, the password change cap would change inadvertently. Fix: add `PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS` constant. (`apps/web/src/lib/auth-rate-limit.ts`, line 66)

2. **C26-05**: `searchImagesAction` DB increment (`incrementRateLimit`) runs AFTER the DB-backed check, and even runs when the check returns "limited". This causes the DB counter to overcount compared to the in-memory counter. Other actions (`sharing.ts`, `admin-users.ts`) correctly run `incrementRateLimit` BEFORE the DB check. Fix: move `incrementRateLimit` before the DB check or skip it when limited. (`apps/web/src/app/actions/public.ts`, lines 62-87)

---

## PREVIOUSLY FIXED — Confirmed Resolved (Verified This Cycle)

All prior C26 findings from the stale aggregate are already fixed in the current codebase:
- C26-01: `deleteTag` already has explicit imageTags deletion in transaction
- C26-02: `deleteGroupShareLink` already revalidates `/admin/dashboard`
- C26-03: `exportImagesCsv` already has `logAuditEvent`
- C26-04: `batchUpdateImageTags` already fetches topic and revalidates
- C26-05: position dedup is correct
- C26-06: `handleAddAlias` captures `aliasValue` at function start
- C26-07: `photoId` already has `/^\d+$/` regex check
- C26-08: CLAUDE.md already says "10 connections"

All C25 findings (C25-09, C25-10, C25-11) remain resolved.

---

## DEFERRED / NOT ACTIONABLE

- C26-01 (renumbered from comprehensive review): `adminSelectFields` docs-code mismatch — documentation only, no data leak
- C26-03 (renumbered): `toISOString` timezone drift in EXIF fallback — rare code path, self-documenting
- C26-04 (renumbered): View count re-buffer on deleted groups — self-limiting via exponential backoff
- C26-06 (renumbered): CSV export GC hint — cosmetic, no bug

---

## AGENT FAILURES

None — review completed successfully.

---

## TOTALS

- **0 CRITICAL/HIGH** findings
- **0 MEDIUM** findings
- **2 LOW** findings (actionable: C26-02, C26-05)
- **4 NOT-A-BUG** observations
