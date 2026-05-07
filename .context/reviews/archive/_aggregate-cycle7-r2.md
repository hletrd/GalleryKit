# Aggregate Review -- Cycle 7 Round 2 (2026-04-20)

## Summary

Cycle 7 round 2 deep review of the full codebase found **8 new actionable issues** (4 MEDIUM, 4 LOW) and confirmed all previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles. The codebase continues to be well-hardened after 46 previous review cycles.

## New Findings (Deduplicated)

### C7R2-01: `createTopicAlias` does not reject malformed `topicSlug`/`alias` [MEDIUM] [HIGH confidence]
**File:** `apps/web/src/app/actions/topics.ts` lines 248-258
**Description:** `createTopicAlias` applies `stripControlChars` to `topicSlug` and `alias` but does NOT check whether sanitization changed the value before proceeding. In contrast, `updateTopic` (line 103), `deleteTopic` (line 200), and `deleteTopicAlias` (lines 298, 307) all check `if (cleanSlug !== slug)` and reject malformed input. This breaks the consistent defense-in-depth pattern.
**Fix:** Add `if (cleanTopicSlug !== topicSlug) return { error: t('invalidTopicSlug') };` after line 248 and `if (cleanAlias !== alias) return { error: t('invalidAlias') };` after line 255.

### C7R2-02: `createTopic` does not reject malformed `label`/`slug` [MEDIUM] [MEDIUM confidence]
**File:** `apps/web/src/app/actions/topics.ts` lines 37-38
**Description:** `createTopic` applies `stripControlChars` to `label` and `slug` from `formData` but does not check whether the sanitized values differ from the originals. Inconsistency with all other topic operations.
**Fix:** Save raw values before sanitization and add mismatch checks.

### C7R2-03: `batchAddTags` does not reject malformed `tagName` [MEDIUM] [HIGH confidence]
**File:** `apps/web/src/app/actions/tags.ts` lines 228-230
**Description:** `batchAddTags` applies `stripControlChars` to the tag name but does NOT check whether sanitization changed the value. In contrast, `addTagToImage` (line 126) and `removeTagFromImage` (line 180) both reject malformed input.
**Fix:** Add `const rawTagName = tagName?.trim() ?? '';` before sanitization, then `if (cleanName !== rawTagName) return { error: t('invalidTagName') };` after sanitization.

### C7R2-04: `updateTag` does not reject malformed `name` [MEDIUM] [HIGH confidence]
**File:** `apps/web/src/app/actions/tags.ts` line 55
**Description:** `updateTag` applies `stripControlChars` to the tag name but does NOT check whether sanitization changed the value. Inconsistent with `addTagToImage` (line 126) and `removeTagFromImage` (line 180).
**Fix:** Add `const rawName = name?.trim() ?? '';` before sanitization, then `if (trimmedName !== rawName) return { error: t('invalidTagName') };`.

### C7R2-05: `createAdminUser` does not reject malformed `username` [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/actions/admin-users.ts` lines 95-96
**Description:** `createAdminUser` applies `stripControlChars` to the raw username but does not check whether sanitization changed the value. Inconsistent with the defense-in-depth pattern used elsewhere.
**Fix:** Add `if (username !== rawUsername) return { error: t('invalidUsernameFormat') };` after line 96.

### C7R2-06: `login` username not checked for pre/post sanitization mismatch [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/actions/auth.ts` line 71
**Description:** The `login` function applies `stripControlChars` to the username but does not check whether the sanitized value differs from the original. Low impact since the sanitized value is used for the DB lookup (correct behavior), and rejecting could prevent a legitimate user with a buggy client from logging in.
**Fix:** Optional -- add mismatch check or document the decision to allow silent sanitization for login.

### C7R2-07: `updateImageMetadata` does not reject malformed `title`/`description` [LOW] [LOW confidence]
**File:** `apps/web/src/app/actions/images.ts` lines 521-522
**Description:** Free-text fields where control characters are extremely unlikely to be legitimate input. The stored value is sanitized, so the impact is minimal.
**Fix:** Optional -- add mismatch checks or document the decision.

### C7R2-08: `updateGallerySettings` and `updateSeoSettings` do not reject malformed values [LOW] [LOW confidence]
**File:** `apps/web/src/app/actions/settings.ts` line 54, `apps/web/src/app/actions/seo.ts` line 67
**Description:** Admin-only settings where control characters are almost certainly erroneous. Same class as C7R2-07.
**Fix:** Optional -- add mismatch checks or document the decision.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-46 remain deferred with no change in status.

## Recommended Priority for Implementation

1. C7R2-01 -- Add malformed-input rejection to `createTopicAlias` (HIGH confidence, clear pattern match)
2. C7R2-03 -- Add malformed-input rejection to `batchAddTags` (HIGH confidence, clear pattern match)
3. C7R2-04 -- Add malformed-input rejection to `updateTag` (HIGH confidence, clear pattern match)
4. C7R2-02 -- Add malformed-input rejection to `createTopic` (MEDIUM confidence, consistent pattern)
5. C7R2-05 -- Add malformed-input rejection to `createAdminUser` (optional, LOW severity)
6. C7R2-06 through C7R2-08 -- Optional, LOW severity, LOW confidence
