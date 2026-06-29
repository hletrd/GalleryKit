# Plan 374 - Cycle 18 Review Fixes

Status: DONE
Cycle: 18/100
Source review aggregate: `.context/reviews/_aggregate.md`
Created: 2026-06-30 KST

Repo rules checked before planning: `CLAUDE.md`, `AGENTS.md`, `.context/**`, `docs/**`, root/app README files. Security, correctness, data-loss, and gate findings are scheduled here unless the deferred ledger quotes a repo rule or accepted boundary that permits deferral.

Completion note: cycle 19 verifier confirmed every scheduled item below was implemented at current HEAD. Deferred cycle-18 findings remain active in `plan/plan-375-cycle18-deferred.md`.

## Scheduled Findings

1. AGG-C18-01 - Bounded CLIP inference admission
   - Original severity/confidence: High / High.
   - Citations: `apps/web/src/lib/clip-model.ts:53-70`, semantic route embedding call sites.
   - Implementation: replace the unbounded waiter array with a bounded pending queue and timeout. Add explicit saturation errors so public routes can return 503/429 instead of retaining unbounded waiters.
   - Tests: add focused unit coverage for queue saturation/release behavior using exported test hooks or source-level contract tests if direct runtime injection is impractical.
   - Status: [x] Implemented with bounded pending queue, timeout errors, and source-contract coverage.

2. AGG-C18-02 - Retain semantic rate-limit budget before DB-backed disabled/stub config work
   - Original severity/confidence: Medium / High.
   - Citations: `apps/web/src/app/api/search/semantic/route.ts:168-205`, `apps/web/src/app/api/search/similar/[id]/route.ts:85-113`.
   - Implementation: charge semantic attempts after cheap origin/maintenance/header gates but before `getGalleryConfig()`, and stop rolling back after config lookup for disabled/stub mode.
   - Tests: update disabled/stub route tests to assert config-gated requests retain budget after the DB config read.
   - Status: [x] Implemented for semantic and similar routes; disabled/stub tests updated.

3. AGG-C18-03 - Public route rate-limit scanner transitive mutator detection
   - Original severity/confidence: Medium / High.
   - Citations: `apps/web/scripts/check-public-route-rate-limit.ts:124-286`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:364-381`.
   - Implementation: compute local mutating functions to a fixed point so helper-to-helper mutations are treated as protected mutations.
   - Tests: add a two-hop helper negative fixture.
   - Status: [x] Implemented with fixed-point local mutator detection and two-hop fixture.

4. AGG-C18-07 - Bulk tag mutation freshness on scalar no-op mixes
   - Original severity/confidence: Medium / Medium.
   - Citations: `apps/web/src/app/actions/images.ts:1057-1155`, `apps/web/src/lib/data.ts:828-852`.
   - Implementation: explicitly bump `images.updated_at` whenever tag mutation rows are affected, independent of scalar `setClause` shape.
   - Tests: add/update source or behavior test for scalar no-op plus tag mutation freshness.
   - Status: [x] Implemented with unconditional tag-mutation timestamp touch and regression coverage.

5. AGG-C18-08 - Serialize database backup with restore
   - Original severity/confidence: Medium / Medium-high.
   - Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:119-170`, `apps/web/src/app/[locale]/admin/db-actions.ts:286-390`.
   - Implementation: make `dumpDatabase()` acquire the same `LOCK_DB_RESTORE` advisory lock on a dedicated connection for the full dump and release it in `finally`.
   - Tests: add a source contract that backup participates in `LOCK_DB_RESTORE`.
   - Status: [x] Implemented with `LOCK_DB_RESTORE` around backup dump and source contract coverage.

6. AGG-C18-11 / AGG-C18-12 / AGG-C18-34 / AGG-C18-35 - Documentation/provenance drift
   - Original severity/confidence: Low-Medium / High.
   - Citations: `apps/web/src/lib/serve-upload.ts:245-267`, `apps/web/src/app/api/admin/db/download/route.ts:73-75`, `apps/web/src/lib/process-image.ts`, `.context/reviews/_aggregate.md`, `.context/plans/cycle-18-plan.md`, `.context/plans/README.md`.
   - Implementation: correct the stale cache lifetime and TOCTOU wording, update pipeline-version history if still stale, replace stale aggregate content, and mark any obsolete cycle-18 plan/index state consistently.
   - Tests: adjust source-contract tests only where wording changed.
   - Status: [x] Implemented for aggregate/provenance, cache comment, and TOCTOU wording; pipeline v7 was already current.

7. AGG-C18-09 / AGG-C18-10 / AGG-C18-36 / AGG-C18-37 - High/medium UI recovery and token-flow safeguards
   - Original severity/confidence: High-Medium / High.
   - Citations: `apps/web/src/app/[locale]/error.tsx`, admin categories/tokens UI files cited in `designer.md`.
   - Implementation: improve public error recovery copy/navigation, add first-run categories empty-state affordance, add one-time-token dismiss acknowledgement, and keep token revoke feedback visible.
   - Tests: add focused source/behavior coverage where existing test harness supports it.
   - Status: [x] Implemented category empty state, one-time token acknowledgement, and revoke-dialog pending guard. Public error page already had retry and gallery recovery links at current HEAD.

## Verification Gates

Run all configured gates against the whole repo before commit/push:

- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `npm run build --workspace=apps/web`
- `npm test --workspace=apps/web`

After green gates, commit with GPG signing and Conventional Commit + gitmoji, pull --rebase, push, then run `npm run deploy` once for per-cycle deploy.
