# Cycle 53 Test / Verifier Review

Reviewed HEAD: `17db8e38` (`fix(settings): prevent hidden production search state`).

## Inventory

- Repo contracts: `AGENTS.md` user-provided workspace instructions, `CLAUDE.md`.
- Recent HEAD diff: `git show --stat --name-only HEAD`; focused on the Cycle 52 Settings semantic-search fix, messages, source-contract test, and ledgers.
- Source under review:
  - `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
  - `apps/web/src/app/actions/settings.ts`
  - `apps/web/src/lib/gallery-config-shared.ts`
  - `apps/web/src/lib/gallery-config.ts`
  - `apps/web/src/__tests__/cycle-52-source-contracts.test.ts`
  - `apps/web/messages/en.json`, `apps/web/messages/ko.json`
- Ledger under review:
  - `.context/reviews/_aggregate.md`
  - `.context/reviews/cycle-52-2026-07-01/_aggregate.md`
  - `.context/plans/README.md`
  - `.context/plans/cycle-52-2026-07-01-plan.md`
  - `.context/plans/cycle-52-2026-07-01-deferred.md`
- Validation run this review:
  - `npm test --workspace=apps/web -- cycle-52-source-contracts.test.ts i18n-key-parity.test.ts` - pass, 2 files / 3 tests.
  - `git diff --check HEAD^..HEAD` - pass.

## Findings

### C53-TE-01 - Healed production rows still cannot be cleared by the displayed Disabled state

- Severity: Medium
- Confidence: High
- Files: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:260-277`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:298-310`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:802-839`, `apps/web/src/app/actions/settings.ts:136-160`
- Fix: In the stored-production-but-not-active state, do not bind the select to the normal `disabled` item while the raw state remains `production`. Use a distinct disabled display item such as `stored-production-inactive`, or add an explicit clear action, so selecting real Disabled changes local state to `semantic_search_mode='disabled'` and `handleSave` sends that field. Add a render/interaction test that proves the clear path writes `disabled`.

Failure scenario: the DB contains `semantic_search_mode='production'`, but the server lacks `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`. The page correctly resolves active mode as disabled (`page.tsx:31-34`, `gallery-config-shared.ts:206-212`) and the client warns (`settings-client.tsx:835-839`). However, `semanticSearchSelectValue` returns the normal `disabled` value while `settings.semantic_search_mode` is still raw `production` (`settings-client.tsx:298-304`). `handleSave` only sends changed fields by comparing against `initialRef.current` (`settings-client.tsx:260-277`), and the action only persists provided keys (`settings.ts:136-160`). Pressing Save without changing this select sends no semantic field; selecting the already-displayed Disabled option is not a reliable state change. The stale `production` row remains armed and can become live later when the env flag is enabled.

The new copy says "Re-select Disabled or Stub to apply a UI-supported mode" (`messages/en.json:765`, `messages/ko.json:765`), but the UI already displays Disabled in this state, so the most natural admin action does not clear the raw production row.

### C53-TE-02 - Cycle 52 ledger repeats the prior stale-plan pattern after the Cycle 52 commit

- Severity: Medium
- Confidence: High
- Files: `.context/plans/README.md:5-13`, `.context/plans/cycle-52-2026-07-01-plan.md:38-57`, `.context/reviews/_aggregate.md:1-9`
- Fix: Close Cycle 52 with the actual terminal state: commit `17db8e38`, push state, and deploy disposition. If no deploy evidence exists, record that explicitly instead of leaving the active checklist ambiguous. Advance the pointer to Cycle 53 only after this review artifact exists.

Cycle 52 fixed Cycle 51 ledger drift, but the new plan index still labels Cycle 52 as active (`README.md:5-13`) while HEAD is already `17db8e38` on `origin/master`. The Cycle 52 plan records all gates as passed (`cycle-52-2026-07-01-plan.md:48-57`) but still leaves commit/push/deploy unchecked (`cycle-52-2026-07-01-plan.md:43-46`). That is the same operational failure mode Cycle 52 reported for Cycle 51: future reviewers cannot tell from committed ledgers whether the work was only implemented locally, pushed, or deployed.

### C53-TE-03 - The new source-contract test overstates behavior lock-in

- Severity: Low
- Confidence: High
- Files: `apps/web/src/__tests__/cycle-52-source-contracts.test.ts:8-26`, `.context/plans/cycle-52-2026-07-01-plan.md:19-22`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:298-304`
- Fix: Keep the source-contract test only as a cheap wiring smoke, and add behavior-level coverage. At minimum, render `SettingsClient` with `semantic_search_mode='production'` under both resolved modes and assert: production-active text is visible when resolved production is active; healed production shows a distinct inactive stored-production state; choosing Disabled sends `semantic_search_mode='disabled'`; choosing Stub sends `stub`.

The Cycle 52 plan says the test "must prove" the client renders active and healed production states (`cycle-52 plan:19-22`). The test only reads files and checks for substrings (`cycle-52-source-contracts.test.ts:8-26`). It would pass if the strings were moved into comments, left in unreachable JSX, or if the select remained bound to a misleading value. It also does not exercise the save path, so it cannot catch `C53-TE-01`.

## Non-Findings / Final Sweep

- The active production display path is wired in source: the server threads `resolveSemanticSearchMode(...)` into `SettingsClient` (`settings/page.tsx:27-35`), and the client renders a disabled production item plus a status paragraph when raw and resolved modes are both production (`settings-client.tsx:298-310`, `settings-client.tsx:823-834`).
- The resolver itself remains consistent with the runtime gate: raw `production` heals to `disabled` unless `allowProduction` is true (`gallery-config-shared.ts:206-212`), and `gallery-config.ts:123-126` passes `SEMANTIC_SEARCH_ALLOW_PRODUCTION === 'true'`.
- English/Korean key parity still passes for the new copy in the focused test run.
- I did not re-raise the carried deferred items (`PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, `AGG-C38-08`); this review found no new evidence changing their severity.
- Full lint/typecheck/build/Vitest gate results were not rerun in Cycle 53. Cycle 52 records them as green in `.context/plans/cycle-52-2026-07-01-plan.md:48-57`; this review independently reran only the focused source-contract/i18n tests and `git diff --check HEAD^..HEAD`.
