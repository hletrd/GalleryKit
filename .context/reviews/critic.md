# Cycle 35 Critic Review

Date: 2026-07-08 KST
Role: `cycle-35 critic`
Repository: `/Users/hletrd/flash-shared/gallery`
Mode: review-only; no product-code edits.

## Inventory And Scope Reviewed

Required control docs were read first:

- `AGENTS.md:15-39` for deploy, schema, and blocking quality-gate policy.
- `CLAUDE.md:510-667` for operational playbook, nginx manual-apply rules, disk hygiene, CLIP production activation, upload/memory limits, persistence, and liveness/readiness contracts.

Repository inventory was built before judging code:

- Repository file map via `rg --files`.
- Review-relevant surface count: 643 files under `apps/web/src/app`, `apps/web/src/lib`, `apps/web/src/db`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, and `apps/web/src/__tests__`.
- App Router inventory: 12 `route.*` handlers and 13 server-action files.
- Test inventory: 364 unit/integration test files under `apps/web/src/__tests__` and 10 Playwright e2e/helper files under `apps/web/e2e`.
- Tracked artifact/secret sweep checked for committed `.env`, `.next`, data/upload directories, obvious secret/key/token/password filenames; only examples, tests, and auth/token source were matched.

Areas examined in detail:

- Product/data correctness: `apps/web/src/lib/data.ts:13-120`, `apps/web/src/lib/data.ts:1318-1362`, `apps/web/src/lib/data.ts:1766-1809`, public page/share/map/search paths, and privacy projections.
- Auth and mutation safety: `apps/web/src/lib/api-auth.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, admin API routes, admin DB actions, public mutation routes, same-origin guards, and rate-limit guard scripts.
- Data integrity and migration behavior: `apps/web/src/db/schema.ts`, `apps/web/scripts/migrate.js:1-110`, `apps/web/scripts/migrate.js:291-360`, `apps/web/scripts/migrate.js:760-835`, all committed `apps/web/drizzle/*.sql`, and `apps/web/drizzle/meta/_journal.json`.
- Deployment and operations: `apps/web/deploy.sh:10-12`, `apps/web/deploy.sh:51-77`, `apps/web/deploy.sh:79-104`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf:1-29`, and `apps/web/nginx/default.conf:254-306`.
- CLIP semantic search: `apps/web/package.json:21-23`, `apps/web/src/lib/clip-model.ts:200-225`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:1-31`, semantic/similar routes, enrichment fields, and search UI.
- Restore/upload/maintenance safety: restore maintenance barrier, DB restore helpers/actions, external Lightroom upload route, upload tracker state, and prior verifier notes.
- Prior-cycle context: newest verifier/test-engineer review artifacts and `.context/plans/archive/82-deferred-cycle34.md`, to avoid re-filing closed or already-tracked items as new defects.

Skipped or only sampled:

- Generated/runtime artifacts such as `apps/web/.next/**`, local `.omc/**`, uploaded media, binary image fixtures, and untracked runtime data.
- Full line-by-line reading of every test file; I sampled tests around the risk areas and used guard scripts plus targeted suites for evidence.
- Full deploy, production nginx reload, production CLIP preflight, production RSS measurement, and Playwright browser flows; those require external/runtime state and were treated as manual validation risks below.

## Validation Evidence

Fresh checks run in this review lane:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed; all mutating server actions either enforce same-origin provenance or carry explicit exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed; public route handlers were either guarded or explicitly exempted.
- Targeted regression suite passed:
  `npm test --workspace=apps/web -- --run src/__tests__/privacy-fields.test.ts src/__tests__/migration-journal.test.ts src/__tests__/migration-journal-monotonicity.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/deploy-script-contract.test.ts src/__tests__/nginx-config.test.ts src/__tests__/search-route-privacy.test.ts`
  Result: 7 files passed, 141 tests passed.

Additional static sweeps:

- `rg` checks for `sql.raw`, shell execution, dangerous/TODO markers, DOM injection, cookies, random IDs, and environment parsing produced no new actionable issue after inspecting the relevant hits.
- Test skip/focus sweep found no `.only`. Skips are explicit for local-admin e2e gating and real-CLIP env-gated suites: `apps/web/e2e/admin.spec.ts:7-12`, `apps/web/e2e/origin-guard.spec.ts:29-77`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`, and `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`.

Not run in this critic lane: full `npm run lint`, `npm run typecheck`, `npm run build`, full `npm test`, `npm run audit:prod`, `npm run test:e2e`, `npm run deploy`.

## Findings

No new confirmed or likely code-level findings.

This is not a claim that the repository is risk-free. It means the cross-file issues I specifically pursued were either covered by code/tests/docs or already tracked as operational/manual risks:

- Public privacy surfaces are guarded by explicit projections and tests: share group reads omit sensitive fields at `apps/web/src/lib/data.ts:1318-1362`, map GPS exposure is opt-in by topic and runtime-asserted at `apps/web/src/lib/data.ts:1766-1809`, and the targeted privacy/search tests passed.
- Migration/baseline risk is actively defended: destructive legacy convergence is explicit at `apps/web/scripts/migrate.js:291-360`, removed feature cleanup is mirrored at `apps/web/scripts/migrate.js:760-769`, and DML-bearing journal baselining is refused at `apps/web/scripts/migrate.js:803-835`; targeted migration tests passed.
- Admin and mutation surfaces are mechanically guarded by the three lint contracts from `AGENTS.md:31-34`; all three passed in this lane.
- Deployment data safety is documented and implemented around health-before-prune and bind-mounted persistence: `CLAUDE.md:528-550` and `apps/web/deploy.sh:57-104`.
- CLIP production activation is deliberately operator-gated rather than silently enabled: docs at `CLAUDE.md:558-636`, script gate at `apps/web/package.json:21-23`, offline model load at `apps/web/src/lib/clip-model.ts:200-225`, and env-gated preflight tests at `apps/web/src/__tests__/clip-offline-load.test.ts:32-41` / `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`.

## Residual Manual Risks, Not New Findings

### RISK35-01 - Host nginx limiter changes remain inert until an operator applies them

- Severity: Medium operational risk
- Confidence: High
- Classification: Known/manual validation risk, not a new code defect
- Region: `CLAUDE.md:514-526`, `apps/web/nginx/default.conf:1-29`, `apps/web/nginx/default.conf:254-306`
- Scenario: A commit changes public or image rate-limiting in `apps/web/nginx/default.conf`, but production keeps the old host nginx config because deploys do not copy/reload host nginx. The app code is deployed, yet the intended edge flood cap is absent or stale.
- Suggested fix / validation: Keep treating host nginx changes as open until an operator copies the template, runs `nginx -t`, reloads, and verifies overflow requests return 429 while normal page loads do not. Record that host-side verification in the active cycle ledger.

### RISK35-02 - Real client IP topology is still an operator contract

- Severity: Medium operational risk
- Confidence: Medium
- Classification: Known/manual validation risk, topology-dependent
- Region: `apps/web/nginx/default.conf:20-29`, `apps/web/nginx/default.conf:59-71`, `apps/web/nginx/default.conf:269-306`
- Scenario: If a load balancer terminates TLS and nginx sees only the balancer IP, `$binary_remote_addr` rate-limit zones and `X-Forwarded-For $remote_addr` collapse all visitors into one bucket. A burst or failed-login sequence by one client can throttle unrelated visitors.
- Suggested fix / validation: On every production topology change, verify whether nginx's peer address is the real client or an upstream proxy. If it is an upstream proxy, configure `realip`/PROXY protocol for nginx limiter keys and switch app-facing XFF to an append form with the matching trusted-hop setting.

### RISK35-03 - CLIP production readiness depends on seeded host weights and manual preflight

- Severity: Medium product/ops risk
- Confidence: High
- Classification: Known/manual validation risk
- Region: `CLAUDE.md:558-636`, `apps/web/package.json:21-23`, `apps/web/src/lib/clip-model.ts:200-225`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`
- Scenario: `admin_settings.semantic_search_mode='production'` is set without seeded model files or without the container env flag. The route then fails/503s instead of serving semantic results, or the real encoder path has never been validated because CI skips the model-weight tests.
- Suggested fix / validation: Before production activation, run `CLIP_MODELS_ROOT=<abs-models-root> npm run test:clip:preflight` against the seeded host volume, then deploy with `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` and only then flip the DB setting.

### RISK35-04 - Large browser uploads still need on-host RSS measurement

- Severity: Medium capacity risk
- Confidence: Medium
- Classification: Known/manual validation risk
- Region: `CLAUDE.md:657-663`, `AGENTS.md:17-20`
- Scenario: The app enforces 200 MB per file and a default 2 GiB batch window, but framework multipart parsing can transiently pin roughly each file size in RSS before disk streaming and Sharp processing. Concurrent uploads on the constrained host can exceed memory before app-level caps feel safe in practice.
- Suggested fix / validation: Measure RSS on the deploy host for the largest realistic concurrent upload batch and tune container/host memory, concurrency, or upload limits from that measurement.

## Final Sweep

Commonly missed issue classes checked:

- Auth bypass and public mutation guard drift: checked with route/action guard scripts; passed.
- Privacy leaks through public data projections: checked public share/search/map paths plus privacy fixture tests; passed.
- Migration journal drift and legacy baseline swallowing: checked migration docs/script/journal and targeted migration tests; passed.
- Deployment data loss from Docker pruning: checked deploy script order and persistence docs; prune runs after health and uses bind mounts / `volume prune` without `-a`.
- Stale test masking: checked `.only`/`.skip`; no `.only`, skips are explicit env/local gates.
- Tracked secrets/runtime artifacts: no committed real env files, `.next`, upload data, or obvious credential artifact found in the tracked sweep.

Stop condition: review report written to this file, with no product-code edits and no new confirmed/likely findings to hand off for implementation.
