# Cycle 35 Critic / Verifier / Designer / Document Review

Reviewer: local critic-verifier-designer-document sweep
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `96160854ebadca1606e9f99b2e6f5bc4689e366c`
Date: 2026-06-30 KST
Scope: local fallback because the native subagent thread limit prevented a sixth reviewer lane. Read-only except this review artifact.

## Inventory

- Read `AGENTS.md`, relevant `CLAUDE.md` security, testing, deploy, service-worker, touch-target, and photographer-intent sections.
- Inspected the current Cycle 34 delta and review artifacts, with emphasis on upload serving, custom lint gates, public static workers, UI/accessibility source contracts, i18n policy, and plan/deploy documentation.
- Checked installed reviewer surfaces in `~/.codex/agents/` for UI/product concerns. No browser run was needed because the confirmed findings are source/gate/documentation issues rather than visual regressions.

## Findings

### C35-CRIT-01 - Confirmed upload-serving FD leak should be scheduled

Severity: Medium
Confidence: High

Region:

- `apps/web/src/lib/serve-upload.ts:166-267`

The performance lane's HEAD/304 finding is a live resource leak on the route-handler fallback path used by service-worker revalidation. It is narrow, testable, and should be fixed this cycle.

### C35-CRIT-02 - Confirmed lint-gate gaps should be scheduled as guardrail fixes

Severity: Medium
Confidence: High

Regions:

- `apps/web/scripts/check-action-origin.ts:192-219`
- `apps/web/scripts/check-action-origin.ts:248-302`
- `apps/web/scripts/check-public-route-rate-limit.ts:49-268`

The code and test lanes independently found scanner fail-open cases. The current production actions/routes use safe orderings, but these scripts are blocking security gates; letting them accept inverted guard checks or imported side-effect helpers before guards would allow future regressions to ship green.

### C35-CRIT-03 - Cycle-34 plan progress drift is real workflow documentation debt

Severity: Low
Confidence: Medium

Regions:

- `.context/plans/README.md`
- `.context/plans/cycle-34-2026-06-30-plan.md`

The reviewed HEAD is the pushed/deployed cycle-34 fix commit supplied by the Cycle 35 task context, but the committed plan still marks push/deploy incomplete. Correcting this avoids false carry-forward work.

## Final Sweep

No additional UI/accessibility, i18n, product-policy, or documentation drift reached the reporting bar beyond the aggregated findings. Cycle 33 deferred items remain governed by their existing deferred record and were not re-opened by this sweep.
