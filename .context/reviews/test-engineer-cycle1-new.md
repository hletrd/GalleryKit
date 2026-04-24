# test-engineer — cycle 1 (new)

Scope: test coverage gaps, flaky tests, TDD opportunities.

## Findings

### TE1-01 — `hasTrustedSameOrigin` has no test that locks the *strict* default
- **Citation:** `apps/web/src/__tests__/request-origin.test.ts:94-106`
- **Severity / confidence:** MEDIUM / HIGH
- **Problem:** The current `"allows trusted requests without origin metadata as a compatibility fallback"` test at line 94 locks the loose default to `true`. Once the default flips, that test must flip too, or any future accidental revert silently passes. There should be a single test that asserts `hasTrustedSameOrigin({ host, x-forwarded-proto })` returns `false`.
- **Fix:** Amend the test to the stricter expectation; keep the `hasTrustedSameOriginWithOptions({ allowMissingSource: true })` compatibility path covered.

### TE1-02 — No unit coverage for normalized admin return contract
- **Citation:** `apps/web/src/app/actions/{images,seo,settings}.ts`
- **Severity / confidence:** LOW / HIGH
- **Problem:** Adding the "return stored value" contract requires at least one assertion per action that confirms the returned value has been sanitized and is not the raw input.
- **Fix:** Add a minimal vitest with a stub DB call per action.

### TE1-03 — E2E admin lane stays opt-in, never runs locally by default
- **Citation:** `apps/web/e2e/admin.spec.ts:6-7`; `apps/web/e2e/helpers.ts`
- **Severity / confidence:** MEDIUM / HIGH
- **Problem:** The entire admin describe is guarded by `test.skip(!adminE2EEnabled)` and the env flag is not auto-enabled for local safe credentials. Nothing in CI or local default `npm run test:e2e` exercises admin.
- **Fix:** Auto-enable the admin describe when the local test environment has known-safe credentials (e.g. when `E2E_ADMIN_USERNAME` is present and `process.env.NODE_ENV !== 'production'`). Keep remote admin opt-in only.

### TE1-04 — Seed alignment: `seed-e2e.ts` hard-codes sizes
- **Citation:** `apps/web/scripts/seed-e2e.ts:77-100`
- **Severity / confidence:** MEDIUM / HIGH
- **Problem:** E2E fixture generation drifts from the active gallery image-size setting. A future size-list change breaks tests without warning.
- **Fix:** Read the configured/default image sizes dynamically in the seed script.

### TE1-05 — Legacy seed slugs are not exercised by any current test
- **Citation:** `apps/web/src/db/seed.ts:4-10`
- **Severity / confidence:** LOW / HIGH
- **Problem:** If the seed is live, it should be smoke-tested. If dead, it should be removed. Either way the uppercase slugs are bit rot.

### TE1-06 — `updateImageMetadata` has no direct unit test covering the sanitized-title return
- **Severity / confidence:** LOW / HIGH
- **Fix:** Add a minimal unit test covering trim + control-char strip for title and description; mock the DB update with a fake affected-rows count.
