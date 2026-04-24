# Cycle 3 gate warning deferrals

Purpose: record non-blocking gate warnings observed during the Cycle 3 full-repo verification pass that were not fixed in this cycle.

## Deferred warnings

### GW3-01 — `next build` still emits the generic Edge-runtime static-generation warning
- **Observed again:** 2026-04-24 during cycle 3/100 `npm run build`.
- **Gate:** `npm run build --workspaces`
- **Citation:** build output while compiling app routes; relevant source route is `apps/web/src/app/api/og/route.tsx:1-103`
- **Severity / confidence:** WARNING / HIGH
- **Reason for deferral:** The warning is caused by the intentionally dynamic OG image route (`export const runtime = 'edge'`) and does not fail the build. Removing the edge runtime would materially change the deployed OG rendering architecture and needs an explicit product/runtime decision rather than a blind warning cleanup.
- **Exit criterion to reopen:** Re-open if the project decides to move `/api/og` off the Edge runtime, or if a Next.js-compatible way is adopted to retain the current behavior without the warning.

### GW3-02 — Playwright local web-server startup prints `NO_COLOR` / `FORCE_COLOR` environment warnings
- **Observed status 2026-04-24:** not reproduced as a blocking warning; e2e passed after local MySQL recovery.
- **Gate:** `npm run test:e2e --workspace=apps/web`
- **Citation:** E2E output from the Playwright-managed local web server startup during Cycle 3 verification
- **Severity / confidence:** WARNING / MEDIUM
- **Reason for deferral:** The suite passed green (`12 passed, 3 skipped`). The warning is environmental/noise-level output from the spawned Node process rather than a functional test failure, and there is no evidence yet that a repo-local change would remove it without also changing the current launch contract.
- **Exit criterion to reopen:** Re-open if the warning becomes actionable (for example, starts failing CI, obscures real failures, or a precise repo-local root cause is identified).
