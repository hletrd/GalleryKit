# Cycle 40 Aggregate Review

Start HEAD: `490b93c5`.
Date: 2026-07-01.

## Scheduled Findings

1. `UI-C40-01` - Wide-gamut JPEG downloads are mislabeled as sRGB on desktop and mobile viewer menus when `force_srgb_derivatives=false`.
2. `TV-40-01` - `lint:action-origin` misses protected reads through Drizzle relational query calls such as `db.query.sessions.findMany()`.
3. `TV-40-02` - `lint:public-route-rate-limit` misses DB-backed imported read helpers whose names are outside its hard-coded marker list.

## Deferred Findings

1. `TV-40-03` - JS operational scripts are only syntax-checked, not semantically type-checked. A direct `tsc --checkJs` probe produced many existing JS typing errors, so this needs a dedicated script-typing migration plan before it is safe to schedule.
2. Cycle-39 deferred migration/index and broader scanner-model items remain deferred because no cycle-40 evidence changed their severity or exit criteria.

## Review Lane Results

- Code / architecture / debugger: no new actionable findings.
- Security / privacy: no new actionable findings; targeted security gates/tests and production dependency audit passed in that lane.
- Performance / concurrency / deploy: no new actionable findings.
- Test / verifier: three new guardrail findings; two are scheduled, one is deferred.
- UI / accessibility / photographer: one medium, high-confidence color-honesty finding scheduled.
- Docs / product / runbook drift: no new actionable findings.

## Agent Routing Note

The installed `~/.codex/agents/ui-ux-designer-reviewer.md` and `~/.codex/agents/product-marketer-reviewer.md` prompts are BurstPick-specific, so they were not used as authoritative GalleryKit review surfaces. Generic native explorer lanes produced the cycle-40 review artifacts.

## Cycle Plan

Implement the three scheduled findings in `.context/plans/cycle-40-2026-07-01-plan.md`; record `TV-40-03` and carry-forward deferred work in `.context/plans/cycle-40-2026-07-01-deferred.md`.
