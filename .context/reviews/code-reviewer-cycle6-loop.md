# Code Reviewer — Cycle 6 (review-plan-fix loop, 2026-04-25)

## Inventory scope
- Mutating server actions and their input-sanitization conventions.
- Cycle-3/4/5 lineage: `UNICODE_FORMAT_CHARS` → `isValidTopicAlias` → `isValidTagName` → `topic.label`/`image.title`/`image.description`. Looking for the next consumers in line.

## New findings

### C6L-CR-01 — `seo.ts` is the last consistency gap in the admin-string Unicode-formatting policy [LOW] [High confidence]

**File:** `apps/web/src/app/actions/seo.ts:71-101`

**Why a problem.** `seo.ts` follows the same `stripControlChars(value.trim())` + length-check pattern as `settings.ts`, but unlike `settings.ts` (which only stores numeric/boolean values), `seo.ts` stores four free-form strings that are rendered into HTML head and OG metadata. The pattern was correct when there was no Unicode-formatting policy in this codebase; after C3L/C4L/C5L it stands alone as the last admin-string consumer that doesn't apply the policy. A future contributor reading `seo.ts:75-78` will reasonably copy the pattern and inherit the gap.

**Concrete failure scenario.** A future SEO setting (e.g. `seo_keywords`, `seo_twitter_handle`) is added; the contributor copies the existing `seo_title` validation chain and inherits the same gap.

**Suggested fix.**
1. Add `UNICODE_FORMAT_CHARS.test(value)` rejection inline in `updateSeoSettings`, after the `stripControlChars` pass and before/around the existing length checks. Return distinct i18n error keys for each field so the UI can highlight the offending input.
2. Add a brief comment pointing to the C3L/C4L/C5L lineage so the policy reads as one cohesive thread.

### C6L-CR-02 — Pattern inconsistency between `images.ts:670-675` and `topics.ts:83/185` [INFO] [High confidence]

**File:**
- `apps/web/src/app/actions/topics.ts:83, 185` — `if (UNICODE_FORMAT_CHARS.test(label)) return { error: t('invalidLabel') };`
- `apps/web/src/app/actions/images.ts:670-675` — `if (sanitizedTitle && UNICODE_FORMAT_CHARS.test(sanitizedTitle)) { return { error: ... }; }`

**Why a problem.** `topics.ts` tests the post-`stripControlChars` value because `label` is required and non-null. `images.ts` is correct in guarding with the truthiness check (title/description are nullable). Both are correct individually but the asymmetry will trip up contributors. Suggest factoring into a single helper:

```ts
export function rejectUnicodeFormatting(value: string | null): boolean {
    return value !== null && value !== '' && UNICODE_FORMAT_CHARS.test(value);
}
```

Apply at every call site (six total after C6L-SEC-01 lands: `topic.label`×2, `image.title`, `image.description`, `seo_title`, `seo_description`, `seo_nav_title`, `seo_author` — actually eight). Keeps the policy as a single inspection point.

**Suggested fix.** Either extract the helper now (preferred — closes the architect's C5L-ARCH-01 carry-over) or document the asymmetry inline.

## Out of scope
- `tags.ts` / `topic_aliases` already have full Unicode-formatting rejection (C3L/C4L).
- `auth.ts` and `admin-users.ts` use a regex-bounded username field that excludes Unicode formatting characters.
- `settings.ts` accepts numeric/boolean values only (`gallery-config-shared.ts:10-19`); `isValidSettingValue` numeric-parses each key. No string vector.

## Cross-agent agreement
Overlaps with security-reviewer (root issue), critic (piecemeal continuation), architect (shared helper), document-specialist (CLAUDE.md update), test-engineer (coverage).
