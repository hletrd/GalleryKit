# Aggregate Review — Cycle 45 (2026-04-20)

## Summary

Cycle 45 deep review of the full codebase found **3 new actionable issues** (1 MEDIUM, 2 LOW) and confirmed all previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles.

## New Findings (Deduplicated)

### C45-01: `createTopicAlias` and `deleteTopicAlias` skip `stripControlChars` on `topicSlug` parameter [MEDIUM] [HIGH confidence]
**Files:**
- `apps/web/src/app/actions/topics.ts` line 233 — `createTopicAlias(topicSlug: string, alias: string)`
- `apps/web/src/app/actions/topics.ts` line 278 — `deleteTopicAlias(topicSlug: string, alias: string)`
**Description:** Both functions accept `topicSlug` as a direct function parameter and pass it to `isValidSlug()` and DB queries without applying `stripControlChars`. In contrast, `updateTopic` sanitizes its `currentSlug` parameter (line 100) and `deleteTopic` sanitizes its `slug` parameter (line 192). The `topicSlug` reaches `logAuditEvent` `targetId` and `revalidateLocalizedPaths` unsanitized.
**Fix:** Apply `stripControlChars(topicSlug) ?? ''` at the top of both functions before validation.

### C45-02: `createTopic` doesn't sanitize `slug` form field with `stripControlChars` [LOW] [HIGH confidence]
**File:** `apps/web/src/app/actions/topics.ts` line 38
**Description:** In `createTopic`, the `label` is sanitized but the `slug` is extracted raw. While `isValidSlug` regex rejects control characters, this is inconsistent with the defense-in-depth pattern.
**Fix:** Apply `stripControlChars(formData.get('slug')?.toString() ?? '') ?? ''` before validation.

### C45-03: `updateImageMetadata` validates length before sanitizing with `stripControlChars` [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/actions/images.ts` lines 512-522
**Description:** Length validation for `title`/`description` runs BEFORE `stripControlChars`. Validated length and stored length can diverge.
**Fix:** Move `stripControlChars` before the length checks.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-44 remain deferred with no change in status.

## Recommended Priority for Implementation

1. C45-01 — Sanitize `topicSlug` in `createTopicAlias`/`deleteTopicAlias`
2. C45-02 — Sanitize `slug` in `createTopic`
3. C45-03 — Reorder sanitization before length validation in `updateImageMetadata`
