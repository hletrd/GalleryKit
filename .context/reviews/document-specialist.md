# Document-Specialist Review - Cycle 20

Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Lane: `document-specialist`
Reviewed working tree: current `master` at `bd0cc170` plus concurrent, unmodified peer review-file edits.

## Scope and Method

I reviewed the repository documentation/code contract surfaces for mismatches that could mislead future agents or operators. The inventory was built from tracked docs and contract files with `git ls-files`, then checked against the current source, scripts, deploy helpers, tests, and repo policy. I did not mutate any peer lane reports.

External package behavior did not need a web lookup for the confirmed findings: both are repo-local doc/source/provenance mismatches. Where package behavior is described in docs, I checked the current local implementation and tests rather than relying on memory.

## Inventory

Tracked documentation and contract-like surfaces inventoried: 2,638 tracked files matched docs/readme/context-plan/context-review/package/deploy contract globs.

Primary policy/runbook docs:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `apps/web/README.md`
- `.env.deploy.example`
- `apps/web/.env.local.example`
- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`
- `apps/web/__test_fixtures__/color/README.md`

Plan and review ledgers:

- `.context/plans/README.md`
- `.context/plans/deferred-carry-forward.md`
- current and historical `.context/plans/*plan.md` / `*deferred.md`, including bare `cycle-20-*`, `cycle-21-*`, `cycle-22-*`, dated run-10 plans, loop-B plans, `archive/`, and `done/`
- `.context/reviews/_aggregate.md`
- current peer review reports under `.context/reviews/*.md`
- historical review directories under `.context/reviews/**`

Package, deploy, and operational contracts:

- root `package.json`
- `apps/web/package.json`
- `scripts/deploy-remote.sh`
- `apps/web/deploy.sh`
- `apps/web/docker-compose.yml`
- `apps/web/Dockerfile`
- `apps/web/nginx/default.conf`
- `apps/web/next.config.ts`
- `apps/web/drizzle.config.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/mysql-connection-options.js`
- `apps/web/scripts/ensure-site-config.mjs`
- `apps/web/src/site-config.json`
- `apps/web/src/site-config.example.json`

Source regions checked against docs:

- database/TLS setup: `apps/web/src/db/index.ts`, `apps/web/drizzle.config.ts`, MySQL helper scripts
- migrations/reconcile/baseline: `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, Drizzle migrations
- CLIP semantic search/runbook: `apps/web/src/lib/clip-embeddings.ts`, `clip-model.ts`, semantic/similar routes, backfill scripts, embedding actions
- upload/body-limit contracts: `apps/web/src/lib/upload-limits.ts`, `next.config.ts`, upload actions, Lightroom route, restore path, nginx limits
- origin/auth/rate-limit gates: `apps/web/src/lib/request-origin.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, admin/public actions and routes, lint scripts
- image/color/HDR/privacy contracts: `apps/web/src/lib/process-image.ts`, `image-types.ts`, color tests, privacy select guards
- service worker/cache and generated-artifact contracts: `apps/web/public/sw.template.js`, `sw.js`, build stamp tests
- tests that function as documentation/source-contracts under `apps/web/src/__tests__/` and Playwright specs under `apps/web/e2e/`

## Confirmed Issues

### DOC-C20-01 - `.env.local.example` narrows `DB_SSL_CA` to CLI TLS, but runtime and Drizzle Kit also fail closed without it

- Severity: Low-Medium
- Confidence: High
- File/region: `apps/web/.env.local.example:1-10`
- Contradicting source: `apps/web/src/db/index.ts:7-18`, `apps/web/scripts/mysql-connection-options.js:13-29`, `apps/web/drizzle.config.ts:5-17`
- Related accurate docs: `CLAUDE.md:94`, `README.md:173`, `apps/web/README.md:52`

Problem: the copied environment example says `DB_SSL_CA` is "Required for verified MySQL CLI TLS to non-local DB hosts". Current source requires it for more than CLI helpers. The runtime DB pool throws at import for non-local `DB_HOST` unless `DB_SSL_CA` is set or `DB_SSL=false`; Drizzle Kit config has the same fail-closed behavior; backup/restore CLI helpers also throw.

Failure scenario: an operator preparing a remote MySQL deployment from the example can reasonably infer that `DB_SSL_CA` matters only for MySQL CLI backup/restore flows. They omit the CA, deploy with a non-local `DB_HOST`, and the app fails at runtime/import or migration tooling fails before serving routes.

Concrete fix: update `apps/web/.env.local.example:9` to match the authoritative docs, for example:

```dotenv
# DB_SSL_CA=/path/to/ca.pem  # Required for verified runtime, Drizzle Kit, and backup/restore CLI TLS to non-local DB hosts
```

Optionally add a second comment that public-CA/managed MySQL still needs an explicitly pinned CA on this path, or `DB_SSL=false` only for a trusted private link.

### DOC-C20-02 - Plan index and bare cycle files still present stale/future cycle ledgers as active or ambiguous

- Severity: Medium for agent/process safety; not a product runtime defect
- Confidence: High
- File/region: `.context/plans/README.md:34-45`
- Supporting regions: `.context/reviews/_aggregate.md:1-7`, `.context/plans/cycle-20-plan.md:1-5` and `:119-125`, `.context/plans/cycle-21-plan.md:1-5` and `:68-78`, `.context/plans/cycle-22-plan.md:1-5` and `:65-75`, `.context/plans/deferred-carry-forward.md:19-24` and `:46-47`

Problem: the plan index's "Active Current-Cycle Plans" still points to Run-10 Cycle 19 and loop-B Cycle 9 at reviewed HEAD `6efd737b`. The current repository HEAD is `bd0cc170`, and current peer reports are Cycle 20. The latest aggregate file is also still Cycle 19. Separately, bare `cycle-20-plan.md`, `cycle-21-plan.md`, and `cycle-22-plan.md` exist beside dated run-10 files. The README disambiguates undated `cycle-19-*` and several Cycle 9 lineages, but it does not disambiguate these bare Cycle 20/21/22 files.

This is partly self-admitted: `cycle-20-deferred.md:27` records `AGG-C20-40` ("Plan index status may mislead future cycles") with an exit criterion before using the index as a backlog source. The issue remains observable in the current files.

Failure scenario: a future agent follows `.context/plans/README.md` as the convenience pointer, reads Cycle 19/loop-B Cycle 9 as active, or treats the bare Cycle 21/22 files as current successor plans. It can then schedule already-completed work, skip current Cycle 20 review findings, or cite the stale Cycle 19 aggregate as the latest review source.

Concrete fix:

- Update `.context/plans/README.md` after this review cycle to mark Run-10 Cycle 19 and loop-B Cycle 9 as completed/superseded and add the current Cycle 20 review/aggregate state with the actual HEAD.
- Add a "Historical-name disambiguation" entry for bare `cycle-20-*`, `cycle-21-*`, and `cycle-22-*`, or rename/archive those bare files into dated/run-qualified filenames.
- Update `.context/reviews/_aggregate.md` as part of the normal review aggregation so it is not silently used as the latest Cycle 20 aggregate.
- Update `deferred-carry-forward.md` when the current cycle's deferred register is final: it currently advertises its last age-budget check as run-10 c19.

## Likely Issues

### DOC-C20-L01 - Carry-forward age register has not yet incorporated the current cycle

- Severity: Low-Medium
- Confidence: Medium
- File/region: `.context/plans/deferred-carry-forward.md:1-7`, `:19-24`, `:46-47`

Problem: the carry-forward register says it must be updated every cycle, but its latest age-budget check and age column are still run-10 c19. Because this lane is running during Cycle 20 review, this may simply be normal in-progress state. It becomes a confirmed stale-doc issue if Cycle 20 finishes and the register still does not include the current cycle's new deferrals and aged rows.

Failure scenario: a planner uses the consolidated register to enforce the High 8-cycle and Medium 16-cycle checkpoint rules and undercounts the age of long-lived deferrals by at least one cycle.

Concrete fix: after Cycle 20 aggregation/deferred decisions, bump ages, add new open deferrals, remove closed rows, and update the check label from run-10 c19 to the current cycle.

## Manual-Validation Risks

- Live deploy topology cannot be proven from repo files alone. The deploy/nginx docs match the checked-in scripts and config, but the actual host, reverse-proxy chain, certificate state, MySQL TLS CA, and CLIP sidecar weights require operator/live-host validation.
- Historical plans and reviews were inventoried and searched for current-risk signals. I treated files clearly framed as historical records as provenance, not current runbooks, unless the current index or active docs point at them.
- The CLIP historical design docs under `docs/superpowers/` explicitly identify themselves as historical and point operators to `CLAUDE.md` / `apps/web/README.md` for current operation, so I did not classify their older implementation details as active mismatches.
- The existing concurrent peer review file modifications were not inspected as finalized cycle artifacts and were not changed.

## Validated Matches

- Root and app README quality-gate commands match the package scripts: lint, auth-origin/rate-limit lints, typecheck, build, Vitest, and Playwright e2e.
- Deploy docs match `scripts/deploy-remote.sh` and `apps/web/deploy.sh`: root `npm run deploy`, env-file precedence, SSH-derived remote command, runtime `.env.local`, and post-`up -d` Docker pruning.
- Docker build/runtime environment wiring matches current compose/Dockerfile behavior: `BASE_URL`, `IMAGE_BASE_URL`, `UPLOAD_MAX_TOTAL_BYTES`, and `NEXT_UPLOAD_BODY_MAX_BYTES` are build args; `.env.local` is the runtime env file.
- Nginx upload/body limits match the documented topology: default small bodies, special admin DB/restore and Lightroom upload limits, and no broad `/api/admin/` large-body opening.
- Migration docs match current `migrate.js` behavior: journal whens must be monotonic, reconcile baseline mirrors schema state, DML guards run before baseline/migrate, and hash postconditions fail deploy on silently skipped journal entries.
- CLIP semantic runbook defaults match current source after the recent cycle work: disabled/stub/production modes, scan/top-k bounds, sidecar model root handling, and repeat-until-empty guidance.
- Image upload limit docs match `upload-limits.ts`, `next.config.ts`, and Docker build args for the app-level total and Next body-size ceiling.
- Privacy-sensitive select guard docs match the current code/test pattern: admin-only fields remain omitted from public data surfaces and covered by the symmetric privacy fixture.

## Final Sweep

Commonly missed doc-risk areas checked:

- stale feature claims in top-level and app READMEs
- wrong package scripts or workspace names
- deploy command/env precedence drift
- Docker/nginx body-limit mismatches
- migration/journal/runbook drift
- runtime env defaults and fail-closed behavior
- CLIP semantic-search activation and backfill instructions
- source comments that serve as concurrency/security contracts
- context-plan provenance and cycle-number ambiguity
- generated/public artifacts whose source templates are documented

Findings are limited to the confirmed and likely issues above. No destructive or unsafe operation was performed.
