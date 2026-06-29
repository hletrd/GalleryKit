# Repository Code Review — review-plan-fix cycle 1/100

**Date:** 2026-06-29  
**Reviewer:** code-reviewer subagent  
**Scope:** repository-wide static review of `/Users/hletrd/flash-shared/gallery` under `AGENTS.md` and `CLAUDE.md`.

## Review Inventory

I built the inventory from `rg --files`, `find apps/web/src -type f`, targeted `rg` sweeps, and line-by-line inspection of the review-relevant runtime families. I treated the following as review-relevant:

- Project instructions and operations: `AGENTS.md`, `CLAUDE.md`, root package metadata, deploy scripts, Docker/nginx config, Next/Vitest/ESLint/TS configs.
- App routes and pages: all 73 files under `apps/web/src/app`, including public photo/topic/share pages, admin protected pages, metadata handlers, `api/search/*`, `api/og*`, upload/download routes, sitemap/robots/feed, and server actions.
- Components and UI: all 55 files under `apps/web/src/components`, with focus on public rendering, admin controls, upload/search/share flows, touch-target assumptions, and client/server boundaries.
- Core libraries: all 93 files under `apps/web/src/lib`, including data access, rate limiting, origin checks, auth/session, queue/backfill, image processing, search/CLIP, analytics, smart collections, restore/maintenance, CSP, uploads, and validation.
- Database and migrations: `apps/web/src/db/*`, all committed `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, and `apps/web/scripts/migrate.js`.
- Tests and guardrails: all 246 files under `apps/web/src/__tests__`, `apps/web/e2e/*`, and repository-specific lint scripts where they encode invariants.
- Localization and config data: `apps/web/messages/*`, `apps/web/src/site-config*.json`, and route-visible JSON/config references.

I excluded archived historical review artifacts and local plan-management files from bug hunting except where they explained an invariant already encoded in current source/tests. No source files were edited.

## Findings

### CR-01 — High — Semantic “similar photos” refunds the limiter after database work

**Location:** `apps/web/src/app/api/search/similar/[id]/route.ts:83-154`  
**Severity:** High  
**Confidence:** High  
**Status:** Confirmed

The route pre-increments the per-IP semantic limiter before the semantic work starts (`route.ts:83-93`), but then refunds the request after database-backed target lookup and scan paths have already consumed the protected resource:

- `route.ts:113-123` performs the target embedding lookup.
- `route.ts:125-127` rolls back the limiter when no embedding row exists.
- `route.ts:131-134` rolls back when the embedding row is corrupt.
- `route.ts:137-139` rolls back on target lookup infrastructure failure.
- `route.ts:142-151` performs the production embedding scan.
- `route.ts:152-154` rolls back on scan query failure.

This conflicts with the repository’s own rate-limit contract for unauthenticated DB/CPU-expensive GET surfaces. `apps/web/src/lib/rate-limit.ts:39-52` documents the charged-post-validation pattern: once the route has consumed its own DB/CPU work, nonexistent targets and infrastructure failures stay charged because refunding them creates an unmetered probe. The semantic helper comments also say rollback is for paths before expensive work (`apps/web/src/lib/rate-limit.ts:323-340`).

The problem is currently source-locked by tests rather than caught by them: `apps/web/src/__tests__/similar-route.test.ts:195-201` expects a rollback for a missing target embedding, and `apps/web/src/__tests__/similar-route.test.ts:228-240` expects a rollback for a corrupt embedding row.

**Failure scenario:** A non-browser client can forge same-origin `Origin`/`Referer` headers and repeatedly request `/api/search/similar/<valid-looking-id-without-production-embedding>`. Each request performs at least the target embedding database lookup and then refunds the semantic rate-limit token, allowing unmetered DB work and image-id/embedding-state probing. On DB failure paths, the scan/lookup work is likewise free to repeat.

**Concrete fix:** Treat the target lookup and production scan as the guarded resource. Keep rollbacks only for syntactic validation, maintenance, and semantic-mode rejection before the route reaches target/scan DB work. Remove `rollbackSemanticAttempt(ip)` from the target-missing, corrupt-target, target-query-catch, and scan-query-catch branches. Update the route header comment at `route.ts:13-20`/`route.ts:25-27` and change `similar-route.test.ts:195-240` to assert that post-lookup failures are charged. Add a source-contract regression like the OG route tests so future edits cannot reintroduce post-DB refunds.

## Cross-File Notes

- The sibling text semantic endpoint was reviewed separately; it refunds before the downstream embedding/scan resource and does not share this exact target-lookup oracle.
- The OG routes already model the desired invariant. `apps/web/src/lib/rate-limit.ts:39-52` references source-locked tests that keep OG DB/CPU failures charged.
- Public analytics actions have an in-memory per-IP guard (`apps/web/src/app/actions/public.ts:316-335`) before inserting view rows, so I did not classify analytics as an unbounded-write finding in this pass.
- Migration journal monotonicity has a documented historical inversion, but `apps/web/scripts/migrate.js` contains the hash-based baseline/post-condition mitigation and tests encode the grandfathered block. I did not count that as a new issue.

## Final Sweep

Common missed classes checked:

- Admin API/auth boundaries: `withAdminAuth(...)`, `isAdmin()`, and action-origin gates across admin route/actions.
- Public mutating route rate limits: POST/PUT/PATCH/DELETE route handlers plus public server-action write surfaces.
- Public GET cost controls: OG, semantic search, similar search, share pages, sitemap/feed/uploads, and metadata handlers.
- Privacy fences: `publicSelectFields`, `publicMapSelectFields`, `_PrivacySensitiveKeys`, semantic/search enrichment fields, and tests guarding sensitive image metadata.
- Data-flow and race paths: upload quota claim/settle, Lightroom upload tracker, restore maintenance lock, topic slug remap, image queue/backfill, view-count buffering, DB dump/restore.
- Raw SQL/process execution/destructive operations: migration reconciliation, restore scanner, Docker/deploy scripts, and one-off maintenance scripts.
- Edge-case validation: slugs/tags, smart collection query compiler, body/content-length caps, cursor pagination, search length/code-point handling, referrer/IP analytics sanitization.

Relevant file families not fully reviewed for defects: archived review history under `.context/reviews/archive` and planning documents under `.context/plans`/`plan`. They are not runtime code or active guardrails for this cycle. I did not run lint/typecheck/build/tests because this prompt requested a read-only review artifact and allowed writing only `./.context/reviews/code-reviewer.md`; the evidence above is from static inspection of current source and tests.

## Verdict

One confirmed high-severity issue found. No other repository-wide findings rose above review threshold in this pass.
