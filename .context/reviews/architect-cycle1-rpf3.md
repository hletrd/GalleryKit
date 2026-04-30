# architect — Cycle 1 RPF v3 (HEAD: 67655cc)

## Scope

Architectural risk in the proposed fix wave.

## Findings

### A-1 (Medium, High confidence) — Two divergent code paths for "image listing with tag names"

- `getImagesLite` / `getImagesLitePage` — correlated-subquery (broken)
- `getImages` / `getImagesAdmin` — LEFT JOIN + GROUP BY (working)

**Risk:** Two paths for the same logical operation diverge silently.
**Recommendation:** Consolidate to LEFT JOIN pattern; add unit test that
locks the contract.

### A-2 (Low, High confidence) — Touch-target rule isn't expressed as a constraint

44 px rule is enforced via reviewer pass, not CI. Five components below
44 px after three cycles prove this. **Recommendation:** Add fixture
test (`apps/web/src/__tests__/touch-target-audit.test.ts`).

### A-3 (Low, High confidence) — `blur_data_url` is fetched but not wired

`getImage()` includes blur, but photo-viewer doesn't consume it. Trivial
one-line CSS background-image addition.

### A-4 (Low, Low confidence) — `LightboxTrigger` hardcodes size

`h-8 w-8` is hardcoded in the named export. Future-proof option: add
`className?` prop. Skip this cycle; just bump to `h-11 w-11`.

## Verdict

Schedule:
1. Consolidate `getImagesLite` correlated subquery to JOIN pattern (A-1)
2. Add fixture-style touch-target test (A-2)
