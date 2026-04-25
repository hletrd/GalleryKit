# Document Specialist — Cycle 5 (review-plan-fix loop, 2026-04-25)

## Inventory scope
- `CLAUDE.md` security architecture section.
- `validation.ts` lineage comments.
- `apps/web/src/lib/sanitize.ts` doc comment.

## New findings

### C5L-DOC-01 — `CLAUDE.md` enumerates Unicode-formatting hardening only for CSV / aliases / tags, not for the broader policy [LOW] [Medium confidence]

**File:** `CLAUDE.md` Security Architecture / Database Security bullet that lists "C7R-RPL-01" and "C8R-RPL-01" hardening.

**Why a problem.** The doc describes the CSV escape as the only Unicode-formatting hardening location. After Cycles 3 and 4 it should also describe the validator-level rejection for aliases and tag names. After this cycle (if C5L-SEC-01 lands), the section needs another addition for `topic.label`, `image.title`, `image.description`. Without periodic doc consolidation, the security narrative lags reality.

**Suggested fix.** Add one summary line under the Database Security bullet:

> Admin-controlled persistent string fields (`topic.alias`, `tag.name`, `topic.label`, `image.title`, `image.description`) reject Unicode bidi overrides (U+202A-202E, U+2066-2069) and zero-width / invisible formatting characters at the validation layer (`UNICODE_FORMAT_CHARS` in `apps/web/src/lib/validation.ts`).

### C5L-DOC-02 — `validation.ts` lineage comment stops at C4L-SEC-01 [INFO] [High confidence]

**File:** `apps/web/src/lib/validation.ts:30-32`

**Why a problem.** Lineage comment says "extended to tag names (C4L-SEC-01)". When C5L-SEC-01 lands, this comment must be updated to extend the lineage to `topic.label`/`image.title`/`image.description`.

**Suggested fix.** Append the new extension in the same commit that lands C5L-SEC-01.
