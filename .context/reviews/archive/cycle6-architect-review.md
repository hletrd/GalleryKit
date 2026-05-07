# Architecture Review — Cycle 6 (2026-04-19)

## Summary
Architectural review of GalleryKit. The codebase has clean separation of concerns, well-defined module boundaries, and consistent patterns. Found **1 new finding** (LOW).

## Findings

### C6-ARCH01: Action modules import `isAdmin` from `@/app/actions/auth` directly — circular re-export through barrel
**File:** Multiple action files (images.ts, topics.ts, tags.ts, sharing.ts, admin-users.ts) all import `isAdmin` from `@/app/actions/auth`, while `@/app/actions` (barrel) re-exports from those same modules.
**Severity:** LOW | **Confidence:** HIGH

The action modules import from `@/app/actions/auth` directly (not from the barrel `@/app/actions`), which is correct and avoids circular dependency. However, `@/app/actions` barrel re-exports `isAdmin` from `auth.ts`, and client components import from `@/app/actions`. This is architecturally sound but worth noting: if someone accidentally changes an action module to import from `@/app/actions` instead of `@/app/actions/auth`, it would create a circular dependency. There is no lint rule or documentation preventing this.

**Fix:** Add a comment in `apps/web/src/app/actions.ts` documenting that action modules must import from `@/app/actions/auth` directly, not from the barrel.

## Architectural Strengths
- **Clean action decomposition:** Split into auth, images, topics, tags, sharing, admin-users, public modules
- **Barrel re-export pattern:** `actions.ts` provides clean public API while avoiding circular deps
- **Data layer separation:** `data.ts` provides cached data access functions; actions handle mutation
- **Security layering:** Middleware guard + `isAdmin()` per-action verification (defense in depth)
- **Rate limiting architecture:** In-memory fast path + DB-backed source of truth
- **Image processing pipeline:** Clean enqueue/process/verify/commit flow with claim-based concurrency
- **i18n architecture:** next-intl with proper server-side translations in actions

## Deferred Items (from prior cycles)
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
