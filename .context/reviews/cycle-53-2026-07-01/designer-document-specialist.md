# Cycle 53 Designer / Document / Product Review

Reviewed HEAD: `14f674d635dffdb6cee434033e78632a45750a26` (`docs(review): record cycle 53 verifier review`).
Baseline focus: Cycle 52 semantic-search Settings behavior and cycle-ledger clarity against current `origin/master` (`14f674d`).

## Inventory

- Read `AGENTS.md` instructions from the prompt and `CLAUDE.md`, especially CLIP semantic-search production activation, Settings/operator runbook, deployment, and ledger conventions.
- Compared recent lineage: `d7326789` -> `17db8e38` -> `14f674d`; `HEAD`, `origin/master`, and `origin/HEAD` all point at `14f674d`.
- Reviewed Cycle 52 source delta: `settings/page.tsx`, `settings-client.tsx`, English/Korean messages, `cycle-52-source-contracts.test.ts`, Cycle 51/52 plans, `.context/plans/README.md`, and review aggregates.
- Reviewed runtime contract points: `resolveSemanticSearchMode(...)`, `getGalleryConfig()`, public semantic/similar route gates, and `updateGallerySettings(...)`.
- Validation run:
  - `npm test --workspace=apps/web -- cycle-52-source-contracts.test.ts` - pass, 1 test.
  - `npm test --workspace=apps/web -- i18n-key-parity.test.ts` - pass, 2 tests.
  - `git diff --check d7326789..HEAD` - pass.
- Browser/DOM evidence: not run. The target admin Settings page is auth/DB-backed, and the review should not block on missing local secrets. Source and route/action evidence was sufficient for the findings below.

## Findings

### C53-DDP-01 - Healed stored-production state tells admins to select Disabled, but the UI may not persist that clear

- Severity: Medium
- Confidence: High
- Files: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:298`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:300`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:808`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:835`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:260`, `apps/web/src/app/actions/settings.ts:136`, `apps/web/messages/en.json:765`, `apps/web/messages/ko.json:765`
- Failure scenario: DB has `semantic_search_mode='production'`, but this server lacks `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`. The Settings page correctly warns that the stored value is healed to disabled, but `semanticSearchSelectValue` maps the raw `production` row onto the normal `disabled` select value while `settings.semantic_search_mode` remains `production`. `handleSave` sends only values changed from `initialRef.current`, and `updateGallerySettings(...)` persists only provided keys. Pressing Save without another change sends nothing; trying to "re-select Disabled" is unreliable because the visible select value is already `disabled`. The latent `production` row can remain armed and later become live when the env flag is enabled.
- Product/UX impact: the warning copy gives a remediation path that may do nothing. Operators can leave Settings believing production was cleared when the persisted row still says `production`.
- Fix: represent stored-production-but-inactive as a distinct read-only/sentinel display state, or add an explicit "Clear stored production mode" action. Selecting the real Disabled option must set `settings.semantic_search_mode = 'disabled'` so `handleSave` submits the field. Add a behavior test that renders this state, chooses Disabled, and asserts the server action payload includes `semantic_search_mode: 'disabled'`.

### C53-DDP-02 - Cycle 52 ledger repeats the stale active/deploy-unknown pattern it just fixed for Cycle 51

- Severity: Medium
- Confidence: High
- Files: `.context/plans/README.md:5`, `.context/plans/README.md:7`, `.context/plans/README.md:12`, `.context/plans/cycle-52-2026-07-01-plan.md:38`, `.context/plans/cycle-52-2026-07-01-plan.md:45`, `.context/plans/cycle-52-2026-07-01-plan.md:48`
- Failure scenario: `origin/master` already contains the Cycle 52 implementation commit `17db8e38` and later review commit `14f674d`, but the plan index still calls Cycle 52 "active", and the Cycle 52 plan leaves commit/pull/push/deploy unchecked despite listing all gates as passing. Future reviewers cannot tell from committed ledgers whether Cycle 52 was only locally implemented, pushed, deployed, or intentionally not deployed.
- Product/documentation impact: this is the same operational ambiguity Cycle 52 identified for Cycle 51. It weakens the cycle ledger as the handoff surface for deployment state.
- Fix: close Cycle 52 with terminal evidence: implementation commit `17db8e38`, current upstream state, and deploy disposition. If deploy evidence is absent, say that explicitly instead of leaving active checkboxes. Then advance `.context/plans/README.md` to the Cycle 53 review state.

### C53-DDP-03 - Cycle 52 coverage claims behavioral proof, but the test only checks source substrings

- Severity: Low
- Confidence: High
- Files: `.context/plans/cycle-52-2026-07-01-plan.md:19`, `apps/web/src/__tests__/cycle-52-source-contracts.test.ts:8`
- Failure scenario: the Cycle 52 plan says the test "must prove" Settings threads the resolved semantic mode and renders active/healed production states. The test reads source files and checks for literal substrings. It would pass if those strings moved into comments, unreachable JSX, or a broken branch, and it does not exercise the save path that matters for C53-DDP-01.
- Documentation-code drift: the committed test is useful as a cheap wiring smoke, but the plan overstates what it proves.
- Fix: keep the source-contract test if desired, but add a DOM/interaction-level component test for both stored-production states: active production shows the operator-active copy, healed production shows a distinct inactive state, choosing Disabled submits `disabled`, and choosing Stub submits `stub`. Update the plan wording to distinguish source-smoke coverage from behavioral coverage.

## Final Sweep

- Cycle 52 production-active visibility is materially improved: the server passes `resolveSemanticSearchMode(...)` into the client (`settings/page.tsx:27`), the active production state renders a disabled production item and status text (`settings-client.tsx:823`, `settings-client.tsx:831`), and English/Korean message keys are present.
- Public serving gates still depend on resolved config, not raw Settings UI state: semantic search serves only `stub`/`production`, and similar-photo search serves only `production`.
- No new UX/accessibility/i18n issue found in the production-active display itself: the select is labelled, help/status text is wired via `aria-describedby`, and i18n parity passed.
- No carry-forward deferred item was re-raised; the findings above are based on new Cycle 52/53 evidence.
