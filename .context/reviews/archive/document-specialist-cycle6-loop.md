# Document Specialist — Cycle 6 (review-plan-fix loop, 2026-04-25)

## Inventory scope
- `CLAUDE.md` Security Architecture / Database Security bullet (the lineage description).
- `apps/web/src/lib/validation.ts:30-32` (lineage comment ending at C5L-SEC-01).
- `apps/web/src/app/actions/seo.ts:71-78` (sanitization comment that does not yet reflect the post-cycle-6 policy).

## New findings

### C6L-DOC-01 — `CLAUDE.md` Database Security bullet still does not enumerate SEO fields [LOW] [Medium confidence]

**File:** `CLAUDE.md` Database Security section.

**Why a problem.** After cycle-5 the bullet was expected to be updated to enumerate `topic.alias`, `tag.name`, `topic.label`, `image.title`, `image.description`. Once C6L-SEC-01 lands, the SEO settings (`seo_title`, `seo_description`, `seo_nav_title`, `seo_author`) need to be added too; otherwise the doc keeps lagging the implementation.

**Suggested fix.** Update the bullet to read:

> Admin-controlled persistent string fields (`topic.alias`, `tag.name`, `topic.label`, `image.title`, `image.description`, `seo_title`, `seo_description`, `seo_nav_title`, `seo_author`) reject Unicode bidi overrides (U+202A-202E, U+2066-2069) and zero-width / invisible formatting characters at the validation layer (`UNICODE_FORMAT_CHARS` in `apps/web/src/lib/validation.ts`).

### C6L-DOC-02 — `validation.ts` lineage comment stops at C5L-SEC-01 [INFO] [High confidence]

**File:** `apps/web/src/lib/validation.ts:30-39`

**Why a problem.** Comment must extend to record `C6L-SEC-01`.

**Suggested fix.** Append in the same commit that lands C6L-SEC-01:

> ..., extended to topic.label / image.title / image.description (C5L-SEC-01), and to seo_title / seo_description / seo_nav_title / seo_author (C6L-SEC-01).

### C6L-DOC-03 — `seo.ts:71-74` sanitization comment is not aware of the Unicode-formatting policy [INFO] [Medium confidence]

**File:** `apps/web/src/app/actions/seo.ts:71-74`

**Why a problem.** Existing comment says "Sanitize before validation so length checks operate on the same value". After C6L-SEC-01 it should also mention "and apply Unicode-formatting rejection consistent with the C3L/C4L/C5L lineage".

**Suggested fix.** Append the lineage reference in the same commit.
