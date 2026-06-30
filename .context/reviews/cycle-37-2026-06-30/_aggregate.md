# Cycle 37 Aggregate Review

Cycle: 37/100
Date: 2026-06-30 KST
Reviewed HEAD: `d6c3a8f69911c84a63985a59827d4597def922d4`

## Agent Coverage

Completed review artifacts:

- `cycle-37-2026-06-30/code-reviewer.md`
- `cycle-37-2026-06-30/security-reviewer.md`
- `cycle-37-2026-06-30/perf-reviewer.md`
- `cycle-37-2026-06-30/test-engineer.md`
- `cycle-37-2026-06-30/architect-debugger-tracer.md`

No agent failures were recorded. A designer/product lane could not be spawned because the native thread limit was reached; the leader performed a local UI/accessibility sweep and did not add a fresh finding beyond the already-recorded Cycle 36 load-more live-region deferral.

## Merged Findings

### AGG-C37-01 - Imported credential mutators can run before the same-origin guard

Severity: High
Confidence: High
Agents: architect-debugger-tracer

Regions:

- `apps/web/scripts/check-action-origin.ts:294`
- `apps/web/scripts/check-action-origin.ts:361`
- `apps/web/scripts/check-action-origin.ts:548`
- `apps/web/src/app/actions/lr-tokens.ts:5`
- `apps/web/src/lib/admin-tokens.ts:226`
- `apps/web/src/lib/admin-tokens.ts:245`

The action-origin scanner classifies imported helper calls as pre-guard side effects using a name-prefix regex. That regex includes verbs such as `delete`, `insert`, and `write`, but not credential/persistence verbs such as `create` or `revoke`. A future action could call imported `createToken()` or `revokeToken()` before returning on `requireSameOriginAdmin()` and still pass `lint:action-origin`.

Fix: expand the imported side-effect verb reach to include credential/persistence verbs and add negative fixtures for imported credential helpers before the guard. Keep the public-route scanner's sibling regex aligned.

### AGG-C37-02 - `lint:action-origin` silently ignores exported identifier aliases

Severity: High
Confidence: High
Agents: code-reviewer

Regions:

- `apps/web/scripts/check-action-origin.ts:677`
- `apps/web/scripts/check-action-origin.ts:680`
- `apps/web/scripts/check-action-origin.ts:819`
- `apps/web/scripts/check-action-origin.ts:826`
- `apps/web/src/__tests__/check-action-origin.test.ts:434`

The scanner collects local function bodies, but exported variable declarations initialized from identifiers fall through with no pass, failure, or skip. A future `const impl = async () => { await db.insert(...) }; export const mutateFoo = impl;` shape can omit `requireSameOriginAdmin()` and keep the gate green.

Fix: resolve exported identifier aliases to known local bodies and evaluate them under the exported name; fail closed when the alias target cannot be resolved. Add guarded, unguarded, and unresolved alias fixtures.

### AGG-C37-03 - Multi-callback wrappers can hide unguarded mutators

Severity: High
Confidence: High
Agents: test-engineer

Regions:

- `apps/web/scripts/check-action-origin.ts:622`
- `apps/web/scripts/check-action-origin.ts:631`
- `apps/web/scripts/check-action-origin.ts:819`
- `apps/web/src/__tests__/check-action-origin.test.ts:542`
- `apps/web/src/__tests__/check-action-origin.test.ts:570`

`functionBodyFromExpression()` unwraps exported call expressions by returning the first async function argument. A wrapper shaped like `wrap(guardedCallback, mutatingCallback)` can pass because the scanner checks only the first callback.

Fix: make exported wrapper support deliberately narrow: only one inline async function body is inspectable. Fail closed on zero, multiple, hidden, or otherwise unsupported wrapper bodies. Add a two-callback regression fixture.

### AGG-C37-04 - Reconcile adds FK constraints without first converging orphaned legacy rows

Severity: High
Confidence: High
Agents: code-reviewer, architect-debugger-tracer

Regions:

- `apps/web/scripts/migrate.js:288`
- `apps/web/scripts/migrate.js:692`
- `apps/web/src/app/actions/admin-users.ts:251`
- `apps/web/src/app/actions/images.ts:708`
- `apps/web/src/db/schema.ts:200`
- `apps/web/src/db/schema.ts:228`
- `apps/web/src/db/schema.ts:284`

Cycle 36 repaired missing FK constraints in `reconcileLegacySchema()`, but `ensureForeignKey()` directly adds constraints without cleaning or quarantining legacy orphan rows first. A dirty legacy DB with orphan `admin_tokens`, view rows, or embedding rows can reject the `ALTER TABLE ... ADD CONSTRAINT` and fail deploy.

Fix: requires an explicit product/operator policy for destructive legacy-data convergence. Candidate implementation: delete pure orphan child rows and null nullable owner references before adding constraints, with logged counts and regression coverage.

### PERF-C37-01 - Live queue bootstrap can launch duplicate CLIP embedding sweeps

Severity: Medium
Confidence: High
Agents: perf-reviewer

Regions:

- `apps/web/src/lib/image-queue.ts:978`
- `apps/web/src/lib/image-queue.ts:981`
- `apps/web/src/lib/image-queue.ts:395`
- `apps/web/src/lib/image-queue.ts:408`
- `apps/web/src/lib/image-queue.ts:425`
- `apps/web/src/lib/image-queue.ts:1007`

Every queue bootstrap pass starts `bootstrapMissingActiveEmbeddings(state)` as a fire-and-forget side effect. On a large processed-photo backlog with semantic search enabled, queue continuation passes can start overlapping full missing-embedding sweeps, duplicating Sharp decode, ONNX inference, DB reads/writes, and shutdown drain work.

Fix: make missing-embedding bootstrap single-owned or bounded, and coordinate with the semantic sidecar/advisory-lock path before doing bulk catch-up in the live web process.

## Scheduled This Cycle

- `AGG-C37-01`
- `AGG-C37-02`
- `AGG-C37-03`

## Deferred Findings

Deferred items are recorded in `.context/plans/cycle-37-2026-06-30-deferred.md` with severity/confidence, reason, and exit criterion:

- `AGG-C37-04`
- `PERF-C37-01`

Cycle 36 deferred UI/performance/product-polish items remain recorded in `.context/plans/cycle-36-2026-06-30-deferred.md`; no fresh evidence changed their severity or made them scheduled now.

## Validation During Review

- Code-review lane ran `npm run lint:action-origin --workspace=apps/web`: passed on reviewed HEAD.
- Code-review lane ran focused scanner/migration/token tests: passed, 174 tests.
- Security lane ran `npm run lint:api-auth --workspace=apps/web`: passed.
- Security lane ran `npm run lint:action-origin --workspace=apps/web`: passed.
- Security lane ran `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- Security lane ran `npm audit --omit=dev --workspace=apps/web --json`: 0 production vulnerabilities.
- Security lane ran focused security/privacy tests: passed, 199 tests.
- Perf lane ran `npm run lint:action-origin --workspace=apps/web`: passed.
- Perf lane ran `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- Test lane ran lint, typecheck, build, and full unit tests at reviewed HEAD: passed; build used documented sitemap fallback when local MySQL was unavailable.

## Final Sweep

Commonly missed issue classes checked this pass: unsupported action export forms, imported mutator helpers, wrapped action callbacks, action-origin dominance, public-route limiter scanning, legacy FK lifecycle convergence, PAT owner survival, queue/bootstrap overlap, semantic CLIP runtime load, upload route exemptions, privacy selectors, security headers, and deploy/runbook drift.
