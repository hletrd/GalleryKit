# Plan 211 — Cycle 6 Review Fixes

Status: DONE
Owner: Codex cycle 6
Created: 2026-04-23
Completed: 2026-04-23
Source reviews: `.context/reviews/_aggregate.md`, `code-reviewer.md`, `perf-reviewer.md`, `critic.md`, `verifier.md`, `tracer.md`, `architect.md`, `debugger.md`, `designer.md`, `test-engineer.md`

## Objective
Implement every non-security finding confirmed in the cycle 6 reviews, with extra attention to performance hotspots and their regression coverage.

## Findings addressed

### C6R-01 — Parallelize independent public-route reads to reduce TTFB
- Source: `AGG6-01`
- Citations:
  - `apps/web/src/app/[locale]/(public)/page.tsx:95-110`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:90-125`
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:104-123`
  - `apps/web/src/app/[locale]/layout.tsx:55-64`
- Severity / confidence: Medium / High
- Progress:
  - [x] dependency map confirmed
  - [x] home/topic/photo/layout routes parallelized
  - [x] regressions checked by lint/tests/build

### C6R-02 — Return explicit `hasMore` for load-more so exact-multiple galleries stop cleanly
- Source: `AGG6-02`, `TE6-01`, `UX6-01`
- Citations:
  - `apps/web/src/app/actions/public.ts:11-25`
  - `apps/web/src/components/load-more.tsx:29-43`
  - `apps/web/src/__tests__/public-actions.test.ts`
- Severity / confidence: Low / High
- Progress:
  - [x] server action contract updated
  - [x] client consumer updated
  - [x] regression test added
  - [x] regressions checked by lint/tests/build

## Deferred findings
- None. Every confirmed cycle 6 finding was implemented in this cycle.

## Verification
- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm test --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web`
- `npm run build`
