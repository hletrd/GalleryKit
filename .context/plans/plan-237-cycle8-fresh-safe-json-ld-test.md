# Plan 237 — Cycle 8 fresh: add vitest unit test for `safe-json-ld.ts`

**Source finding:** AGG8F-26 (test-engineer)
**Severity:** LOW
**Confidence:** High

## Problem

`apps/web/src/lib/safe-json-ld.ts` is a small but security-critical helper. It escapes `<`, U+2028, and U+2029 inside JSON-LD `<script>` tags to prevent XSS via embedded `</script>` and historical JS line-terminator quirks. There is currently no vitest unit test for this helper. A regression that drops one of the escapes would not be caught.

## Fix shape

Add `apps/web/src/__tests__/safe-json-ld.test.ts` covering all three escapes plus regular round-trip.

## Implementation steps

1. Create the test file with cases:
   - `safeJsonLd({ name: '</script>' })` → output contains `</script>` not `</script>`.
   - `safeJsonLd({ note: 'a b' })` → output contains ` ` not the raw char.
   - `safeJsonLd({ note: 'a b' })` → output contains ` `.
   - `safeJsonLd({ a: 1, b: 'two' })` → JSON.parse(output) round-trips correctly.
2. Run `npm test --workspace=apps/web` to confirm passing.

## Done criteria

- All gates pass.
- Test file exists, runs in vitest, all assertions pass.
- Coverage report (informal) shows `safe-json-ld.ts` as covered.

## Risk assessment

- Test-only change. No runtime effect.
