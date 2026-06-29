# Debugger — review-plan-fix cycle 2

**Date:** 2026-06-29
**HEAD:** `3d1387045e0d7f1e06fb48756e412228bbdaf08d`
**Role:** debugger
**Scope:** latent bugs, failure modes, edge cases, async/resource cleanup, parser/number/date behavior, and regression checks. No application code edited.

## Inventory Coverage

Debugger inventory was built before analysis from the same repository inventory as the code-review lane, then narrowed to failure-prone surfaces:

- Async/resource paths: image queue, backfill runner, restore actions, upload/save/delete flows, serve-upload streaming, shutdown hooks, timers, and DB pool initialization.
- Parser/number/date paths: route params, env parsing, EXIF values, pagination, semantic limits, capture-date grouping, migration journal metadata, JSON parsing, and binary metadata readers.
- Public abuse paths: semantic/similar search, OG rendering, share routes, analytics actions, public load-more/search.
- Deployment failure paths: Docker build context, nginx upload proxy, compose bind mounts, entrypoint permissions, CI workflow.
- Regression docs/plans: current top-level reports, latest run9/run10 review-plan-fix artifacts, and carry-forward deferred findings.

Targeted validation evidence:

```text
npm test --workspace=apps/web -- similar-route semantic-search-route image-types-shutter pagination nginx-config
7 files passed, 57 tests passed
```

## Confirmed Issues

### DBG-01 — Docker builds can ingest local `.claude/` worktrees because the root Docker ignore misses a gitignored runtime directory

**Severity:** Medium
**Confidence:** High
**Status:** Confirmed
**Location:** `.gitignore:30`, `.dockerignore:1-22`, `apps/web/docker-compose.yml:4-6`, `apps/web/Dockerfile:69`

Debugger view of the failure: the build pipeline has a reproducibility/resource failure mode. `.gitignore:30` excludes `.claude/`, and the current workspace contains `.claude/worktrees/...`; however `.dockerignore:1-22` excludes `.omx`, `.omc`, and `.agent` but not `.claude`. Because the compose build context is the repo root and the Dockerfile runs `COPY . .`, those local worktrees enter the Docker build context and builder filesystem.

Concrete failure scenario: after several agent sessions, `.claude/` grows or contains nested worktrees with generated files. A deploy now sends and copies that tree. Best case: the build is slower and cache keys churn on unrelated local agent state. Worse case: a future `.claude` artifact contains local diagnostics or credentials and becomes available in builder-layer cache/history, despite being intentionally excluded from Git.

Suggested fix: add `.claude/` to root `.dockerignore`; keep it aligned with `.gitignore` local-agent/runtime excludes. Add a regression test or simple static check so any future gitignored local runtime directory is either intentionally dockerignored or explicitly documented as safe to include.

## Risks / Not Confirmed

### RISK-01 — Server-local calendar semantics may surprise non-UTC/non-local deployments

**Severity:** Low risk
**Confidence:** Medium
**Location:** `apps/web/src/components/on-this-day-widget.tsx:15-17`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:67-70`, `apps/web/src/lib/data-timeline.ts:237-242`

`OnThisDayWidget` derives "today" from the Node process timezone, while timeline grouping parses timezone-less `capture_date` strings with local `Date` methods. This is not a confirmed bug because the code may intentionally define calendar views by server/operator timezone, and MySQL `DATETIME` plus camera EXIF timestamps are timezone-less. If the product wants viewer-local or fixed UTC/KST calendar semantics, these paths need an explicit helper instead of ad hoc `new Date().getMonth()/getDate()` usage.

Suggested fix if semantics are intended to be fixed-zone: centralize capture-date parsing and "today" derivation in one calendar helper, with tests for midnight boundary dates and documented server/viewer timezone behavior.

## Regression Checks Cleared

- Semantic route abuse paths: current tests passed; malformed/oversized post-read bodies and missing production embeddings are charged as intended.
- Similar route abuse paths: current tests passed; missing/corrupt target embeddings no longer refund the limiter after DB work.
- Numeric parsing regressions: pagination now uses `Number()` via `parsePageParam`; semantic env caps floor and clamp; upload/view/audit env parsing uses `Number()` guards.
- EXIF shutter formatting: subnormal positive values no longer produce `1/Infinity`.
- Binary parser sweep: current code retains explicit bounds checks in ICC, NCLX/color, gain-map, GPS strip, and embedding decode paths.
- Streaming cleanup: `serveUploadFile` streams from `realpath`, handles HEAD without opening a stream, and destroys the stream on abort/error.

## Final Sweep

Missed-issue sweep covered: parseInt/Number/date use, JSON.parse guards, raw Buffer/binary reads, timer cleanup, fire-and-forget promises, DB catch/rollback behavior, route runtime pins, Docker/nginx deploy failure modes, and stale prior findings against current HEAD.

Verdict: **1 confirmed deploy/build failure mode, 1 low-risk calendar semantics concern, and no confirmed current runtime debugger defect beyond DBG-01.**
