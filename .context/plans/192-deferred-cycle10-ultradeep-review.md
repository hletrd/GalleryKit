# Plan 192 — Deferred Cycle 10 Ultradeep Review Items

**Source review:** Cycle 10 Aggregate Review deferred table (`D10-01` through `D10-09`) plus lower-priority confirmed items (`C10-07` through `C10-11`)
**Status:** TODO / deferred

Deferred-fix rules honored:
- Every deferred item below preserves the original severity/confidence from the review.
- No severity was downgraded to justify deferral.
- Repo policy still applies when these items are eventually picked up (AGENTS.md: commit+push every change, use gitmoji commits; CLAUDE.md: preserve documented deploy/runtime/privacy contracts).

| ID | File / Citation | Severity | Confidence | Reason for deferral this cycle | Exit criterion / reopen trigger |
|---|---|---|---|---|---|
| D10-01 | historical `apps/web/.env.local.example` commits (`d7c3279`, `d068a7f`) | HIGH | HIGH | This is primarily an operational secret-rotation / advisory / possibly-history-rewrite response, not a bounded code-path fix. | Reopen when secret rotation/advisory work is scheduled and external stakeholders can execute it safely. |
| D10-02 | `apps/web/next.config.ts` | MEDIUM | HIGH | Removing `unsafe-inline` safely still needs a broader nonce/hash rollout across every inline script/style producer. | Reopen when a dedicated CSP-hardening pass can audit and convert all inline surfaces together. |
| D10-03 | `apps/web/src/db/schema.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/data.ts` | MEDIUM | HIGH | Share-link TTLs require a schema migration plus admin/runtime contract decisions and revocation UX. | Reopen when a schema-changing share-link hardening pass is approved. |
| D10-04 | `apps/web/src/app/api/health/route.ts`, `apps/web/Dockerfile`, deploy verification scripts | LOW | HIGH | The live deploy/health-check workflow still depends on the public endpoint contract; tightening it safely needs coordinated monitoring/deploy changes. | Reopen when the production monitoring contract is explicitly updated to use an internal/secret health check. |
| D10-05 | `README.md`, `apps/web/README.md`, `apps/web/nginx/default.conf`, `apps/web/playwright.config.ts`, `apps/web/Dockerfile` | MEDIUM | MEDIUM | The docs/runtime topology mismatch is real but broader than this code-hardening pass; it spans deployment docs, nginx topology, and Playwright/standalone alignment. | Reopen when a dedicated docs/runtime-alignment pass is scheduled. |
| D10-06 | `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/data.ts` | MEDIUM | MEDIUM | A robust restore-maintenance fix needs shared coordination across processes plus a product decision for public-read behavior during restore windows. | Reopen when multi-process/cluster deployment support or explicit maintenance-mode behavior is being implemented. |
| D10-07 | `apps/web/src/lib/image-queue.ts`, `apps/web/src/instrumentation.ts` | MEDIUM | HIGH | Queue bootstrap single-flight changes touch startup/retry behavior and deserve their own bounded pass after this cycle’s topic/tag/rate-limit fixes land. | Reopen when a queue-startup hardening pass is scheduled. |
| D10-08 | `.github/`, `apps/web/e2e/`, `apps/web/src/app/actions/{sharing,admin-users,settings,seo,topics}.ts` | MEDIUM | HIGH | Broader CI/test-lane expansion remains valuable, but always-on admin/share/settings lanes still need runner/env policy decisions. | Reopen when CI rollout scope and seeded admin/test-environment policy are approved. |
| D10-09 | `apps/web/src/components/{tag-input,search,image-zoom,lightbox,image-manager,home-client}.tsx` | LOW | MEDIUM | The remaining UI polish items are real but lower priority than the confirmed route/tag/upload/runtime correctness issues fixed in Plan 191. | Reopen when a dedicated UI/UX polish cycle is scheduled. |
| C10-07 | `README.md`, `apps/web/README.md`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf` | MEDIUM | HIGH | Same as D10-05: it is a docs/runtime-topology alignment task, not a bounded code-path defect. | Reopen with the docs/runtime-alignment pass. |
| C10-08 | `apps/web/src/components/lightbox.tsx` | MEDIUM | HIGH | Touch/lightbox UX fix is bounded but lower priority than the current correctness/security fixes and would change visible behavior. | Reopen in a UI/UX cycle or if mobile lightbox complaints/regressions surface. |
| C10-09 | `apps/web/src/components/tag-input.tsx` | LOW | HIGH | The Tab-trap fix is bounded but lower priority than the correctness/security fixes already scheduled this cycle. | Reopen in the next keyboard-accessibility/UI polish pass. |
| C10-10 | `apps/web/Dockerfile` | MEDIUM | HIGH | Runtime image slimming is valuable but changes deploy/runtime packaging; keep it isolated from this cycle’s application-logic fixes. | Reopen in a dedicated Docker/runtime hardening pass. |
| C10-11 | `apps/web/src/app/[locale]/admin/db-actions.ts` | MEDIUM | HIGH | CSV streaming/memory work touches export UX/API shape and is safer as its own bounded perf/runtime pass. | Reopen when admin export scalability is prioritized. |
