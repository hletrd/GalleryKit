# Architect Review — Cycle 7 (R2)

**Date:** 2026-04-19
**Reviewer:** architect
**Scope:** Architectural risks, coupling, layering

## Findings

### ARCH-7R2-01: `searchImages` SearchResult type leaks internal schema to public API [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/lib/data.ts` lines 573-587
- **Description:** The `SearchResult` interface includes `filename_jpeg`, `filename_webp`, `filename_avif` — these are internal storage filenames (UUID-based). This type is exported and used by the unauthenticated `searchImagesAction` in `public.ts`, which returns the full array to the client. This violates the same privacy principle that `publicSelectFields` was designed to enforce. The `selectFields`/`publicSelectFields` system carefully omits sensitive fields from public queries, but `searchImages` bypasses this by defining its own `searchFields` that include filename columns.
- **Fix:** Create a `searchPublicFields` that omits filename columns, or apply the existing `publicSelectFields` pattern to the search function.
- **Cross-agent:** Also flagged by security-reviewer (SEC-7R2-01), code-reviewer (CR-7R2-02), designer (UX-7R2-01).

### ARCH-7R2-02: Settings upserts are not transactional — partial writes on crash [LOW] [MEDIUM confidence]
- **Files:** `apps/web/src/app/actions/seo.ts` lines 100-111, `apps/web/src/app/actions/settings.ts` lines 57-67
- **Description:** Both `updateSeoSettings` and `updateGallerySettings` perform individual `INSERT ... ON DUPLICATE KEY UPDATE` operations in a for loop without a transaction. If the process crashes mid-loop, the application can be left in an inconsistent state. This is particularly concerning for `updateGallerySettings` where the storage backend switch happens after the loop — if only some settings are written before the crash, the DB state may be inconsistent with the runtime state.
- **Fix:** Wrap the loop in `db.transaction()`.
- **Cross-agent:** Also flagged by code-reviewer (CR-7R2-05) and debugger (DBG-7R2-03).

## Previously Deferred Items Confirmed (No Change)

ARCH-38-03 (data.ts god module) remains deferred.
