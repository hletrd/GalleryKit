# Code Reviewer — Cycle 10 (review-plan-fix loop, 2026-04-25)

## Lens

General code quality, maintainability, idiomatic correctness.

**HEAD:** `24c0df1 perf(seo): 🧹 skip JSON-LD on noindex page variants`
**Cycle:** 10/100

## Scope

Cycle 9 closed with zero MEDIUM/HIGH findings and only one in-scope LOW
fix (skip JSON-LD on noindex). The diff between the cycle 9 baseline
(`35a29c5`) and HEAD (`24c0df1`) is one commit, two files: 24
insertions, 9 deletions.

## Files inspected for diff

- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`

## Cross-surface checks

- `p/[id]/page.tsx` emits JSON-LD but never sets `index: false`, so
  the noindex parity issue does not apply.
- `s/[key]/page.tsx`, `g/[key]/page.tsx` set `robots` via
  `sharePageRobots` and emit no JSON-LD.

## Findings

**Zero new MEDIUM or HIGH findings.**

The cycle 9 commit is correct, minimal, and consistent: `shouldEmitJsonLd
= tagSlugs.length === 0` mirrors the existing
`robots: tagSlugs.length > 0 ? { index: false, follow: true } : undefined`
gate on the same variable. The unfiltered website + gallery JSON-LD
remains on indexable variants. No regression.

### LOW informational (no action)

- **CR10-INFO-01** — `(public)/page.tsx` evaluates `getImagesLitePage`
  on the noindex (filtered) view but skips JSON-LD. The DB query is
  needed for `HomeClient` render anyway, so this is not wasted work.
- **CR10-INFO-02** — `galleryLd` is still computed on the noindex view
  before being gated. Branch is short and JIT-friendly; not worth a
  micro-opt refactor.

## Confidence

High. Diff is small, the change is a pure subtractive guard, all
existing tests cover the affected paths via `safe-json-ld.test.ts`.

## Recommendation

No further code-quality changes warranted from this lens.
