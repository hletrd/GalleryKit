# Cycle 54 Test / Gate Coverage Review

Reviewed HEAD: `1a65247c` (`fix(settings): keep production search operator-owned`).

## Inventory

- Settings semantic-search coverage: `apps/web/src/__tests__/cycle-52-source-contracts.test.ts`, `apps/web/src/__tests__/semantic-search-settings-ui.test.ts`, `apps/web/src/__tests__/settings-semantic-mode-action.test.ts`.
- Runtime path: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, `apps/web/src/lib/semantic-search-settings-ui.ts`, `apps/web/src/app/actions/settings.ts`.
- Gate fixtures: API auth, action-origin, public-route rate-limit, i18n, touch target, privacy-field guards.

## Finding

### C54-TEST-01 - Inactive-production clear path lacks behavior-level payload coverage

- Severity: Medium
- Confidence: High
- Files: `apps/web/src/__tests__/cycle-52-source-contracts.test.ts:18`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:254`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:799`, `apps/web/src/__tests__/semantic-search-settings-ui.test.ts:25`, `apps/web/src/__tests__/settings-semantic-mode-action.test.ts:120`

Current tests cover the pure select-state helper and server action rejection/persistence, but not the component save path that turns an inactive stored `production` row into an `updateGallerySettings({ semantic_search_mode: 'disabled' | 'stub' })` payload. A future refactor could keep helper and action tests green while breaking `onValueChange` or the changed-field diff so the latent `production` DB row remains armed.

Suggested fix: extract the changed-settings payload builder into a pure helper, use it from `SettingsClient`, and add a regression proving `production -> disabled` and `production -> stub` are submitted as changed values.

## Validation From Lane

- Focused Vitest files passed: 7 files / 38 tests.
- `lint:api-auth`, `lint:action-origin`, and `lint:public-route-rate-limit` passed.
