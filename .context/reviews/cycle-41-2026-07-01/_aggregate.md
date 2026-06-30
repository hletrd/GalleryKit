# Cycle 41 Aggregate Review

Start HEAD: `ae71bd5a`.
Date: 2026-07-01.

## Scheduled Findings

1. `TV-C41-01` - `lint:public-route-rate-limit` accepts inverted limiter gates such as `!preIncrement*()` and `overLimit === false` before protected work.
2. `TV-C41-02` - `lint:public-route-rate-limit` misses expensive GET/HEAD work through aliased `db` imports from `@/db`.
3. `TV-C41-03` - `lint:public-route-rate-limit` misses DB-backed helper calls imported through relative paths to known expensive modules.
4. `TV-C41-04` - Public mutating handlers can perform expensive public work before the limiter because the mutating-handler path only checks mutation ordering.
5. `TV-C41-05` - `lint:action-origin` misses pre-origin auth/session reads when `isAdmin`, `getCurrentUser`, or `getSession` are imported under aliases.
6. `TV-C41-06` - `lint:action-origin` misses protected Drizzle relational reads when `db` is imported under an alias.
7. `DOC-C41-01` - CLIP seed/backfill sidecar commands in `CLAUDE.md` omit the `tsconfig.json` mount required for `tsx` path aliases.
8. `DOC-C41-02` - Root `README.md` implies GPS stripping can be changed after uploads, while code locks the setting once photos exist.
9. `UX-C41-01` - Shared-link photo viewers can render whole-library similar photos outside the shared set.
10. `UX-C41-02` - Public semantic/similar APIs expose numeric similarity scores despite the no-scoring product policy.

## Deferred Findings

No new Cycle 41 finding is deferred. Prior deferred items remain unchanged:

1. `TV-40-03` - JS operational scripts need a dedicated semantic-checking migration.
2. `PERF-C39-03` / `PERF-C39-04` - index migrations need query-plan and reconcile coverage before scheduling.
3. `AGG-C38-07` / `AGG-C38-08` - broader scanner modeling and sidecar keyset pagination remain larger design items.

## Review Lane Results

- Code / debugger: no new actionable findings; review artifact committed in `39247fd5`.
- Security / tracer: no new actionable security findings; review artifact pending in this cycle.
- Performance / architecture: two scanner-classification findings, both scheduled.
- Test / verifier: three scanner false negatives, all scheduled; review artifact committed in `ae381e7c`.
- Docs / runbook: two doc drift findings, both scheduled.
- Critic / designer: two photographer-facing product/UX findings, both scheduled.

## Cycle Plan

Implement the ten scheduled findings in `.context/plans/cycle-41-2026-07-01-plan.md`; record no new Cycle 41 deferrals in `.context/plans/cycle-41-2026-07-01-deferred.md`.
