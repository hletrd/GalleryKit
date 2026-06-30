# Cycle 45 Code Reviewer + Critic Review

Reviewer: code-reviewer + critic
Date: 2026-07-01
HEAD reviewed: `b430cddd` (`docs(cycle-44): record deploy closure`)

## Mandatory Context Read

- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/cycle-44-2026-07-01/_aggregate.md`
- `.context/plans/cycle-44-2026-07-01-plan.md`
- `.context/plans/cycle-44-2026-07-01-deferred.md`

Cycle 44 scheduled and closed `TV-C44-01`, `TV-C44-02`, `DOC-C44-01`, and `DOC-C44-02`. I treated the carry-forward deferred list as already known and did not re-raise it: `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08`.

## Inventory

Relevant files inventoried before judging findings:

- Repo instructions and cycle context: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/_aggregate.md`, `.context/reviews/cycle-44-2026-07-01/_aggregate.md`, `.context/plans/cycle-44-2026-07-01-plan.md`, `.context/plans/cycle-44-2026-07-01-deferred.md`, `.context/plans/README.md`.
- Cycle 44 changed implementation/docs: `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/src/__tests__/check-action-origin.test.ts`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`, `CLAUDE.md`, `apps/web/README.md`.
- Admin/server actions: `apps/web/src/app/actions/admin-backfill.ts`, `admin-users.ts`, `auth.ts`, `collections.ts`, `embeddings.ts`, `images.ts`, `lr-tokens.ts`, `public.ts`, `seo.ts`, `settings.ts`, `sharing.ts`, `tags.ts`, `topics.ts`, plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- API routes: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`.
- Cross-file invariants: `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, CLIP activation docs/config/tests.

## Findings

No new issue found in this lane.

I specifically checked the Cycle 44 scanner fixes for the prior failure modes:

- `check-action-origin.ts` now requires read-auth proof names to come from approved imports (`collectApprovedReadAuthNames`, lines 200-219) and uses that approved set for exempt read checks (`exemptReadHasAuthBeforeProtectedRead`, lines 732-758; call site lines 1239-1249). The new regression fixtures cover same-file fake auth and concise protected reads.
- `check-public-route-rate-limit.ts` now fails closed for non-block expensive `GET` / `HEAD` bodies (`bodyCallsRateLimitBeforeExpensiveGetWork`, lines 553-612), and the added fixtures cover concise body ordering.
- The remaining scanner limitations I saw are either fail-closed false positives or match the existing deferred scanner-modeling debt, especially broad imported-helper side-effect classification. I did not find a new false negative with a concrete current-file failure scenario.
- The CLIP production activation docs now state that the env change must be applied to the running container before flipping the DB mode, matching the resolver behavior in `gallery-config.ts`.
- The inspected public/admin actions and API routes preserve the expected guard order: same-origin/admin checks before mutations, rate-limit pre-increment before expensive public work, and explicit operational exemptions where documented.
- Public data/privacy selectors still omit the admin-only and photographer-sensitive fields guarded by `PrivacySensitiveKeys` and `privacy-fields.test.ts`.

## Validation Notes

This review was intentionally read-only except for this artifact. I did not run lint/typecheck/tests because the user constrained the lane to read-only review work, and those commands may create caches or other generated outputs. Evidence used: line-numbered source reads, `git show` for `4ecfdde0` and `b430cddd`, route/action inventory, and the committed Cycle 44 plan/review context.
