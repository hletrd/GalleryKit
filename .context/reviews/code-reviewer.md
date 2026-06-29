# Code Reviewer - Cycle 14

**Date:** 2026-06-30
**HEAD reviewed:** `c2da917d0fe9620bcbef3897570591080445592c`
**Role:** cycle-14 code-reviewer
**Scope:** current `HEAD` only; review-only artifact. No production code was modified.

## Required Context Read

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

## Inventory Built Before Inspection

- Tracked repository inventory at `HEAD`: **2,551 files**.
- Primary runtime/review surface:
  - `apps/web/src`: **503 tracked files**
  - `apps/web/scripts`: **27 tracked files**
  - `apps/web/drizzle`: **31 tracked files**
  - `apps/web/e2e`: **8 tracked files**
  - root/app configs: `package.json`, `apps/web/package.json`, `next.config.ts`, TypeScript/Vitest/Playwright/ESLint/Tailwind configs, Docker/deploy files, env examples.
- Historical `.context/reviews/` and `plan/` files were inventoried as context/history, not treated as executable production behavior.

## Files And Regions Reviewed

Direct reads covered the high-risk executable paths and their cross-file contracts:

- Data/schema/migrations: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/src/lib/data.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`.
- Upload/processing/storage: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/storage/local.ts`, upload quota/restore-maintenance helpers.
- Admin/ops/security flow: `apps/web/src/app/actions/auth.ts`, `admin-users.ts`, `settings.ts`, `seo.ts`, `sharing.ts`, `lr-tokens.ts`, `admin-backfill.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/api-auth.ts`, `rate-limit.ts`, `request-origin.ts`, `proxy.ts`, CSP helpers.
- Public/search/share flow: public pages under `apps/web/src/app/[locale]/(public)`, `/api/search/semantic`, `/api/search/similar/[id]`, `/api/og`, `/api/og/photo/[id]`, public actions, map/share/group pages.
- Domain/admin mutation flow: topics, tags, collections, smart collections, SEO/gallery config, privacy-sensitive projections, semantic-search enrichment fields and tests.
- Representative UI/state clients: settings backfill status, image manager, photo viewer/lightbox, public grid/share pages.
- Final sweeps: repository-wide searches for unsafe casts, raw SQL, TODO/FIXME/HACK markers, `dangerouslySetInnerHTML`, auth/origin/rate-limit wrappers, global state, timers, catch blocks, env parsing, and migration/schema drift.

No runtime-relevant source files were intentionally skipped. I did not line-review every historical review artifact in `.context/reviews/` or every plan document because they are not production runtime/test code.

## Confirmed Findings

### C14-01 - Zero-candidate backfill leaves stale "last run" state in the admin UI

**Severity:** Low
**Confidence:** High
**File/region:** `apps/web/src/lib/admin-backfill-runner.ts:837-841`, `apps/web/src/lib/admin-backfill-runner.ts:631-646`, `apps/web/src/lib/admin-backfill-runner.ts:780-803`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:302-327`

**Problem:** `triggerAdminBackfill()` handles `candidateCount === 0` by releasing the advisory lock and returning `{ status: 'queued', affectedRows: 0 }` immediately. That path never enters `runBackfill()`, so it does not reset `processed`, `errors`, `encodeFailures`, `detectionFailures`, `lastRunHadFailures`, `lastError`, or increment/replace the completed-run summary. The normal runner path resets state at start and flushes final counters on completion, but the no-op path bypasses both.

**Failure scenario:** An admin runs a backfill that records failures. Later, after the stale candidates are fixed or no longer exist, the admin clicks "Re-encode existing photos" again and receives a successful queued/0-work result. The settings UI renders the last-run panel whenever `completedRuns > 0` and reads the stale counters directly, so it can continue showing the previous failure banner or old processed count even though the latest trigger found no work.

**Concrete fix:** Treat `candidateCount === 0` as a completed no-op run in the shared state before returning: set `lastQueuedCount = 0`, reset all per-run counters to 0, set `lastRunHadFailures = false`, clear `lastError`, and either increment `completedRuns` or add an explicit `lastNoopAt`/`lastRunStatus` field that the UI can render. Add a focused test that seeds a failed previous state, mocks `fetchCandidateCount()` to 0, calls `triggerAdminBackfill()`, and asserts the status state no longer reports stale failures.

## Likely Issues

### C14-02 - Semantic rate-limit helper documentation contradicts the route's charged short-query behavior

**Severity:** Low
**Confidence:** Medium
**File/region:** `apps/web/src/lib/rate-limit.ts:372-375`, `apps/web/src/app/api/search/semantic/route.ts:194-243`, `apps/web/src/__tests__/semantic-search-route.test.ts:230-235`

**Problem:** `rollbackSemanticAttempt()` says it is used for requests that exit before guarded work is consumed, "for example disabled mode or too-short query." The semantic route now intentionally checks disabled mode before charging, but charges at `route.ts:194-205` before body parsing and does not roll back for malformed JSON, oversized post-read bodies, or short queries at `route.ts:239-243`. The route-level comments and tests align with charged body admission; the helper comment is the stale part.

**Failure scenario:** A future maintainer following the helper comment can reintroduce a rollback for `< 3` character queries after body admission, weakening the current "charged after body read" posture and making cheap invalid bodies a free request stream again.

**Concrete fix:** Update the helper comment to match the route contract: rollback is for callers that exit before body/embedding/vector-scan admission, not for too-short semantic-route queries after the route has charged. If fairness for short queries is desired instead, move short-query validation before the rate-limit charge and add tests for that explicit contract.

## Risks Needing Manual Validation

- Image-processing color fidelity, HDR/gain-map detection, AVIF/WebP/JPEG byte output, and rollback behavior were reviewed statically and through existing tests/comments, but not manually validated with real photo fixtures during this review.
- DB restore/backfill/queue interactions were reviewed from code and invariants; no live restore, long-running backfill, or multi-process race test was executed.
- Full `npm run build`, `npm test --workspace=apps/web`, and Playwright e2e were not run because this was a review-only artifact and no production code changed.
- Current worktree had unrelated modifications in other `.context/reviews/*.md` files; they were not part of this review and were left untouched.

## Final Missed-Issues Sweep

- Auth/origin/rate-limit sweeps found the admin API routes wrapped by `withAdminAuth`, mutating server actions covered by `requireSameOriginAdmin()`, and public mutating API routes covered by pre-increment rate-limit helpers.
- Schema/migration/reconcile sweep found the current late migrations mirrored in `migrate.js`, including `processing_settings_json`, AVIF bit-depth, analytics indexes, and removed feature schema drops. The journal still contains the known historic non-monotonic timestamp, but current migration code baselines per hash and verifies all journal hashes after migration.
- Privacy projection sweep found public image/search/map/share select fields constrained by shared omit/type-guard fixtures.
- No relevant runtime source files were intentionally skipped; skipped material was historical review/plan content and non-runtime artifacts.

## Validation Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
