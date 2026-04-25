# Plan 238 — Cycle 8 fresh: skip JSON-LD on `noindex` page variants

**Source finding:** AGG8F-19 (2 agents: perf, designer)
**Severity:** LOW
**Confidence:** Medium

## Problem

Public pages emit JSON-LD `<script>` even when robots metadata is `{index: false, follow: true}`:

- `apps/web/src/app/[locale]/(public)/page.tsx` — `?tags=...` filtered home page
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx` — `?tags=...` filtered topic page

Search engines won't index the page; the JSON-LD is wasted bandwidth and DOM nodes.

## Fix shape

Compute a `shouldEmitJsonLd = tagSlugs.length === 0` flag in each affected page; gate the `<script>` block on it.

## Implementation steps

1. Edit `apps/web/src/app/[locale]/(public)/page.tsx`:
   - Add `const shouldEmitJsonLd = tagSlugs.length === 0;` near the top of the default export.
   - Wrap the existing `<script type="application/ld+json">` blocks in `{shouldEmitJsonLd && (...)}`.
2. Edit `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`:
   - Same change.
3. Confirm photo page (`/p/[id]`) is unaffected — it does not have a `noindex` variant.

## Done criteria

- All gates pass.
- Manual probe: `/?tags=foo` returns no JSON-LD `<script>`; `/` (no filter) does.

## Risk assessment

- No SEO regression — the page was not being indexed in the filtered case anyway.
- Minor DOM size reduction.
