# Cycle 30 Test Engineering Review

Reviewed HEAD: `4bab5270fad3cdce6be288dda94a7322fb6997f1`.

## Finding

### C30-02 — Dirty `client-server-only-boundary` widening initially followed valid Server Action imports

- **Severity/Confidence:** High / High while present.
- **Citations:** `apps/web/src/__tests__/client-server-only-boundary.test.ts` dirty widening around `extractAliasedImports`; valid Server Action imports from client components include `dashboard-client.tsx -> @/app/actions/images`, `search.tsx -> @/app/actions/public`, `seo-client.tsx -> @/app/actions/seo`, and `db/page.tsx -> @/app/[locale]/admin/db-actions`.
- **Failure scenario:** if the test follows every `@/app` value edge, it treats legitimate Next.js Server Action references as browser-bundle leaks, blocking unit gates and CI even though the action body is not client-bundled.
- **Disposition:** already fixed in the current dirty worktree before implementation planning completed. The focused boundary test is now green and fixtures explicitly keep `@/app/actions/*` imports terminal while still walking `@/components/*` value edges.

## Non-findings

- The December archive-range behavior tests pass.
- Cycle 29 action-origin scanner hardening remains covered by executable fixtures.
- Live `use server` grep found no inline route-component action.

## Validation

- `npm test --workspace=apps/web -- --run src/__tests__/client-server-only-boundary.test.ts` passed locally after the current dirty fix: 12 tests.
- `npm test --workspace=apps/web -- --run src/__tests__/data-timeline-behavior.test.ts src/__tests__/data-timeline-truncation.test.ts src/__tests__/data-timeline.test.ts` passed in the review lane.
- `npm test --workspace=apps/web -- --run src/__tests__/check-action-origin.test.ts src/__tests__/cycle-28-source-contracts.test.ts src/__tests__/cycle-29-source-contracts.test.ts` passed in the review lane.
- `npm run lint:action-origin --workspace=apps/web` passed in the review lane.

## Reviewed inventory

`AGENTS.md`, `CLAUDE.md`, Cycle 29 reviews/plans, Cycle 10b local plan/deferred scratch files, committed carry-forward register, data-timeline source/tests, action-origin scanner/tests, and `client-server-only-boundary.test.ts`.
