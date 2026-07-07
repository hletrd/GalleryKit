# Cycle 21 Verifier Review

Reviewed HEAD: `45b32d1db373e03d82a29511f53832051c770880`
Mode: evidence-based correctness review against `AGENTS.md`, `CLAUDE.md`, and `.context/plans/README.md`.

## Findings

### VER-C21-01 — Mutation-barrier lint accepts an acquired check after the mutation

- Severity: High
- Confidence: High
- Files/regions:
  - `apps/web/scripts/check-action-origin.ts:628-678`
  - `apps/web/src/__tests__/check-action-origin.test.ts:624-738`
  - `.context/plans/cycle-20-2026-07-08-plan.md:49-54`
- Contract: Cycle 20 WP2 explicitly required the scanner to "Require an acquired-state early-return gate before mutation" (`.context/plans/cycle-20-2026-07-08-plan.md:51-53`). `CLAUDE.md`/lint-gate contract says every mutating admin action must hold the restore-window mutation slot for the whole body and refuse work when the slot is not acquired.
- Evidence: `bodyAcquiresAdminMutationSlot()` accepts any later statement that checks `mutationSlot.acquired` after the `using` declaration (`block.statements.slice(i + 1).some(...)` at `check-action-origin.ts:674-676`). It does not prove the check occurs before the first DB/server mutation. Existing negative fixtures cover spoofing, wrong imports, bare calls, non-`using`, and no acquired check, but not "mutation before acquired check".
- Reproduction:

```bash
cd apps/web
node --import tsx -e "import { checkActionSource } from './scripts/check-action-origin.ts'; const src = \`import { requireSameOriginAdmin } from '@/lib/action-guards'; import { acquireAdminMutationSlot } from '@/lib/admin-mutation-barrier'; export async function updateSettings(input) { const originError = await requireSameOriginAdmin(); if (originError) return { error: originError }; using mutationSlot = acquireAdminMutationSlot(); await db.update(settings).set(input); if (!mutationSlot.acquired) return { error: 'restore in progress' }; return { success: true }; }\`; console.log(JSON.stringify(checkActionSource(src, 'src/app/actions/settings.ts'), null, 2));"
```

Output:

```json
{"passed":["OK: src/app/actions/settings.ts::updateSettings"],"failed":[],"skipped":[]}
```

- Concrete failure scenario: a future mutating admin action can run `await db.update(...)` while restore maintenance is active, then check `!mutationSlot.acquired` afterward. `npm run lint:action-origin` still passes, so the exact restore-race class the scanner is meant to prevent can be reintroduced without CI catching it.
- Suggested fix: make the scanner reason about statement order. For the common early-return pattern, require `if (!slot.acquired) return/throw` immediately after the `using` declaration before any mutation marker/protected call; for the positive `if (slot.acquired) { ... }` pattern, require every mutation in the function to be lexically contained in that guarded branch. Add a negative fixture with mutation before the acquired check.

### VER-C21-02 — Current Cycle 20 ledger still records the docs/deploy step as pending at HEAD

- Severity: Low-Medium
- Confidence: High
- Files/regions:
  - `.context/plans/cycle-20-2026-07-08-plan.md:3`
  - `.context/plans/cycle-20-2026-07-08-plan.md:131-142`
  - `.context/plans/cycle-20-2026-07-08-plan.md:157-163`
  - `.context/plans/README.md:36-37`
- Contract: `AGENTS.md` requires `npm run deploy` after every commit pushed to `master`; Cycle 20 WP5 repeats "Run `npm run deploy` after each pushed commit" and smoke the production URL (`cycle-20-2026-07-08-plan.md:131-133`).
- Evidence: at HEAD, the active Cycle 20 plan says "final docs ledger commit/deploy is handled by the orchestrator after this file lands" (`:3`) and leaves the docs-ledger commit/deploy checkbox open (`:142`). The only committed deploy/smoke evidence is for source-fix commit `d8e604ef` (`:157-163`), not for current HEAD `45b32d1d`, which changed `.env.local.example` and review/plan ledgers. The HEAD commit trailer also says `Not-tested: ... post-docs deploy runs after this commit`, but no committed follow-up evidence was found.
- Concrete failure scenario: the next cycle reads `.context/plans/README.md:36-37` and treats Cycle 20 as active and per-cycle deployed, while the authoritative plan still records an unfinished WP5 item. This can hide a missed deploy/smoke step for the final docs/env-example commit and weakens the repo's release-ledger reliability.
- Suggested fix: after the docs/env-example commit is actually deployed and smoked, update `cycle-20-2026-07-08-plan.md` with current HEAD `45b32d1d`, mark WP5 complete, and record the deploy/smoke commands. If deployment is intentionally skipped for docs-only commits, document that as an explicit exception to the per-iteration policy rather than leaving the active ledger half-open.

## No Finding From Focused Checks

- Restore drain ordering: `apps/web/src/app/[locale]/admin/db-actions.ts:47-64` adds a bounded shared-group flush and `:593-635` wires it as the first `runRestoreDrainChecklist` stage. `apps/web/src/__tests__/restore-drain-checklist.test.ts` rejects the old direct pre-checklist flush.
- Service worker photo-page revocability: `apps/web/public/sw.template.js:59-64` and generated `apps/web/public/sw.js` classify `/p/:id` routes as revocable, and `apps/web/src/__tests__/sw-template-contract.test.ts:125-139` covers localized and unlocalized examples. The actual route tree contains `apps/web/src/app/[locale]/(public)/p/[id]/`.
- `DB_SSL_CA` example wording: `apps/web/.env.local.example:9` now matches runtime, Drizzle Kit, and backup/restore CLI TLS behavior confirmed in `apps/web/src/db/index.ts`, `apps/web/drizzle.config.ts`, and `apps/web/scripts/mysql-connection-options.js`.

## Inventory Built

- Required guidance read first: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`.
- Current-cycle ledgers: `.context/plans/cycle-20-2026-07-08-plan.md`, `.context/plans/cycle-20-2026-07-08-deferred.md`, `.context/plans/deferred-carry-forward.md`, `.context/reviews/_aggregate.md`, and top-level `.context/reviews/*.md` inventory.
- Explicitly documented/tested behavior categories mapped:
  - Security/lint contracts: `apps/web/scripts/check-action-origin.ts`, `check-api-auth`, public route rate limit scanner, corresponding unit tests.
  - Restore/DB contracts: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-drain-checklist.ts`, migration docs/tests/scripts.
  - Service worker/PWA contracts: `apps/web/public/sw.template.js`, generated `sw.js`, `sw-template-contract.test.ts`.
  - Deploy/ops contracts: `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `.env.local.example`, nginx template/docs.
  - Privacy/schema contracts: `apps/web/src/lib/data.ts`, `apps/web/src/db/schema.ts`, privacy-field tests, migration journal/reconcile rules.
  - Current source-fix scope: files changed from `bd0cc170..45b32d1d`, with behavior-bearing review concentrated on `d8e604ef`.

## Evidence Commands

```bash
git rev-parse HEAD
git log --oneline --decorate -n 12
git diff --name-only bd0cc170..45b32d1d
npm run lint:action-origin --workspace=apps/web
npm test --workspace=apps/web -- --run src/__tests__/check-action-origin.test.ts src/__tests__/restore-drain-checklist.test.ts src/__tests__/sw-template-contract.test.ts
git diff --check
```

Results:

- HEAD matched requested `45b32d1db373e03d82a29511f53832051c770880`.
- `npm run lint:action-origin --workspace=apps/web` passed for current files.
- Targeted Vitest run passed: 3 files, 152 tests.
- `git diff --check` produced no whitespace errors.

## Final Sweep / Not Fully Inspected

- I did not run the full blocking gate suite (`lint`, `api-auth`, `public-route-rate-limit`, `typecheck`, `build`, full `npm test`, full Playwright e2e`) because this was a review lane and the current source-fix plan already records a full sweep at `d8e604ef`; I ran the targeted gates for the changed contracts instead.
- I did not inspect every historical file under `.context/plans/archive/` or `.context/reviews/archive/`; I used the active current-cycle README, current Cycle 20 plan/deferred pair, carry-forward register, and top-level review aggregate.
- I did not verify live production deployment state or host nginx state; that would require external side-effecting deploy/operator checks outside this review request.
