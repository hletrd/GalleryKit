# Cycle 42 Aggregate Review

Start HEAD: `6efd00a8`.
Date: 2026-07-01.

## Scheduled Findings

1. `PA-42-01` - `lint:action-origin` misses protected Drizzle relational reads behind namespace `@/db` imports, and the same provenance boundary should cover relative `db` aliases.
2. `TV-C42-01` - `lint:action-origin` accepts inverted public analytics rate-limit gates such as `!isViewRecordRateLimited(...)`, `overLimit === false`, `.status === 'ok'`, and `.status !== 'rateLimited'`.
3. `TV-C42-02` - public analytics scanner accepts action-local shadowing of trusted limiter helper names.
4. `TV-C42-03` - JS operational script syntax checker succeeds when discovery finds zero files.
5. `UX-C42-01` - shared-group selected-photo back link exits the curated share and points to `/` instead of `/g/{key}`.
6. `A11Y-C42-02` - hidden lightbox color pip remains pointer-interactive while the controls overlay is visually hidden.
7. `DOC-C42-01` - root deploy docs omit the build-time nature of `NEXT_UPLOAD_BODY_MAX_BYTES`.
8. `DOC-C42-02` - committed context still marks Cycle 41 active/incomplete after its fix commit was pushed.

## Deferred Findings

1. `PA-42-02` - production CLIP catch-up can run inside the web process without the semantic backfill advisory lock. Deferred because the safe fix needs a broader runtime coordination decision: whether automatic production web catch-up should be disabled, capped, or lock-guarded while preserving stub-mode and recent-upload recovery behavior.

Prior deferred items remain carried forward: `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08`.

## Review Lane Results

- Security/auth: no new findings.
- Performance/architecture: one scheduled action-origin scanner gap and one deferred production CLIP runtime-coordination gap.
- Test/verifier: three scheduled guardrail gaps in action-origin/public analytics and JS script discovery.
- UX/accessibility: two scheduled photographer-facing shared-view/lightbox interaction issues.
- Documentation/deploy drift: two scheduled context/docs drift issues.
- Debugger/tracer/critic: no separate finding; relative `db` import probing folded into `PA-42-01`.

## Cycle Plan

Implement the eight scheduled findings in `.context/plans/cycle-42-2026-07-01-plan.md`; defer `PA-42-02` in `.context/plans/cycle-42-2026-07-01-deferred.md`.
