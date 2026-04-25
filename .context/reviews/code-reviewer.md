# Code Reviewer — Cycle 5 (review-plan-fix loop, 2026-04-25)

## Inventory scope
- Mutating server actions and their input-sanitization conventions.
- Cycle-3/Cycle-4 lineage: `UNICODE_FORMAT_CHARS` → `isValidTopicAlias` → `isValidTagName`. Looking for the next consumers in line.

## New findings

### C5L-CR-01 — Inconsistent admin-string sanitization policy [LOW] [High confidence]

**Files:**
- `apps/web/src/app/actions/topics.ts` (`label` lines 73, 172)
- `apps/web/src/app/actions/images.ts` (`title`/`description` lines 662-663)

**Why a problem.** The codebase has a documented sanitization policy for admin-controlled strings (see comments in `validation.ts` and the C3L/C4L commit history). Two new validator gates were added in Cycles 3 and 4. The remaining admin-controlled long-form string fields — `topic.label` and `image.title`/`image.description` — were skipped, creating a code-review inconsistency: a future contributor cannot easily tell whether the omission is intentional or simply incomplete.

**Concrete failure scenario.** A future contributor adds another admin string field, copies the pattern from `topics.ts:73`, and inherits the gap.

**Suggested fix.** Either:
(a) extend Unicode-formatting rejection to `topic.label`, `image.title`, `image.description` (preferred — closes C5L-SEC-01 and unifies the rule);
(b) document in `CLAUDE.md` why `label`/`title`/`description` are intentionally exempted (less preferred — leaves the security gap).

### C5L-CR-02 — `updateImageMetadata` sanitization comment cites pattern parity but the behaviour does not match [INFO] [Medium confidence]

**File:** `apps/web/src/app/actions/images.ts:659-663`

**Why a problem.** Inline comment claims it "matches settings.ts/seo.ts pattern" but `settings.ts:64` uses `stripControlChars(value.trim())` whereas `images.ts:662-663` uses `stripControlChars(title ? title.trim() : null) || null`. The semantic difference is correct (DB nullability) but the comment is misleading.

**Suggested fix.** Update the comment to "follows the sanitize-before-validate ordering from settings.ts/seo.ts; null preservation is image-specific".

## Out of scope
- `tags.ts` / `topic_aliases` already have full Unicode-formatting rejection (C3L/C4L).
- `auth.ts` and `admin-users.ts` use a regex that already excludes Unicode formatting characters.

## Cross-agent agreement
Overlaps with security-reviewer (root issue), architect (shared helper), document-specialist (CLAUDE.md update).
