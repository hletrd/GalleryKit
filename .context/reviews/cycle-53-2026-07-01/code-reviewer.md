# Cycle 53 Code Reviewer

Reviewed HEAD: `17db8e38` (`fix(settings): prevent hidden production search state`).

## Inventory Reviewed

- `AGENTS.md`, `CLAUDE.md`
- HEAD `17db8e38` and latest commit diff from Cycle 52
- Semantic search settings flow: Settings page/client, settings server action, config resolver, public semantic/similar routes
- Cycle 52 aggregate/plan/deferred review context

## Findings

### C53-CODE-01 - Settings action can still persist production semantic search

- Severity: Medium
- Confidence: High
- Files: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:802`, `apps/web/src/app/actions/settings.ts:60`, `apps/web/src/app/actions/settings.ts:136`, `apps/web/src/lib/gallery-config-shared.ts:159`, `apps/web/src/lib/gallery-config.ts:123`, `apps/web/src/app/api/search/semantic/route.ts:186`, `apps/web/src/app/api/search/similar/[id]/route.ts:110`

The Settings UI removes `production` as a user-selectable option and renders it only as a disabled item when already active, but the shared server action still accepts any `isValidSettingValue(...)` result and persists it. `semantic_search_mode='production'` is intentionally type-valid for operator-owned DB state, and `getGalleryConfig()` resolves it to live production when `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`.

Failure scenario: on a host with weights seeded and `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, an authenticated admin can invoke the Settings server action with `{ semantic_search_mode: "production" }`. The action persists that row and public semantic/similar routes activate, bypassing the Cycle 52 invariant that production enablement remains outside Settings.

Suggested fix: block `semantic_search_mode === "production"` in `updateGallerySettings()` while keeping the stored-value validator unchanged. Add regression coverage proving the Settings action rejects production writes but still allows UI-supported modes.

## Final Sweep

- Focused tests passed in the review lane: `npm test --workspace=apps/web -- cycle-52-source-contracts.test.ts gallery-config.test.ts semantic-route-production.test.ts` (14 tests).
- Guard scanners passed in the review lane: `lint:action-origin`, `lint:public-route-rate-limit`, `lint:api-auth`.
- No files were modified by the reviewer; this artifact was recorded by the cycle owner from the returned report.
