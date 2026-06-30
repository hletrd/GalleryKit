# Cycle 24 Critic Review

Reviewer: cycle 24 critic  
Repository: `/Users/hletrd/flash-shared/gallery`  
HEAD reviewed: `0cc094dd76d51e88fe163c0b7075e3f0b341f74c` on `master`  
Change surface reviewed: HEAD commit `fix(deploy): 🐛 allow mounted deploy env ownership`, which changes only `scripts/deploy-remote.sh`.  
Source edits: none. This review artifact is the only file written by this critic pass.

## Inventory First

Review-relevant tracked files were inventoried before findings:

- Live source/config/docs set: 590 tracked files across `apps/web/src`, `apps/web/e2e`, `apps/web/scripts`, root `scripts`, `apps/web/drizzle`, manifests, deploy files, CI, `README.md`, `CLAUDE.md`, and `AGENTS.md`.
- Runtime app breadth examined: app routes/pages, API routes, server actions, auth/session/origin guards, public search/share routes, data selectors/privacy guards, upload ingest, image queue, image processing, restore/backup, migrations, deployment, Docker, settings, rate limits, CLIP activation, nav/search/photo-viewer UI surfaces, unit tests, and e2e tests.
- Historical `.context/` and `plan/` archives were inventoried as context but not treated as live product code. The current review output file is the only `.context` file intentionally modified.

Current worktree note: `git status --short` showed an unrelated modified `.context/reviews/verifier.md` before this file write. It was not read as source-of-truth for this review and was not modified.

## Validation Evidence

- `git rev-parse --short HEAD` -> `0cc094dd`.
- `git show --stat --name-only HEAD` confirmed the HEAD change surface is only `scripts/deploy-remote.sh`.
- `bash -n scripts/deploy-remote.sh` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm test --workspace=apps/web -- deploy-script-contract.test.ts` passed: 1 file, 8 tests.
- Full `lint`, `typecheck`, `build`, full Vitest, and Playwright were not rerun in this critic pass because the task was read-only except for this review artifact.

## Confirmed Issues

### CRIT24-01 - Deploy env files can be group/world-readable and still get sourced

Severity: High  
Confidence: High  
Area: operational risk, credential handling, documentation drift  

Evidence:

- The deploy helper sources the selected deploy env file after a permissions check in `scripts/deploy-remote.sh:65-77`.
- The check splits group/world permission digits but rejects only write/execute bits: `((env_group_perms & 3) != 0 || (env_world_perms & 3) != 0)` at `scripts/deploy-remote.sh:67-72`. Read bit `4` is accepted.
- The same error message tells operators to run `chmod 600` at `scripts/deploy-remote.sh:70-71`, but modes such as `0644` and `0640` pass the current predicate.
- The env file carries deploy target and SSH material references: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KEY`, `DEPLOY_PATH`, and optional full `DEPLOY_CMD` in `.env.deploy.example:7-14`.
- HEAD intentionally relaxed ownership failure to a warning in `scripts/deploy-remote.sh:61-63`, so the permission predicate is now the remaining hard local guard.

Concrete failure scenario:

An operator copies `.env.deploy.example` to `.env.deploy` and leaves the file at a common default mode such as `0644`. `npm run deploy` accepts and sources it. On a shared workstation, mounted checkout, backup agent, or compromised low-privilege local account, another user can read deploy host/user/key path or a full custom `DEPLOY_CMD`, weakening the deploy boundary. The script says `chmod 600` is required, but the code does not enforce it.

Suggested fix:

Reject any group/world permission bits before sourcing, for example by checking `((env_perms & 77) != 0)` after parsing the octal mode, or equivalently rejecting group/world read/write/execute. Keep the non-owner warning only if mounted env files are required, but make readability strict. Add tests proving `0600` passes and `0644`, `0640`, `0660`, and `0755` fail.

### CRIT24-02 - Deploy helper tests do not cover the credential-file permission contract

Severity: Medium  
Confidence: High  
Area: testing adequacy, operational regression prevention  

Evidence:

- `apps/web/src/__tests__/deploy-script-contract.test.ts:47-54` verifies that the deploy target is config-driven and does not hardcode an SSH target.
- The same test file covers Docker prune ordering, mutable mounts, build args, and native dependency pinning in `apps/web/src/__tests__/deploy-script-contract.test.ts:20-89`.
- There is no test in that file for the permission-mode behavior around `scripts/deploy-remote.sh:65-72`.
- The targeted test still passes on current HEAD: `npm test --workspace=apps/web -- deploy-script-contract.test.ts` -> 8/8 tests passed, despite CRIT24-01.

Concrete failure scenario:

A future change again weakens the deploy env guard, or preserves the current read-bit gap, and CI remains green because the contract test only checks script text for config-driven deployment. The regression is found only at operation time or by manual review.

Suggested fix:

Refactor the permission decision into a small shell-testable function or add a lightweight shell harness that creates temp env files at specific modes and invokes the helper with a harmless `DEPLOY_CMD='true'`. Assert `0600` succeeds and group/world readable/writable/executable modes fail before `source`.

### CRIT24-03 - Foreground image queue can starve the shared MySQL pool when concurrency is raised

Severity: Medium  
Confidence: High  
Area: failure modes, operational risk  

Evidence:

- The shared MySQL pool is fixed at 10 connections with queue limit 20 in `apps/web/src/db/index.ts:23-33`.
- `QUEUE_CONCURRENCY` is operator-configurable up to 8 in `apps/web/src/lib/image-queue.ts:87-90`.
- Each image job acquires a MySQL advisory-lock connection and returns the connection as the claim handle in `apps/web/src/lib/image-queue.ts:446-455`.
- That lock connection remains held while the job checks DB state, resolves the original, runs Sharp processing, verifies derivatives, and updates the row in `apps/web/src/lib/image-queue.ts:554-657`.
- The lock is released only in final cleanup at `apps/web/src/lib/image-queue.ts:812-815`.
- The admin backfill path already contains the missing pool-budget pattern: it documents the pinned-connection arithmetic in `apps/web/src/lib/admin-backfill-runner.ts:108-127` and clamps requested concurrency in `apps/web/src/lib/admin-backfill-runner.ts:667-678`.

Concrete failure scenario:

An operator raises `QUEUE_CONCURRENCY=8` during a large upload/import. Eight foreground queue jobs can pin eight of ten shared DB connections across long image processing work. Page renders, session checks, admin actions, public search, and queue state writes then compete for two connections and a 20-item wait queue, causing avoidable 500s even while the DB itself is healthy.

Suggested fix:

Apply the same pool-budget cap used by admin backfill to the foreground queue, reserving live request headroom. A conservative fix is a `resolveImageQueueConcurrency(requested, POOL_CONNECTION_LIMIT)` helper plus a test proving configured queue concurrency cannot consume the live traffic budget. A stronger fix is to avoid holding shared-pool advisory-lock connections across Sharp work.

## Likely Issues / Risks Needing Manual Validation

### CRIT24-04 - Single-process topology is documented but not enforced

Severity: Medium  
Confidence: High for architecture state, Medium for likelihood  
Area: product correctness, failure modes, operational risk  

Evidence:

- `CLAUDE.md:233-236` states the shipped deployment is single web-instance/single-writer and warns that restore maintenance, upload quota tracking, image queue state, and several rate-limit buckets are process-local.
- Restore maintenance is a `globalThis` flag in `apps/web/src/lib/restore-maintenance.ts:1-56`.
- Upload quota tracking is a `globalThis` `Map` in `apps/web/src/lib/upload-tracker-state.ts:7-20`, and active-claim checks are process-local in `apps/web/src/lib/upload-tracker-state.ts:70-78`.
- Image queue state is also process-local around `apps/web/src/lib/image-queue.ts:76-90`.
- The shipped compose file declares one service/container in `apps/web/docker-compose.yml:1-28`, but there is no startup lease or DB-backed process-count assertion that fails if a second web process points at the same DB/uploads tree.

Concrete failure scenario:

A future operator or deploy script starts a second web process for availability. Process A begins a restore and sets only its own maintenance flag. Process B continues to accept uploads, maintains separate upload/rate-limit maps, and runs its own queue bootstrap. The product silently violates the documented single-writer assumptions.

Suggested fix:

If single-writer remains the contract, make it executable: acquire a startup MySQL advisory lease for the web writer and fail fast if another writer is active. If scale-out is desired, move restore state, upload quota tracking, queue ownership, and public rate-limit buckets to shared durable coordination first.

### CRIT24-05 - Nav visual e2e tests save screenshots but do not assert visual regressions

Severity: Low-Medium  
Confidence: High  
Area: UX consistency, testing adequacy  

Evidence:

- `apps/web/e2e/nav-visual-check.spec.ts:40-79` is named `Nav visual checks` and has screenshot-oriented test names.
- The tests assert visibility, touch target dimensions, and non-overlap via `expectVisibleNavTargetsAreStable` in `apps/web/e2e/nav-visual-check.spec.ts:6-38`.
- The screenshot calls at `apps/web/e2e/nav-visual-check.spec.ts:51`, `:65`, and `:78` only write PNG artifacts under `test-results`; they do not use `expect(page).toHaveScreenshot(...)` or compare against a baseline.
- Repo-wide search found no `toHaveScreenshot` assertions in `apps/web/e2e` or `apps/web/src/__tests__`.

Concrete failure scenario:

Nav spacing, color contrast, wrapping, z-index, or theme styling regresses while basic visibility/touch-target/non-overlap checks still pass. CI produces screenshot artifacts, but it does not fail unless a human manually inspects them every run.

Suggested fix:

Either convert these to real visual regression tests with `toHaveScreenshot` and controlled fixtures/viewports, or rename/document them as artifact-capture smoke tests and add explicit assertions for the visual properties the product cares about, such as no horizontal overflow, active theme state, collapsed/expanded density, and contrast-sensitive states.

## Cleared Checks And Non-Findings

- Current public share pages avoid the earlier enumeration class: metadata is generic and intentionally avoids share-key DB lookup in `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:36-79` and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:41-84`; the body rate-limits lookup before DB access in `s/[key]/page.tsx:81-103` and `g/[key]/page.tsx:86-111`.
- Public semantic search and similar routes have same-origin, maintenance, rate-limit, mode, scan-limit, and ID/body gates in inspected current code. The security lint gates also passed.
- Docs and package versions are aligned for the major stack claims checked in this pass: `.nvmrc` is `24`; `apps/web/package.json` declares Node `>=24`, Next `^16.2.9`, React `^19.2.5`, TypeScript `^6`, and `CLAUDE.md`/`README.md` describe Node 24+, Next 16, React 19, and TypeScript 6.
- Migration/journal guidance was inspected; no new schema migration is present in HEAD, and the current deploy change does not touch Drizzle artifacts.
- Docker deploy pruning still runs after `up -d --build`, and the automatic volume prune remains `docker volume prune -f` without `-a` in `apps/web/deploy.sh:27-63`.

## Final Sweep

Commonly missed issue sweep:

- Secrets: found one confirmed local-readable deploy env gap (CRIT24-01); no plaintext deploy secret values were printed by commands.
- Auth/origin/rate limits: focused project lint gates passed; no unwrapped admin API route or mutating server action origin omission was found.
- Privacy fields: public selectors and search enrichment were inspected; no new admin-only field exposure found in the reviewed current code.
- Migration drift: no HEAD migration change; no new journal/schema drift found.
- Production operations: single-writer and foreground queue pool-budget risks remain the highest non-HEAD operational risks.
- UX/a11y: touch target and overlap checks exist for nav, but true visual regression coverage is not enforced.
- Documentation drift: stack-version docs are current; deploy permission message says `chmod 600` but the code does not enforce that exact safety posture.

Skipped-file confirmation:

- I did not intentionally skip any live review-relevant source/config/test/docs area in the inventory above.
- I did not line-review every historical `.context/` and `plan/` archive because those are prior review/plan history, not current executable product surface.
- I did not inspect generated/runtime outputs such as `.next`, `node_modules`, or `test-results` as source.
