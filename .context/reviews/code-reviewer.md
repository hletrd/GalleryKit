# Code Review — Cycle 4 (review-plan-fix loop, 2026-04-25)

## Inventory

Same as security-reviewer plus: data layer (`apps/web/src/lib/data.ts`), image queue (`image-queue.ts`), revalidation helpers, sharing actions, `proxy.ts`, validation/sanitize tests.

## Findings

### C4L-CR-01 — `UNICODE_FORMAT_CHARS` regex is duplicated implicitly between `isValidTopicAlias` and CSV-escape logic [LOW] [Medium confidence]

- **File / line:** `apps/web/src/lib/validation.ts:37`, `apps/web/src/lib/csv-escape.ts` (parallel logic).
- **Issue:** The set of high-codepoint formatting characters the project hardens against is encoded twice — once as a regex in `validation.ts` and once as character-class strips in `csv-escape.ts`. Adding `isValidTagName` parity (C4L-SEC-01) means a third consumer. Without a shared constant, the regex risks drift over time.
- **Suggested fix:** Export `UNICODE_FORMAT_CHARS` from `validation.ts` (or a new `lib/unicode-format-chars.ts`) and re-use it in both `isValidTopicAlias` and the new `isValidTagName` check.
- **Confidence:** Medium — cleanup; not a correctness bug.

### C4L-CR-02 — `tag-records.ts:33-35` exact-match query case-sensitivity [INFO] [Low confidence]

- **File / line:** `apps/web/src/lib/tag-records.ts:30-44`
- **Issue:** `selectTagByNameOrSlug` runs `eq(tags.name, cleanName)`. With utf8mb4_*_ci collation, `=` is case-insensitive — that's actually intent: UNIQUE on `name` enforces case-insensitive uniqueness, so concurrent inserts of differently-cased names converge on slug. No issue.
- **Suggested fix:** None.
- **Confidence:** Low (verified intentional; logged for completeness).

## No findings (verified clean)

- Same-origin guard wiring across all `apps/web/src/app/actions/*.ts` mutations.
- `revalidate = 0` annotations on public photo/topic/shared/home pages.
- `requireSameOriginAdmin` wired into all mutating exports.
- Per-image-processing advisory lock + conditional UPDATE remains race-safe.
- Audit log truncation and `purgeOldAuditLog` retention path correct.

## Confidence summary

- C4L-CR-01 — Medium (cleanup)
- C4L-CR-02 — Low (no action)
