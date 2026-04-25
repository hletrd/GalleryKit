# Document Specialist — Cycle 1 (review-plan-fix loop, 2026-04-25)

## Lens

Doc drift, lineage comments, public-facing docs vs. implementation.

**HEAD:** `8d351f5`
**Cycle:** 1/100

## Doc surface delta

The 11 fix commits don't touch:
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `apps/web/.env.local.example`
- `docs/` (none in repo)

Every code change has an inline F-* lineage comment citing the designer-finding ID. Comments are well-placed and explain the *why*. Verified via grep `F-(1|2|...|23)`.

## Findings

### DS1-LOW-01 — `seo.locale` semantics undocumented after F-6/F-16 (LOW, High confidence)

**File/region:** `apps/web/src/lib/locale-path.ts:57-69`, plus the SEO settings page (`apps/web/src/app/[locale]/admin/seo/...`) and the database column for `seo.locale`.

**Why a problem:** The admin "Open Graph locale" setting changed semantics — it's now a fallback for unsupported route locales rather than the primary OG locale. Neither the settings UI nor the DB schema documents this. A future admin who sets `seo.locale = 'en_GB'` to advertise British English on Korean pages will have no UI feedback that the value is silently ignored.

**Failure scenario:** Confused admin opens an issue, reports "OG locale not working".

**Suggested fix:** Add a docstring above `getOpenGraphLocale` explaining the precedence, and (optionally) a help-text under the SEO admin form. Out of scope for the UI fix wave; record only.

**Confidence:** High.

### DS1-LOW-02 — F-* finding-IDs not yet recorded in any plan archive (LOW, Medium confidence)

**File/region:** `.context/plans/` lacks a plan referencing F-1..F-23.

**Why a problem:** The 11 commits cite F-* IDs in commit messages and code comments, but there's no plan file that maps F-1..F-23 to designer-review observations. Future archaeologists trying to understand what F-15 means will only find scattered breadcrumbs.

**Suggested fix:** Either (a) drop a "designer-cycle-N-fix" plan file in `.context/plans/done/` documenting the 23 findings and their resolutions, or (b) add a single section in CLAUDE.md or `.context/reviews/_aggregate-cycle1-fresh.md` enumerating them.

**Confidence:** Medium.

### DS1-INFO-01 — All commit messages follow the gitmoji + semantic format (positive)

**File/region:** Every commit in the 11-commit window uses `<type>(<scope>): <gitmoji> <description>`. Verified via `git log --oneline`.

**Confidence:** High.

### DS1-INFO-02 — Inline `F-*` comments are well-placed (positive)

**File/region:** Comments cite the finding ID and explain the rationale (e.g. "F-6/F-16: when the request is on a recognized route locale ... the OG locale MUST match"). Good discoverability.

**Confidence:** High.

## Findings

**Zero new MEDIUM or HIGH findings.**

LOW: DS1-LOW-01, DS1-LOW-02.

## Confidence

High.

## Recommendation

DS1-LOW-01 (settings semantics doc) is worth a small docstring fix. DS1-LOW-02 can be addressed by writing the cycle 1 aggregate review (which will be done in this cycle's _aggregate file).
