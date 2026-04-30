# Plan 25: Deferred Items — R5 & R6 Carry-forward

**Priority:** P2-P3
**Estimated effort:** 2-3 hours
**Sources:** R5 deferred (Plan 16, 17, 19), R6 deferred (font subsetting, focus-trap lazy, Docker node_modules)
**Status:** COMPLETE
**Ralph verification:** 2026-04-18 re-checked during current Ralph run; no new carry-forward work was required from this plan.

---

## 1. Create batchUpdateImageTags server action (P2) ✅
**Source:** Plan 17 partial
**File:** `src/app/actions/tags.ts`
**Commit:** d961785

Tag add/remove runs N serial server action round-trips. Created `batchUpdateImageTags` with single auth check + revalidation.
Also refactored `image-manager.tsx` to use it (bf9a2c6).

---

## 2. Add tsconfig.scripts.json for active scripts (P2) ✅
**Source:** Plan 19 #19
**File:** `apps/web/tsconfig.scripts.json`
**Commit:** 3afdb6d

Root tsconfig.json excludes scripts/. Created a separate tsconfig for active scripts so they get type checking via `tsc -p tsconfig.scripts.json --noEmit`.

---

## 3. Add OG image route rate limiting (P2) ✅
**Source:** Plan 19 #21
**File:** `src/app/api/og/route.tsx`
**Commit:** fb9a8b6

OG route uses edge runtime — in-memory Map rate limiting not compatible. Hardened with strict input validation (topic length, tag count/length limits). Rate limiting delegated to nginx reverse proxy.

---

## 4. Add seed-e2e.ts production guard (P3) ✅
**Source:** Plan 19 #22
**File:** `apps/web/scripts/seed-e2e.ts`
**Commit:** 2c873fc

Script refuses to run when `NODE_ENV=production` to prevent accidental data corruption.

---

## 5. Mount site-config.json as Docker volume (P3) ✅
**Source:** Plan 19 #20
**File:** `apps/web/docker-compose.yml`
**Commit:** 2c31894

site-config.json mounted as read-only volume so changes don't require rebuild.

---

## 6. Focus-trap-react lazy loading (P3) ✅
**Source:** R6 review L-10
**Files:** `search.tsx:6`, `lightbox.tsx:4`, `info-bottom-sheet.tsx:4`
**Commit:** a326d56

~15KB savings from client bundle. Created shared `lazy-focus-trap.tsx` wrapper via `next/dynamic` with `ssr: false`, updated all three consumers.

---

## Permanently Deferred

- **Font subsetting**: pyftsubset requires Python brotli module, not available on Python 3.14. Revisit when brotli support lands.
- **Docker node_modules removal**: migrate.js needs argon2/mysql2/drizzle-orm native modules that standalone output doesn't bundle for direct Node execution.
