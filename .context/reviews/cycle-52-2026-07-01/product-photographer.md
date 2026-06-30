# Cycle 52 Product / Photographer Risk Review

Reviewed HEAD: `d7326789`.

## Inventory

- `AGENTS.md`, `CLAUDE.md`, latest aggregate, Cycle 49-51 aggregates/plans/deferred files
- Source surfaces: privacy projections, public sharing, semantic search, color/HDR display, admin settings, GPS map, alt-text hints, share routes

## Findings

### C52-PROD-01 - Settings can show production semantic search as Disabled while production is serving

- Severity: Medium
- Confidence: High
- Files: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:788`, `apps/web/src/lib/gallery-config.ts:123`, `CLAUDE.md:547`

If an operator follows the documented production semantic-search runbook (`SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` plus DB `semantic_search_mode='production'`), visitors can use real semantic search because the server resolves the mode as `production`. The Settings client has no production item and coerces the raw stored value to Disabled, so an admin can believe semantic search is off while it is publicly available.

Suggested fix: pass the resolved semantic mode or production-active flag into `SettingsClient`; render a read-only "Production active" state when the stored value and resolver both indicate production, while keeping production enablement outside the UI.

## Final Sweep

No additional privacy, color/HDR honesty, no edit/culling/scoring policy, public sharing trust, semantic honesty, or admin/operator affordance findings were found.
