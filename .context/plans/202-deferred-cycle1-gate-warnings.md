# Plan 202 — Deferred Gate Warnings (Cycle 1)

**Status:** TODO / deferred
**Context:** warnings observed after completing the Cycle 1 fixes and rerunning all required gates.

## Deferred warning 1 — Next.js edge-runtime static-generation notice
- **Severity:** warning
- **Confidence:** High
- **Citation:** `apps/web/src/app/api/og/route.tsx:6`, `apps/web/src/app/apple-icon.tsx:4`, `apps/web/src/app/icon.tsx:5`
- **Observed warning:** `Using edge runtime on a page currently disables static generation for that page`
- **Reason for deferral:** This is an expected framework notice caused by intentional `runtime = 'edge'` declarations on OG/icon routes. Removing the warning cleanly would require changing the runtime model for those routes, which is outside this cycle's review-fix scope.
- **Exit criterion:** Revisit only if these routes no longer need edge runtime or if the warning becomes an actual build/test failure.

## Deferred warning 2 — `NO_COLOR` vs `FORCE_COLOR` warning from Playwright child processes
- **Severity:** warning
- **Confidence:** Medium
- **Citation:** `apps/web/playwright.config.ts:56`
- **Observed warning:** `The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.`
- **Reason for deferral:** The warning originates from the surrounding Playwright/Node process environment rather than a correctness problem in the app. This cycle already removed the actionable standalone-start warning and unsets `NO_COLOR` for the repo-controlled webServer command, but the runner still injects the conflict for some child processes.
- **Exit criterion:** Revisit if CI starts treating the warning as a failure or if Playwright exposes a stable repo-local way to suppress the injected env conflict.
