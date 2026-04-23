# Aggregate Review — Cycle 18 (2026-04-19)

**Source reviews:** Comprehensive deep review of all key source files (single-reviewer cycle)

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

Single-reviewer cycle — no deduplication needed. All findings are from the comprehensive review.

---

## NEW FINDINGS

### C18-01: Share rate limit and user-create rate limit don't roll back in-memory counter when DB-backed check returns "limited" [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/sharing.ts` lines 63-75, `apps/web/src/app/actions/admin-users.ts` lines 70-85
- **Description**: Both `createPhotoShareLink`/`createGroupShareLink` and `createAdminUser` use a two-phase rate limit: (1) in-memory pre-increment, then (2) DB-backed increment + check. When the DB-backed check returns `dbLimit.limited`, the action returns an error but does NOT roll back the in-memory pre-increment. This causes the in-memory counter to over-count by 1 per rejected request, leading to premature rate limiting. The search rate limit (`public.ts` lines 64-76) correctly rolls back the in-memory counter, making this an inconsistency.
- **Fix**: Add in-memory rollback when the DB-backed check returns "limited", matching the pattern in `searchImagesAction` (public.ts lines 64-76).

### C18-02: `stripControlChars` does not strip `\x7F` (DEL character) [LOW] [LOW confidence]
- **File**: `apps/web/src/lib/sanitize.ts` line 8
- **Description**: The regex `/[\x00-\x08\x0B\x0C\x0E-\x1F]/g` strips ASCII control characters but skips `\x7F` (DEL). DEL character can cause display anomalies in some contexts. Extremely unlikely to appear in user-submitted text from browser forms.
- **Fix**: Extend the regex to include `\x7F`: `/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g`

### C18-03: `uploadImages` GPS stripping defaults to "keep" when DB is unavailable [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/images.ts` lines 146-154
- **Description**: When `getGalleryConfig()` throws (DB unavailable), GPS coordinates are not stripped from uploaded images. A stricter privacy posture would strip GPS by default when the admin-configured setting cannot be verified. Since only admins can see GPS data currently, the risk is minimal, but this could become a privacy leak if future code accidentally exposes GPS in a public query.
- **Fix**: Change the catch block to strip GPS by default when the config cannot be read.

---

## PREVIOUSLY FIXED — Confirmed Resolved

All cycle 1-17 findings remain resolved. No regressions detected. Key items re-verified:
- C17-01 (rate limit rollback): In-memory pre-increment kept on DB failure. Confirmed fixed.
- C17-02 (seo.ts control chars): `stripControlChars()` applied. Confirmed fixed.
- C17-03 (settings.ts control chars): `stripControlChars()` applied. Confirmed fixed.
- All prior findings (C1-C16, C38-C39) remain resolved per prior cycle re-verification.

Prior C18 findings from earlier run (admin-user-manager try/finally, image-manager try/finally, etc.) all confirmed fixed.

---

## DEFERRED CARRY-FORWARD

All previously deferred items remain unchanged. See `.omc/plans/plan-deferred-items.md` for the full list.

---

## AGENT FAILURES

None — direct review completed successfully.

---

## TOTALS

- **0 CRITICAL/HIGH** findings
- **0 MEDIUM** findings
- **3 LOW** findings (C18-01, C18-02, C18-03)
- **3 total** new findings
