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
