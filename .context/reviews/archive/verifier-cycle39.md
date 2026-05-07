# Verifier — Cycle 39

## Review Scope

Evidence-based correctness check against stated behavior. Verified claims from CLAUDE.md and code comments against actual implementation.

## New Findings

### VER-39-01: `batchUpdateImageTags` remove path not aligned with `removeTagFromImage` fix [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/app/actions/tags.ts` lines 309-318
- **Description:** C38-01 fixed `removeTagFromImage` to look up by name first, then fall back to slug. The stated behavior (from the fix) is: "removes the correct tag even when slug collisions exist." However, `batchUpdateImageTags` still uses slug-only lookup in its remove path, violating the same behavioral guarantee. The fix was incomplete — it only covered one of two code paths that remove tags.
- **Evidence:** Compare `removeTagFromImage` (lines 159-168) with `batchUpdateImageTags` remove loop (lines 309-318). The former does name-first lookup; the latter does slug-only lookup.
- **Fix:** Apply the same name-first lookup pattern to `batchUpdateImageTags`.

### VER-39-02: Mobile bottom sheet GPS code unreachable (same as C38-02) [LOW] [HIGH confidence]
- **File:** `apps/web/src/components/info-bottom-sheet.tsx` lines 288-301
- **Description:** C38-02 added a comment to the unreachable GPS block in `photo-viewer.tsx`, but the same unreachable GPS block exists in `info-bottom-sheet.tsx` without the comment. The fix was incomplete — it only covered one of two components.
- **Fix:** Add the same unreachable-GPS comment to `info-bottom-sheet.tsx`.

## Previously Deferred Items Confirmed

No changes. All prior deferred items remain accurately documented.
