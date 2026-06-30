# Verifier Review - Cycle 22

Date: 2026-06-30 KST
HEAD reviewed: `85b0291f` (`docs(review): 📝 record cycle 22 code review`)
Scope: read-only verifier review of the current repository against `AGENTS.md`, `CLAUDE.md`, current plans/reviews, tests, and source behavior. Source code was not edited. This review artifact is the only intended file change from this verifier.

## Inventory Built First

Required instructions and project docs examined:

- `AGENTS.md` content supplied in the prompt.
- `CLAUDE.md`.
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`.
- `README.md`.
- `apps/web/README.md`.
- `package.json`.
- `apps/web/package.json`.

Current cycle and adjacent review/plan artifacts examined:

- `.context/reviews/verifier.md` from cycle 21.
- `.context/reviews/code-reviewer.md` for cycle 22.
- `.context/plans/archive/plan-382-cycle22-fixes.md`.
- `.context/plans/archive/plan-383-cycle22-fixes.md`.
- `.context/plans/cycle-21-2026-06-30-plan.md`.

Implementation, test, and operations files inspected directly:

- Advisory locks and concurrent maintenance: `apps/web/src/lib/advisory-locks.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, and advisory-lock tests.
- Smart collections: `apps/web/src/lib/smart-collections.ts`, `apps/web/src/lib/sql-like.ts`, `apps/web/src/app/actions/collections.ts`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`, and `apps/web/src/__tests__/smart-collections.test.ts`.
- Cycle-22 fix surfaces: `apps/web/src/lib/validation.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/__tests__/validation.test.ts`, `apps/web/src/__tests__/data-tag-names-sql.test.ts`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts`.
- Deploy/docs contracts: `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `scripts/deploy-remote.sh`, `apps/web/src/__tests__/deploy-script-contract.test.ts`, README/CLAUDE deployment sections.
- Privacy/security gates: `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/__tests__/check-api-auth.test.ts`, `apps/web/src/__tests__/check-action-origin.test.ts`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`.

Repository-wide/static sweeps run:

- `rg --files` over tracked/non-generated repo paths.
- `rg` sweeps for `GET_LOCK`, `BigInt(1)`, `safeInsertId`, `Number(...insertId)`, `GROUP_CONCAT`, `SEPARATOR`, `split('\x01')`, `isValidTagSlug`, `.length`/`countCodePoints`, and Docker compose deployment commands.
- `git status --short`, `git log --oneline -20`, and diff/status checks to avoid touching unrelated work.

Validation run:

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- `npm run lint --workspace=apps/web`: passed.
- `npm run typecheck --workspace=apps/web`: passed.
- Focused Vitest: `validation.test.ts`, `data-tag-names-sql.test.ts`, `lr-upload-hdr-gate.test.ts`, `privacy-fields.test.ts`, `check-api-auth.test.ts`, `check-action-origin.test.ts`, `check-public-route-rate-limit.test.ts`: passed, 7 files / 202 tests.
- Focused Vitest: `smart-collections.test.ts`, `upload-processing-contract-lock.test.ts`, `deploy-script-contract.test.ts`: passed, 3 files / 51 tests.
- Full Vitest: passed, 264 files / 2,477 tests; 2 files / 4 tests skipped.
- `npm run build --workspace=apps/web`: passed. Local MySQL was not running, so sitemap generation logged the expected homepage-only fallback after `ECONNREFUSED 127.0.0.1:3306`.

Workspace note: before this artifact was written, unrelated review artifacts were already modified by other work (`.context/reviews/critic.md`, `.context/reviews/test-engineer.md`, `.context/reviews/tracer.md`). They were left untouched. `npm run build` regenerated PWA/service-worker artifacts, but they had no git diff.

## Confirmed Findings

### V22-01 - Several advisory-lock call sites reject `BigInt(1)` even though sibling lock code treats it as acquired

Severity: High  
Confidence: High  
Status: Confirmed code defect  
Category: concurrency / operational correctness

Evidence:

- `apps/web/src/lib/image-queue.ts:446-462` types `GET_LOCK` as `number | null` and returns the lock connection only when `rows[0]?.acquired === 1`. A runtime `1n` falls through to `lockConnection.release()` without `RELEASE_LOCK`.
- `apps/web/src/lib/admin-backfill-runner.ts:316-330` has the same numeric-only check for the whole color-backfill lock.
- `apps/web/src/lib/admin-backfill-runner.ts:356-371` repeats it for per-image processing locks during backfill.
- `apps/web/src/app/actions/admin-users.ts:225-233` sets `lockAcquired` only for numeric `1`; `finally` releases the lock only when that boolean is true at `apps/web/src/app/actions/admin-users.ts:290-294`.
- `apps/web/src/app/actions/topics.ts:62-82` does the same for the topic route-segment mutation lock.
- `apps/web/scripts/backfill-color-pipeline.ts:309-327` does the same for the sidecar color-backfill lock.
- The repo already knows the driver can return `BigInt(1)`: `apps/web/src/lib/upload-processing-contract-lock.ts:27-33` accepts `acquired === 1 || acquired === BigInt(1)`, and `apps/web/src/app/actions/embeddings.ts:108-116` uses the same pattern.
- The dedicated regression documents that exact risk: `apps/web/src/__tests__/upload-processing-contract-lock.test.ts:6-16` says a driver/config/column-type change can make `GET_LOCK` return `BigInt(1)`.

Concrete failure scenario:

If mysql2 returns `GET_LOCK(...) AS acquired` as `BigInt(1)` for one of the numeric-only callers, MySQL has actually granted the advisory lock but the app treats it as a failed acquisition. For app code using pooled connections, `conn.release()` returns the still-open MySQL session to the pool, so the advisory lock can remain held by an idle pooled connection. Image processing can skip or reschedule jobs as locked, admin deletion can fail as a timeout while holding the global delete lock, topic mutations can report lock failures, and color backfills can exit as "already running" or skip rows while the process itself owns the lock.

Suggested fix:

Add a shared helper such as `isMysqlAdvisoryLockAcquired(value: unknown): boolean` that accepts `1` and `BigInt(1)`, then use it at every `GET_LOCK` call site with row types widened to `number | bigint | null`. Add tests for the affected image-queue, admin-backfill-runner, admin-users, topics, and sidecar-backfill paths proving that `BigInt(1)` proceeds and releases.

### V22-02 - Smart-collection tag predicates accept numeric values but compile them as tag-name strings

Severity: Medium  
Confidence: High  
Status: Confirmed code defect  
Category: validation / public-route availability

Evidence:

- The declared tag predicate contract is string-only: `TagPredicate.value: string` at `apps/web/src/lib/smart-collections.ts:91-97`.
- Runtime scalar validation accepts `string | finite number` at `apps/web/src/lib/smart-collections.ts:366-368`.
- The tag branch in `validatePredicateSemantics` checks only that the operator is `eq` or `contains`, then returns without checking `typeof node.value === 'string'`: `apps/web/src/lib/smart-collections.ts:374-381`.
- The parser applies generic scalar validation before semantic validation, so a numeric tag value reaches the tag branch as accepted input: `apps/web/src/lib/smart-collections.ts:487-498`.
- The compiler treats tag values as names. Exact tag match compares `tags.name` to `pred.value` at `apps/web/src/lib/smart-collections.ts:250-258`; `contains` calls `containsLike(tags.name, pred.value)` at `apps/web/src/lib/smart-collections.ts:261-267`.
- `containsLike` requires a string and calls `escapeLikePattern(value)`, which calls `value.replace(...)`: `apps/web/src/lib/sql-like.ts:5-10`.
- Admin create/update actions persist `query_json` after `parseSmartCollectionQuery` succeeds: `apps/web/src/app/actions/collections.ts:32-50` and `apps/web/src/app/actions/collections.ts:83-98`.
- The public smart-collection page reparses and compiles stored JSON; any compile error becomes `notFound()`: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:86-98`.
- Tests reject non-scalar tag values but do not reject numeric tag scalars: `apps/web/src/__tests__/smart-collections.test.ts:167-220`. The accepted-operator test uses the default string value for `tag eq` and `tag contains`: `apps/web/src/__tests__/smart-collections.test.ts:228-250`.

Concrete failure scenario:

An admin import script or future UI bug saves a public collection like:

```json
{"type":"predicate","column":"tag","operator":"contains","value":123}
```

`parseSmartCollectionQuery` accepts it because `123` is a finite scalar and the tag semantic branch checks only the operator. When a visitor opens `/c/<slug>`, `compileSmartCollection` calls `containsLike` with a number, `value.replace` throws, and the route returns `notFound()` for a collection that was accepted at write time. With `operator: "eq"`, the query compiles but compares a string tag-name column to a number, yielding surprising MySQL coercion/empty-result behavior instead of a validation error.

Suggested fix:

Inside the `column === 'tag'` branch of `validatePredicateSemantics`, require `typeof node.value === 'string'` before returning. Add tests for numeric `tag eq` and numeric `tag contains` rejection, and add a parser/compiler agreement test that specifically includes tag values with non-string scalars.

### V22-03 - CLAUDE.md still documents the stale Docker compose command that the cycle-21 plan says was fixed

Severity: Medium  
Confidence: High  
Status: Confirmed docs/test-contract drift  
Category: deployment correctness / claimed fix not fully proven

Evidence:

- The cycle-21 plan says deployment docs should update manual Docker commands to use `--env-file apps/web/.env.local` and add a source-contract test: `.context/plans/cycle-21-2026-06-30-plan.md:50-63`.
- `README.md` now uses the corrected command: `docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build` at `README.md:180-189`.
- `CLAUDE.md` still has the stale common-command form without `--env-file`: `docker compose -f apps/web/docker-compose.yml up -d --build` at `CLAUDE.md:63-68`.
- `CLAUDE.md` repeats the stale command in the deployment checklist at `CLAUDE.md:645-657`.
- The deploy contract test reads `CLAUDE.md` into `deploymentDocs` at `apps/web/src/__tests__/deploy-script-contract.test.ts:12-18`, but the test that claims to feed Docker Compose the env file checks only `apps/web/deploy.sh`, compose config, and Dockerfile build args: `apps/web/src/__tests__/deploy-script-contract.test.ts:56-61`. It does not fail on stale manual commands in `CLAUDE.md`.
- The focused deploy contract test and full Vitest suite both passed, proving the gate currently misses this documentation drift.

Concrete failure scenario:

An operator follows `CLAUDE.md` instead of `README.md`, configures `apps/web/.env.local`, and runs the documented compose build command. Runtime `env_file` values still reach the container, but Compose build-arg interpolation for values like `BASE_URL`, `IMAGE_BASE_URL`, `UPLOAD_MAX_TOTAL_BYTES`, and `NEXT_UPLOAD_BODY_MAX_BYTES` depends on the shell/Compose environment. The image can be built with empty/default build-time values while the runtime environment looks correct, leading to wrong remote image host config or body-size build assumptions.

Suggested fix:

Update both `CLAUDE.md` command sites to the same `--env-file apps/web/.env.local` form used by `README.md` and `apps/web/deploy.sh`. Extend `deploy-script-contract.test.ts` to scan README/CLAUDE manual `docker compose ... up -d --build` snippets and require `--env-file apps/web/.env.local` unless an adjacent note explicitly says the same variables must be exported before build.

### V22-04 - Cycle-22 tests pass without proving the exact regression edges claimed by the fixes

Severity: Low  
Confidence: High  
Status: Confirmed coverage gap / future-regression risk  
Category: test adequacy

Evidence:

- Plan 382 says `isValidTagSlug` was changed to `countCodePoints(slug) <= 100` because supplementary characters allowed by `\p{Letter}` could be valid under MySQL utf8mb4 while exceeding 100 UTF-16 code units: `.context/plans/archive/plan-382-cycle22-fixes.md:6-14`.
- The implementation does use `countCodePoints`: `apps/web/src/lib/validation.ts:138-150`.
- The corresponding test accepts `landscape-night` and `풍경`, then rejects empty/malformed/underscore cases: `apps/web/src/__tests__/validation.test.ts:192-209`. `풍경` is BMP text where `.length` and code-point count agree, so reverting the max-length check to `.length <= 100` would still pass this test.
- Plan 383 says `getImageByShareKey` should use explicit `SEPARATOR '\x01'` and split on `\x01`: `.context/plans/archive/plan-383-cycle22-fixes.md:14-19`.
- The implementation does use `SEPARATOR CHAR(1)` and `split('\x01')`: `apps/web/src/lib/data.ts:1199-1229`.
- The source test checks `tag_concat`, `CONCAT(slug, CHAR(0), name)`, `ORDER BY`, joins, groupBy, no second select, and public fields: `apps/web/src/__tests__/data-tag-names-sql.test.ts:223-242`. It does not assert `SEPARATOR CHAR(1)` or `split('\x01')`.
- The targeted tests passed, so the current gate cannot prove either exact cycle-22 edge.

Concrete failure scenario:

A future edit can accidentally revert `isValidTagSlug` to `.length <= 100`; all current validation tests still pass while rare supplementary-character tag slugs are rejected again. Separately, a future edit can remove `SEPARATOR CHAR(1)` or change the parser back to comma splitting; `data-tag-names-sql.test.ts` still passes because it only checks the combined `GROUP_CONCAT` shape, not the explicit separator contract.

Suggested fix:

Add an `isValidTagSlug` regression with exactly 100 supplementary `\p{Letter}` code points from a CJK Extension plane and a 101-code-point reject case. Extend `data-tag-names-sql.test.ts` to assert both `SEPARATOR CHAR(1)` and `split('\x01')` in `getImageByShareKey`, or add a small pure parser helper with unit tests for tag names containing commas.

## Final Sweep / Skipped Files

Final sweep covered instructions, deployment docs, recent plans/reviews, app routes, API routes, server actions, core libs, scripts, migration contracts, custom lint scanners, privacy guards, smart collections, advisory locks, cycle-22 fix targets, Docker/deploy helpers, and relevant tests. I did not manually read every historical file under `plan/`, `.context/plans/archive/`, or every historical `.context/reviews/**` artifact because they are committed review history rather than current executable behavior; I sampled current-cycle and adjacent plans/reviews that could affect this verifier pass. I also skipped generated/runtime-heavy paths such as `node_modules`, `.next`, local uploads/data, and screenshots. Playwright e2e was not rerun because the confirmed findings are server/docs/test-contract issues and the requested behavior did not depend on a browser-flow claim.
