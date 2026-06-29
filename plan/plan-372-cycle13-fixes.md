# Plan 372 - Cycle 13 Review Fixes

Status: IN_PROGRESS
Cycle: 13/100
Source review aggregate: `.context/reviews/_aggregate.md`

## Scope

Fix the cycle 13 findings that are confirmed, non-deferrable, or safely closed in one implementation pass.

## Progress

- [x] Restore import failure keeps maintenance active after `mysql` handoff.
- [x] `updatePassword` rejects hostile origins before auth/session reads.
- [x] Service worker bypasses unlocalized `/admin` routes and generated `sw.js` was refreshed.
- [x] Incompatible OKLCH token overrides were removed and source-locked.
- [x] `TagInput` combobox has a 44 px target and raw visible text inputs are audited.
- [x] Public analytics recorders swallow pre-insert failures.
- [x] Smart-collection validation is column/operator/value aware.
- [x] Scheduled low-risk doc/comment drift was corrected.
- [x] Targeted regression tests passed: `restore-upload-lock`, `db-restore`, `auth-actions-behavior`, `sw-cache`, `sw-template-contract`, `touch-target-audit`, `public-actions`, `smart-collections`, `theme-token-contract` (129 tests).
- [x] Full required gates passed: lint, API auth lint, action-origin lint, public-route rate-limit lint, typecheck, build, and full Vitest (258 files, 2386 tests passed, 2 files / 4 tests skipped).
- [ ] Commit, push, deploy.

## Scheduled Findings

1. AGG-C13-01 / DBG13-01 - Failed mysql restore clears maintenance after partial import
   - Severity/confidence: High / High.
   - Files: `apps/web/src/app/[locale]/admin/db-actions.ts:367-389`, `apps/web/src/app/[locale]/admin/db-actions.ts:526-604`.
   - Plan: make every failure after restore handoff to `mysql` return `keepMaintenance: true`; add source/behavior regression coverage that nonzero mysql close and restore-stream/process failures fail closed.
   - Acceptance: targeted restore tests pass and the full gate suite passes.

2. AGG-C13-02 / C13-TE-01 - `updatePassword` reads auth state before rejecting hostile origin
   - Severity/confidence: High / High.
   - Files: `apps/web/src/app/actions/auth.ts:283-298`, `apps/web/src/__tests__/auth-actions-behavior.test.ts:241-253`.
   - Plan: move the origin check before `getCurrentUser()` and add hostile-origin assertions for no session verification or DB user reads.
   - Acceptance: auth behavior tests prove no pre-origin auth/session read.

3. AGG-C13-03 - Service worker admin bypass omits unlocalized `/admin` routes
   - Severity/confidence: Low / High, raised by verifier + tracer agreement.
   - Files: `apps/web/public/sw.template.js:42-46`, `apps/web/src/lib/sw-cache.ts:54-62`, `apps/web/src/__tests__/sw-cache.test.ts:47-71`, generated `apps/web/public/sw.js`.
   - Plan: add `/admin` and `/admin/*` to the SW admin bypass predicate, update reference tests, regenerate `sw.js`.
   - Acceptance: SW cache/template tests pass.

4. AGG-C13-04 / DES-C13-01 - OKLCH overrides invalidate Tailwind HSL color utilities
   - Severity/confidence: High / High.
   - Files: `apps/web/src/app/[locale]/globals.css:121-148`, `apps/web/tailwind.config.ts:23-61`.
   - Plan: remove the incompatible OKLCH overrides and keep the existing HSL-channel token contract. Add a source or computed-style regression test if feasible without brittle browser setup.
   - Acceptance: UI/a11y tests pass and primary/destructive utilities no longer resolve through invalid `hsl(oklch(...))` values.

5. AGG-C13-05 / DES-C13-02 - `TagInput` combobox misses 44 px touch target
   - Severity/confidence: Medium / High.
   - Files: `apps/web/src/components/tag-input.tsx:184-223`, `apps/web/src/__tests__/touch-target-audit.test.ts`.
   - Plan: give the combobox input a `min-h-11` target and wrapper click-to-focus behavior without breaking combobox ARIA semantics. Extend the touch-target audit to catch raw text/search inputs with sub-44 height.
   - Acceptance: touch-target audit and targeted TagInput/UI tests pass.

6. AGG-C13-06 / C13-CRIT-01 - Fire-and-forget public analytics can reject before internal catch
   - Severity/confidence: Medium / High.
   - Files: `apps/web/src/app/actions/public.ts:357-441`, `apps/web/src/__tests__/public-actions.test.ts`.
   - Plan: wrap full recorder bodies in top-level `try/catch` after cheap validation/maintenance checks and add tests that rejected pre-insert DB/header work resolves without throwing.
   - Acceptance: public-actions tests prove all three recorders swallow pre-insert failures.

7. AGG-C13-28 / ARCH-C13-01 - Smart collection predicate contract is column-global
   - Severity/confidence: Medium / Medium.
   - Files: `apps/web/src/lib/smart-collections.ts:21-392`, `apps/web/src/__tests__/smart-collections.test.ts`.
   - Plan: introduce per-column operator/value validation for numeric, text, date, topic, and tag fields. Keep topic exact-identity semantics for `eq`/`in`; reject semantically invalid combinations at parse/save time.
   - Acceptance: smart-collection tests cover invalid column/operator/value combinations and valid existing combinations.

8. AGG-C13-30 through AGG-C13-34 - Low-risk documentation/comment drift
   - Severity/confidence: Low / High-Medium.
   - Files: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `CLAUDE.md`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/lib/caption-generator.ts`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`.
   - Plan: update stale comments/docs only, preserving current behavior.
   - Acceptance: docs/comments match current code contracts and docs spellcheck-style gates do not fail.

## Deferred Elsewhere

All other aggregate findings are recorded in `plan/plan-373-cycle13-deferred.md` with original severity/confidence, reason, and exit criterion.

## Required Gates

Run the cycle gates after implementation:

- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `npm run build --workspace=apps/web`
- `npm test --workspace=apps/web`

After green gates: signed commit, pull --rebase, push, and `npm run deploy`.
