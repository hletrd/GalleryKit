# Cycle 22 Verifier Review

Role: `verifier`
Repo: `/Users/hletrd/flash-shared/gallery`
Current HEAD at write: `dabf8e8a` (intervening commits after `8b795862` changed other review artifacts only)
Reviewed source HEAD: `8b795862079b0e5318242a09390b4cdff1dc2058`
Baseline: Cycle 21 review HEAD `45b32d1db373e03d82a29511f53832051c770880`

## Inventory

Required guidance read first: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`.

Relevant files/categories inspected:

- Current Cycle 21 implementation ledger and index: `.context/plans/cycle-21-2026-07-08-plan.md`, `.context/plans/cycle-21-2026-07-08-deferred.md`, `.context/plans/deferred-carry-forward.md`, `.context/plans/README.md`.
- Prior-cycle claims and assertions: `.context/reviews/_aggregate.md`, prior `.context/reviews/verifier.md`, prior `.context/reviews/test-engineer.md`, commit `8b795862`.
- Mutation-barrier scanner and tests: `apps/web/scripts/check-action-origin.ts`, `apps/web/src/__tests__/check-action-origin.test.ts`, all `apps/web/src/app/actions/**` acquired-slot call shapes.
- Pending deletion ledger: `apps/web/src/lib/pending-file-deletions.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/db/schema.ts`, `apps/web/drizzle/0030_pending_file_deletions.sql`, `apps/web/scripts/migrate.js`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/__tests__/pending-file-deletions-source.test.ts`.
- Scheduled fix surfaces spot-checked: image queue permanent failures, MySQL datetime parsing, root script syntax gate, i18n keys, map marker naming, image-manager checkbox labels.

## Findings

### VER-C22-01 - Positive acquired-guard shape still lets mutations run outside the restore slot check

- Severity: High
- Confidence: High
- Status: Confirmed
- Files/regions: `apps/web/scripts/check-action-origin.ts:641-650`, `apps/web/scripts/check-action-origin.ts:664-708`, `apps/web/src/__tests__/check-action-origin.test.ts:640-655`, `apps/web/src/app/actions/auth.ts:290-302`
- Contract: Cycle 21 WP1 required the scanner to prove mutation-barrier acquisition before mutations; the positive `if (slot.acquired) { ... }` shape is only safe when protected mutations are lexically inside that branch.
- Evidence: `statementIsMutationSlotPositiveGuard()` returns true for a bare `if (mutationSlot.acquired)` and `bodyAcquiresAdminMutationSlot()` accepts it solely because it is the next statement after `using`. It does not inspect whether later mutations are inside the branch. A focused reproduction passed:

```bash
cd apps/web
node --import tsx -e "import { checkActionSource } from './scripts/check-action-origin.ts'; const src = \`import { requireSameOriginAdmin } from '@/lib/action-guards'; import { acquireAdminMutationSlot } from '@/lib/admin-mutation-barrier'; import { db, images } from '@/db'; import { eq } from 'drizzle-orm'; export async function updateImage(id, input) { const originError = await requireSameOriginAdmin(); if (originError) return { error: originError }; using mutationSlot = acquireAdminMutationSlot(); if (mutationSlot.acquired) { console.log('guard observed'); } await db.update(images).set(input).where(eq(images.id, id)); return { success: true }; }\`; console.log(JSON.stringify(checkActionSource(src, 'src/app/actions/images.ts'), null, 2));"
```

Output included `"OK: src/app/actions/images.ts::updateImage"`. Current production actions mostly use the negative early-return shape; `logout()` uses the positive branch correctly at `apps/web/src/app/actions/auth.ts:290-302`.
- Failure scenario: a future mutating action adds an empty/logging positive acquired check, then performs DB writes afterward. `npm run lint:action-origin` remains green while restore maintenance can be bypassed.
- Suggested fix/test: for positive guards, require all mutation markers/protected writes after the `using` declaration to be lexically contained in the acquired branch, or disallow the positive shape except in explicitly reasoned exemptions. Add a negative fixture where `if (slot.acquired) {}` is followed by `await db.update(...)`.

### VER-C22-02 - Pending file-deletion rows are durable but have no later retry/drain path

- Severity: High
- Confidence: High
- Status: Confirmed
- Files/regions: `.context/plans/cycle-21-2026-07-08-plan.md:53-68`, `apps/web/src/lib/pending-file-deletions.ts:70-90`, `apps/web/src/app/actions/images.ts:714-727`, `apps/web/src/app/actions/images.ts:864-907`, `apps/web/src/__tests__/pending-file-deletions-source.test.ts:39-45`
- Contract: Cycle 21 WP2 says failed cleanup should be preserved "so a later retry can finish cleanup" and acceptance says cleanup failures leave durable retry state.
- Evidence: failed cleanup updates `pending_file_deletions.attempts` and `last_error`, but repo-wide search shows no reader/drain/scheduler/admin retry path for `pendingFileDeletions` outside the immediate delete call and migration/backup allowlists. The only cleanup executor is `cleanupPendingFileDeletion(record)`, called synchronously from `deleteImage()` and `deleteImages()`.
- Failure scenario: a transient filesystem or permission failure leaves a public derivative on disk and records a ledger row. After the action returns success, no restart, scheduler tick, admin page, or operator command will consume that row, so the file can remain publicly available indefinitely unless someone writes ad hoc cleanup.
- Suggested fix/test: add a bounded cleanup drain invoked at startup/maintenance and an admin/operator retry surface, with idempotent behavior for missing files. Add behavior tests that seed a failed ledger row, mock one transient failure then success, and prove a later drain deletes files and removes the ledger row.

### VER-C22-03 - Cycle 21 deploy/release ledger remains unfinished at the pushed HEAD

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Files/regions: `.context/plans/cycle-21-2026-07-08-plan.md:1-6`, `.context/plans/cycle-21-2026-07-08-plan.md:221-253`, `.context/plans/README.md:34-37`, commit `8b795862`
- Contract: Project policy requires `npm run deploy` after every pushed commit to `master`; Cycle 21 WP9 explicitly scheduled commit, push, and per-cycle deploy.
- Evidence: `8b795862` is `HEAD -> master, origin/master`, so commit/push happened. The plan still says `commit/push/deploy pending`, the WP9 checkbox for signed commit/push/deploy is unchecked, and the commit trailer says `Not-tested: Production deploy pending until after signed commit is pushed per DEPLOY_MODE=per-cycle`.
- Failure scenario: future cycles read the active plan index and treat Cycle 21 as the current complete release lineage, but the authoritative ledger still lacks production deploy/smoke evidence for the actual pushed HEAD.
- Suggested fix/test: run/record the Cycle 21 deploy or explicitly mark it superseded by a later deploy with the exact commit hash and smoke result. Add a lightweight ledger check that a plan cannot claim active completion while its terminal deploy checkbox and HEAD hash evidence are missing.

## No Finding From Focused Checks

- The negative early-return mutation-barrier regression from Cycle 21 is fixed: `check-action-origin.test.ts:745-760` covers mutation before `if (!slot.acquired)`.
- The new migration journal entry is monotonic: `0030_pending_file_deletions` has `when=1783463767421`, greater than all prior journal entries.
- `APP_BACKUP_TABLES` includes `pending_file_deletions`, so own-backup restore scanning is not immediately broken by the new table.
- Root `scripts/*.mjs` are covered by `check-js-scripts.mjs` discovery.

## Evidence Commands

```bash
git rev-parse --short HEAD
git diff --name-status 45b32d1d..8b795862
git show --format=fuller --no-patch 8b795862
npm run lint:action-origin --workspace=apps/web
npm test --workspace=apps/web -- --run src/__tests__/check-action-origin.test.ts src/__tests__/mysql-datetime.test.ts src/__tests__/pending-file-deletions-source.test.ts
npm test --workspace=apps/web -- --run src/__tests__/migration-journal-monotonicity.test.ts src/__tests__/check-js-scripts-contract.test.ts src/__tests__/sql-restore-scan.test.ts
```

Results: targeted tests passed; `lint:action-origin` passed on current files; the custom positive-guard reproduction still passed incorrectly.

## Final Missed-Issue Sweep / Uninspected

- I did not run the full blocking suite (`lint`, `api-auth`, `public-route-rate-limit`, `typecheck`, `build`, full unit tests, Playwright e2e); this was a review lane and I ran targeted checks only.
- I did not verify live production deploy/nginx/proxy state.
- I did not inspect every historical archive under `.context/plans/archive/`; current plan/deferred/index/aggregate were inspected.
