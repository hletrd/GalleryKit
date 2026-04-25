# Designer — Cycle 6 (review-plan-fix loop, 2026-04-25)

## UX/Design lens
- New i18n error keys for SEO Unicode-formatting rejection should match the existing tone of the `seo*TooLong` family.
- Error messaging should not echo back the problematic character to avoid second-order rendering issues in the admin form.

## New findings

### C6L-DES-01 — New SEO-rejection i18n keys should match the tone of existing `seoXTooLong` family [LOW] [Medium confidence]

**Files:**
- `apps/web/messages/en.json` (search for `seoTitleTooLong`)
- `apps/web/messages/ko.json`

**Why a problem.** The existing copy reads e.g. `seoTitleTooLong: "SEO title is too long (max 200 characters)."`. The new errors should follow the same shape: `seoTitleInvalid: "SEO title contains disallowed formatting characters."`. Don't echo the offending char into the message; the admin UI form is the only place the message renders, but rendering bidi overrides in error messages can re-trigger the same visual reordering bug we're trying to prevent.

**Suggested fix.** Add four new keys (`seoTitleInvalid`, `seoDescriptionInvalid`, `seoNavTitleInvalid`, `seoAuthorInvalid`) plus the matching Korean translations. Keep the messages short and instructive — "remove invisible/right-to-left characters from this field" works for both audiences.

## No active design regressions detected this cycle.
