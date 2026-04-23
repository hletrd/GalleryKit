# Plan 211 — Cycle 6 Review Fixes

Status: TODO
Owner: Codex cycle 6
Created: 2026-04-23
Source reviews: `.context/reviews/_aggregate.md`, `code-reviewer.md`, `perf-reviewer.md`, `critic.md`, `verifier.md`, `tracer.md`, `architect.md`, `debugger.md`, `designer.md`, `test-engineer.md`

## Objective
Implement every non-security finding confirmed in the cycle 6 reviews, with extra attention to performance hotspots and their regression coverage.

## Findings to address

### C6R-01 — Parallelize independent public-route reads to reduce TTFB
- Source: `AGG6-01`
- Citations:
  - `apps/web/src/app/[locale]/(public)/page.tsx:95-110`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:90-125`
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:104-123`
  - `apps/web/src/app/[locale]/layout.tsx:55-64`
- Severity / confidence: Medium / High
- Plan:
  1. Audit each route for true data dependencies vs independent reads.
  2. Convert independent fetch chains to `Promise.all` groupings without changing route behavior.
  3. Keep tag-derived filtering and image-dependent logic sequential where required.
  4. Verify no auth/SEO/config side effects change.
- Progress:
  - [ ] dependency map confirmed
  - [ ] home/topic/photo/layout routes parallelized
  - [ ] regressions checked by lint/tests/build

### C6R-02 — Return explicit `hasMore` for load-more so exact-multiple galleries stop cleanly
- Source: `AGG6-02`, `TE6-01`, `UX6-01`
- Citations:
  - `apps/web/src/app/actions/public.ts:11-25`
  - `apps/web/src/components/load-more.tsx:29-43`
  - `apps/web/src/__tests__/public-actions.test.ts`
- Severity / confidence: Low / High
- Plan:
  1. Change the public load-more action contract to return `images` plus `hasMore`.
  2. Overfetch one row (or reuse existing paginated helper) so the server knows whether another page exists.
  3. Update `LoadMore` and `HomeClient` consumers to use the explicit flag.
  4. Add regression tests covering the exact-multiple terminal-page case.
- Progress:
  - [ ] server action contract updated
  - [ ] client consumer updated
  - [ ] regression test added
  - [ ] regressions checked by lint/tests/build

## Deferred findings
- None. Every confirmed cycle 6 finding is scheduled in this plan.

## Exit criteria
- Public SSR routes no longer serialize independent reads.
- Infinite scroll stops without an empty terminal probe request on exact-multiple galleries.
- Tests cover the new load-more contract.
- All configured gates pass.
