# Architect — Cycle 44 (2026-04-20)

## Review Scope
Architectural/design risks, coupling, layering, and module responsibility boundaries.

## New Findings

### A44-01: `stripControlChars` usage is a cross-cutting concern with no enforcement mechanism [MEDIUM] [HIGH confidence]
**Description:** The `stripControlChars` function in `sanitize.ts` is a cross-cutting security concern applied inconsistently across the codebase. There is no automated enforcement (lint rule, type system, or decorator) ensuring it is applied to all user inputs. The current approach relies on developer discipline and code review, which has already led to gaps (login username, topic slugs in update/delete).
**Recommendation:** Consider one of:
1. A custom ESLint rule that flags `formData.get()` calls not followed by `stripControlChars`
2. A wrapper function `getSanitizedFormData(formData, key)` that applies `stripControlChars` automatically
3. A middleware layer that sanitizes all form data before it reaches action handlers

Option 2 is the most pragmatic — it centralizes the sanitization and makes omissions obvious by requiring a different API call for unsanitized access.

### A44-02: Rate limiting architecture has 4 separate in-memory Map implementations [LOW] [HIGH confidence]
**Files:** `rate-limit.ts`, `auth-rate-limit.ts`, `sharing.ts`, `admin-users.ts`, `images.ts`, `public.ts`
**Description:** There are 6 separate in-memory rate-limit Maps across the codebase:
1. `loginRateLimit` (rate-limit.ts)
2. `searchRateLimit` (rate-limit.ts)
3. `passwordChangeRateLimit` (auth-rate-limit.ts)
4. `shareRateLimit` (sharing.ts)
5. `userCreateRateLimit` (admin-users.ts)
6. `uploadTracker` (images.ts)

Each has its own pruning logic (insertion-order eviction), max key limits, and window sizes. The pruning and eviction patterns are nearly identical across all 6, creating maintenance burden and the risk of subtle inconsistencies.
**Recommendation:** Consolidate into a generic `RateLimitMap` class with configurable max keys, window size, and eviction policy. This would reduce ~200 lines of duplicated pruning logic across the codebase.

## Previously Deferred Items (No Change)

- ARCH-38-03: `data.ts` is a god module
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
