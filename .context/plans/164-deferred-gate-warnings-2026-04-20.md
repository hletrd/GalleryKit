# Deferred Gate Warnings — 2026-04-20

**Created:** 2026-04-20
**Status:** TODO
**Purpose:** Record non-blocking warning-level quality-gate output that stayed green this cycle but was not fixed cleanly without risking broader regressions.

| Warning | Citation / source | Severity / confidence | Reason for deferral | Exit criterion |
| --- | --- | --- | --- | --- |
| Production startup warning when `TRUST_PROXY` is unset in local build/test environments | `npm run build --workspace=apps/web` and Playwright web-server output on 2026-04-20 | LOW / High | The shipped docker-compose deployment already sets `TRUST_PROXY=true`, which covers the documented reverse-proxy path. Silencing the local warning cleanly would require a policy decision on whether non-proxied local production-like builds should default to a quieter mode. | Re-open if local production-like builds should run warning-free without a proxy, or if the rate-limit warning policy is revisited. |
| Playwright web-server warning that `next start` is not ideal for `output: standalone` | `npm run test:e2e --workspace=apps/web` output on 2026-04-20 | LOW / Medium | A direct switch to `node .next/standalone/.../server.js` previously changed runtime behavior and broke passing browser tests. Keeping the current command preserves a green e2e gate until a standalone-compatible command is proven equivalent. | Re-open when the e2e server bootstrap can be migrated to standalone mode without changing locale/navigation/photo-page behavior. |
| Node warning about `NO_COLOR` being ignored because `FORCE_COLOR` is set | Playwright web-server / test process output on 2026-04-20 | LOW / High | Warning originates from tooling environment flags rather than application code. Changing it is outside this repo's current product fix scope. | Re-open if terminal-color environment policy is standardized for local test tooling. |
| Next.js warning that edge-runtime pages disable static generation | `npm run build --workspace=apps/web` and Playwright web-server output on 2026-04-20 | LOW / High | This is expected behavior for the current `/api/og` edge-runtime setup and does not indicate a failing build or incorrect output. Fixing it would require revisiting the runtime strategy rather than a narrow warning-only tweak. | Re-open if the OG/image generation runtime is redesigned or static-generation expectations change. |
