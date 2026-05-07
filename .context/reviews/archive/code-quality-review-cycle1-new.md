# Code Quality Review — Cycle 1 (New Loop)

**Reviewer:** Code Quality / Logic / Maintainability
**Date:** 2026-04-19

## Methodology
- Read all server actions (auth, images, topics, tags, sharing, admin-users, public), middleware, data layer, image processing pipeline, queue system, auth/session, rate limiting, upload serving, DB schema, admin pages, public pages, API routes
- Cross-referenced with CLAUDE.md documentation
- Searched for patterns: notFound(), parseInt, dangerouslySetInnerHTML, TODO/FIXME, empty catches, innerHTML, eval, process.env leaks, Number(insertId)
- Verified all `dangerouslySetInnerHTML` uses go through `safeJsonLd` (which escapes `<`)
- Verified all `parseInt` on route params are validated with `/^\d+$/` regex

## Findings

### C1N-01: `updateImageMetadata` does not validate title/description for XSS-viable content [MEDIUM, Medium Confidence]
**File:** `apps/web/src/app/actions/images.ts:434-478`
**Problem:** While `title` length is capped at 255 and `description` at 5000, neither is sanitized for HTML/script content. The title and description are rendered in the admin dashboard and photo viewer. In the admin dashboard (`image-manager.tsx`), they are rendered inside JSX text content which React auto-escapes. In the photo viewer sidebar, they also appear in JSX text. However, the OG metadata and JSON-LD embed these values directly.
**Actual risk:** React JSX auto-escapes, and `safeJsonLd` handles JSON-LD. The `generateMetadata` return values are strings consumed by Next.js Metadata API (not raw HTML). The actual XSS risk is LOW, but the lack of explicit sanitization is a defense-in-depth gap.
**Confidence downgrade:** Medium — React's auto-escaping and safeJsonLd mitigate the primary vectors, but the pattern of not sanitizing user input before storage is still a code quality concern.
**Suggested fix:** Add server-side HTML tag stripping for title/description before DB insert, as defense in depth.

### C1N-02: `getImageCount` uses ad-hoc validation regex instead of `isValidSlug` [LOW, High Confidence]
**File:** `apps/web/src/lib/data.ts:158`
**Problem:** `getImageCount` validates `topic` with `/^[a-z0-9_-]+$/i.test(topic) || topic.length > 100` which is equivalent to `isValidSlug` but not the same function. This duplicates validation logic.
**Suggested fix:** Use `isValidSlug(topic)` from `@/lib/validation` for consistency, or extract the regex into a shared constant.

### C1N-03: `buildImageConditions` duplicates the same ad-hoc slug validation [LOW, High Confidence]
**File:** `apps/web/src/lib/data.ts:208`
**Problem:** Same pattern as C1N-02 — uses `/^[a-z0-9_-]+$/i.test(topic) || topic.length > 100` inline instead of `isValidSlug`.
**Suggested fix:** Same as C1N-02 — use `isValidSlug`.

### C1N-04: `createAdminUser` does not reject duplicate usernames before DB insert [LOW, Low Confidence]
**File:** `apps/web/src/app/actions/admin-users.ts:25-59`
**Problem:** The function relies on catching `ER_DUP_ENTRY` to handle duplicate usernames. This is actually the correct pattern (TOCTOU-safe), but the catch block also checks `e.message?.includes('users.username')` which is fragile and may not match all MySQL error message formats across versions.
**Confidence:** Low — the ER_DUP_ENTRY code check should catch it regardless, the message check is just extra.
**Suggested fix:** Remove the `e.message?.includes('users.username')` fallback since `e.code === 'ER_DUP_ENTRY'` is sufficient.

### C1N-05: `exportImagesCsv` reassigns `results` parameter with type assertion [LOW, Medium Confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:76`
**Problem:** `results = [] as typeof results;` is a type-unsafe way to release the reference for GC. The comment explains the intent but the pattern is unusual and the type assertion could mask future type errors if the variable shape changes.
**Suggested fix:** Use a block scope or `void` expression instead: `{ const _ = results; results = null as unknown as typeof results; }` or just let GC handle it naturally — the variable goes out of scope at function end anyway.

### C1N-06: `searchImagesAction` increments in-memory rate limit BEFORE DB check but the DB check is authoritative [LOW, Medium Confidence]
**File:** `apps/web/src/app/actions/public.ts:52-84`
**Problem:** The function increments the in-memory Map counter first (line 55-59), then checks the DB (line 63). If the DB says the user IS limited, the in-memory counter is already incremented, and the function returns `[]` without rolling back the in-memory increment. On the next call, the in-memory counter will be even higher than it should be. This is the reverse TOCTOU issue — the pre-increment causes overcounting in the in-memory fast path when the DB would have rejected.
**Concrete scenario:** A user at 29/30 requests makes a concurrent request. Both pass the in-memory check (29 < 30), both increment to 30 and 31. The DB check for one returns limited. That request returns `[]` but the in-memory counter is now 31. The next request fails the in-memory check even though it should be at 30.
**Suggested fix:** On DB-limited response, roll back the in-memory increment (similar to how `incrementRateLimit` failure is handled on lines 74-84).

## No-New-Findings Items
- Authentication & Sessions: Solid — Argon2id, HMAC-SHA256, timingSafeEqual, session fixation prevention
- Rate Limiting: Pre-increment TOCTOU fix is correct for login/password; search has minor gap (C1N-06)
- Upload Security: Path traversal prevention, symlink rejection, UUID filenames, decompression bomb mitigation
- SQL Injection: All queries via Drizzle ORM (parameterized), LIKE wildcards escaped
- Image Processing Queue: Claim locks, conditional updates, retry limits, orphaned file cleanup
- Data Layer: React cache() deduplication, Promise.all parallel queries, view count buffering

## Previously Deferred Items (Unchanged)
All previously deferred items from cycles 5-37 remain deferred with no change in status.
