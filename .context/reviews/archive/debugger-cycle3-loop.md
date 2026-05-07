# Debugger review — Cycle 3 review-plan-fix loop

## Run context
- HEAD: `67655cc`
- Lens: hypothesis-driven defect search; can I produce a failure scenario for the cycle 2 fix wave or the new fixture?

## Hypotheses tested

### H1: Could the chip-render fix break for tags with multiple consecutive underscores?

`humanizeTagLabel('Music__Festival') → 'Music  Festival'` (double space).
- React preserves whitespace literally in text nodes; CSS default `white-space: normal` collapses adjacent whitespace at render.
- Visually, double-underscored tags would still render as `Music  Festival` with collapsed whitespace.
- However: tag slugs in `data.ts` are lowercased and likely don't carry double underscores. Even if they did, the chip would render with collapsed whitespace; not a defect.
- **Verdict**: not a defect. Tracking-only.

### H2: Could the chip-render fix break for tags with leading/trailing underscores?

`humanizeTagLabel('_Music_') → ' Music '` — leading and trailing whitespace.
- The chip renders inside `Badge` with `className="text-xs"`; trim/CSS doesn't strip whitespace.
- However: tag slugs canonically are lowercased + word-shaped; leading/trailing underscore is exceptional and likely not authorable through the admin tag-create flow.
- **Verdict**: not a defect. Edge-case for unusual data, not a current regression.

### H3: Does `buildHreflangAlternates` handle path normalization correctly?

`buildHreflangAlternates('https://gallery.example.com/', '/p/42')`:
- `localizeUrl(baseUrl, locale, path)` → `absoluteUrl(baseUrl, localizePath(locale, path))`.
- `localizePath('en', '/p/42')` strips locale prefix (none) → `/en/p/42`.
- `absoluteUrl('https://gallery.example.com/', '/en/p/42')` → `https://gallery.example.com/en/p/42`. ✓
- Trailing slash on `baseUrl` is normalized by `URL` constructor.

### H4: Does the fixture test fail on Windows-style line endings?

The fixture reads file content via `fs.readFileSync(…, 'utf-8')`. The regex doesn't anchor on line boundaries; `\s` matches CR/LF. ✓

### H5: Could the fixture test pass while the import-presence assertion is bypassed via a wildcard import?

`import * as photoTitle from '@/lib/photo-title'; photoTitle.humanizeTagLabel(tag.name)` would render correctly but bypass the `import { humanizeTagLabel } from '@/lib/photo-title'` regex.
- The fixture's import regex is `/import\s*\{[^}]*\bhumanizeTagLabel\b[^}]*\}\s*from\s*['"]@\/lib\/photo-title['"]/`.
- A wildcard import `import * as foo` would not match.
- However: the `tag-label-consolidation.test.ts` describes its scope clearly — "wrap with humanizeTagLabel(tag.name) instead". A wildcard-import contributor would still produce correct visible output; the fixture's failure would be a false-positive on a working refactor.
- **Verdict**: tracking-only. The wildcard-import pattern is not idiomatic in this codebase (zero existing `import * as`); the fixture's named-import constraint is fine.

### H6: Could a future contributor break the `x-default` semantics in `buildHreflangAlternates`?

The helper writes `alternates['x-default'] = localizeUrl(baseUrl, DEFAULT_LOCALE, path)`. If `DEFAULT_LOCALE` is changed (e.g. to `'ko'`), `x-default` will follow.
- Test coverage: `locale-path.test.ts:79` asserts `'x-default': 'https://gallery.example.com/en'`. If `DEFAULT_LOCALE` changes to `'ko'`, that test would correctly fail.
- **Verdict**: not a defect; correctly captured by tests.

### H7: Could the locale-aware OG locale lookup be broken by a manually configured `seo.locale`?

`getOpenGraphLocale(locale, configuredLocale)`:
- if `isSupportedLocale(locale)` (i.e. route locale is known), return the mapped OG locale (route wins).
- else, normalize the configured locale, fallback to `en_US`.
- Test coverage: `locale-path.test.ts:53-67` exhaustively covers route-wins-on-supported, override-only-on-unknown, and invalid-override-rejection cases.
- **Verdict**: not a defect.

## Findings

**No new MEDIUM or HIGH debugger findings.**

| ID | Description | Severity | Confidence |
|---|---|---|---|
| **D3L-INFO-01** | `humanizeTagLabel` does not collapse adjacent whitespace or trim leading/trailing whitespace; pathologically-shaped tag names (`_Music__Festival_`) render with extra spaces. Not a current data shape; tracking-only. | LOW (tracking) | Medium |
| **D3L-INFO-02** | The fixture's named-import constraint would false-positive on a wildcard-import refactor. Not currently used in the codebase; tracking-only. | LOW (tracking) | Low |

## Verdict

Cycle 3 fresh debugger pass: zero MEDIUM/HIGH, two informational LOW notes (both tracking-only). No reproducible defect against current data shapes. Convergence indicated.
