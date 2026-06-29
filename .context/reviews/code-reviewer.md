# Code Reviewer - Cycle 15

**Date:** 2026-06-30
**HEAD reviewed:** `e87d1bc2ba75d1ec90704920ea0fa240cdba749c`
**Role:** cycle-15 code-reviewer
**Scope:** current `HEAD` only; review-only artifact. No production source code was modified.

## Required Context Read

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

## Inventory Built Before Inspection

- Tracked repository inventory at `HEAD`: **2,554 files**.
- Primary runtime/review surface:
  - `apps/web/src`: **504 tracked files**
  - `apps/web/scripts`: **27 tracked files**
  - `apps/web/drizzle`: **31 tracked files**
  - `apps/web/e2e`: **8 tracked files**
  - root/app configs: `package.json`, `apps/web/package.json`, `next.config.ts`, TypeScript/Vitest/Playwright/ESLint/Tailwind configs, Docker/deploy files, env examples.
- Historical `.context/reviews/` and plan files were inventoried as context/history only. Prior-cycle findings were rechecked against current code rather than carried forward.

## Files And Regions Reviewed

Direct reads covered the high-risk executable paths and their cross-file contracts:

- Data/schema/migrations: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/src/lib/data.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`.
- Upload/processing/storage: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/storage/local.ts`, upload quota and restore-maintenance helpers.
- Admin/ops/security flow: `apps/web/src/app/actions/auth.ts`, `admin-users.ts`, `settings.ts`, `seo.ts`, `sharing.ts`, `lr-tokens.ts`, `admin-backfill.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/api-auth.ts`, `rate-limit.ts`, `request-origin.ts`, `proxy.ts`, CSP helpers.
- Public/search/share flow: public pages under `apps/web/src/app/[locale]/(public)`, `/api/search/semantic`, `/api/search/similar/[id]`, `/api/og`, `/api/og/photo/[id]`, public actions, map/share/group pages.
- Domain/admin mutation flow: topics, tags, collections, smart collections, SEO/gallery config, privacy-sensitive projections, semantic-search enrichment fields and tests.
- Representative UI/state clients: settings backfill status, image manager, photo viewer/lightbox, public grid/share pages.
- Final sweeps: repository-wide searches for unsafe casts, raw SQL, TODO/FIXME/HACK markers, `dangerouslySetInnerHTML`, auth/origin/rate-limit wrappers, global state, timers, catch blocks, env parsing, filesystem writes, process spawning, and migration/schema drift.

No runtime-relevant source files were intentionally skipped. I did not line-review every historical review artifact in `.context/reviews/` because they are not production runtime/test code.

## Confirmed Findings

None.

## Likely Issues

### C15-01 - Semantic rate-limit helper documentation still names a branch the route intentionally does not refund

**Severity:** Low
**Confidence:** Medium
**Status:** Likely
**File/region:** `apps/web/src/lib/rate-limit.ts:374-377`, `apps/web/src/app/api/search/semantic/route.ts:194-205`, `apps/web/src/app/api/search/semantic/route.ts:239-242`

**Problem:** `rollbackSemanticAttempt()` says refunds are used when a request exits before guarded work is consumed, including "too-short query." The semantic route currently charges at `route.ts:194-205` before reading/parsing the body, then returns 400 for short queries at `route.ts:239-242` without calling `rollbackSemanticAttempt()`. That route behavior is coherent with the "charge before body materialization" posture, but the helper comment contradicts it.

**Failure scenario:** A future maintainer follows the helper comment and adds a short-query rollback after the route has already read and parsed the body. That would make cheap invalid semantic bodies a free request stream again and weaken the current public endpoint throttling posture.

**Concrete fix:** Update the helper comment to remove "too-short query" from refundable examples, or move short-query validation before the pre-increment if product policy wants those requests to be free. Lock the chosen contract with a small route test that asserts short semantic queries either remain charged or are prevalidated before charging.

## Prior-Cycle Recheck

- The former zero-candidate backfill stale-state issue is fixed in current `HEAD`: `triggerAdminBackfill()` now calls `resetPerRunCounters(state, 0)` and increments `completedRuns` before returning the no-op queued result at `apps/web/src/lib/admin-backfill-runner.ts:843-850`.
- The semantic rollback documentation mismatch remains in current `HEAD`; it is reported above as C15-01 after fresh inspection.

## Risks Needing Manual Validation

- Image-processing color fidelity, HDR/gain-map detection, AVIF/WebP/JPEG byte output, and rollback behavior were reviewed statically and through existing tests/comments, but not manually validated with real photo fixtures during this review.
- DB restore/backfill/queue interactions were reviewed from code and invariants; no live restore, long-running backfill, or multi-process race test was executed.
- Playwright e2e was not run because browser-flow coverage was not required for the code-quality issue found here.
- Current worktree had unrelated modifications in `.context/reviews/security-reviewer.md` and `.context/reviews/verifier.md`; they were not part of this review and were left untouched.

## Final Missed-Issues Sweep

- Auth/origin/rate-limit sweeps found the admin API routes wrapped by `withAdminAuth`, mutating server actions covered by `requireSameOriginAdmin()`, and public mutating API routes covered by pre-increment rate-limit helpers.
- Schema/migration/reconcile sweep found the current migrations mirrored in `migrate.js`, including processing settings, AVIF bit-depth, analytics indexes, semantic-search schema, and removed feature schema drops.
- Upload/queue/backfill sweeps found quota rollback, restore-maintenance checks, per-image processing locks, deleted-mid-reencode cleanup, original-path realpath containment, and GPS stripping wired across browser upload, Lightroom upload, queue, retry, and color backfill paths.
- Privacy projection sweep found public image/search/map/share select fields constrained by shared omit/type-guard fixtures.
- No additional real code-quality, logic, maintainability, or correctness issue was found in the final sweep.

## Validation Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm run lint --workspace=apps/web` - passed.
- `npm run typecheck --workspace=apps/web` - passed.
- `npm test --workspace=apps/web` - passed: 259 test files passed, 2 skipped; 2404 tests passed, 4 skipped.
- `npm run build --workspace=apps/web` - passed. During static generation, sitemap logged the expected local-DB fallback because MySQL was not listening on `127.0.0.1:3306`; the production build still completed successfully.
