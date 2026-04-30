# Plan 87 — Cycle 1 (New Loop) Deferred Carry-Forward

**Created:** 2026-04-19 (Cycle 1, New Loop)
**Status:** DONE (informational and risk findings deferred)

---

## Cycle 1 Review Result

3 actionable issues found and scheduled for fix (Plans 85-86). 7 informational/risk findings and 4 test coverage gaps deferred.

## Informational / Risk Findings (Deferred)

### C1N-01: No HTML sanitization on title/description before storage [LOW, Medium Confidence]
**File:** `apps/web/src/app/actions/images.ts:434`
**Reason:** React auto-escapes JSX text content, and `safeJsonLd` handles JSON-LD. The actual XSS risk is mitigated by framework-level protections. Adding server-side sanitization would be defense-in-depth only.
**Exit criterion:** If user content is ever rendered in a non-React context (e.g., email templates, PDF generation).

### C1N-02/C1N-03: Ad-hoc slug validation in data.ts instead of `isValidSlug()` [LOW, High Confidence]
**File:** `apps/web/src/lib/data.ts:158,208`
**Reason:** The inline regex `/^[a-z0-9_-]+$/i.test(topic) || topic.length > 100` is functionally equivalent to `isValidSlug()`. Replacing with the shared function is a refactoring task with no behavior change.
**Exit criterion:** If data.ts validation logic diverges from `isValidSlug`.

### C1N-04: Fragile message check in ER_DUP_ENTRY catch [LOW, Low Confidence]
**File:** `apps/web/src/app/actions/admin-users.ts:54`
**Reason:** The `e.code === 'ER_DUP_ENTRY'` check is sufficient; the `e.message?.includes('users.username')` fallback is defensive but fragile. Removing it is a minor cleanup.
**Exit criterion:** If the message check causes a false positive or negative.

### C1N-05: Type-unsafe GC pattern in exportImagesCsv [LOW, Medium Confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:76`
**Reason:** The `results = [] as typeof results` pattern is unusual but the comment explains the intent. The variable goes out of scope at function end anyway, so GC handles it naturally.
**Exit criterion:** If the type assertion causes a future type error.

### C1N-10: Admin tag counts include unprocessed images [LOW, Medium Confidence]
**File:** `apps/web/src/app/actions/tags.ts:23`
**Reason:** For admin purposes, showing all tags (including those on unprocessed images) is arguably correct behavior. This is a design decision, not a bug.
**Exit criterion:** If admin users report tag count discrepancies as a bug.

### C1N-23: No screen reader announcement on photo navigation [LOW, Medium Confidence]
**File:** `apps/web/src/components/photo-viewer.tsx:139`
**Reason:** The `aria-live="polite"` position indicator provides some context, but the image content change is not announced. Adding a full announcement requires careful design to avoid excessive verbosity.
**Exit criterion:** If accessibility audit flags this as a WCAG 2.2 violation.

## Test Coverage Gaps (Deferred)

### C1N-13: No tests for `searchImagesAction` rate limit rollback [MEDIUM]
**Reason:** Plan 85 fixes the rollback bug. Once the fix is in place, tests should be added. However, testing server actions requires mocking the DB and headers, which adds complexity. Deferring tests to a dedicated test-improvement cycle.
**Exit criterion:** After Plan 85 is implemented, add tests in a follow-up cycle.

### C1N-14/C1N-15/C1N-16: Other test gaps [LOW]
**Reason:** These are test coverage improvements, not bug fixes. They should be addressed in a dedicated test-improvement cycle.
**Exit criterion:** Next test improvement cycle.

## Previously Deferred Items (Unchanged)

All previously deferred items from cycles 5-37 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
