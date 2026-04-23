# Plan 210 — Deferred Gate Warnings (Cycle 5)

**Status:** TODO / DEFERRED
**Source:** Cycle 5 gate output (`npm run test:e2e --workspace=apps/web`, `npm run build`)
**Purpose:** Record the remaining non-blocking warning that stayed after the cycle-5 implementation work. This file tracks an existing warning only; it does not introduce new feature/refactor ideas.

## Deferred findings

### GW5-01 — Next.js warns that edge-runtime routes disable static generation
- **Original severity:** LOW
- **Original confidence:** MEDIUM
- **Citation:** `apps/web/src/app/api/og/route.tsx:6`, `apps/web/src/app/icon.tsx:5`, `apps/web/src/app/apple-icon.tsx:4`
- **Observed warning:** `Using edge runtime on a page currently disables static generation for that page`
- **Reason for deferral:** The warning is tied to intentionally edge-executed OG/icon routes. Removing the warning cleanly requires revisiting runtime selection and asset-generation behavior together, which exceeds the bounded scope of this cycle's review fixes.
- **Exit criterion to reopen:** A follow-up cycle scopes the OG/icon runtime strategy explicitly and verifies whether the edge runtime is still required for those routes or can be replaced without behavior loss.


### GW5-02 — Playwright webServer emits `NO_COLOR` / `FORCE_COLOR` env warnings
- **Original severity:** LOW
- **Original confidence:** MEDIUM
- **Citation:** `apps/web/playwright.config.ts:33-36`, cycle-5 `npm run test:e2e --workspace=apps/web` output
- **Observed warning:** `(node:...) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.`
- **Reason for deferral:** The warning is emitted by the shell/runtime environment around the Playwright webServer command rather than the product code path itself. Cleaning it up safely requires normalizing how color env vars are injected in the broader local/CI shell wrapper, which is outside this cycle’s bounded fix lane.
- **Exit criterion to reopen:** A follow-up cycle scopes CLI/test-runner env normalization explicitly and verifies the Playwright webServer command stays warning-free.
