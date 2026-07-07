# Cycle 20 Code Reviewer Report

Date: 2026-07-08
Role: `code-reviewer`
Scope: repository-wide code quality, logic, SOLID, maintainability, shared-state, error handling, and cross-file correctness review.

## Inventory

Required project guidance read first:
- `AGENTS.md` workspace instructions from the task prompt.
- `CLAUDE.md` repository architecture, security, migration, deploy, privacy, and operational contracts.
- `code-review` skill instructions.

Review-relevant inventory built before the detailed pass:
- 12,513 non-generated workspace files after excluding `node_modules`, `.next`, `coverage`, `dist`, `build`, upload/resource/data stores, and similar runtime artifacts.
- 700 files under the live review surface: `apps/web/src`, `apps/web/scripts`, `apps/web/e2e`, and `apps/web/drizzle`.
- 715 code-like files after excluding generated/runtime payloads: TypeScript/TSX/JS/MJS/CJS/SQL/JSON/shell.
- 44 app route/page/layout entry files.
- 197 files across `apps/web/src/lib`, `apps/web/src/app/actions`, `apps/web/src/app/api`, `apps/web/scripts`, and `apps/web/drizzle`.

Files and interactions examined:
- Package/config/deploy surface: root and app `package.json`, Next config, app scripts, migration/deploy helpers, DB bootstrap/migration paths.
- Public/admin routes: admin DB download, Lightroom upload, health/live, OG topic/photo, semantic/similar search, upload serving, global/topic feeds.
- Server actions: auth/session/password, admin users, DB restore/dump, images upload/delete/update/retry, settings, SEO, tags/topics, sharing, collections, public analytics/search/load-more.
- Core libraries: `data.ts`, `image-queue.ts`, `process-image.ts`, upload path/serving/storage helpers, auth/session/rate-limit/origin guards, smart collections, gallery config, restore maintenance, background writes.
- DB/migrations: schema, journal, migration reconciliation/baselining, migration post-condition logic.
- Tests and source-contract coverage around privacy fields, image queue permanent failures, migration contracts, auth/origin/rate-limit gates, upload and processing invariants.
- Historical `.context/` review/plan files were inventoried but not treated as live executable code, except where project guidance pointed to current contracts.

Validation evidence:
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm test --workspace=apps/web -- image-queue-permanent-failure image-queue-r10c1-contracts --run` passed: 3 files, 21 tests.
- `npm run typecheck --workspace=apps/web` passed.
- Migration journal/files one-to-one check passed for file presence; the historical non-monotonic `when` values are explicitly handled by `apps/web/scripts/migrate.js` per-entry baselining and post-condition logic.

## Findings

### CR20-01 - Claim-exhaustion permanent failures bypass the bounded-set eviction contract

- Severity: Medium
- Confidence: High
- Status: Confirmed issue
- Code region:
  - `apps/web/src/lib/image-queue.ts:112-113` defines `MAX_PERMANENTLY_FAILED_IDS = 1000`.
  - `apps/web/src/lib/image-queue.ts:320-324` documents `permanentlyFailedIds` as a FIFO-bounded set.
  - `apps/web/src/lib/image-queue.ts:767` adds a claim-exhausted job to `state.permanentlyFailedIds` with no cap enforcement.
  - `apps/web/src/lib/image-queue.ts:1029-1041` enforces the cap only on the normal processing-failure add path.
  - `apps/web/src/lib/image-queue.ts:1155-1156` expands the whole set into a `notInArray(images.id, [...state.permanentlyFailedIds])` bootstrap predicate.
  - `apps/web/src/__tests__/image-queue-permanent-failure.test.ts:56-63` only source-checks that some FIFO eviction code exists, not that every add path uses it.
- Failure scenario: If many different image jobs repeatedly fail to acquire their per-image processing claim, each job reaches the claim-exhaustion branch and is added at `image-queue.ts:767`. Unlike the ordinary `MAX_RETRIES` branch, that path never evicts old IDs or cleans associated retry/error maps. In a leaked-lock, multi-process contention, or lock-acquisition anomaly, the process-local set can grow beyond the documented cap. The next bootstrap scan then builds a larger and larger `NOT IN (...)` predicate from the unbounded set, increasing memory, SQL bind-list size, and bootstrap latency, and potentially failing the query under sustained claim exhaustion.
- Concrete fix: Extract a single helper such as `markPermanentlyFailed(state, id)` that adds the ID, applies FIFO eviction when `size > MAX_PERMANENTLY_FAILED_IDS`, and deletes stale `claimRetryCounts`, `retryCounts`, and `lastErrors` entries for any evicted ID. Use that helper at both `image-queue.ts:767` and `image-queue.ts:1029`. Add a behavior or source-contract test that proves all `permanentlyFailedIds.add(...)` sites are routed through the helper, or directly exercises the claim-exhaustion path past 1000 IDs and asserts the cap.

## Likely Issues

None found.

## Manual-Validation Risks

No manual-validation-only code defects were identified. Production-only CLIP model availability, real MySQL restore/dump behavior, and nginx/deploy environment wiring remain operational validation areas, but the reviewed code has explicit gates or runbook coverage for those paths.

## Final Missed-Issues Sweep

Commonly missed areas checked:
- Auth/origin/rate-limit wrappers on API routes and mutating server actions.
- Raw SQL and child-process use in DB restore/dump/migration/admin deletion flows.
- File-path containment, symlink checks, and private-original/public-derivative upload handling.
- Public privacy select fields and sensitive-field compile/test guards.
- Migration journal/file coverage, non-monotonic timestamp handling, and post-condition failure paths.
- Background queue shared state, retry maps, quiesce/resume/restore interactions, and existing permanent-failure tests.
- `dangerouslySetInnerHTML`, source-string tests, timers, spawned scripts, and generated JSON-LD surfaces.

Skipped as non-review-relevant:
- Generated/build/runtime payloads: `node_modules`, `.next`, coverage/build output, uploaded image/resource/data directories.
- Historical review and plan markdown as executable behavior, except for current repository contracts referenced by AGENTS/CLAUDE.

Findings summary:
- Confirmed issues: 1
- Likely issues: 0
- Manual-validation risks: 0
