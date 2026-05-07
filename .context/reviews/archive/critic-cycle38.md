# Critic Review — Cycle 38 (2026-04-19)

## Reviewer: critic
## Scope: Multi-perspective critique of the whole change surface

### Overall Assessment
The codebase is in excellent shape after 37+ review cycles. The architecture is clean, security is well-hardened, and edge cases are handled defensively. My critique focuses on patterns that could degrade over time if not addressed.

### Cross-Cutting Concerns

**Finding CRI-38-01: Multiple in-memory Maps with similar but not identical pruning logic**
- **Files**: `rate-limit.ts`, `auth-rate-limit.ts`, `actions/images.ts`, `actions/sharing.ts`, `actions/public.ts`
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: There are at least 5 separate in-memory Maps with pruning logic:
  1. `loginRateLimit` (rate-limit.ts) — prunes expired + hard cap eviction
  2. `searchRateLimit` (rate-limit.ts) — prunes expired + hard cap eviction
  3. `passwordChangeRateLimit` (auth-rate-limit.ts) — prunes expired + hard cap eviction
  4. `uploadTracker` (actions/images.ts) — prunes expired + hard cap eviction
  5. `shareRateLimit` (actions/sharing.ts) — prunes expired + hard cap eviction

  Each implements the same pattern: iterate and delete expired entries, then evict oldest entries by insertion order if over the hard cap. This is a DRY violation — the pruning logic is duplicated 5 times with minor variations. If the eviction strategy needs to change (e.g., to LRU), it must be updated in all 5 places.
- **Fix**: Extract a generic `BoundedMap<K, V>` or `PrunableMap` class that encapsulates the pruning logic, with configurable max size, TTL, and eviction strategy.

**Finding CRI-38-02: Tag slug collision is a systemic issue affecting multiple operations**
- **Files**: `actions/tags.ts`, `actions/images.ts`
- **Severity**: MEDIUM | **Confidence**: HIGH
- **Description**: Tag slug collisions (e.g., "SEO" and "S-E-O" both slug to "s-e-o") affect:
  1. `addTagToImage` — warns about collision, uses existing tag
  2. `removeTagFromImage` — removes by slug, could remove wrong tag
  3. `batchAddTags` — warns about collision, uses existing tag
  4. `batchUpdateImageTags` — warns about collision, uses existing tag
  5. `uploadImages` — warns about collision in console
  6. `updateTag` — changes slug, could create new collisions

  The root cause is that tag names are not unique (only the slug is unique). The slug derivation (`name.toLowerCase().replace(/[^a-z0-9]+/g, '-')`) is lossy. The system warns about collisions but doesn't prevent them or offer disambiguation.
- **Fix**: Either (a) make tag names unique in addition to slugs, or (b) change tag operations to use IDs instead of names/slug for lookups, or (c) add a disambiguation step when a collision is detected.

**Finding CRI-38-03: Dead code in photo-viewer.tsx GPS display**
- **File**: `apps/web/src/components/photo-viewer.tsx` lines 470-483
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: As noted in SEC-38-01, the GPS coordinates display code in PhotoViewer is unreachable because `selectFields` (used by `getImage`) excludes `latitude` and `longitude`. This dead code adds complexity and could be misleading to future developers who might assume GPS data is available.
- **Fix**: Remove the dead GPS display code or add a clear comment explaining why it's unreachable.

**Finding CRI-38-04: `db-actions.ts` export CSV uses `results = [] as typeof results` to release memory**
- **File**: `apps/web/src/app/[locale]/admin/db-actions.ts` line 76
- **Severity**: LOW | **Confidence**: LOW
- **Description**: The `results = [] as typeof results` pattern to release the reference for GC is unconventional. While it works, it could confuse developers who aren't familiar with the pattern. A more idiomatic approach would be to use a block scope or extract the CSV generation into a separate function.
- **Fix**: Extract CSV generation into a helper function that doesn't hold both references simultaneously.

### Summary
The codebase is well-maintained and the most impactful finding is the tag slug collision issue (CRI-38-02) which has cross-cutting implications. The DRY violation in Map pruning (CRI-38-01) is a maintainability concern that should be addressed when convenient.
