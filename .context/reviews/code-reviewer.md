# Code Review — GalleryKit Cycle 14 (R14C14)

**HEAD:** 39cfa889 · **Agent:** code-reviewer (sonnet) · **Angle:** code quality, logic, SOLID, maintainability, error handling, edge cases.

## Severity summary
| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 1 (confirmed regression — `bfree` vs `bavail` in LR upload route) |
| LOW | 2 (defense-in-depth gaps in `lightbox-color-pip.tsx`) |

## Findings

### [MEDIUM] `stats.bfree` instead of `stats.bavail` in Lightroom upload disk pre-check — HIGH confidence
**File:** `apps/web/src/app/api/admin/lr/upload/route.ts:180`
The cycle-13 fix changed `apps/web/src/app/actions/images.ts:211` from `bfree` to `bavail` (with an explanatory comment), but the structurally identical disk-space pre-check in the Lightroom upload route was NOT updated.
- `lr/upload/route.ts:180` → `const freeBytes = stats.bfree * stats.bsize;` (WRONG)
- `images.ts:211` → `const freeBytes = stats.bavail * stats.bsize;` (CORRECT)

**Failure:** On ext4 with default 5% root-reserved blocks, `bfree` includes those reserved blocks the non-root `node` user cannot allocate. When `bavail < 1 GiB` but `bfree > 1 GiB`, the LR route passes the threshold check, streams the photo, then fails mid-write with `ENOSPC` leaving a partial file. The browser path (`images.ts`) would have returned the localized "insufficient disk space" error first. This is the repo's recurring "fix one sibling, miss the next" pattern.
**Fix:** `stats.bfree` → `stats.bavail` at line 180.

### [LOW] `lightbox-color-pip.tsx` reads admin-only fields without `isAdmin` guard — HIGH confidence
**File:** `apps/web/src/components/lightbox-color-pip.tsx:44,77,173,179`
Same defense-in-depth class fixed for `color-details-section.tsx` in cycle-13 (AGG-R13-06 / TRC-13-02). The parallel lightbox component was untouched:
- L44 `hasData = Boolean(image.color_primaries || image.transfer_function || image.color_pipeline_decision)` — reads admin-only `transfer_function`/`color_pipeline_decision` unguarded.
- L77 `isHdr = image.transfer_function === 'pq' || 'hlg'` — admin-only, unguarded (render site gates correctly but the derivation doesn't).
- L173/L179 render `transfer_function` / `color_pipeline_decision` rows without `isAdmin`.

Functionally safe today (both fields omitted from `publicSelectFields` → undefined for public), but a future call site passing admin-fetched data with `isAdmin={false}` would leak them. Inconsistent with the AGG-M3 convention in the sibling file.
**Fix:** wrap admin-only reads in `isAdmin && …`, mirroring `color-details-section.tsx:228,402`.

## Confirmed-deferred (no change)
- TRC-13-05 — `BoundedMap.entries()`/`[Symbol.iterator]()` return raw inner-Map iterators (`bounded-map.ts:115,119`). Zero callers. Deferred.
- SEC-13-02 / AGG-R12-09 — `hasTrustedSameOriginWithOptions` exported (`request-origin.ts:109`). Zero production callers. Deferred.
- `color-details-section.tsx` `isNonTrivialColor`/`isHdr` derivations: documented defense-in-depth gap, unchanged.

## Positive observations
- All 9 cycle-13 fixes correctly implemented (Docker `exec`, `bavail`, rate-limit shallow-copy, color-details `isAdmin` gate, feed `NULL` author, aria-describedby, load-more `min-h-11`, doc fixes).
- search/similar and search/semantic routes: correct rate-limit rollback on every early return; correct dotProduct (prod normalized) vs cosineSimilarity (stub) selection.
- All 13 action files gate with both `isAdmin()` and `requireSameOriginAdmin()`; `db-actions.ts` advisory lock released in try/finally on every restore path.
- smart-collections compiler depth-limits at MAX_DEPTH=4 with parameterized Drizzle queries; no string concat.

**Recommendation:** COMMENT. One MEDIUM regression (LR-route `bfree`) to fix before a near-full-disk deploy; two LOW defense-in-depth mirrors of a known pattern.
