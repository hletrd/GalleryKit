# Cycle 66 Code Quality / Correctness Review

## Inventory

- Read `AGENTS.md`, `CLAUDE.md`, and current `master` at `d3e18c6f6f8db7f064a612a045a2033c1660ca95`.
- Reviewed Cycle 65 changed files: `settings-client.tsx`, `similar-photos.tsx`, `select.tsx`, related source-contract tests, `apps/web/README.md`, and Cycle 65 review/plan artifacts.
- Cross-checked settings contracts with `settings.ts`, `settings-submit-payload.ts`, `settings-hash.ts`, and `gallery-config-shared.ts`.
- Ran focused tests: `npm test --workspace=apps/web -- settings-backfill-warning-source.test.ts select-item-touch-target.test.ts similar-photos-abort-source.test.ts` (pass).

## Findings

### C66-01 - Settings re-encode warning compares raw stored values instead of effective defaults

- Severity/confidence: Medium / High.
- Citation: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:207`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:290`, `apps/web/src/app/actions/settings.ts:30`.
- Evidence: empty stored values mean "use default" in `getGallerySettingsAdmin` / `updateGallerySettings`, but the client warning compared raw `''` against explicit default strings such as `'false'`, `'90'`, or `'4:4:4'`.
- Failure scenario: a fresh/default gallery changes `force_srgb_derivatives` from effective `false` to `true`, saves, then changes it back to `false`. The saved values match the original effective defaults, but the warning remains because `'' !== 'false'`.
- Fix direction: compare effective backfill values by replacing blank/missing values with `getSettingDefaults()` before dirty and pending-baseline comparisons.

## Non-Findings

- Similar Photos close handling aborts active requests, clears loading, resets retry eligibility, and guards late responses.
- Radix Select scroll buttons now include `min-h-11`.
- The README sidecar command wording now marks short commands as local/dev helpers.
- `C65-02` remains a deferred durable reload-persistent marker issue and is not re-raised as part of this client-session fix.

## Final Sweep

One actionable correctness issue found. No critical/high correctness or race issue found.
