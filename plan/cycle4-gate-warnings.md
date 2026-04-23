# Cycle 4 gate warning deferrals

Purpose: record non-blocking gate warnings observed during the Cycle 4 full-repo verification pass that were not fixed in this cycle.

## Deferred warnings

### GW4-01 — `next build` still emits the generic Edge-runtime static-generation warning
- **Gate:** `npm run build --workspaces`
- **Citation:** build output while compiling app routes; relevant source route is `apps/web/src/app/api/og/route.tsx:1-103`
- **Severity / confidence:** WARNING / HIGH
- **Reason for deferral:** The warning is caused by the intentionally dynamic OG image route (`export const runtime = 'edge'`) and does not fail the build. Removing the edge runtime would materially change the deployed OG rendering architecture and needs an explicit product/runtime decision rather than a blind warning cleanup.
- **Exit criterion to reopen:** Re-open if the project decides to move `/api/og` off the Edge runtime, or if a Next.js-compatible way is adopted to retain the current behavior without the warning.

### GW4-02 — Playwright local web-server startup still prints `NO_COLOR` / `FORCE_COLOR` environment warnings
- **Gate:** `npm run test:e2e --workspace=apps/web`
- **Citation:** E2E output from the Playwright-managed local web server startup during Cycle 4 verification
- **Severity / confidence:** WARNING / MEDIUM
- **Reason for deferral:** The suite passed green (`12 passed, 3 skipped`). The warning is environmental/noise-level output from the spawned Node process rather than a functional test failure, and the repo already unsets both env vars in `apps/web/playwright.config.ts`, so no tighter repo-local fix was identified this cycle.
- **Exit criterion to reopen:** Re-open if the warning starts failing CI, obscures real failures, or a precise repo-local root cause is identified.
