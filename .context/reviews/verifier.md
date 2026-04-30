# Verifier Review — verifier (Cycle 8)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Evidence-based correctness check

### Gate verification

| Gate | Status |
|------|--------|
| eslint | PASS |
| tsc --noEmit | PASS |
| vitest | PASS |
| lint:api-auth | PASS |
| lint:action-origin | PASS |
| npm run build | PASS |

### Verified behavior

1. **sanitizeAdminString contract**: Verified that `sanitizeAdminString` correctly combines `stripControlChars` + Unicode formatting rejection in one call. However, discovered a critical flaw (C8-V-01): the `UNICODE_FORMAT_CHARS_RE` regex has the `/g` flag and is used with `.test()`, making the rejection alternately pass/fail for the same input.

2. **countCodePoints adoption**: Verified that `updateImageMetadata` (images.ts:707,711) correctly uses `countCodePoints()` for title/description length checks. However, `topics.ts:103,202` and `seo.ts:94-112` still use `.length` — the fix was not applied consistently.

3. **Upload flow**: Verified the full upload pipeline from FormData to DB insert to queue enqueue. `assertBlurDataUrl` contract is enforced at both producer and consumer.

4. **Privacy enforcement**: `publicSelectFields` omits all sensitive fields. Compile-time guard `_SensitiveKeysInPublic` confirms no leakage.

5. **Auth flow**: Login rate limiting correctly pre-increments before Argon2 verify. Account-scoped rate limiting is present. Password change validates form fields before consuming rate-limit attempts.

### Verified fixes from prior cycles

1. C7-V-01 (redundant `IS NULL`): VERIFIED — standalone conditions removed from undated prev/next.
2. C7-V-02 (`.length` vs code points in images.ts): VERIFIED — `countCodePoints()` used.

### New Findings

#### C8-V-01 (Medium / High). `sanitizeAdminString` uses stateful `/g` regex with `.test()` — bidi rejection alternately passes and fails

- Location: `apps/web/src/lib/sanitize.ts:136`
- Verified with a Node.js reproduction script: calling `UNICODE_FORMAT_CHARS_RE.test('hello‪world')` alternates between `true` and `false` on consecutive calls because the `/g` flag makes `.test()` stateful. After `stripControlChars` calls `.replace()` with the same regex (advancing `lastIndex`), the subsequent `.test()` in `sanitizeAdminString` can return `false` for a string containing bidi overrides.
- This is a direct security regression: the `sanitizeAdminString` helper was specifically designed to prevent Trojan-Source bidi overrides, but the stateful regex can allow them through.
- Verified that `UNICODE_FORMAT_CHARS` in `validation.ts` does NOT have the `/g` flag and is safe for `.test()` use.
- Suggested fix: Import and use `UNICODE_FORMAT_CHARS` from `validation.ts` for the `.test()` check, or define a separate non-`/g` regex.

#### C8-V-02 (Low / Medium). `topics.ts` and `seo.ts` still use `.length` for MySQL varchar comparisons — `countCodePoints` fix not applied consistently

- Location: `apps/web/src/app/actions/topics.ts:103,202` and `apps/web/src/app/actions/seo.ts:94-112`
- Verified that `images.ts` uses `countCodePoints()` but the same class of fix was not applied to `topics.ts` (label) or `seo.ts` (all SEO fields). These all compare against MySQL varchar limits.
- Same false-rejection risk as C7-V-02 / AGG7R-02, just on different fields.

## Carry-forward (unchanged — existing deferred backlog)

- C6-V-02: `bootstrapImageProcessingQueue` cursor continuation path untested.
- C4-CR-03/C5-CR-03/C6-V-01: NULL `capture_date` navigation integration test gap.
