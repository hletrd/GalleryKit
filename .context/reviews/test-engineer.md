# Test Engineer — Cycle 3

## Coverage Gaps

### G1: Service Worker `networkFirstHtml` body consumption
- **File**: `apps/web/public/sw.js`
- **Gap**: No unit or e2e test verifies that a network-success HTML fetch returns a readable body. The existing `sw-cache.test.ts` likely only tests metadata or cache keys.
- **Recommendation**: Add a test that mocks a network response with a body, runs `networkFirstHtml`, and asserts the returned response text matches the original.

### G2: `check-public-route-rate-limit.ts` string-literal false positive
- **File**: `apps/web/scripts/check-public-route-rate-limit.ts`
- **Gap**: The fixture test (`check-public-route-rate-limit.test.ts`) does not include a case where the helper name appears inside a string literal but no actual call exists.
- **Recommendation**: Add a test with `const docs = "preIncrementFoo("; export async function POST(...) {}` and assert it fails.

### G3: OG photo size cap
- **File**: `apps/web/src/app/api/og/photo/[id]/route.tsx`
- **Gap**: No test for derivatives exceeding a size threshold.
- **Recommendation**: Mock a fetch returning a 5 MB buffer and assert fallback behavior.

### G4: Reactions post-transaction rollback
- **File**: `apps/web/src/app/api/reactions/[imageId]/route.ts`
- **Gap**: Existing tests likely cover happy path and DB errors, but not post-transaction throw.
- **Recommendation**: Inject a thrown error after the transaction mock and assert rate-limit counters are NOT rolled back.
