# Plan 326 — Cycle 8: Deferred findings carry-forward

## Origin

Cycle 8 review findings that are explicitly deferred per the plan directory rules.

## AGG8R-02 (partial — LOW). `validation.ts` length checks in `isValidTopicAlias`, `isValidTagName`, `isValidTagSlug` use `.length` instead of `countCodePoints`

- **File+line**: `apps/web/src/lib/validation.ts:23,77,88,96`
- **Original severity/confidence**: Low / Medium
- **Reason for deferral**: These validators enforce format constraints (regex + length) for slug/alias/tag-name inputs that are overwhelmingly ASCII. Emoji in slugs is rejected by the regex patterns (`isValidSlug` requires `[a-z0-9_-]`, `isValidTagSlug` requires `[\p{Letter}\p{Number}-]`). The `.length` mismatch only matters for `isValidTopicAlias` which allows CJK characters — but CJK characters are in the BMP and `.length` counts them correctly (1 code unit each). Supplementary characters (emoji) in aliases would be extremely rare and the length limit (255) is generous enough that the false-rejection window is negligible.
- **Exit criterion**: If `isValidTopicAlias` is changed to allow supplementary characters in aliases, or if a user reports false rejection for a valid alias, migrate to `countCodePoints()`.

## Carry-forward of prior deferred items

All prior deferred items from previous cycle deferred plans (plan-40, plan-43, plan-47, plan-50, plan-58, plan-59, plan-60, plan-62) remain valid and deferred with no change in status.
