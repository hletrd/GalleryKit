# Critic — Cycle 44 (2026-04-20)

## Review Scope
Multi-perspective critique: design consistency, error handling patterns, API surface quality, and cross-cutting concerns.

## New Findings

### CC44-01: Inconsistent `stripControlChars` application across action modules [MEDIUM] [HIGH confidence]
**Files:** Multiple action files
**Description:** There is a systematic inconsistency in where `stripControlChars` is applied:
- **Always applied:** tag names (all operations), topic labels, topic aliases, SEO settings, gallery settings, image title/description
- **NOT applied:** `login` username (auth.ts:70), `updateTopic` currentSlug (topics.ts:99), `deleteTopic` slug (topics.ts:189), `uploadImages` topic slug (images.ts:58)

The `isValidSlug` regex (`/^[a-z0-9_-]+$/i`) effectively excludes control characters, making the omission safe in practice. However, the defense-in-depth principle established across the codebase is: "sanitize before validate, even if the validator would reject the bad input." This ensures that if a validator is ever relaxed, sanitization still provides a safety net.

**Recommendation:** Apply `stripControlChars` consistently to ALL user inputs before validation, regardless of whether the current validator rejects control characters. This makes the codebase's security posture more resilient to future changes.

### CC44-02: `searchImagesAction` strips control chars after slicing [LOW] [HIGH confidence]
**File:** `apps/web/src/app/actions/public.ts` line 94
**Description:** `stripControlChars(query.trim().slice(0, 200))` — the order should be strip first, then slice, so the 200-char limit applies to the sanitized string. Currently, if the first 200 chars include control characters, stripping them produces a shorter effective query.

## Verified as Fixed

- C43-01, CR43-02: Both confirmed fixed.

## Previously Deferred Items (No Change)

All previously deferred items remain outstanding with no change in status.
