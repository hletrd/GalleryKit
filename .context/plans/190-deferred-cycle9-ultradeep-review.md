# Plan 190 — Deferred Cycle 9 Ultradeep Review Items

**Source review:** Cycle 9 Aggregate Review deferred table (`D9-01` through `D9-06`)
**Status:** TODO / deferred

Deferred-fix rules honored:
- Every deferred item below preserves the original severity/confidence from the review.
- No severity was downgraded to justify deferral.
- Security/correctness/ops items are recorded explicitly with reopen criteria; none were silently dropped.
- Repo policy still applies when these items are eventually picked up (AGENTS.md: commit+push every change, use gitmoji commits; CLAUDE.md: preserve documented deploy/runtime contracts and privacy constraints).

| ID | File / Citation | Severity | Confidence | Reason for deferral this cycle | Exit criterion / reopen trigger |
|---|---|---|---|---|---|
| D9-01 | `apps/web/next.config.ts:56-92` | MEDIUM | HIGH | CSP nonce/hash rollout is broader than a bounded cycle-9 pass and still needs coordinated handling for inline scripts/styles and any third-party snippets. | Reopen when a dedicated security-hardening cycle can audit all inline script/style producers together. |
| D9-02 | `apps/web/src/app/api/health/route.ts:1-17` | LOW | HIGH | Tightening the health endpoint safely still depends on the live monitoring and reverse-proxy contract. | Reopen when the production monitoring contract and any required header/secret allowlist are explicitly defined. |
| D9-03 | `apps/web/src/lib/data.ts:492-540`, `apps/web/src/app/actions/sharing.ts:17-18,109,214` | MEDIUM | HIGH | Removing support for short legacy share keys still needs a migration/rotation plan to avoid breaking existing shared URLs. | Reopen when a one-time key-rotation / migration plan is scheduled. |
| D9-04 | `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/rate-limit.ts` | MEDIUM | HIGH | Multi-instance coordination for restore/rate limiting still needs a shared authority (DB/Redis/advisory-lock design) and deployment-topology decisions. | Reopen when the app is expected to scale beyond the current single-process assumption or a shared coordination store is introduced. |
| D9-05 | `.github/`, `package.json`, `apps/web/package.json`, `apps/web/scripts/check-api-auth.ts` | MEDIUM | HIGH | In-repo CI enforcement remains valuable but still introduces workflow/runtime policy choices (seeded DB strategy, remote admin E2E stance, caches/secrets). | Reopen when CI rollout scope and runner expectations are approved. |
| D9-06 | `apps/web/e2e/nav-visual-check.spec.ts` | LOW | HIGH | Converting screenshot capture to stable visual assertions still needs baseline storage/update policy and noise controls. | Reopen when snapshot baseline policy is defined. |
