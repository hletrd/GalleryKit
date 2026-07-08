# Run-10 Cycle 35/100 Implementation Plan

Status: IMPLEMENTED - gates/deploy pending
Aggregate: `.context/reviews/_aggregate.md`
Date: 2026-07-08 KST
Review start HEAD: `7993fa467f8a71814f878aa59bcd80174daab1ed`

## Scope

This cycle schedules the contained, implementation-ready findings from the Cycle 35 aggregate and records every broader item in `deferred.md`.

Repo rules read before scheduling: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, `.context/plans/run10-cycle34/{plan,deferred}.md`, `README.md`, `apps/web/README.md`, docs under `docs/superpowers/`, and the Cycle 35 review artifacts. No new dependency, schema migration, payment/editing/product feature, destructive production operation, or host-nginx mutation is required.

## Scheduled Work Packages

### WP1 - Serialize topic map visibility toggles with topic route mutations

Finding: `C35-07`.

Files:

- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/__tests__/topics-actions.test.ts`

Plan:

1. Keep `requireSameOriginAdmin`, admin auth, restore-maintenance, and mutation-slot admission unchanged.
2. Move clean-slug validation, topic update, audit logging, and page revalidation inside `withTopicRouteMutationLock`.
3. Preserve the existing `invalidInput`, `unauthorized`, and success return shapes.
4. Add a regression proving `setTopicMapVisible` uses the same lock helper as create/update/delete/alias route mutations.

Acceptance:

- A concurrent slug rename and map visibility toggle cannot interleave such that a successful toggle is deleted with the old slug.
- Existing topic action tests remain green.

### WP2 - Fix search combobox popup ownership

Finding: `C35-10`.

Files:

- `apps/web/src/components/search.tsx`
- `apps/web/src/__tests__/search-status-source.test.ts` or adjacent source-contract coverage

Plan:

1. Stop pointing `#search-input[role="combobox"]` at `#search-dialog`.
2. Keep `aria-controls="search-results"` only when the listbox exists, or always render a stable listbox/status target.
3. Preserve current keyboard behavior, focus trap, and status announcements.
4. Update the source-contract test that currently pins the invalid fallback.

Acceptance:

- The combobox never declares the modal dialog as its controlled popup.
- Existing search status and accessibility source tests pass.

### WP3 - Make wide-gamut hint copy describe display capability, not sRGB asset delivery

Finding: `C35-14`.

Files:

- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- Optional focused i18n/source test if a direct string contract exists

Plan:

1. Replace EN/KO `viewer.wideGamutHint` and `viewer.wideGamutHintWithSource` copy so it no longer claims an "sRGB version" or display-side sRGB conversion.
2. Keep the `{gamut}` and `{source}` placeholders intact.
3. Preserve the existing admin/settings copy that accurately describes `force_srgb_derivatives`.

Acceptance:

- Visitors on sRGB displays see honest copy about display capability and wide-gamut/P3 availability.
- i18n key parity and JSON validity remain green.

### WP4 - Add behavioral coverage for semantic scan caps

Finding: `C35-17`.

Files:

- `apps/web/src/__tests__/semantic-search-route.test.ts`
- `apps/web/src/__tests__/similar-route.test.ts`
- Existing source tripwire remains secondary coverage

Plan:

1. Extend semantic-route DB-chain mocks so the scan query records the terminal `.limit(...)` argument.
2. Extend similar-route DB-chain mocks the same way for the comparable embedding scan.
3. Assert both route behaviors apply `SEMANTIC_SCAN_LIMIT` on the embedding scan, not merely in source text.
4. Keep the current source-level tripwire as a cheap guard.

Acceptance:

- A refactor that leaves the text `.limit(SEMANTIC_SCAN_LIMIT)` in source but drops it from the executed scan chain fails tests.
- Targeted semantic and similar route tests pass.

### WP5 - Repair current-cycle provenance and nginx limiter wording

Findings: `C35-08`, `C35-09`.

Files:

- `CLAUDE.md`
- `apps/web/nginx/default.conf`
- `.context/plans/README.md`
- `.context/reviews/_aggregate.md`
- `.context/plans/run10-cycle35/plan.md`
- `.context/plans/run10-cycle35/deferred.md`

Plan:

1. Update the public-edge throttling docs/comments from "public SSR page only" to a catch-all description that includes public non-admin APIs unless a longer location matches.
2. Keep the operator-host-nginx manual apply contract intact.
3. Update the plan index so Run-10 Cycle 35 is the active plan/deferred pair and Cycle 34 moves to recently completed/superseded history.
4. Preserve the Cycle 35 aggregate as the current root handoff surface.

Acceptance:

- Future planners no longer mix Cycle 34 active pointers with Cycle 35 lane reports.
- Operators understand that public API routes without longer nginx locations inherit the catch-all public limiter.

## Deferred Finding Map

Deferred items are recorded in `deferred.md` with original severity/confidence, file+line citations, reason, and exit criterion:

- `C35-01`
- `C35-02`
- `C35-03`
- `C35-04`
- `C35-05`
- `C35-06`
- `C35-11`
- `C35-12`
- `C35-13`
- `C35-15`
- `C35-16`
- `C35-18`
- `C35-19`
- `C35-20`
- `C35-21`
- `C35-22`
- `C35-23`
- `C35-24`

No confirmed security, correctness, or data-loss finding is deferred in this plan. `C35-07` is the only confirmed correctness finding and is scheduled in WP1.

## Progress

- [x] Prompt 1 review artifacts returned and aggregate written.
- [x] Prompt 2 plan/deferred pair written.
- [x] WP1 topic map visibility serialization implemented.
- [x] WP2 search combobox ARIA fixed.
- [x] WP3 wide-gamut hint copy corrected.
- [x] WP4 semantic scan-cap behavioral tests added.
- [x] WP5 current-cycle provenance and nginx wording repaired.
- [x] Full configured gates run green.
- [ ] Signed commit pushed.
- [ ] Per-cycle deploy run and production smoke evidence recorded.

## Verification Evidence

- `npm test --workspace=apps/web -- --run src/__tests__/topics-actions.test.ts` — passed, 31 tests.
- `npm test --workspace=apps/web -- --run src/__tests__/search-status-source.test.ts` — passed, 4 tests.
- `npm test --workspace=apps/web -- --run src/__tests__/humanize-transfer-function-i18n.test.ts src/__tests__/wide-gamut-primaries.test.ts src/__tests__/messages-parity.test.ts` — passed for available files, 31 tests.
- `npm test --workspace=apps/web -- --run src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts` — passed, 37 tests.
- `npm test --workspace=apps/web -- --run src/__tests__/nginx-config.test.ts src/__tests__/cycle12-ops-contracts.test.ts` — passed, 15 tests.
- `git diff --check` — passed.
- `npm run lint --workspace=apps/web` — passed.
- `npm run lint:api-auth --workspace=apps/web` — passed.
- `npm run lint:action-origin --workspace=apps/web` — passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` — passed.
- `npm run audit:prod` — passed, 0 vulnerabilities.
- `npm run typecheck --workspace=apps/web` — passed.
- `npm run build --workspace=apps/web` — passed.
- `npm test --workspace=apps/web` — passed, 361 files passed, 2 skipped; 3397 tests passed, 4 skipped.
- `npm run test:e2e --workspace=apps/web` — not run; no browser-flow coverage was required for the scheduled source/test/docs changes beyond the existing source-contract and unit coverage above.
