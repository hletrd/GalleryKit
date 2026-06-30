# Cycle 38 Aggregate Review

Cycle: 38/100
Date: 2026-06-30 KST
Reviewed HEAD: `564a7679`

## Agent Coverage

Completed review artifacts:

- `cycle-38-2026-06-30/code-reviewer.md`
- `cycle-38-2026-06-30/security-reviewer.md`
- `cycle-38-2026-06-30/perf-reviewer.md`
- `cycle-38-2026-06-30/test-engineer.md`
- `cycle-38-2026-06-30/architect-debugger-tracer.md`
- `cycle-38-2026-06-30/designer-local.md`

No spawned review agent failures were recorded. A sixth UI/UX native lane could not be spawned initially because the native thread limit was reached; the leader completed a local UI/accessibility sweep and recorded it in `designer-local.md`.

## Merged Findings

### AGG-C38-01 - `lint:action-origin` accepts unreasoned exemption tags

Severity: Low
Confidence: High
Agents: code-reviewer

Regions:

- `apps/web/scripts/check-action-origin.ts:106`
- `apps/web/src/__tests__/check-action-origin.test.ts:416`

The action-origin scanner treats any leading `@action-origin-exempt` text as an exemption even though the scanner header and repo rules require `@action-origin-exempt: <reason>`.

Failure scenario: a future action lands with `/** @action-origin-exempt */`; the gate skips it without recording why the export is safe to exempt. That weakens the audit trail on a security-critical scanner.

Fix: require a non-empty reason after `:` and add fixtures for bare/empty exemption tags.

### AGG-C38-02 - Public route scanner ignores exported handler identifier aliases

Severity: Medium
Confidence: High
Agents: test-engineer, leader final sweep

Regions:

- `apps/web/scripts/check-public-route-rate-limit.ts:489`
- `apps/web/scripts/check-public-route-rate-limit.ts:535`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`

The public route rate-limit scanner only treats variable exports as handlers when the initializer is function-like. `export const POST = handler` and `export const GET = handler` can therefore disappear from the audit even when the local handler mutates or does expensive DB work.

Failure scenario: a future public route writes `const handler = async () => db.insert(...); export const POST = handler;`; Next can execute it, but `lint:public-route-rate-limit` reports no protected handler and passes.

Fix: resolve exported identifier aliases to local function bodies, audit them under the exported HTTP method name, and fail closed on unresolved aliases.

### AGG-C38-03 - Exempt read-only admin actions can skip auth in the lint gate

Severity: Medium
Confidence: High
Agents: test-engineer

Regions:

- `apps/web/scripts/check-action-origin.ts:710`
- `apps/web/src/__tests__/check-action-origin.test.ts:462`
- `apps/web/src/app/actions/settings.ts:18`
- `apps/web/src/app/actions/seo.ts:26`
- `apps/web/src/app/actions/tags.ts:18`
- `apps/web/src/app/actions/admin-users.ts:65`

The action-origin scanner accepts any non-mutating `@action-origin-exempt` export as a skip. Current source getters do call `isAdmin()` or `getCurrentUser()`, but the gate does not enforce that.

Failure scenario: a future read-only admin getter returns admin data from `db.select()` without an auth check and still passes `lint:action-origin`.

Fix: require exempt admin getters to call `isAdmin()`, `getCurrentUser()`, or `requireSameOriginAdmin()` before protected reads, with carve-outs for auth primitives and intentional public actions.

### AGG-C38-04 - Sidecar color backfill can crash on unhandled queued task rejection

Severity: Medium
Confidence: High
Agents: perf-reviewer

Regions:

- `apps/web/scripts/backfill-color-pipeline.ts:476`
- `apps/web/scripts/backfill-color-pipeline.ts:496`
- `apps/web/scripts/backfill-color-pipeline.ts:512`

The sidecar enqueues `queue.add(async () => { ... await flushBatch(); })` and ignores the returned promise. `queue.onIdle()` can resolve while an individual task rejection still becomes an unhandled rejection.

Failure scenario: a transient DB failure, deadlock, or connection drop inside `flushBatch()` aborts the operator sidecar without the script's own summary/error accounting.

Fix: retain and await the task promises with `Promise.allSettled()` and count/log rejected tasks before the summary and exit-code calculation.

### AGG-C38-05 - Manual disk-recovery runbook uses all-volume prune despite narrower deploy safety contract

Severity: Medium
Confidence: Medium
Agents: architect-debugger-tracer

Regions:

- `CLAUDE.md:475`
- `CLAUDE.md:486`
- `AGENTS.md:19`
- `apps/web/docker-compose.yml:24`

The automatic deploy path documents and tests `docker volume prune -f` without `-a`, preserving the no all-volume-prune safety contract. The manual 100%-disk recovery snippet recommends `docker volume prune -af` and labels it safe because GalleryKit data is bind-mounted. The command is host-global and can delete unused named volumes from unrelated Docker workloads.

Failure scenario: an operator follows the emergency runbook on a reused/co-tenanted host and deletes another service's unused named volume or rollback snapshot while recovering GalleryKit disk pressure.

Fix: make the default manual command `docker volume prune -f`; mention `-a` only as dedicated-host break-glass after volume inspection.

### AGG-C38-06 - Latest aggregate file points to Cycle 37 but still embeds Cycle 35 content

Severity: Low
Confidence: High
Agents: architect-debugger-tracer

Regions:

- `.context/reviews/_aggregate.md:1`
- `.context/reviews/_aggregate.md:15`
- `.context/plans/README.md:34`
- `.context/reviews/cycle-37-2026-06-30/_aggregate.md:1`

`.context/reviews/_aggregate.md` correctly points to `cycle-37-2026-06-30/_aggregate.md`, but the body after the separator still contains the Cycle 35 aggregate. `.context/plans/README.md` tells agents to read `.context/reviews/_aggregate.md`, so the current file mixes a current pointer with stale embedded detail.

Failure scenario: a later planning lane reads past the pointer and re-schedules Cycle 35 findings as if they were the latest state.

Fix: replace the top-level aggregate with the current cycle aggregate and keep historical bodies only in cycle-specific files.

### AGG-C38-07 - Imported side-effect detection is prefix-based and misses real helper names

Severity: Medium
Confidence: High
Agents: test-engineer

Regions:

- `apps/web/scripts/check-action-origin.ts:294`
- `apps/web/scripts/check-public-route-rate-limit.ts:58`
- `apps/web/src/app/actions/images.ts:7`
- `apps/web/src/app/actions/images.ts:370`

Both scanners classify imported side-effect calls through a name-prefix regex. A probe using `persistThing()` before `requireSameOriginAdmin()` passed, and a real helper outside the prefix set exists: `saveOriginalAndGetMetadata`, which performs file writes but is currently called after the guard.

Failure scenario: a future refactor moves an imported side-effect helper with a non-matching name before a same-origin guard or public limiter, and the gate stays green.

Disposition: deferred in `cycle-38-2026-06-30-deferred.md`.

### AGG-C38-08 - Sidecar color backfill still materializes and enqueues the full candidate set

Severity: Low
Confidence: High
Agents: perf-reviewer

Regions:

- `apps/web/scripts/backfill-color-pipeline.ts:343`
- `apps/web/scripts/backfill-color-pipeline.ts:475`
- `apps/web/src/lib/admin-backfill-runner.ts:692`

The sidecar fetches every candidate row in one query and enqueues one closure per row. The in-app runner uses keyset-paginated batch/drain loops for the same class of work.

Failure scenario: a large gallery or `--force-reencode` sidecar run keeps all candidate rows plus all queued closures in heap.

Disposition: deferred in `cycle-38-2026-06-30-deferred.md`.

## Scheduled This Cycle

- `AGG-C38-01`
- `AGG-C38-02`
- `AGG-C38-03`
- `AGG-C38-04`
- `AGG-C38-05`
- `AGG-C38-06`

## Deferred Findings

Deferred items are recorded in `.context/plans/cycle-38-2026-06-30-deferred.md` with severity/confidence, reason, and exit criterion:

- `AGG-C38-07`
- `AGG-C38-08`

Cycle 37 deferred findings remain recorded in `.context/plans/cycle-37-2026-06-30-deferred.md`; no fresh evidence changed their severity or made them scheduled now.

## Validation During Review

- Security lane ran the three security lint gates, `npm audit --workspace=apps/web --audit-level=moderate`, and focused security/privacy tests: passed.
- Architecture lane ran deploy, nginx, and migration reconcile focused tests: passed, 99 tests.
- Test lane ran the three security lint gates and targeted scanner/security tests: passed.
- Code lane ran the three security lint gates: passed.

## Final Sweep

Commonly missed issue classes checked this pass: unsupported action export forms, action exemption semantics, public route export shapes, imported side-effect helper classification, sidecar backfill failure accounting, deploy/runbook safety drift, latest aggregate state drift, UI touch-target/product-policy adjacency, migration/reconcile drift, upload route exemptions, privacy selectors, and security headers.
