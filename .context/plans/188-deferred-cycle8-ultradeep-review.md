# Plan 188 — Deferred Cycle 8 Ultradeep Review Items

**Source review:** Cycle 8 Aggregate Review deferred table (`D8-01` through `D8-10`)
**Status:** TODO / deferred

Deferred-fix rules honored:
- Every deferred item below preserves the original severity/confidence from the review.
- No severity was downgraded to justify deferral.
- Security/correctness/ops items are recorded explicitly with reopen criteria; none were silently dropped.
- Repo policy still applies when these items are eventually picked up (AGENTS.md: commit+push every change, use gitmoji commits; CLAUDE.md: preserve documented deploy/runtime contracts and privacy constraints).

| ID | File / Citation | Severity | Confidence | Reason for deferral this cycle | Exit criterion / reopen trigger |
|---|---|---|---|---|---|
| D8-01 | `apps/web/next.config.ts:56-92` | MEDIUM | HIGH | CSP nonce/hash rollout is broader than a bounded cycle-8 pass and needs coordinated handling for inline scripts/styles and third-party analytics. | Reopen when a dedicated security-hardening cycle can audit all inline script/style producers and analytics dependencies together. |
| D8-02 | `apps/web/src/app/api/health/route.ts:1-17` | LOW | HIGH | Tightening the health endpoint safely depends on the live monitoring/reverse-proxy contract, which is an operational decision outside this cycle. | Reopen when the production monitoring contract and any required secret/header allowlist are explicitly defined. |
| D8-03 | `apps/web/src/lib/data.ts:492-540`, `apps/web/src/app/actions/sharing.ts:17-18,109,214` | MEDIUM | HIGH | Removing support for short legacy share keys requires a migration/rotation plan to avoid breaking existing shared URLs. | Reopen when a one-time key-rotation/migration plan is scheduled. |
| D8-04 | `apps/web/src/lib/data.ts:315-331`, `apps/web/src/components/load-more.tsx:20-43`, `apps/web/src/app/actions/public.ts:10-22` | MEDIUM | HIGH | Cursor-pagination is a cross-layer refactor touching public routes, actions, client state, and tests. | Reopen when a dedicated pagination refactor cycle is approved. |
| D8-05 | `apps/web/src/lib/data.ts:612-691` | LOW | MEDIUM | Topic-label/alias search semantics need product confirmation before widening the current search model and relevance behavior. | Reopen when product intent explicitly includes searching by topic labels and aliases. |
| D8-06 | `apps/web/src/app/actions/images.ts:210-307`, `apps/web/src/lib/image-queue.ts:148-267` | MEDIUM | HIGH | Durable failed-processing recovery needs schema/UI/admin workflow additions that exceed a safe bounded hardening pass. | Reopen when a queue/admin recovery feature cycle is scheduled. |
| D8-07 | `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/rate-limit.ts` | MEDIUM | HIGH | Multi-instance coordination for restore/rate limiting needs a shared authority (DB/Redis/advisory-lock design) and deployment-topology decisions. | Reopen when the app is expected to scale beyond the current single-process assumption or a shared coordination store is introduced. |
| D8-08 | `.github/`, `package.json`, `apps/web/package.json`, `apps/web/scripts/check-api-auth.ts` | MEDIUM | HIGH | Adding CI enforcement is valuable but introduces workflow/runtime policy choices (caches, secrets, seeded DB strategy, remote admin E2E stance). | Reopen when CI rollout scope and runner expectations are approved. |
| D8-09 | `apps/web/e2e/nav-visual-check.spec.ts` | LOW | HIGH | Converting screenshot capture to stable visual assertions needs baseline strategy and noise controls that are better handled in a dedicated visual-testing pass. | Reopen when snapshot baseline storage/update policy is defined. |
| D8-10 | `apps/web/package.json`, `package-lock.json` | MEDIUM | HIGH | The `drizzle-kit` → `esbuild` advisory chain should be addressed carefully alongside migration workflow verification. | Reopen when a dependency-maintenance cycle can upgrade/pin the toolchain and rerun schema-generation workflows. |
