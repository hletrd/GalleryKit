# Cycle 65 Test / Verification Review

## Inventory

- Latest commit: `ad1bc983 fix(cycle-64): 🐛 keep search and settings state honest`.
- Unit and source-contract surface under `apps/web/src/__tests__/`.
- Recent Cycle 64 regression fixtures for search reset, GPS map links, Radix Select items, and Settings backfill warning persistence.

## Findings

### C65-01 - Saved backfill warning stays visible after reverting byte-impacting settings to the baseline

- Severity/confidence: Medium / High.
- File/line: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:89`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:209`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:272`, `apps/web/src/__tests__/settings-backfill-warning-source.test.ts:12`.
- Evidence: `hasSavedBackfillPending` is a boolean initialized false and set true after any saved backfill-relevant change. The source contract verifies only that it can be set, not that it clears when the saved values match the current baseline again.
- Failure scenario: an admin changes `image_quality_webp` from `90` to `80` and saves, then changes it back to `90` and saves before any re-encode. The persisted settings again match the derivative baseline, but the warning remains visible.
- Suggested fix: track the saved-pending values or clear the pending flag when the successful save returns all backfill-relevant keys to their pre-change baseline. Add focused source-contract coverage for the clear path.

## Validation

- `npm test --workspace=apps/web -- search-semantic-toggle-source gps-map-link-touch-targets select-item-touch-target settings-backfill-warning-source` passed in the reviewer lane.
