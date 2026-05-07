# Comprehensive Review — Cycle 45 (2026-04-20)

## Summary

Deep review of the full codebase after 44 prior review cycles. The codebase is extremely well-hardened with consistent `stripControlChars` application, proper rate limiting, transactional integrity, and defense-in-depth patterns. Found **3 new actionable issues** (1 MEDIUM, 2 LOW). No CRITICAL or HIGH findings.

## New Findings

### C45-01: `createTopicAlias` and `deleteTopicAlias` skip `stripControlChars` on `topicSlug` parameter [MEDIUM] [HIGH confidence]

**Files:**
- `apps/web/src/app/actions/topics.ts` line 233 — `createTopicAlias(topicSlug: string, alias: string)`
- `apps/web/src/app/actions/topics.ts` line 278 — `deleteTopicAlias(topicSlug: string, alias: string)`

**Description:** Both functions accept `topicSlug` as a direct function parameter and pass it to `isValidSlug()` and DB queries without applying `stripControlChars`. In contrast, `updateTopic` sanitizes its `currentSlug` parameter (line 100) and `deleteTopic` sanitizes its `slug` parameter (line 192). While `isValidSlug` regex (`/^[a-z0-9_-]+$/i`) effectively rejects control characters, the defense-in-depth principle ("sanitize before validate") is violated — the same pattern that was fixed in cycle 44 for `updateTopic`/`deleteTopic` slugs.

The `topicSlug` reaches the `logAuditEvent` `targetId` column and `revalidateLocalizedPaths` path argument unsanitized.

**Concrete scenario:** A client sends `topicSlug = "nature\x00"` to `createTopicAlias`. The `isValidSlug` regex rejects it (so there's no DB injection), but the unsanitized value is passed to `logAuditEvent` where control chars could cause display issues in audit logs.

**Fix:** Apply `stripControlChars(topicSlug) ?? ''` at the top of both functions before validation, matching the `updateTopic`/`deleteTopic` pattern.

### C45-02: `createTopic` doesn't sanitize `slug` form field with `stripControlChars` [LOW] [HIGH confidence]

**File:** `apps/web/src/app/actions/topics.ts` line 38

**Description:** In `createTopic`, the `label` is sanitized (line 37: `stripControlChars(formData.get('label')...)`) but the `slug` is extracted raw (line 38: `formData.get('slug')?.toString() ?? ''`). While `isValidSlug` regex (`/^[a-z0-9_-]+$/i`) effectively rejects control characters, this is inconsistent with the pattern in `updateTopic` where the form `slug` field IS validated by `isValidSlug` after the `currentSlug` was already sanitized. The `slug` value is also passed to `logAuditEvent` (line 79) and `revalidateLocalizedPaths` (line 81) unsanitized.

**Fix:** Apply `stripControlChars(formData.get('slug')?.toString() ?? '') ?? ''` before validation, matching the `label` sanitization on the adjacent line.

### C45-03: `updateImageMetadata` validates length before sanitizing with `stripControlChars` [LOW] [MEDIUM confidence]

**File:** `apps/web/src/app/actions/images.ts` lines 512-522

**Description:** The length validation for `title` (max 255) and `description` (max 5000) runs BEFORE `stripControlChars` is applied (lines 512-518 vs 521-522). This means a string like `"A" + "\x00".repeat(200)` would pass the 255-char title check but after stripping becomes just `"A"`. The validated length and the stored length diverge. This is the same strip-before-validate ordering pattern that was fixed in `searchImagesAction` (cycle 44, S44-02) and in `settings.ts`/`seo.ts` (cycle 29).

**Fix:** Move `stripControlChars` before the length checks so validation operates on the same value that will be stored.

## Verified as Fixed (from prior cycles)

All cycle 44 fixes verified:
- C44-01 (stripControlChars in auth/images/topics): VERIFIED FIXED
- S44-02 (searchImagesAction strip-before-slice): VERIFIED FIXED
- TE44-01 (sanitize.test.ts): VERIFIED FIXED

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-44 remain deferred with no change in status.

## Recommended Priority for Implementation

1. **C45-01** — Sanitize `topicSlug` in `createTopicAlias`/`deleteTopicAlias` (MEDIUM, easy fix, 2 functions)
2. **C45-02** — Sanitize `slug` in `createTopic` (LOW, trivial fix)
3. **C45-03** — Reorder sanitization before length validation in `updateImageMetadata` (LOW, easy fix)
