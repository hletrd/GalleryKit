# Plan 382 — Cycle 22 Fixes

**Created:** 2026-04-29 (Cycle 22)
**Status:** In Progress

## C22-AGG-01: `isValidTagSlug` uses `slug.length <= 100` with `\p{Letter}` regex that allows supplementary characters — consistency gap with C21 fixes

- **Source**: `apps/web/src/lib/validation.ts:116`
- **Severity**: Low / Confidence: Medium
- **Fix**: Migrate to `countCodePoints(slug) <= 100` for consistency with `isValidTopicAlias` and `isValidTagName` which were migrated in C21. Import `countCodePoints` from `@/lib/utils` (already imported in validation.ts for C21-AGG-02/03). Update the AGG10-03 comment to reflect that the migration has been done.
- **Progress**: [ ] validation.ts fix

## C22-AGG-02: `original_format` uses `.slice(0, 10)` — safe but undocumented invariant

- **Source**: `apps/web/src/app/actions/images.ts:326`
- **Severity**: Informational / Confidence: High
- **Fix**: Add a comment at the `slice(0, 10)` call noting that the value is guaranteed ASCII by the upstream `getSafeExtension()` validator (which only allows `[a-z0-9.]`), so `.slice()` on UTF-16 code units is equivalent to code-point-based truncation.
- **Progress**: [ ] comment added

## Deferred items (no changes from prior cycles)

- A17-MED-01: data.ts god module — previously deferred
- A17-MED-02: CSP style-src 'unsafe-inline' — previously deferred
- A17-MED-03: getImage parallel DB queries — previously deferred
- A17-LOW-04: permanentlyFailedIds process-local — previously deferred
- C14-MED-03: createGroupShareLink BigInt coercion risk on insertId — previously deferred
- C14-LOW-02: lightbox.tsx showControls callback identity — previously deferred
- C14-LOW-03: searchImages alias branch over-fetch — previously deferred
