# Cycle 37 Architect / Debugger / Tracer Review

Reviewed HEAD: `d6c3a8f69911c84a63985a59827d4597def922d4`
Date: 2026-06-30 KST
Lane: architect / debugger / tracer
Scope: read-only source review, except this review artifact.

## Inventory Inspected

- Project context: `AGENTS.md` instructions from prompt, `CLAUDE.md`
- Prior-cycle context: `.context/reviews/cycle-36-2026-06-30/_aggregate.md`, `.context/plans/cycle-36-2026-06-30-deferred.md`, `.context/reviews/archive/_aggregate-cycle37.md`
- Current fix diff from cycle 36: `git diff bdfb38a1c39bd828c07851d3d096602441b4122c..HEAD`
- Lint/scanner code: `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`
- Migration/reconcile code: `apps/web/scripts/migrate.js`, `apps/web/drizzle/*.sql`, `apps/web/src/db/schema.ts`
- Token/auth boundary: `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/auth.ts`
- Delete/lifecycle paths: `apps/web/src/app/actions/images.ts`
- Public upload routes: `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- Regression tests: `apps/web/src/__tests__/check-action-origin.test.ts`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`, `apps/web/src/__tests__/admin-tokens.test.ts`

## Findings

### C37-ARCH-01 - Imported credential mutators can run before the same-origin guard while `lint:action-origin` stays green

Severity: High
Confidence: High

File/line citations:

- `apps/web/scripts/check-action-origin.ts:294` defines the imported-side-effect name regex; it includes verbs like `delete`, `remove`, `insert`, `update`, and `write`, but not `create` or `revoke`.
- `apps/web/scripts/check-action-origin.ts:548`-`552` relies on `statementContainsPreGuardMutation(...)` to reject mutation before `requireSameOriginAdmin()`.
- `apps/web/scripts/check-action-origin.ts:361`-`363` only treats imported calls as mutating when the imported local name was captured by that regex.
- `apps/web/src/app/actions/lr-tokens.ts:5`-`12` imports `createToken` and `revokeToken` from `@/lib/admin-tokens`.
- `apps/web/src/lib/admin-tokens.ts:226`-`229` shows `createToken()` inserts into `admin_tokens`.
- `apps/web/src/lib/admin-tokens.ts:245`-`247` shows `revokeToken()` deletes from `admin_tokens`.

Failure scenario:

A future edit to `createLrToken()` or another server action accidentally calls `await createToken(...)` before the `requireSameOriginAdmin()` result is checked. Because `createToken` is imported and its name does not match `IMPORTED_SIDE_EFFECT_NAME_RE`, the pre-guard statement is not classified as mutating. The scanner then accepts the later guard and return branch, so a cross-origin request could mint or revoke credentials before returning an origin error.

I confirmed this with a pure scanner fixture:

```json
{
  "passed": ["OK: actions/lr-tokens.ts::createLrToken"],
  "failed": [],
  "skipped": []
}
```

Suggested fix:

Replace the name-prefix heuristic with a fail-closed imported-helper model for action files, or at minimum include the repo's credential and persistence verbs (`create`, `revoke`, `issue`, `mint`, `rotate`, `upsert`) in the imported side-effect classifier. Add negative fixtures for `createToken()` and `revokeToken()` before `requireSameOriginAdmin()`. Consider sharing the mutator verb set with `check-public-route-rate-limit.ts`, whose `IMPORTED_SIDE_EFFECT_NAME_RE` has the same omission at `apps/web/scripts/check-public-route-rate-limit.ts:58`.

### C37-ARCH-02 - Reconcile adds FK constraints without first converging orphaned legacy rows

Severity: High
Confidence: Medium-High

File/line citations:

- `apps/web/scripts/migrate.js:288`-`291` implements `ensureForeignKey()` as a direct `ALTER TABLE ... ADD CONSTRAINT` when the FK name is missing.
- `apps/web/scripts/migrate.js:692`-`697` now repairs FKs for `admin_tokens`, `images.uploaded_by`, `image_views`, `topic_views`, `shared_group_views`, and `image_embeddings`.
- `apps/web/src/app/actions/admin-users.ts:251` deletes sessions and `apps/web/src/app/actions/admin-users.ts:264` nulls audit rows before `apps/web/src/app/actions/admin-users.ts:265`-`267` deletes the admin, but token cleanup is left to the `admin_tokens.user_id` FK.
- `apps/web/src/app/actions/images.ts:708`-`711` deletes `image_tags` and then `images`, relying on child FKs for other dependent rows.
- `apps/web/src/db/schema.ts:200`-`211`, `apps/web/src/db/schema.ts:228`-`240`, and `apps/web/src/db/schema.ts:284`-`298` define the repaired token, analytics, and embedding relationships that legacy DBs may previously have lacked.

Failure scenario:

This fix correctly tries to repair missing FK boundaries, but a legacy database can already contain orphan children because the missing FK was the original problem. For example, before `admin_tokens_user_fk` existed, deleting an admin through `deleteAdminUser()` would remove the `admin_users` row while leaving `admin_tokens` rows behind. Current `verifyToken()` now fails those tokens closed through its `INNER JOIN`, but the next deploy's reconcile path attempts `ALTER TABLE admin_tokens ADD CONSTRAINT ...` directly. MySQL rejects the constraint if any orphan `admin_tokens.user_id` exists, causing migration/deploy failure. The same causal pattern applies to legacy `image_views`, `topic_views`, `shared_group_views`, and `image_embeddings` rows left behind by earlier image/topic/share deletes before those FKs were repaired.

Suggested fix:

Before each repaired FK, add explicit convergence for the existing data shape: delete orphan child rows for pure dependent tables (`admin_tokens`, view tables, embeddings, join tables), and set nullable owner references such as `images.uploaded_by` to `NULL` when the admin row is missing. Log affected counts. Then run `ensureForeignKey()`. Add a migration/reconcile regression that seeds orphan rows into a temp schema and proves reconcile both cleans them and adds the FK; the current source tripwire only proves the `ensureForeignKey(...)` call exists, not that dirty legacy data can survive the lifecycle.

## Validation Evidence

- `npm run lint:action-origin --workspace=apps/web` passed on current HEAD.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed on current HEAD.
- `npm test --workspace=apps/web -- --run src/__tests__/check-action-origin.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/admin-tokens.test.ts` passed: 3 files, 174 tests.
- Additional ad hoc scanner fixture showed `checkActionSource()` currently accepts a pre-guard imported `createToken()` call.

## Final Sweep Note

I did not re-raise the cycle-36 deferred performance and UX items. I also swept for common misses in this lane: migration journal/reconcile drift, FK lifecycle convergence, action-origin dominance, public-route limiter scanning, token owner survival, delete/retry cleanup, upload route exemptions, and schema privacy surfaces. No additional fresh finding rose above the two actionable issues above.
