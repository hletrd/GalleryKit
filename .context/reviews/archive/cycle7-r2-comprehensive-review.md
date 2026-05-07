# Comprehensive Code Review -- Cycle 7 Round 2 (2026-04-20)

## Review Scope

Deep multi-angle review of the full GalleryKit codebase, covering all server actions, data layer, middleware, session/auth, image processing, storage, and configuration modules. This is cycle 7 of the review-plan-fix loop. Prior cycle 7 review (C7-F01 through C7-F06) was consulted; this review focuses on gaps not previously identified.

## New Findings

### C7R2-01: `createTopicAlias` does not reject malformed `topicSlug`/`alias` like other destructive operations [MEDIUM] [HIGH confidence]

**File:** `apps/web/src/app/actions/topics.ts` lines 248-258

**Description:** `createTopicAlias` applies `stripControlChars` to `topicSlug` and `alias` but does NOT check whether sanitization changed the value before proceeding. In contrast, `updateTopic` (line 103), `deleteTopic` (line 200), and `deleteTopicAlias` (lines 298, 307) all check `if (cleanSlug !== slug)` and reject malformed input. While `createTopicAlias` is a creation operation (not purely destructive), accepting silently sanitized input that differs from what the user submitted could cause confusion -- the user submits `"foo\x00bar"` as an alias, and it gets stored as `"foobar"` without any indication. More importantly, it breaks the consistent defense-in-depth pattern established across all other topic operations where malformed input is rejected rather than silently sanitized.

**Fix:** Add `if (cleanTopicSlug !== topicSlug) return { error: t('invalidTopicSlug') };` after line 248 and `if (cleanAlias !== alias) return { error: t('invalidAlias') };` after line 255, matching the `deleteTopicAlias` pattern.

### C7R2-02: `createTopic` does not reject malformed `label`/`slug` like other topic operations [MEDIUM] [MEDIUM confidence]

**File:** `apps/web/src/app/actions/topics.ts` lines 37-38

**Description:** `createTopic` applies `stripControlChars` to `label` and `slug` from `formData` but does not check whether the sanitized values differ from the originals. The same concern as C7R2-01 applies: if the user submitted `"my\x00topic"` as a slug, it would be silently stored as `"mytopic"`. While creation is less risky than deletion, the inconsistency with the rest of the codebase (where every other topic operation rejects malformed input) should be resolved for consistency and to surface potential client-side bugs early.

**Fix:** Save the raw values before sanitization and add mismatch checks. Replace lines 37-38 with:
```typescript
const rawLabel = formData.get('label')?.toString() ?? '';
const rawSlug = formData.get('slug')?.toString() ?? '';
const label = stripControlChars(rawLabel) ?? '';
const slug = stripControlChars(rawSlug) ?? '';
if (label !== rawLabel) return { error: t('invalidLabel') };
if (slug !== rawSlug) return { error: t('invalidSlug') };
```

### C7R2-03: `batchAddTags` does not reject malformed `tagName` like `addTagToImage`/`removeTagFromImage` [MEDIUM] [HIGH confidence]

**File:** `apps/web/src/app/actions/tags.ts` lines 228-230

**Description:** `batchAddTags` applies `stripControlChars` to the tag name but does NOT check whether sanitization changed the value. In contrast, `addTagToImage` (line 126) and `removeTagFromImage` (line 180) both have `if (cleanName !== trimmedTagName) return { error: ... }` checks. `batchAddTags` silently accepts the sanitized name. This breaks the defense-in-depth pattern and could lead to confusion where the user submits a tag with control characters and it's silently stored differently.

**Fix:** Add `const rawTagName = tagName?.trim() ?? '';` before sanitization, then add `if (cleanName !== rawTagName) return { error: t('invalidTagName') };` after line 228, matching the `addTagToImage` pattern.

### C7R2-04: `updateTag` does not reject malformed `name` like `addTagToImage`/`removeTagFromImage` [MEDIUM] [HIGH confidence]

**File:** `apps/web/src/app/actions/tags.ts` line 55

**Description:** `updateTag` applies `stripControlChars` to the tag name but does NOT check whether sanitization changed the value. This is inconsistent with `addTagToImage` (line 126) and `removeTagFromImage` (line 180) which both reject malformed input. Same class as C7R2-03.

**Fix:** Add `const rawName = name?.trim() ?? '';` before sanitization, then add `if (trimmedName !== rawName) return { error: t('invalidTagName') };` before the existing empty check on line 56.

### C7R2-05: `createAdminUser` does not reject malformed `username` like destructive admin operations [LOW] [MEDIUM confidence]

**File:** `apps/web/src/app/actions/admin-users.ts` lines 95-96

**Description:** `createAdminUser` applies `stripControlChars` to the raw username but does not check whether sanitization changed the value. If a client sends `"admin\x00user"` as a username, it would be silently stored as `"adminuser"`. The subsequent regex check `/^[a-zA-Z0-9_-]+$/` would pass on the sanitized value. While this doesn't cause a security issue (the sanitized name is validated and stored), it breaks the consistent pattern used across the codebase where malformed input is rejected. For user creation specifically, a mismatch likely indicates a tampered request, so rejecting it would be more informative.

**Fix:** Add `if (username !== rawUsername) return { error: t('invalidUsernameFormat') };` after line 96.

### C7R2-06: `login` username not checked for pre/post sanitization mismatch [LOW] [MEDIUM confidence]

**File:** `apps/web/src/app/actions/auth.ts` line 71

**Description:** The `login` function applies `stripControlChars` to the username but does not check whether the sanitized value differs from the original. If a user's browser or a malicious script sends `"admin\x00"` as a username, it would be silently treated as `"admin"`. While this doesn't cause a security issue (the sanitized name is what gets looked up), rejecting it would surface potential client bugs early. However, the impact is LOW because the sanitized value is used for the DB lookup (which is correct), and rejecting could prevent a legitimate user with a buggy client from logging in.

**Fix:** Optional -- add mismatch check or document the decision to allow silent sanitization for login.

### C7R2-07: `updateImageMetadata` does not reject malformed `title`/`description` [LOW] [LOW confidence]

**File:** `apps/web/src/app/actions/images.ts` lines 521-522

**Description:** `updateImageMetadata` applies `stripControlChars` to `title` and `description` but does not check for a pre/post mismatch. These are free-text fields where control characters are extremely unlikely to be legitimate input, but they could come from copy-paste. The impact is LOW because the stored value is sanitized, and these are not destructive operations.

**Fix:** Optional -- add mismatch checks similar to other operations, or document the decision.

### C7R2-08: `updateGallerySettings` and `updateSeoSettings` do not reject malformed values [LOW] [LOW confidence]

**File:** `apps/web/src/app/actions/settings.ts` line 54, `apps/web/src/app/actions/seo.ts` line 67

**Description:** Both settings update functions apply `stripControlChars` to all values but do not check for mismatches. These are admin-only settings where control characters in values like site titles, descriptions, and URLs are almost certainly erroneous. Same class as C7R2-07.

**Fix:** Optional -- add mismatch checks or document the decision.

## Previously Addressed (Confirmed Fixed)

- C46-01: `tagsString` sanitization before length check -- **FIXED** (images.ts line 62 sanitizes before line 64 length check)
- C46-02: `query` sanitization before length check in `searchImagesAction` -- **FIXED** (public.ts line 29 sanitizes before line 30 length check)
- C6R3-01: Early-reject for malformed input in destructive operations -- **PARTIALLY FIXED** (updateTopic, deleteTopic, deleteTopicAlias, addTagToImage, removeTagFromImage, batchUpdateImageTags now reject; but createTopicAlias, createTopic, batchAddTags, updateTag, createAdminUser still silently sanitize -- addressed in C7R2-01 through C7R2-05)
- C6R3-02: Startup cleanup for topic image temp files -- **FIXED** (cleanOrphanedTopicTempFiles in process-topic-image.ts, called from bootstrapImageProcessingQueue)
- C6R3-03: Storage backend non-integration documentation -- **FIXED** (documented in CLAUDE.md and storage/index.ts)
- C7-F02: `searchImagesAction` query validation length mismatch -- **FIXED** (public.ts now uses `sanitizedQuery.length > 200` on line 30)

## Architectural Observations (No Action Required)

1. The privacy field separation (`adminSelectFields` vs `publicSelectFields` with compile-time guard) is well-designed and prevents accidental PII leakage.
2. The rate limiting architecture (in-memory fast path + DB-backed source of truth with pre-increment-then-check pattern) is consistent across all operations.
3. The `stripControlChars` before validation pattern has been mostly adopted, with the remaining gaps identified in C7R2-01 through C7R2-05.
4. The SQL restore scanner provides good defense-in-depth against SQL injection in backup restoration.
5. The view count buffering with exponential backoff during DB outages is well-implemented.

## Summary

| ID | Severity | Confidence | Status |
|----|----------|------------|--------|
| C7R2-01 | MEDIUM | HIGH | New -- createTopicAlias missing malformed-input rejection |
| C7R2-02 | MEDIUM | MEDIUM | New -- createTopic missing malformed-input rejection |
| C7R2-03 | MEDIUM | HIGH | New -- batchAddTags missing malformed-input rejection |
| C7R2-04 | MEDIUM | HIGH | New -- updateTag missing malformed-input rejection |
| C7R2-05 | LOW | MEDIUM | New -- createAdminUser missing malformed-input rejection |
| C7R2-06 | LOW | MEDIUM | New -- login username mismatch check (optional) |
| C7R2-07 | LOW | LOW | New -- updateImageMetadata mismatch check (optional) |
| C7R2-08 | LOW | LOW | New -- settings/seo mismatch checks (optional) |
