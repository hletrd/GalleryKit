# Architect — Cycle 6 (review-plan-fix loop, 2026-04-25)

## Architectural lens
Cross-cutting policy: Unicode-formatting hardening for admin-controlled persistent strings. After cycle 5, the policy lives in two helpers (`isValidTopicAlias`, `isValidTagName`) plus three inline `UNICODE_FORMAT_CHARS.test(...)` call sites in `topics.ts` and `images.ts`. The architectural seam (single helper) was carried over from C5L-ARCH-01. After applying the cycle-6 SEO fix, inline call sites would multiply to seven — the right cycle to extract.

## New findings

### C6L-ARCH-01 — Inline `UNICODE_FORMAT_CHARS.test(...)` call sites have proliferated; extract a single helper [LOW] [High confidence]

**Files (current state):**
- `apps/web/src/lib/validation.ts:33` (`UNICODE_FORMAT_CHARS` constant)
- `apps/web/src/lib/validation.ts:45` (`isValidTopicAlias` consumer)
- `apps/web/src/lib/validation.ts:56` (`isValidTagName` consumer)
- `apps/web/src/app/actions/topics.ts:83, 185` (inline tests on `label`)
- `apps/web/src/app/actions/images.ts:670, 673` (inline tests on `sanitizedTitle` / `sanitizedDescription`)
- *Pending C6L-SEC-01:* `apps/web/src/app/actions/seo.ts` (four more inline tests if not extracted)

**Why a problem.** Five inline call sites today, growing to nine after the cycle-6 fix. The truthiness-handling differs subtly (required strings test post-trim; nullable strings test the post-strip value with a truthiness guard), and copying the wrong shape into a new field is the next regression mode.

**Suggested fix.** Add a `containsUnicodeFormatting(value: string | null | undefined): boolean` helper in `lib/validation.ts` that handles null/empty → false. Replace inline tests with the helper. Keep the constant exported because `isValidTopicAlias` / `isValidTagName` test on already-trimmed required strings without the truthiness guard.

## Out of scope
The single-instance / single-writer topology constraint, sharing tables, and admin-user fields are unaffected.

## Cross-agent agreement
Overlaps with code-reviewer (C6L-CR-02), critic (C6L-CRIT-01 — single-motion fix), security-reviewer (C6L-SEC-01 root).
