# Plan 120 — Cycle 11 Round 2 Fixes

**Created:** 2026-04-19 (Cycle 11, Round 2)
**Status:** DONE

---

## C11R2-01: Convert `s/[key]/page.tsx` dynamic import to static [LOW]

**File:** `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:10`
**Current:** `const PhotoViewer = dynamic(() => import('@/components/photo-viewer'));`
**Target:** `import PhotoViewer from '@/components/photo-viewer';`
**Also remove:** `import dynamic from 'next/dynamic';`

This matches the `g/[key]/page.tsx` pattern that was recently converted.

---

## C11R2-02: Fix createAdminUser DB rate limit TOCTOU [MEDIUM]

**File:** `apps/web/src/app/actions/admin-users.ts:66-85`
**Current flow:**
1. In-memory check+increment (safe — single-threaded)
2. DB `checkRateLimit` (read)
3. DB `incrementRateLimit` (write)
4. Expensive Argon2 hash

**Problem:** Steps 2-3 are check-then-increment across two DB calls, allowing concurrent requests to both pass.

**Target flow (matching login pattern):**
1. In-memory check+increment (existing — keep)
2. DB `incrementRateLimit` (pre-increment — atomic upsert)
3. DB `checkRateLimit` (check after increment)
4. If limited, return error
5. Expensive Argon2 hash
6. On success: roll back DB rate limit (clear bucket)
7. On unexpected error: roll back DB rate limit

---

## C11R2-03: Password confirmation server-side [LOW] — DEFERRED

**Reason:** The `createAdminUser` action requires admin authentication. Direct API calls with a valid admin session would intentionally set whatever password is provided. Adding server-side confirmation would require sending the password twice over the wire, which is unnecessary when the client already validates. The real protection is the admin auth gate.
**Exit criterion:** If non-admin users ever gain ability to create accounts, this must be re-opened.

---

## Implementation Order

1. C11R2-01 (simple import change)
2. C11R2-02 (rate limit restructure)
