# Cycle 16 Code-Reviewer Review

Date: 2026-07-08

Mode: whole-repository code review from the code quality, logic, SOLID, and maintainability angle. The only file intentionally written by this lane is this report.

## Scope And Inventory

Instructions/context loaded: `AGENTS.md` from the prompt, `CLAUDE.md`, and the `code-review` skill.

Inventory built before findings:

- 685 review-relevant files under `apps/web/src`, `apps/web/scripts`, `scripts`, and `apps/web/drizzle` including tests.
- 328 production/config/migration/script files after excluding `__tests__`.
- 80 app route/action/page files under `apps/web/src/app`.
- 179 core `lib`, `components`, `db`, and `i18n` TypeScript/TSX files.
- Total reviewed production text surface: 56,452 lines from the production inventory.

Files and interactions examined directly or via targeted sweeps:

- Admin/session/PAT auth, same-origin action guards, public route rate limits, public/admin selector privacy, upload/delete/bulk image flows, Lightroom upload, processing queue, admin and semantic backfills, restore-maintenance fencing, backup/restore scripts, migration/journal handling, smart collections, public search/semantic/similar routes, share/feed/OG routes, gallery pagination/cursors, UI state components, service-worker cache helpers, storage helpers, and repo hygiene.
- Static binary assets, fonts, generated screenshots, fixtures, dependency directories, and build output were excluded from behavioral findings. Historical `.context` plans/reviews were treated as review history, not live runtime behavior.

## Validation Evidence

Read-only/static validation run in this lane:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.

Additional sweeps performed:

- Route export/auth/rate-limit inventory across all `route.ts(x)` files.
- Server-action export inventory with same-origin/admin guard checks.
- Raw SQL, advisory-lock, child-process, filesystem write/delete/rename, revalidation, `cache()`, `process.env`, timer, and catch/rollback pattern scans.
- `TODO/FIXME/HACK`, TypeScript suppression, and ESLint suppression scans.
- Final check for tracked `.omc`/runtime-state artifacts.

Not run:

- Full `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, or Playwright e2e. This was a review/report lane; the three custom guard scripts above were enough to validate the auth/origin/rate-limit claims made here, but full gates remain required before shipping fixes.

## Findings Summary

- Confirmed issues: 2
- Likely issues: 1
- Manual-validation risks: 1

## Confirmed Issues

### 1. Admin deletion can throw an unstructured 500 when the dedicated advisory-lock connection cannot be acquired

- Location: `apps/web/src/app/actions/admin-users.ts:231`
- Severity: Medium
- Confidence: High
- Category: confirmed issue

`deleteAdminUser()` acquires its dedicated MySQL connection before entering the `try/catch/finally` that maps lock, transaction, and domain failures to localized action results. If `connection.getConnection()` rejects because the pool is exhausted, the database is restarting, or credentials/TLS are misconfigured, the rejection bypasses the structured error handling entirely and propagates as a server-action exception.

Why this is a problem:

- Sibling admin mutation paths generally convert transient DB/lock acquisition failures into `{ error: t(...) }`.
- The function has careful transaction rollback and lock release logic after the connection exists, but the first infrastructure failure sits outside that envelope.
- This creates an inconsistent admin UX and makes a routine infrastructure fault look like an application crash.

Concrete failure scenario:

- An admin tries to delete a stale admin account while the DB pool is saturated by uploads/backfill/health probes.
- `connection.getConnection()` rejects at line 231.
- The caller receives a framework-level server-action failure instead of `failedToDeleteUser`; the UI may show a generic crash/toast and no localized recovery message.

Suggested fix:

- Move `connection.getConnection()` into a small guarded acquisition block, or widen the existing `try` to start before acquisition with `let conn: PoolConnection | null = null`.
- In `finally`, release only when `conn` is non-null.
- Return `t('failedToDeleteUser')` on acquisition failure and log the detail server-side.

### 2. CLIP embedding backfill has the same unhandled dedicated-connection acquisition gap

- Location: `apps/web/src/app/actions/embeddings.ts:113`
- Severity: Medium
- Confidence: High
- Category: confirmed issue

`backfillClipEmbeddings()` localizes and logs errors inside the `try/catch` beginning at line 115, but the advisory-lock connection is acquired at line 113 before that `try` starts. If the pool cannot hand out a connection, the server action rejects instead of returning `{ status: 'error', message: t('embeddingBackfillFailed') }`.

Why this is a problem:

- The action already treats config read failures as disabled/no-op and later DB/encoder failures as structured `{ status: 'error' }`; connection acquisition is the one infrastructure error outside that policy.
- The action is currently documented as not UI-wired, but it is exported and linted as an admin server action. Future wiring would inherit this rough failure mode.

Concrete failure scenario:

- An admin/operator triggers embedding backfill during a production CLIP rollout while the DB pool is temporarily exhausted.
- `connection.getConnection()` throws before `semanticBackfillLockHeld` exists.
- The action boundary sees an uncaught exception rather than a localized `embeddingBackfillFailed` response.

Suggested fix:

- Match `acquireUploadProcessingContractLock()`'s posture: catch connection-acquisition failures and return a structured unavailable/error result.
- Keep the current `releasePooledAdvisoryLocks()` discipline after a connection exists.

## Likely Issues

### 3. Tracked OMX/OMC runtime artifacts pollute the source and review inventory

- Location: `.omc/plans/plan-cycle12-fixes.md:1`, `apps/web/src/__tests__/.omc/state/sessions/cf88ba27-b054-4385-83b8-446a5996bdbf/pre-tool-advisory-throttle.json:1`
- Severity: Low
- Confidence: High
- Category: likely maintainability issue

Two runtime/planning artifacts are tracked even though `.gitignore` ignores `.omc` at line 16. One is a stale completed plan under root `.omc`; the other is an agent throttle JSON file nested inside `apps/web/src/__tests__`.

Why this is a problem:

- `rg --files` and review inventories pick up `apps/web/src/__tests__/.omc/...` as part of the test tree.
- The root `.omc` plan is not the project’s committed plan history (`.context/plans` is), and it references old source-line numbers and completed work.
- Future agents and maintainers can mistake runtime state for authoritative repo context.

Concrete failure scenario:

- A future review or code-search script includes `apps/web/src/__tests__/.omc/state/...json`, counts it as a test artifact, or reports stale advisory text as source.
- Another agent reads `.omc/plans/plan-cycle12-fixes.md` as current planning context and reopens already-fixed work.

Suggested fix:

- Remove the tracked `.omc` files from git while preserving `.context/plans` and `.context/reviews` as the committed review/plan surfaces.
- Add a CI or lint check that fails if tracked paths match `(^|/)\\.omc/` or `(^|/)\\.omx/`.

## Manual-Validation Risks

### 4. Full quality gates were not run in this review lane

- Location: `AGENTS.md` quality-gates section; `apps/web/package.json` scripts
- Severity: Low
- Confidence: High
- Category: manual-validation risk

The three custom guard scripts passed, but this lane did not run the full lint/typecheck/build/unit/e2e gate suite.

Concrete failure scenario:

- A TypeScript, Next build, ESLint, unit-test, or browser-flow failure unrelated to API auth/action-origin/public-route-rate-limit exists and is not detected by this review pass.

Suggested validation:

- In the implementation/verification lane, run `npm run lint --workspace=apps/web`, `npm run typecheck --workspace=apps/web`, `npm run build --workspace=apps/web`, `npm test --workspace=apps/web`, and `npm run test:e2e --workspace=apps/web` where browser-flow coverage is required.

## Final Sweep Notes

- Auth wrapper coverage: passed `lint:api-auth`; inspected `withAdminAuth`, cookie and PAT branches, response cache headers, token scope gates, and request-token context cleanup.
- Server-action mutation guard coverage: passed `lint:action-origin`; inspected mutating image/topic/tag/share/settings/admin-user/token/restore-related paths for same-origin and restore-fence patterns.
- Public route rate-limit coverage: passed `lint:public-route-rate-limit`; inspected search, similar, OG, feed, upload serving, health, and live routes.
- Data/privacy boundaries: public selectors continue to omit admin-only fields with compile-time guards; map GPS exposure is isolated behind `map_visible`.
- Upload/queue/backfill: quota claims, lock release, retry maps, file cleanup, restore maintenance checks, and queue side effects are mostly disciplined. The notable exception is the two dedicated connection-acquisition gaps above.
- Pagination/search: cursor predicates are order-compatible with the `capture_date DESC, created_at DESC, id DESC` listing order; malformed load-more cursors fail closed.
- Raw SQL/advisory-lock surfaces: most use parameterized queries and shared lock-release helpers. The remaining concern is acquisition placement, not SQL injection.
- Skipped files: binary fixtures, fonts/icons, screenshots, generated output, and historical review artifacts were not treated as runtime behavior.
