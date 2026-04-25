# Architect — Cycle 6 (review-plan-fix loop, 2026-04-25)

## Architectural lens
Cross-cutting policy: Unicode-formatting hardening for admin-controlled persistent strings. After cycle 5 the policy is applied to two helpers (`isValidTopicAlias`, `isValidTagName`) plus three inline `UNICODE_FORMAT_CHARS.test(...)` call sites in `topics.ts`/`images.ts`. The architectural seam carried over from C5L-ARCH-01 (single helper) is still open. After applying the C6L-SEC-01 fix the call-site count rises to **seven** inline tests — the right moment to finally extract a helper.

## New findings

### C6L-ARCH-01 — Inline `UNICODE_FORMAT_CHARS.test(...)` call sites have proliferated; extract a single helper [LOW] [High confidence]

**Files (current state):**
- `apps/web/src/lib/validation.ts:33` (`UNICODE_FORMAT_CHARS` constant)
- `apps/web/src/lib/validation.ts:45` (`isValidTopicAlias` consumer)
- `apps/web/src/lib/validation.ts:56` (`isValidTagName` consumer)
- `apps/web/src/app/actions/topics.ts:83, 185` (inline `UNICODE_FORMAT_CHARS.test(label)`)
- `apps/web/src/app/actions/images.ts:670, 673` (inline `UNICODE_FORMAT_CHARS.test(sanitizedTitle/Description)`)
- *Pending C6L-SEC-01:* `apps/web/src/app/actions/seo.ts` (four more inline tests if not extracted)

**Why a problem.** Five inline call sites today, growing to nine after C6L-SEC-01. Each site repeats the same single-line check; differences in nullability handling (truthiness guard vs. unconditional test on a non-null string) are subtle and easy to copy wrongly. A reusable helper centralises the policy in one source of truth.

**Suggested fix.** Add a tiny helper to `lib/validation.ts`:

```ts
/**
 * Returns true when `value` contains Unicode bidi/invisible formatting
 * characters that should be rejected at admin-string entry points.
 * Null/empty inputs are treated as clean (the field-level required-check
 * decides whether to error on empty separately).
 */
export function containsUnicodeFormatting(value: string | null | undefined): boolean {
    return !!value && UNICODE_FORMAT_CHARS.test(value);
}
```

Replace every inline `UNICODE_FORMAT_CHARS.test(...)` with `containsUnicodeFormatting(...)`. Keep the constant exported so `isValidTopicAlias` / `isValidTagName` (which run `.test` on already-trimmed required strings) can continue to use the constant directly without the truthiness guard. This is a non-functional refactor that lands as part of C6L-SEC-01 to avoid yet another single-purpose commit.

## Out of scope
The single-instance / single-writer topology constraint, sharing tables, and admin-user fields are unaffected.

## Cross-agent agreement
Overlaps with code-reviewer (C6L-CR-02), critic (C6L-CRIT-01 — single-motion fix), security-reviewer (C6L-SEC-01 root).
