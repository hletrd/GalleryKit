# Run-10 Cycle 28/100 Deferred Findings

Status: OPEN
Aggregate: `.context/reviews/run10-cycle28/_aggregate.md`
Date: 2026-07-08 KST

This register records every Cycle 28 aggregate finding not scheduled in `plan.md`. Severity and confidence are preserved. Deferred work remains bound by repo policy: GPG-signed Conventional Commits with gitmoji, `git pull --rebase` before push, required gates, no force-push, no `--no-verify`, and the repo's toolchain/deploy rules.

Repo rule basis for deferral: `CLAUDE.md` allows browser-flow coverage to run when required by changes/findings and separately documents operator-only proxy/nginx validation. `.context/plans/README.md` defines carry-forward budgeting for deferred Medium findings.

## Deferred Items

| ID | Severity / Confidence | Citation | Reason for deferral | Exit criterion |
|----|-----------------------|----------|---------------------|----------------|
| AGG-C28-05 | Medium / High | `apps/web/src/components/admin-nav.tsx:15-25`; `apps/web/e2e/admin.spec.ts:20-43`; `apps/web/e2e/admin.spec.ts:73-103` | Authenticated Playwright expansion for SEO/tokens/analytics needs seeded admin browser credentials and route-specific stable assertions. This cycle already schedules narrower source/test hardening plus a production deploy; no confirmed runtime breakage was found on those pages. | Next browser-flow hardening cycle, a regression on `/admin/seo`, `/admin/tokens`, or `/admin/analytics`, or availability of a maintained authenticated e2e fixture for all nav destinations. |
| AGG-C28-08 | Medium / Medium | `apps/web/nginx/default.conf:20-28`; `apps/web/nginx/default.conf:59-71` | This is deployment-topology validation, not a repo-code defect. The repo already documents that deploys do not apply host nginx changes and that proxy real-IP configuration is operator-owned. The current task forbids manual production DNS/network/service changes; the per-cycle deploy helper is the only permitted production operation. | Operator confirms LB/CDN/nginx real-IP topology, changes proxy topology, observes shared-IP rate-limit anomalies, or schedules a host-nginx validation runbook execution. |

## Scheduled, Not Deferred

Scheduled in `plan.md`: `AGG-C28-01`, `AGG-C28-02`, `AGG-C28-03`, `AGG-C28-04`, `AGG-C28-06`, `AGG-C28-07`.

## Age-Budget Check

No new High-severity finding is deferred. Two Medium findings are deferred with explicit exit criteria and must be carried forward according to the 16-cycle Medium checkpoint if still open.
