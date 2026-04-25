# Code Reviewer — Cycle 6 (review-plan-fix loop, 2026-04-25)

## Inventory scope
- Mutating server actions and their input-sanitization conventions.
- Cycle-3/4/5 lineage: `UNICODE_FORMAT_CHARS` → `isValidTopicAlias` → `isValidTagName` → `topic.label`/`image.title`/`image.description`. Looking for the next consumer in line.

## New findings

### C6L-CR-01 — `seo.ts` is the last consistency gap in the admin-string Unicode-formatting policy [LOW] [High confidence]

**File:** `apps/web/src/app/actions/seo.ts:71-101`

**Why a problem.** `seo.ts` follows the `stripControlChars(value.trim())` + length-check pattern. After C3L/C4L/C5L it stands alone as the last admin-string consumer that doesn't apply the Unicode-formatting policy. A future contributor reading `seo.ts:75-78` will reasonably copy the pattern and inherit the gap.

**Suggested fix.**
1. Add `UNICODE_FORMAT_CHARS.test(value)` rejection (preferably via the new `containsUnicodeFormatting` helper from C6L-ARCH-01) inline in `updateSeoSettings`, alongside the existing length checks. Return distinct i18n error keys for each field so the UI can highlight the offending input.
2. Add a brief comment pointing to the C3L/C4L/C5L lineage so the policy reads as one cohesive thread.

### C6L-CR-02 — Pattern inconsistency between `images.ts:670-675` and `topics.ts:83/185` [INFO] [High confidence]

**Files:**
- `apps/web/src/app/actions/topics.ts:83, 185` — `if (UNICODE_FORMAT_CHARS.test(label)) ...`
- `apps/web/src/app/actions/images.ts:670-675` — `if (sanitizedTitle && UNICODE_FORMAT_CHARS.test(sanitizedTitle)) ...`

**Why a problem.** Both correct individually; together they invite copy-the-wrong-shape. Factor into `containsUnicodeFormatting`, which encapsulates the truthiness guard.

## Out of scope
- `tags.ts` / `topic_aliases` already have full Unicode-formatting rejection (C3L/C4L).
- `auth.ts` and `admin-users.ts` use a regex-bounded username field that excludes Unicode formatting characters.
- `settings.ts` accepts numeric/boolean values only (`gallery-config-shared.ts:10-19`); `isValidSettingValue` numeric-parses each key. No string vector.

## Cross-agent agreement
Overlaps with security-reviewer (root issue), critic (piecemeal continuation), architect (shared helper), document-specialist (CLAUDE.md update), test-engineer (coverage).
