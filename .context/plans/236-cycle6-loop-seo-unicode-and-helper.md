# Plan 236 — Cycle 6 Loop: SEO Unicode-Formatting Parity + `containsUnicodeFormatting` Helper

**Status:** TODO
**Cycle:** 6 / 100 (review-plan-fix loop)
**Source:** `_aggregate-cycle6-loop.md` AGG6L-01 / AGG6L-02 / AGG6L-03 / AGG6L-04
**Severity (highest):** LOW (closes consistency gap; no active regression).

## Goal

Close the last gap in the Unicode-formatting hardening lineage (C7R-RPL-11 → C8R-RPL-01 → C3L-SEC-01 → C4L-SEC-01 → C5L-SEC-01) by:

1. Rejecting Unicode bidi/invisible formatting characters in the four free-form SEO settings (`seo_title`, `seo_description`, `seo_nav_title`, `seo_author`).
2. Extracting a single `containsUnicodeFormatting` helper in `apps/web/src/lib/validation.ts` so the policy has one source of truth.
3. Updating documentation, lineage comments, and i18n messages.
4. Adding action-level test coverage and helper unit-test coverage.

## Scope

### In scope
- `apps/web/src/lib/validation.ts` — add `containsUnicodeFormatting`; extend lineage comment.
- `apps/web/src/app/actions/seo.ts` — apply helper to four free-form fields; comment lineage; comment skip-rationale for `seo_locale` / `seo_og_image_url`.
- `apps/web/src/app/actions/topics.ts` — refactor inline tests to use the helper (no behaviour change).
- `apps/web/src/app/actions/images.ts` — refactor inline tests to use the helper (no behaviour change).
- `apps/web/messages/en.json`, `apps/web/messages/ko.json` — four new error keys: `seoTitleInvalid`, `seoDescriptionInvalid`, `seoNavTitleInvalid`, `seoAuthorInvalid`.
- `apps/web/src/__tests__/seo-actions.test.ts` — add ≥4 new cases (one per affected field, mix of bidi and ZWSP).
- `apps/web/src/__tests__/validation.test.ts` — add `containsUnicodeFormatting` tests.
- `CLAUDE.md` — extend the Database Security bullet to enumerate the SEO fields.

### Out of scope (deferred per `_aggregate-cycle6-loop.md` carry-forward)
- Existing carry-forward backlog items (AGG5R-07 etc.).

## Implementation steps

### Step 1 — `lib/validation.ts`
Add helper:

```ts
/**
 * Returns true when `value` contains Unicode bidi/invisible formatting
 * characters that should be rejected at admin-string entry points.
 * Null/empty inputs are treated as clean — the field-level required-check
 * decides whether to error on empty separately.
 *
 * Lineage entry point for C3L/C4L/C5L/C6L. Use this helper at every
 * admin-controlled persistent string write site so the policy has one
 * canonical implementation.
 */
export function containsUnicodeFormatting(value: string | null | undefined): boolean {
    return !!value && UNICODE_FORMAT_CHARS.test(value);
}
```

Update the lineage comment at lines 30-39 to extend through `C6L-SEC-01` and reference SEO fields.

### Step 2 — `app/actions/seo.ts`
- Import `containsUnicodeFormatting` from `@/lib/validation`.
- Insert four rejection checks in `updateSeoSettings`, after `stripControlChars` and before/around the existing length checks:

```ts
if (containsUnicodeFormatting(sanitizedSettings.seo_title)) {
    return { error: t('seoTitleInvalid') };
}
if (containsUnicodeFormatting(sanitizedSettings.seo_description)) {
    return { error: t('seoDescriptionInvalid') };
}
if (containsUnicodeFormatting(sanitizedSettings.seo_nav_title)) {
    return { error: t('seoNavTitleInvalid') };
}
if (containsUnicodeFormatting(sanitizedSettings.seo_author)) {
    return { error: t('seoAuthorInvalid') };
}
// seo_locale and seo_og_image_url skip the helper because their
// existing validators (normalizeOpenGraphLocale / validateSeoOgImageUrl)
// are stricter than the Unicode-formatting filter.
```

- Update the comment at lines 71-78 to reference the C3L/C4L/C5L/C6L lineage and note the strip-vs-reject layering.

### Step 3 — `app/actions/topics.ts` and `app/actions/images.ts` (refactor only)
- Replace existing inline `UNICODE_FORMAT_CHARS.test(...)` call sites with `containsUnicodeFormatting(...)`.
- Keep the existing error keys (`invalidLabel`, `invalidTitle`, `invalidDescription`).
- Verify behaviour by running `vitest`.

### Step 4 — i18n
Add to `apps/web/messages/en.json` (alongside existing `seoTitleTooLong` family):
```json
"seoTitleInvalid": "SEO title contains disallowed formatting characters. Remove invisible or right-to-left characters.",
"seoDescriptionInvalid": "SEO description contains disallowed formatting characters. Remove invisible or right-to-left characters.",
"seoNavTitleInvalid": "Navigation title contains disallowed formatting characters. Remove invisible or right-to-left characters.",
"seoAuthorInvalid": "Author contains disallowed formatting characters. Remove invisible or right-to-left characters."
```

Add equivalent Korean translations in `ko.json`.

### Step 5 — tests
- `apps/web/src/__tests__/validation.test.ts` — add tests for `containsUnicodeFormatting`:
  - `null` / `undefined` / `''` → `false`
  - `'plain text'` → `false`
  - `'has‮rlo'` → `true`
  - `'has​zwsp'` → `true`
- `apps/web/src/__tests__/seo-actions.test.ts` — add ≥4 cases (create the file if absent, modelled on `images-actions.test.ts` / `topics-actions.test.ts`):
  - `seo_title` rejects RLO-bearing input.
  - `seo_description` rejects ZWSP-bearing input.
  - `seo_nav_title` rejects bidi-isolate-bearing input.
  - `seo_author` rejects ZWNJ-bearing input.

### Step 6 — `CLAUDE.md`
Update the Database Security bullet to enumerate the SEO fields:

> Admin-controlled persistent string fields (`topic.alias`, `tag.name`, `topic.label`, `image.title`, `image.description`, `seo_title`, `seo_description`, `seo_nav_title`, `seo_author`) reject Unicode bidi overrides (U+202A-202E, U+2066-2069) and zero-width / invisible formatting characters at the validation layer (`UNICODE_FORMAT_CHARS` / `containsUnicodeFormatting` in `apps/web/src/lib/validation.ts`).

## Verification

Verifier commitments mirror cycle 5:
1. `npm run lint --workspace=apps/web` — exit 0
2. `tsc --noEmit -p apps/web/tsconfig.json` — exit 0
3. `npm run lint:api-auth --workspace=apps/web` — exit 0
4. `npm run lint:action-origin --workspace=apps/web` — exit 0
5. `npm test --workspace=apps/web` — vitest count increases by ≥5 net cases (4 SEO + 1+ helper); existing 379 tests still pass.
6. `npm run build --workspace=apps/web` — exit 0
7. Manual sanity (skipped this cycle if vitest covers): admin SEO form rejects RLO-bearing input.

## Commit shape

Single semantic commit:

> fix(security): 🛡️ reject Unicode bidi/invisible chars in SEO settings and consolidate via `containsUnicodeFormatting`

Body should reference the AGG6L-01 / AGG6L-02 lineage and explain that this closes the last consumer in the C3L/C4L/C5L/C6L policy.

## Deploy

Per cycle DEPLOY_MODE: per-cycle. After all gates green, run `npm run deploy` once. Failure → one idempotent retry. Persistent failure → `DEPLOY: per-cycle-failed:<reason>`.

## Re-open criteria

If any of the following emerges, re-open:
- A new admin-controlled string field is added without using `containsUnicodeFormatting`.
- A reviewer reports another rendering surface that bypasses HTML escaping (e.g. raw SVG text, `dangerouslySetInnerHTML`).
- Vitest helper coverage is removed.
