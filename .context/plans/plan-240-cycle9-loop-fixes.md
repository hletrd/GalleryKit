# Plan 240 — Cycle 9 loop: close out cycle-8 unlanded plans

**Source:** `.context/reviews/_aggregate-cycle9-loop.md`
**Severity:** LOW (both items)
**Confidence:** High

## Scope

Cycle 9 reviewers (11 roles) returned **zero new MEDIUM or HIGH findings**.
The only material work is closing out two cycle-8-scheduled plans:

| Plan | Source AGG ID | Description | Cycle-9 status at start |
|---|---|---|---|
| 237 | AGG8F-26 | Add vitest unit test for `safe-json-ld.ts` | **Already DONE pre-cycle** — `apps/web/src/__tests__/safe-json-ld.test.ts` was committed on 00000003f2 ("fix(seo): escape U+2028/U+2029 in safeJsonLd"). 7 cases passing under vitest. No further work needed. |
| 238 | AGG8F-19 | Skip JSON-LD `<script>` on noindex page variants | Implemented this cycle (this plan). |

Plan 237 verification only — implementation work is plan 238 alone.

## Implementation steps

### Plan 237 — verification only

`apps/web/src/__tests__/safe-json-ld.test.ts` already contains 7 vitest
cases covering all three escapes (`<`, U+2028, U+2029) plus combined
payloads, plain-string passthrough, Unicode passthrough, and nested
JSON. Verified `npx vitest run safe-json-ld` → 7 / 7 pass. **DONE.**

### Plan 238 (skip JSON-LD on noindex)

1. Edit `apps/web/src/app/[locale]/(public)/page.tsx`:
   - Add `const shouldEmitJsonLd = tagSlugs.length === 0;` in the default
     export.
   - Wrap `<script type="application/ld+json">` block in
     `{shouldEmitJsonLd && (...)}`.
2. Edit `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`:
   - Same change (compute `shouldEmitJsonLd` from the same tag-slug
     source the page uses for its noindex decision).
3. Confirm photo page (`/p/[id]`) is unaffected — it has no noindex
   variant.

## Done criteria

- All gates pass:
  - `npm run lint --workspace=apps/web`
  - `npm run typecheck --workspace=apps/web`
  - `npm run lint:api-auth --workspace=apps/web`
  - `npm run lint:action-origin --workspace=apps/web`
  - `npm test --workspace=apps/web`
  - `npm run test:e2e --workspace=apps/web`
  - `npm run build --workspace=apps/web`
- `safe-json-ld.test.ts` continues to pass (verified DONE).
- Filtered home/topic pages (with `?tags=`) emit no JSON-LD `<script>`;
  unfiltered pages still emit it.

## Risk assessment

- Plan 237: test-only change. No runtime effect.
- Plan 238: minor DOM size reduction on filtered views. SEO unaffected
  because filtered views are already `noindex`.

## Out of scope

- All other LOW findings from cycle 9 — see plan-241-cycle9-loop-deferred.md.
