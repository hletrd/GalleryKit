# Run-10 Cycle 27 Aggregate Review

Date: 2026-07-08 KST
Review start HEAD: `cff8d59f0301df8f64e030adc0fb2d65e825903a`

## Agent Coverage

- `code-reviewer.md` and `architect.md`: no new non-duplicative source/architecture findings.
- `security-reviewer.md`: no confirmed current security findings; security lint gates and `npm audit --workspace=apps/web --audit-level=moderate` passed.
- `perf-reviewer.md` and `tracer.md`: restore-maintenance ordering still incomplete outside protected layouts.
- `debugger.md` and `critic.md`: `/admin` and concurrent restore submissions still touch auth/session state before maintenance fast-paths.
- `verifier.md` and `test-engineer.md`: Cycle 26 release evidence remains unclosed; several Cycle 26 fixes are source-contract-only.
- `document-specialist.md`: Cycle 26 plan status/deploy evidence is stale.
- `designer.md`: `/admin` maintenance UX is inconsistent; Cycle 26 UI assertions need render-level strengthening.

## Findings

### AGG-C27-01 - Admin entry/status paths still do DB work before restore-maintenance gating

Severity: Medium
Confidence: High
Cross-agent agreement: perf-reviewer, tracer, debugger, critic, designer

Citations:

- `apps/web/src/app/[locale]/admin/page.tsx:11-24`
- `apps/web/src/app/actions/auth.ts:331-345`
- `apps/web/src/app/actions/admin-backfill.ts:34-43`
- `apps/web/src/app/actions/admin-backfill.ts:113-121`

Problem:

Cycle 26 fixed parent/protected admin layouts, but `/admin`, `updatePassword()`, `triggerBackfill()`, and `getBackfillStatus()` still reach auth/session or candidate-count work before a restore-maintenance response. Stale admin tabs and direct action calls can therefore compete with restore import/migration table state instead of failing fast.

Failure scenario:

During a restore, an admin opens `/admin`, submits a stale password form, or leaves Settings polling backfill status. Those requests can query `sessions`, `admin_users`, `admin_settings`, or `images` while the restore path is replacing/migrating tables, causing noisy errors, pool pressure, or misleading login/status output.

Fix:

Move restore-maintenance checks before session/admin/candidate DB work for those entry/status paths. Keep same-origin first for mutating actions.

Disposition: Scheduled in Cycle 27 plan.

### AGG-C27-02 - Concurrent restore submissions still authenticate before observing an already-active restore window

Severity: Medium
Confidence: Medium-High
Cross-agent agreement: debugger, critic

Citations:

- `apps/web/src/app/[locale]/admin/db-actions.ts:421-428`
- `apps/web/src/app/[locale]/admin/db-actions.ts:545-552`
- `apps/web/src/__tests__/restore-upload-lock.test.ts:104-126`

Problem:

A second restore submission during an active restore still calls `isAdmin()` before the restore advisory-lock / maintenance-begin path can return `restoreInProgress`. That touches auth tables while the first restore owns the maintenance window.

Deferral note:

This finding conflicts with an existing repo source contract: `restore-upload-lock.test.ts` explicitly asserts corrective restore attempts must not be rejected by `getRestoreMaintenanceMessage` before advisory-lock acquisition while maintenance is active. A safe fix needs a narrower design that distinguishes corrective stale-marker restores from true concurrent restore attempts, likely by moving/introducing lock acquisition before auth without creating an unauthenticated lock-hold DoS. That is broader than this cycle's bounded patch.

Disposition: Deferred with severity preserved.

### AGG-C27-03 - Cycle 26 release/deploy evidence is still unclosed in committed ledgers

Severity: Medium
Confidence: High
Cross-agent agreement: verifier, test-engineer, document-specialist

Citations:

- `.context/plans/cycle-26-2026-07-08-plan.md:3`
- `.context/plans/cycle-26-2026-07-08-plan.md:115-132`
- `.context/plans/README.md:35-37`
- `git show cff8d59f0301df8f64e030adc0fb2d65e825903a`

Problem:

The Cycle 26 fix commit is on `origin/master`, but the Cycle 26 plan still says commit/push/deploy are pending and WP4 is unchecked. The commit body records required deploy policy but not deploy success.

Failure scenario:

Future cycles cannot distinguish a real production deploy from a stale local-gates-only ledger and may either repeat closure work or assume production state without evidence.

Fix:

Update the Cycle 26/current plan index to show commit/push completion and explicitly state that Cycle 27's per-cycle deploy supersedes production state after the current fixes.

Disposition: Scheduled in Cycle 27 plan.

### AGG-C27-04 - Restore finalizer durable-clear failure remains source-locked instead of action-behavior-proven

Severity: Medium
Confidence: High
Cross-agent agreement: verifier, test-engineer

Citations:

- `apps/web/src/app/[locale]/admin/db-actions.ts:674-690`
- `apps/web/src/__tests__/cycle-26-source-contracts.test.ts:46-55`
- `apps/web/src/__tests__/restore-maintenance.test.ts:104-110`

Problem:

The low-level helper behavior is tested, but the restore action's finalizer branch is mostly pinned by source strings. A future refactor could resume the queue or run post-clear cleanup after marker-clear failure while retaining the current literals.

Disposition: Deferred as test-harness strengthening; no current behavior bug was confirmed.

### AGG-C27-05 - Cycle 26 public UI fixes need render-level assertions

Severity: Low-Medium
Confidence: High
Cross-agent agreement: test-engineer, designer

Citations:

- `apps/web/src/components/lightbox-color-pip.tsx:167-204`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:250-253`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:55-67`, `:99-108`
- `apps/web/src/__tests__/cycle-26-source-contracts.test.ts:57-82`

Problem:

The Cycle 26 UI fixes are mostly source-contract assertions rather than rendered DOM/browser checks.

Disposition: Deferred as UI test-strength work; no current rendered regression was confirmed.

## Scheduled This Cycle

- `AGG-C27-01`: restore-maintenance fast-path ordering for `/admin`, `updatePassword`, and backfill trigger/status.
- `AGG-C27-03`: release-ledger closure for Cycle 26/27.

## Deferred This Cycle

- `AGG-C27-02`, `AGG-C27-04`, `AGG-C27-05` are recorded in `.context/plans/run10-cycle27/deferred.md` with severity/confidence preserved.
