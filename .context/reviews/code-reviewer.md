# Code Reviewer Report - Cycle 22

Review role: code-reviewer  
Repository: `/Users/hletrd/flash-shared/gallery`  
Requested HEAD reviewed: `ec7cd528` (`ec7cd52883d4973e32f056324620154228190335`)  
Source edits made: none. This file is the only intended change from this reviewer.

## Inventory Built First

Tracked repository inventory at review start:

- Total tracked files: 2,575.
- Live app/config scope inspected: 593 tracked files under `apps/web/src`, `apps/web/scripts`, `apps/web/e2e`, `apps/web/drizzle`, and app-level config/deploy files.
- Largest/high-risk implementation files inspected directly: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/migrate.js`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/actions/public.ts`.
- Docs/instructions read: `AGENTS.md` content supplied in the prompt, `CLAUDE.md`, `package.json`, `apps/web/package.json`, migration runbook rules embedded in `AGENTS.md`, and prior `.context/reviews/code-reviewer.md`.
- Broad static sweeps run across app/source/scripts/tests for auth wrappers, action-origin exemptions, public route rate limits, advisory locks, raw SQL, file/path operations, privacy select fields, smart-collection compilation, upload/processing snapshots, migrations/reconcile, and TODO/FIXME markers.

Concurrent workspace note: while the review was running, other agents committed/modified `.context/reviews/*` artifacts. `git diff --quiet ec7cd528..HEAD -- apps/web package.json package-lock.json CLAUDE.md AGENTS.md` confirmed app and instruction files still match the requested `ec7cd528` target. Findings below are anchored to that source state, not to later review-document churn.

## Findings

### CR22-CR-01 - Several advisory-lock call sites reject `BigInt(1)` and can leak acquired MySQL locks

Severity: High  
Confidence: High  
Status: Confirmed code-path defect under a driver-valid return shape  
Category: Logic / cross-file consistency / operational regression risk

Evidence:

- `apps/web/src/lib/image-queue.ts:446-463` acquires `GET_LOCK` and returns the connection only when `rows[0]?.acquired === 1`; a `BigInt(1)` result falls through to `lockConnection.release()` without `RELEASE_LOCK`.
- `apps/web/src/lib/admin-backfill-runner.ts:316-330` and `apps/web/src/lib/admin-backfill-runner.ts:356-371` use the same numeric-only check for the whole-run and per-image backfill locks.
- `apps/web/src/app/actions/admin-users.ts:225-233` and `apps/web/src/app/actions/admin-users.ts:290-294` set `lockAcquired` only for numeric `1`; if the row value is `1n`, the finally block skips `RELEASE_LOCK` and releases the pooled connection.
- `apps/web/src/app/actions/topics.ts:62-82` has the same numeric-only lock detection around route-segment mutations.
- `apps/web/scripts/backfill-color-pipeline.ts:309-326` also treats only numeric `1` as success.
- The repo already recognizes this driver variability elsewhere: `apps/web/src/lib/upload-processing-contract-lock.ts:27-33`, `apps/web/src/app/[locale]/admin/db-actions.ts:204-208`, `apps/web/src/app/actions/embeddings.ts:108-114`, and `apps/web/scripts/backfill-clip-embeddings.ts:102-108` all accept `1` or `BigInt(1)`. The dedicated test at `apps/web/src/__tests__/upload-processing-contract-lock.test.ts:9-16` documents why this matters.

Concrete failure scenario:

If mysql2 returns `GET_LOCK(... ) AS acquired` as `BigInt(1)` for any of these callers, the database lock was actually acquired, but the application treats it as not acquired. For pooled app connections, `conn.release()` returns the live connection to the pool; it does not necessarily close the MySQL session, so the advisory lock can remain held by an idle pooled connection. After that:

- image processing jobs can repeatedly fail to claim their per-image lock and get rescheduled or left pending;
- topic create/rename/alias mutations can report generic lock failures even when no user-visible mutation is running;
- admin deletion can fail spuriously and hold the global admin-delete lock;
- color backfills can exit as "already running" or skip rows despite holding locks.

Suggested fix:

Create a shared helper, for example `isMysqlAdvisoryLockAcquired(value: unknown): boolean`, that returns true for `value === 1 || value === BigInt(1)`. Use it at every `GET_LOCK` call site, widen local row types to `number | bigint | null`, and add focused tests for at least `image-queue`, `admin-backfill-runner`, `topics`, and `admin-users` to prove the `BigInt(1)` arm both proceeds and releases.

### CR22-CR-02 - Smart-collection tag predicates accept numeric values despite compiling as tag-name strings

Severity: Medium  
Confidence: High  
Status: Confirmed  
Category: Validation / public-route regression / type-contract drift

Evidence:

- `TagPredicate` declares `value: string` in `apps/web/src/lib/smart-collections.ts:91-97`.
- Runtime validation for normal scalar predicates accepts either string or finite number at `apps/web/src/lib/smart-collections.ts:366-368` and `apps/web/src/lib/smart-collections.ts:487-495`.
- `validatePredicateSemantics` special-cases `column === 'tag'` at `apps/web/src/lib/smart-collections.ts:374-382`, checks only the operator, then returns before enforcing that `node.value` is a string.
- The tag compiler then treats the value as a tag name: exact match at `apps/web/src/lib/smart-collections.ts:250-258`, and `containsLike(tags.name, pred.value)` at `apps/web/src/lib/smart-collections.ts:261-267`.
- `containsLike` requires a string and calls `.replace()` in `apps/web/src/lib/sql-like.ts:5-10`.
- Admin save actions validate only through `parseSmartCollectionQuery` before storing the raw JSON in `apps/web/src/app/actions/collections.ts:32-50` and `apps/web/src/app/actions/collections.ts:83-98`.
- Public smart-collection rendering parses and compiles stored JSON in `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:86-98`; compile failure becomes `notFound()`.

Concrete failure scenario:

An admin, import script, or future UI bug saves:

```json
{"type":"predicate","column":"tag","operator":"contains","value":123}
```

`parseSmartCollectionQuery` accepts it because `123` is a finite scalar and the tag branch checks only the operator. Later, the public collection page calls `compileSmartCollection`; `containsLike` receives a number and throws `value.replace is not a function`, so the public collection 404s. With `operator: "eq"`, the query compiles but compares a string column to a number, producing surprising MySQL coercion/empty-result behavior instead of a write-time validation error.

Suggested fix:

In the tag branch of `validatePredicateSemantics`, require `typeof node.value === 'string'` before returning. Add tests that reject numeric `tag eq` and `tag contains` values, and keep the validate/compile agreement test so every accepted tag predicate compiles without throwing.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed; all mutating server actions enforce same-origin provenance or carry accepted public/read-only exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- `npm test --workspace=apps/web -- smart-collections.test.ts upload-processing-contract-lock.test.ts`: passed, 43 tests.
- `npm run lint --workspace=apps/web`: passed.
- `npm run typecheck --workspace=apps/web`: passed, including app, test, and script typechecking.
- `npm test --workspace=apps/web`: passed, 264 files and 2,477 tests, with 2 files / 4 tests skipped.
- `npm run build --workspace=apps/web`: exited 0. Caveat: local MySQL was not running, so the sitemap build path logged an expected fallback to homepage-only sitemap after `ECONNREFUSED 127.0.0.1:3306`.

## Non-Findings Checked

- Admin API routes are wrapped by `withAdminAuth`.
- Mutating server actions pass the same-origin lint gate.
- Public mutating API routes pass the rate-limit scanner.
- Public image/search/timeline selectors retain compile-time privacy guards for sensitive fields.
- Upload, Lightroom upload, failed-image retry, and queue snapshot wiring are still duplicated but were not re-filed as a cycle 22 issue because cycle 21 already documented that maintainability concern and the current code has targeted parity tests.
- The migration journal remains non-monotonic, but `apps/web/scripts/migrate.js:709-785` explicitly compensates with reconcile plus per-entry baselining, and `runMigrations` asserts every journal hash is recorded at `apps/web/scripts/migrate.js:787-807`.

## Final Sweep / Skipped Files

No tracked implementation category was intentionally skipped: app routes, server actions, API routes, shared libs, scripts, migrations, tests, config, Docker/deploy helpers, and project docs were included in the inventory and broad inspection. I did not review untracked/generated runtime artifacts such as `.next`, `node_modules`, local uploads, `.env.local`, or runtime screenshots because they are not part of HEAD `ec7cd528`. Historical `.context/reviews` and `.context/plans` were treated as context/history, not as current executable behavior; concurrent changes to peer review artifacts were left untouched.
