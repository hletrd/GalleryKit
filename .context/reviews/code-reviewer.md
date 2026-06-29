# Code Reviewer - cycle 10

**Date:** 2026-06-29
**HEAD reviewed:** `ee8e08afee1d2a9c7e5f6c2b7cead05670d514d7` (`ee8e08af fix(cycle9): 🐛 harden review findings`)
**Role:** code-reviewer
**Scope:** whole current repository at HEAD, prompt 1 only. Deep code quality, logic, SOLID/maintainability, cross-file contract, security-adjacent guardrail, state consistency, race-condition, error-handling, and missed-issue review. No source files were edited; only this report artifact was written.

## Required Context Read

- Read the project `AGENTS.md` instructions supplied for `/Users/hletrd/flash-shared/gallery`.
- Read `CLAUDE.md` for architecture, deploy, schema, security, privacy, upload, restore, analytics, CLIP/search, i18n, and quality-gate context.
- Loaded the local `code-review` skill instructions before reviewing.

## Inventory Built Before Findings

Review-relevant tracked surface, excluding `node_modules`, `.next`, coverage, screenshots/fixtures, generated local artifacts, and old archived-only review assets:

- 560 review-relevant files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, `docs`, and `scripts`.
- Extension mix: 412 `ts`, 103 `tsx`, 28 `sql`, 6 `json`, 4 `mjs`, 3 `js`, 2 `sh`, 2 `md`.
- Runtime application: Next.js app routes, public/admin pages, API routes, server actions, shared components, i18n routing/provider code, metadata/OG/sitemap/feed paths.
- Core data/state: schema, migrations/journal, migration/reconcile scripts, `data.ts`, timeline/public query helpers, analytics, smart collections, privacy field contracts, CLIP/search data paths.
- Mutations/trust boundaries: auth/session, admin-users, LR tokens, uploads, image delete/bulk/retry/update, tags, topics, sharing, settings, SEO, embeddings, public actions, route scanner scripts.
- Processing/ops: upload path handling, image/topic processing, queue and shutdown handling, backfill runner, restore maintenance, DB restore/download, advisory locks, deploy/Docker/nginx surfaces.
- Tests/config: Vitest/Playwright/ESLint/Next/TypeScript configs, lint-gate scripts, scanner tests, privacy/touch-target tests, and prior review lineage enough to avoid stale duplicate findings.

Broad sweeps covered action/API auth gates, origin checks, public mutating route rate limits, public server-action rate limits, raw SQL and child-process call sites, detached background work, advisory locks, temp-file cleanup, upload serving traversal/symlink protection, schema/journal drift, cache/revalidation contracts, privacy-sensitive select fields, JSON-LD/HTML injection surfaces, rate-limit rollback semantics, and TODO/FIXME/high-risk catch sites.

## Findings

### C10-CQ-01 - Analytics view recording rate limit runs after unauthenticated DB validation

**Severity:** Medium
**Confidence:** High
**Classification:** Confirmed issue

**File/region:**

- `apps/web/src/app/actions/public.ts:323-341` defines the in-memory per-IP view-recording rate limit.
- `apps/web/src/app/actions/public.ts:364-374` validates `imageId` with a DB `SELECT` before calling `headers()`, `buildViewParams`, and `isViewRecordRateLimited`.
- `apps/web/src/app/actions/public.ts:387-402` validates `topicSlug` with a DB `SELECT` before applying the same rate limit.
- `apps/web/src/app/actions/public.ts:414-430` validates `groupId` with a `sharedGroups`/`sharedGroupImages`/`images` join before applying the same rate limit.

**Issue:** The C9 rate limit protects the durable analytics `INSERT`, but it is applied only after each public view-recording action performs target validation against the database. These actions are intentionally public and `@action-origin-exempt`; the only per-IP abuse control should happen before avoidable database work. As written, over-limit traffic still forces a DB read, including the heavier shared-group join.

**Concrete failure scenario:** A bot repeatedly calls the photo, topic, or shared-group view server actions for valid public IDs/slugs from one IP. After 120 requests/minute, inserts stop, but every over-limit request still performs the validation query first. For shared groups, the attacker can continue driving a join across `sharedGroups`, `sharedGroupImages`, and `images` even while nominally rate-limited, creating avoidable database load on unauthenticated public endpoints.

**Concrete fix:** Move request header/IP extraction and `isViewRecordRateLimited(params.ip, Date.now())` before the validation `SELECT`/join in all three actions. Keep the cheap syntactic checks first. Prefer charging invalid-but-well-formed target probes too, so rate-limited clients cannot bypass the budget by alternating invalid IDs/slugs. Add focused tests that push an IP over the limit and assert the database validation query is not called after the limiter rejects.

### C10-CQ-02 - Many mutating admin server actions authenticate before same-origin rejection

**Severity:** Low
**Confidence:** High on the pattern, Medium on exploitability
**Classification:** Risk / maintainability issue

**File/region:**

- `apps/web/src/app/actions/settings.ts:40-47` calls `isAdmin()` before `requireSameOriginAdmin()`.
- `apps/web/src/app/actions/seo.ts:54-61` calls `isAdmin()` before `requireSameOriginAdmin()`.
- `apps/web/src/app/actions/collections.ts:15-21`, `:64-70`, and `:112-118` call `isAdmin()` before `requireSameOriginAdmin()`.
- `apps/web/src/app/actions/topics.ts:85-92` and `:182-189` show the same ordering for topic create/update, with the pattern repeated across topic mutations.
- `apps/web/src/app/actions/tags.ts:42-49` and `:99-106` show the same ordering for tag mutations.
- `apps/web/src/app/actions/sharing.ts:84-91` calls `isAdmin()` before the same-origin check for share-link creation.
- `apps/web/src/app/actions/admin-users.ts:75-82` calls `isAdmin()` before origin validation, and `apps/web/src/app/actions/admin-users.ts:182-190` calls both `isAdmin()` and `getCurrentUser()` before origin validation.

**Issue:** The required same-origin check exists, and `npm run lint:action-origin --workspace=apps/web` passes, but the ordering is inconsistent with a fail-fast provenance boundary. Cross-site requests with an admin cookie are rejected eventually, yet many actions first perform session/auth work, and in `deleteAdminUser` also fetch the current user, before rejecting on origin. This is not a confirmed CSRF bypass; it is a guardrail and maintainability gap. The scanner proves presence of `requireSameOriginAdmin`, not that it is the first meaningful trust-boundary check.

**Concrete failure scenario:** A malicious site causes an authenticated admin browser to submit repeated cross-site server-action requests. Mutations are blocked by `requireSameOriginAdmin`, but each request can still drive session verification and, in some paths, user lookup before the request is rejected. More importantly, the mixed ordering makes future action edits easier to get wrong: developers can add validation, rate-limit, audit, or DB work between `isAdmin()` and origin rejection while still passing the current lint gate.

**Concrete fix:** Standardize mutating admin action prologues as: maintenance check if needed, `requireSameOriginAdmin()`, then `isAdmin()`/`getCurrentUser()`, then runtime payload validation and mutation. Strengthen `scripts/check-action-origin.ts` so it flags mutating actions where `isAdmin`, `getCurrentUser`, `db.*`, audit logging, rate-limit increments, or other awaited side effects appear before the same-origin return path. Add fixtures that cover both accepted and rejected ordering.

## No Additional Findings After Final Sweep

I did not find additional current issues in these reviewed areas:

- Admin API routes are wrapped by `withAdminAuth`, and public mutating API routes are covered by the public-route rate-limit scanner.
- Privacy-sensitive public selects remain guarded by omit objects, type guards, and the dedicated privacy fixture.
- Upload serving still validates safe path segments, extension/directory contracts, `lstat`, `realpath`, root containment, conditional headers, and stream abort cleanup.
- Browser upload, Lightroom upload, retry, queue, processing-setting snapshots, restore maintenance, upload quota claim/settle, and post-restore migration flows did not show a current lock/rollback leak in this pass.
- Search route rate-limit rollback/charging behavior appears intentional in the current tests: disabled semantic search is refunded, while post-body validation and embedding/search setup failures are charged.
- Schema/migration journal and reconcile behavior were checked for drift-sensitive patterns; no new migration/journal issue was found.

## Validation Evidence

Commands run during this review:

- `npm run lint:api-auth --workspace=apps/web` - passed; admin API routes reported OK.
- `npm run lint:action-origin --workspace=apps/web` - passed; all mutating server actions reported same-origin coverage or documented exemption.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed; public mutating API route scanner reported OK.
- Static evidence gathered with `rg --files`, `rg` sweeps, `find` inventory counts, `nl -ba` line inspections, package/config reads, current HEAD checks, and cross-file tracing.

I did not run full lint, typecheck, build, or the full Vitest suite because this prompt requested a review-only artifact and no executable source changed. The three targeted guardrails above were run to validate the reviewed trust-boundary claims.

## Recommendation

Request changes for `C10-CQ-01` before treating the analytics rate limit as complete. Treat `C10-CQ-02` as low-severity hardening and scanner-quality work: not an emergency, but worth fixing because it narrows the server-action trust boundary and prevents future same-origin ordering regressions.
