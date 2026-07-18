# Documentation Review — Cycle 13/100

Reviewed HEAD: `8bd8999f`

## Inventory and coverage

Cross-checked `README.md`, `apps/web/README.md`, `CLAUDE.md`, `AGENTS.md`,
workflow/deploy scripts, migration journal and SQL, schema comments, data-layer
comments, tests, and the active Cycle 12 plan against the implemented behavior.
The final sweep searched for stale migration tags, schema names, query/index
claims, deploy guidance, and unresolved plan status.

## DOC-C13-02 — Timeline module header documents only one of three indexes

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed documentation/code mismatch**
- Region: `apps/web/src/lib/data-timeline.ts:1-9`, versus query-specific
  contracts at `:112-116`, `:145-164`, and `:198-212`.
- Evidence: the module header states that all queries target
  `idx_images_processed_capture_date`, but On This Day targets
  `idx_images_processed_capture_month_day` and year discovery targets the new
  `idx_images_processed_capture_year`.
- Concrete failure: a maintainer follows the supposedly module-wide invariant
  and removes or changes one of the generated-key indexes as redundant, or
  reviews a query plan against the wrong expected index.
- Suggested fix: replace the singular header claim with a concise mapping of
  each query family to its intended index.

## Final sweep

`CLAUDE.md` accurately records migration 0033 and all three capture-date index
contracts. No other confirmed README, operator-runbook, schema, security,
deployment, or active-plan mismatch survived validation.
