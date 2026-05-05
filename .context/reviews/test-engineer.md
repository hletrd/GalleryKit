# Test Engineer Review — Cycle 19

## Method

Reviewed test coverage for newly introduced code (`check-public-route-rate-limit.ts`), verified existing fixture contracts, and identified gaps in edge-case testing. Examined `__tests__/` directory for relevant test files.

---

## Verified Prior Fixes

- C18-TEST-01 (checkout idempotency): FIXED — `route.ts` no longer uses `randomUUID()` in idempotency key.
- C18-TEST-02 (SW cache key): FIXED — `sw.js` uses string keys consistently.
- C18-TEST-03 (semantic search codepoints): FIXED — `route.ts` now uses `countCodePoints(query) < 3`.

---

## Findings

### C19-TEST-01 (MEDIUM): No test for ESM import of `check-public-route-rate-limit.ts`

- **Source**: `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
- **Issue**: The test file imports `checkPublicRouteSource` from `../../scripts/check-public-route-rate-limit`. If the module is ever loaded in an ESM context (e.g., future Vitest ESM mode), the top-level `require.main === module` expression crashes with `ReferenceError`. No test verifies safe import in both CJS and ESM environments.
- **Fix**: Add a test that verifies the module can be imported without throwing. Alternatively, fix the entry-point detection (C19-CR-01) and add a test that mocks `import.meta.url` and `require.main`.
- **Confidence**: High

### C19-TEST-02 (LOW): `check-public-route-rate-limit.test.ts` does not test exact-prefix helper names

- **Source**: `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
- **Issue**: No test verifies that a helper named exactly `preIncrement()` (no suffix) is detected. The regex `[A-Za-z0-9_]+` requires at least one suffix character. If a future route uses a generic `preIncrement` helper, the lint gate would fail it.
- **Fix**: Add a test case with `export const POST = async () => { if (preIncrement('1.2.3.4')) return { status: 429 }; ... }` and assert it passes.
- **Confidence**: Medium

### C19-TEST-03 (LOW): No test for `getImageByShareKeyCached` purity vs `getSharedGroupCached` side effects

- **Source**: `apps/web/src/lib/data.ts`
- **Issue**: No test verifies that `getImageByShareKey` does NOT buffer view counts, or that `getSharedGroup` DOES buffer them when `incrementViewCount` is enabled. The misplaced comment (C19-DOC-01) could lead to incorrect assumptions.
- **Fix**: Add unit tests that spy on `bufferGroupViewCount` and verify it is called by `getSharedGroup` but NOT by `getImageByShareKey`.
- **Confidence**: Low

---

## Test coverage confirmed adequate

- `check-public-route-rate-limit.test.ts`: 13 test cases covering function exports, variable exports, export specifiers, exempt tags, string-literal false positives, commented-out helpers.
- `data-tag-names-sql.test.ts`: Locks the `GROUP_CONCAT` shape.
- `touch-target-audit.test.ts`: Enforces 44px minimum.
- `process-image-blur-wiring.test.ts`: Locks producer-side blur validation.
- `action-origin.test.ts`: Scans all mutating server actions.
- `api-auth.test.ts`: Verifies admin API routes wrap with `withAdminAuth`.
