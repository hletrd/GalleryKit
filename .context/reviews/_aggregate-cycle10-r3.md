# Aggregate Review — Cycle 10 R3 (2026-04-20)

## Summary

Cycle 10 R3 deep review of the full codebase found **3 new actionable issues** (1 MEDIUM, 2 LOW) and confirmed previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles.

The review focused on the current codebase state after 45+ prior review cycles, with emphasis on input validation consistency, audit log correctness, and the OG image generation route.

## New Findings (Deduplicated)

### C10R3-01: `og/route.tsx` renders unsanitized `topic` parameter directly into OG image [MEDIUM] [MEDIUM confidence]
- **File:** `apps/web/src/app/api/og/route.tsx` lines 9, 81
- **Flagged by:** code-reviewer, security-reviewer
- **Description:** The `topic` query parameter is rendered into the OG image JSX with only length truncation. No validation against `isValidSlug` or similar pattern. An attacker can craft arbitrary OG images with misleading text. Inconsistent with the defense-in-depth approach used everywhere else in the codebase.
- **Fix:** Validate `topic` against `isValidSlug`. Return 400 if invalid.

### C10R3-02: `og/route.tsx` tag list is not sanitized [LOW] [LOW confidence]
- **File:** `apps/web/src/app/api/og/route.tsx` lines 10, 16, 95-109
- **Flagged by:** security-reviewer
- **Description:** `tags` query parameter rendered without validation against `isValidTagName`. Same class as C10R3-01 but lower impact.
- **Fix:** Validate each tag against `isValidTagName` before rendering.

### C10R3-03: `deleteAdminUser` audit log fires even when concurrent deletion causes 0 affected rows [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/app/actions/admin-users.ts` lines 168-196
- **Flagged by:** code-reviewer
- **Description:** If a concurrent deletion happens between the SELECT and DELETE inside the transaction, the DELETE affects 0 rows but no error is thrown. The audit log then records a phantom `user_delete` event. This is the same class of issue as C10-05 (now fixed for `deleteImage` and `deleteTag`).
- **Fix:** Check `affectedRows` from the DELETE result inside the transaction. If 0, throw an error to prevent the audit log from firing.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-46 remain deferred with no change in status:
- C32-03: Insertion-order eviction in Maps (also CRI-38-01 DRY concern)
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- CR-38-05: `db-actions.ts` env passthrough is overly broad
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- CRI-38-01: DRY violation in Map pruning (5+ copies)
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory
- ARCH-38-03: `data.ts` is a god module
- TE-38-01 through TE-38-04: Test coverage gaps
- CR-39-02: `processImageFormats` unlink-before-link race window
- C9R2-04: `queue_concurrency` setting has no effect on live queue
- C10-F01: `batchAddTags` returns success on silent FK failures
- C10-F02: Duplicated tag-filter subquery logic in `getImageCount`

## Recommended Priority for Implementation

1. C10R3-01 — Validate `topic` parameter in OG route against `isValidSlug`
2. C10R3-03 — Check `affectedRows` in `deleteAdminUser` before audit log
3. C10R3-02 — Validate `tags` parameter in OG route against `isValidTagName`
