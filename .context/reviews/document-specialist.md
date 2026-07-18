# Document Specialist — Cycle 6 Provenance

Review target: `6e4c25c8`. I reviewed `AGENTS.md`, all 770 lines of `CLAUDE.md`, root/app READMEs, package scripts, current Cycle 5 plan/index, current provenance/aggregate, archive history, and the deferred register against source, tests, Git, and production behavior.

## NEW Cycle 6 findings

### DOC-C6-01 — Cycle 5 still claims signed publication is pending

- Severity / confidence: **Low / High**
- Status: **Confirmed signed push; exact deploy SHA manual-validation**
- Regions: `.context/plans/cycle-5-2026-07-18-plan.md:3-5,47-49,70-78`; `.context/plans/README.md:34-40`
- Scenario: `master == origin/master == 6e4c25c8` and all Cycle 5 commits verify, while the plan remains active with push/deploy unchecked. A resumed agent can repeat terminal work or choose the wrong frontier.
- Fix: mark signed push complete, separately record live verification versus exact deploy-SHA availability, archive Cycle 5, and update the index.

### DOC-C6-02 — `useColumnCount` comments overstate layout alignment for sparse galleries

- Severity / confidence: **Low / High**
- Status: **Confirmed source/runtime contradiction**
- Regions: `apps/web/src/components/home-client.tsx:27-36,44-47,236-247,249-274`
- Scenario: comments say intrinsic estimation mirrors browser layout, but at 1,536 px/two items the browser uses two columns while the estimator uses five, yielding a 196 px hint for a 496 px card. Maintainers can preserve the wrong invariant during future edits.
- Fix: correct the implementation first, then document the single effective-column owner and container-width assumption.

## Revalidated, not new

Cycle 5's plan accurately records focused/full gate counts and the corrected candidate expectation. Governing security, privacy, color/HDR, migration, deploy, and CLIP runbooks remain source-consistent in sampled cross-checks. Existing carry-forward register age/history complexity is not relabeled.

## Final documentation sweep

Coverage included setup, env/config lifetime, deployment/data mounts, migrations, auth/proxy/rate limits, backup/restore, image/color/semantic flows, tests, and release ledgers. No further new material contradiction survived.
